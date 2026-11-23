/**
 * Context Monitor - Claude usage-limit watcher (MAIN world, claude.ai only)
 *
 * Runs in claude.ai's own JavaScript world. Claude reports plan limits (5-hour session, 7-day weekly)
 * inside reply streams. Two transports carry them:
 *   1. Classic chat: server-sent events (`message_limit`) on .../completion
 *   2. Unified interface: binary Connect frames on /claudeai-rpc/...ConversationService/StreamTimeline
 *
 * Privacy boundary:
 * Extracts ONLY limit fields (utilization and reset time of the 5-hour and 7-day windows).
 * Compressed frames (the reply text) are skipped without decompressing; only their 5-byte header is read.
 * Headers, cookies, and prompt/reply contents are never stored, decoded, or forwarded.
 */
(function (win) {
  'use strict';
  const targetWin = typeof win !== 'undefined' ? win : (typeof window !== 'undefined' ? window : globalThis);
  if (targetWin.__CONTEXT_MONITOR_CLAUDE_LIMITS__) return;
  targetWin.__CONTEXT_MONITOR_CLAUDE_LIMITS__ = true;

  const SOURCE = 'CONTEXT_MONITOR_CLAUDE_LIMIT';
  const COMPLETION_PATH = /\/api\/organizations\/([^/]+)\/chat_conversations\/[^/]+\/(retry_)?completion[0-9]*(\?|$)/;
  const TIMELINE_PATH = /\/claudeai-rpc\/[\w.]*ConversationService\/StreamTimeline(\?|$)/;
  const ACTION_PATH = /\/claudeai-rpc\/[\w.]*ConversationService\/PerformAction(\?|$)/;
  const MAX_BYTES = 8 * 1024 * 1024;
  const FRAME_HEADER = 5;
  const MAX_FRAME = 4 * 1024 * 1024;
  const MAX_DEPTH = 8;
  const RESET_AHEAD_S = 8 * 24 * 60 * 60;
  const RECENT_KEYS = 32;

  const recentKeys = [];

  function send(payload, orgId) {
    try {
      const origin = targetWin.location?.origin || '*';
      targetWin.postMessage({
        source: SOURCE,
        messageLimit: payload,
        limits: payload?.limits || payload,
        orgId: orgId || null
      }, origin);
    } catch (_) {}
  }

  function toWindow(winObj) {
    if (!winObj || typeof winObj !== 'object') return null;
    const utilization = Number(winObj.utilization);
    if (!Number.isFinite(utilization)) return null;
    const resetsAt = Number(winObj.resets_at ?? (winObj.resetTime ? winObj.resetTime / 1000 : null));
    const exceeded = winObj.status === 'exceeded_limit' || utilization >= 1;
    return {
      percentage: exceeded ? 100 : Math.min(99, Math.round(utilization * 100)),
      resetTime: Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt * 1000 : null,
      utilization
    };
  }

  function reportMessageLimit(ml, orgId) {
    if (!ml || typeof ml !== 'object') return;
    const windows = ml.windows && typeof ml.windows === 'object' ? ml.windows : null;
    if (windows) {
      const session = toWindow(windows['5h']);
      const weekly = toWindow(windows['7d']);
      const payload = {
        ...ml,
        windows,
        session,
        weekly,
        limits: { session, weekly }
      };
      send(payload, orgId);
      return;
    }
    // Limit hit / exceeded / within_limit
    send(ml, orgId);
  }

  /** Finds a limits object in a rejected request's body or nested error details. */
  function limitFromError(text, orgId) {
    try {
      const body = JSON.parse(text);
      const err = body?.error;
      const inner = typeof err?.message === 'string' ? (() => { try { return JSON.parse(err.message); } catch (_) { return null; } })() : err;
      const ml = (inner && (inner.windows ? inner : inner?.message_limit || inner?.extra?.details?.message_limit)) ||
        (err && (err.windows ? err : err?.message_limit || err?.extra?.details?.message_limit)) ||
        (body?.message_limit ? body.message_limit : null);
      if (ml) reportMessageLimit(ml, orgId);
    } catch (_) {}
  }

  // ── Classic chat: Server-Sent Events ────────────────────────────────────────
  const DATA_PREFIX = ascii('data:');
  const EVENT_MARK = ascii('"message_limit"');
  const MAX_LINE = 64 * 1024;

  async function scanEventStream(body, orgId) {
    if (!body) return;
    const reader = body.getReader();
    let carry = null;
    let skipping = false;
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        let start = 0;
        for (let nl = value.indexOf(0x0A); nl !== -1; nl = value.indexOf(0x0A, start)) {
          if (!skipping) checkLine(carry ? concat(carry, value.subarray(start, nl)) : value.subarray(start, nl), orgId);
          carry = null;
          skipping = false;
          start = nl + 1;
        }
        if (!skipping && start < value.length) {
          carry = carry ? concat(carry, value.subarray(start)) : value.slice(start);
          if (carry.length > MAX_LINE) { carry = null; skipping = true; }
        }
        if (bytes > MAX_BYTES) { reader.cancel().catch(() => {}); return; }
      }
    } catch (_) {}
  }

  function checkLine(line, orgId) {
    if (!startsWith(line, DATA_PREFIX) || indexOfBytes(line, EVENT_MARK) === -1) return;
    try {
      const event = JSON.parse(new TextDecoder().decode(line.subarray(DATA_PREFIX.length)));
      if (event && event.type === 'message_limit' && event.message_limit) {
        reportMessageLimit(event.message_limit, orgId);
      }
    } catch (_) {}
  }

  // ── Unified interface: StreamTimeline (Connect + protobuf) ──────────────────
  async function scanTimeline(body, orgId) {
    if (!body) return;
    const reader = body.getReader();
    const queue = byteQueue();
    let frame = null;
    let skip = 0;
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) { reader.cancel().catch(() => {}); return; }
        queue.push(value);
        for (;;) {
          if (skip) {
            skip -= queue.drop(skip);
            if (skip) break;
          }
          if (!frame) {
            if (queue.size < FRAME_HEADER) break;
            const head = queue.take(FRAME_HEADER);
            const flags = head[0];
            const length = head[1] * 0x1000000 + (head[2] << 16) + (head[3] << 8) + head[4];
            if (length > MAX_FRAME) { reader.cancel().catch(() => {}); return; }
            if (flags & 0x02) { skip = length; continue; }
            if (flags & 0x01) {
              skip = length;
              continue;
            }
            if (flags !== 0x00) { skip = length; continue; }
            frame = { length };
          }
          if (queue.size < frame.length) break;
          const payload = queue.take(frame.length);
          frame = null;
          readFrame(payload, orgId);
        }
      }
    } catch (_) {}
  }

  function readFrame(payload, orgId) {
    if (!payload || !(hasLabel(payload, 0x35, 0x68) || hasLabel(payload, 0x37, 0x64))) return;
    const found = {};
    findWindows(payload, 0, payload.length, 0, found);
    const rated = (w) => Boolean(w && w.utilization !== null);
    if (!rated(found.session) && !rated(found.weekly)) return;
    const session = toLimit(found.session);
    const weekly = toLimit(found.weekly);
    const eventKey = fnv1a(payload);
    if (recentKeys.includes(eventKey)) return;
    recentKeys.push(eventKey);
    if (recentKeys.length > RECENT_KEYS) recentKeys.shift();
    reportMessageLimit({
      windows: {
        '5h': session ? { utilization: session.utilization, resets_at: session.resetTime ? session.resetTime / 1000 : null } : null,
        '7d': weekly ? { utilization: weekly.utilization, resets_at: weekly.resetTime ? weekly.resetTime / 1000 : null } : null
      },
      session,
      weekly
    }, orgId);
  }

  function toLimit(winObj) {
    if (!winObj) return null;
    const utilization = winObj.utilization ?? 0;
    return {
      percentage: (winObj.status === 'exceeded_limit' || utilization >= 1) ? 100 : Math.min(99, Math.round(utilization * 100)),
      resetTime: winObj.resetsAt ? winObj.resetsAt * 1000 : null,
      utilization
    };
  }

  function findWindows(bytes, start, end, depth, found) {
    const list = fields(bytes, start, end);
    if (!list) return;
    const label = list.find((f) => f.wire === 2 && f.end - f.start === 2 && labelAt(bytes, f.start));
    if (label) {
      const key = labelAt(bytes, label.start);
      if (!found[key]) found[key] = windowFrom(bytes, list.filter((f) => f !== label), depth);
      return;
    }
    if (depth >= MAX_DEPTH) return;
    for (const f of list) {
      if (f.wire === 2 && f.end > f.start) findWindows(bytes, f.start, f.end, depth + 1, found);
    }
  }

  function labelAt(bytes, i) {
    if (bytes[i] === 0x35 && bytes[i + 1] === 0x68) return 'session';
    if (bytes[i] === 0x37 && bytes[i + 1] === 0x64) return 'weekly';
    return null;
  }

  function windowFrom(bytes, list, depth) {
    const nowS = Date.now() / 1000;
    const hit = { utilization: null, resetsAt: null };
    collect(bytes, list, depth, hit, nowS);
    return hit.resetsAt === null ? null : hit;
  }

  function collect(bytes, list, depth, hit, nowS) {
    for (const f of list) {
      if (hit.utilization !== null && hit.resetsAt !== null) return;
      if (f.wire === 1 && hit.utilization === null) {
        const value = new DataView(bytes.buffer, bytes.byteOffset + f.start, 8).getFloat64(0, true);
        if (Number.isFinite(value) && value >= 0 && value <= 1.5) hit.utilization = value;
      } else if (f.wire === 0 && hit.resetsAt === null) {
        if (f.value > nowS - 3600 && f.value < nowS + RESET_AHEAD_S) hit.resetsAt = f.value;
      } else if (f.wire === 2 && depth < MAX_DEPTH) {
        const sub = fields(bytes, f.start, f.end);
        if (sub) collect(bytes, sub, depth + 1, hit, nowS);
      }
    }
  }

  function fields(bytes, start, end) {
    const list = [];
    let pos = start;
    while (pos < end) {
      const tag = varint(bytes, pos, end);
      if (!tag || tag.value < 8) return null;
      pos = tag.next;
      const wire = tag.value % 8;
      if (wire === 0) {
        const v = varint(bytes, pos, end);
        if (!v) return null;
        list.push({ wire, value: v.value });
        pos = v.next;
      } else if (wire === 1 || wire === 5) {
        const size = wire === 1 ? 8 : 4;
        if (pos + size > end) return null;
        list.push({ wire, start: pos, end: pos + size });
        pos += size;
      } else if (wire === 2) {
        const len = varint(bytes, pos, end);
        if (!len || len.next + len.value > end) return null;
        list.push({ wire, start: len.next, end: len.next + len.value });
        pos = len.next + len.value;
      } else {
        return null;
      }
    }
    return list;
  }

  function varint(bytes, pos, end) {
    let value = 0;
    for (let i = 0, scale = 1; i < 10 && pos < end; i++, scale *= 128) {
      const b = bytes[pos++];
      value += (b & 0x7f) * scale;
      if (b < 0x80) return { value, next: pos };
    }
    return null;
  }

  function byteQueue() {
    const chunks = [];
    let size = 0;
    return {
      get size() { return size; },
      push(chunk) {
        if (!chunk.byteLength) return;
        chunks.push(chunk);
        size += chunk.byteLength;
      },
      drop(n) {
        const count = Math.min(n, size);
        let left = count;
        while (left) {
          const head = chunks[0];
          if (head.byteLength <= left) { chunks.shift(); left -= head.byteLength; }
          else { chunks[0] = head.subarray(left); left = 0; }
        }
        size -= count;
        return count;
      },
      take(n) {
        const out = new Uint8Array(n);
        let offset = 0;
        while (offset < n) {
          const head = chunks[0];
          const k = Math.min(head.byteLength, n - offset);
          out.set(head.subarray(0, k), offset);
          offset += k;
          if (k === head.byteLength) chunks.shift();
          else chunks[0] = head.subarray(k);
        }
        size -= n;
        return out;
      }
    };
  }

  function ascii(text) {
    return Uint8Array.from(text, (c) => c.charCodeAt(0));
  }

  function concat(a, b) {
    const out = new Uint8Array(a.byteLength + b.byteLength);
    out.set(a);
    out.set(b, a.byteLength);
    return out;
  }

  function startsWith(bytes, prefix) {
    if (bytes.byteLength < prefix.byteLength) return false;
    for (let i = 0; i < prefix.byteLength; i++) if (bytes[i] !== prefix[i]) return false;
    return true;
  }

  function indexOfBytes(bytes, needle) {
    for (let i = bytes.indexOf(needle[0]); i !== -1 && i + needle.byteLength <= bytes.byteLength; i = bytes.indexOf(needle[0], i + 1)) {
      let j = 1;
      while (j < needle.byteLength && bytes[i + j] === needle[j]) j++;
      if (j === needle.byteLength) return i;
    }
    return -1;
  }

  function hasLabel(bytes, a, b) {
    for (let i = bytes.indexOf(0x02); i !== -1 && i + 2 < bytes.byteLength; i = bytes.indexOf(0x02, i + 1)) {
      if (bytes[i + 1] === a && bytes[i + 2] === b) return true;
    }
    return false;
  }

  function fnv1a(bytes) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.byteLength; i++) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function classify(input) {
    try {
      const raw = typeof input === 'string' ? input : (input && input.url) || String(input);
      const completion = COMPLETION_PATH.exec(raw);
      if (completion) return { type: 'completion', orgId: completion[1] };
      if (TIMELINE_PATH.test(raw)) return { type: 'timeline' };
      if (ACTION_PATH.test(raw)) return { type: 'action' };
    } catch (_) {}
    return null;
  }

  // Hook fetch
  const originalFetch = targetWin.fetch;
  targetWin.fetch = function (input, _init) {
    const pending = originalFetch.apply(this, arguments);
    const kind = classify(input);
    if (!kind) return pending;
    if (kind.type === 'action') {
      return pending;
    }
    return pending.then((response) => {
      try {
        if (!response.ok) {
          response.clone().text().then((t) => limitFromError(t, kind.orgId)).catch(() => {});
          return response;
        }
        const contentType = response.headers?.get?.('content-type') || '';
        if (kind.type === 'timeline' && contentType.includes('application/connect+proto')) {
          scanTimeline(response.clone().body, kind.orgId).catch(() => {});
        } else if (kind.type === 'completion' || contentType.includes('text/event-stream')) {
          scanEventStream(response.clone().body, kind.orgId).catch(() => {});
        } else if (contentType.includes('application/json')) {
          response.clone().text().then((t) => limitFromError(t, kind.orgId)).catch(() => {});
        }
      } catch (_) {}
      return response;
    });
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
