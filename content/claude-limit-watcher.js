/**
 * Context Monitor - Claude usage-limit watcher (MAIN world, claude.ai only)
 *
 * claude.ai reports plan limits (5-hour session, 7-day weekly) inside each reply's stream as a
 * `message_limit` event, not through /usage on every plan. This passively reads a clone of the
 * completion stream and forwards ONLY that event's object to the extension. Message text, headers
 * and cookies are never read or forwarded; the page's own request is never altered.
 */
(function () {
  'use strict';
  if (window.__CONTEXT_MONITOR_CLAUDE_LIMITS__) return;
  window.__CONTEXT_MONITOR_CLAUDE_LIMITS__ = true;

  const SOURCE = 'CONTEXT_MONITOR_CLAUDE_LIMIT';
  const COMPLETION_RE = /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/(retry_)?completion[0-9]*(\?|$)/;

  const send = (messageLimit) => {
    try { window.postMessage({ source: SOURCE, messageLimit }, window.location.origin); } catch (_) {}
  };

  /** Finds a limits object in a rejected request's body or nested error details. */
  function limitFromError(text) {
    try {
      const body = JSON.parse(text);
      const err = body?.error;
      const inner = typeof err?.message === 'string' ? (() => { try { return JSON.parse(err.message); } catch (_) { return null; } })() : err;
      const ml = (inner && (inner.windows ? inner : inner?.message_limit || inner?.extra?.details?.message_limit)) ||
        (err && (err.windows ? err : err?.message_limit || err?.extra?.details?.message_limit)) ||
        (body?.message_limit ? body.message_limit : null);
      if (ml) send(ml);
    } catch (_) {}
  }

  async function watch(response) {
    if (!response.ok) return limitFromError(await response.text());
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = 'message';
    let currentData = '';

    const processEvent = () => {
      if (!currentData) return;
      const isLimitEvent = currentEvent === 'message_limit' ||
        currentData.includes('message_limit') ||
        currentData.includes('messageLimit') ||
        currentData.includes('within_limit') ||
        currentData.includes('exceeded_limit');
      if (isLimitEvent) {
        try {
          const evt = JSON.parse(currentData);
          const ml = evt?.message_limit ||
            evt?.messageLimit ||
            (evt?.windows ? evt : null) ||
            (evt?.type ? evt : null);
          if (ml) send(ml);
        } catch (_) {}
      }
      currentEvent = 'message';
      currentData = '';
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        const trimmed = line.trim();
        if (trimmed === '') {
          processEvent();
        } else if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          const d = trimmed.slice(5).trim();
          currentData = currentData ? `${currentData}\n${d}` : d;
        }
      }
    }
    processEvent();
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (COMPLETION_RE.test(url)) {
        promise.then(res => watch(res.clone())).catch(() => {}); // Never affects the page's request
      }
    } catch (_) {}
    return promise;
  };
})();
