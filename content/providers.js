/**
 * Context Monitor - Provider adapters for Claude (claude.ai) and Gemini (gemini.google.com)
 *
 * Each adapter only knows its site: how to find the conversation id, read turns from the page,
 * read the model and plan, and which context window applies. Everything else (tokenizer, evidence,
 * confidence, widget) is the shared engine in provider-coordinator.js.
 *
 * Context windows come only from the providers' own published pages; anything not published stays
 * UNKNOWN. Neither provider publishes the tokenizer its chat app uses, so counts are ESTIMATED with
 * the o200k BPE tokenizer and confidence can never be HIGH for these sites.
 */

import { GemmaCounter } from '../engine/gemma-tokenizer.js';

// element -> { raw, text }: cleaning clones the node, so unchanged elements reuse the last result
const textCache = new WeakMap();
// Set while a MutationObserver reports every page change through invalidateText(): cached text is
// then trusted without re-reading the element.
const textTrust = { enabled: false };

/** Page change at `node`: drop cached text of every element containing it. */
export function invalidateText(node) {
  for (let el = node && (node.nodeType === 1 ? node : node.parentElement); el; el = el.parentElement) textCache.delete(el);
}

/** Trust cached text while mutations are being reported (see invalidateText). */
export function trustTextCache(enabled) {
  textTrust.enabled = Boolean(enabled);
}

/**
 * Visible text of a message element without UI chrome (buttons, screen-reader labels, thinking).
 * @param {Element} el
 * @param {string} removeSelector
 * @returns {string}
 */
export function cleanText(el, removeSelector) {
  if (!el) return '';
  if (textTrust.enabled) {
    const trusted = textCache.get(el);
    if (trusted) return trusted.text;
  }
  const count = typeof el.getElementsByTagName === 'function' ? el.getElementsByTagName('*').length : -1;
  const raw = `${count}|${el.textContent || ''}`;
  const hit = textCache.get(el);
  if (hit && hit.raw === raw) return hit.text;
  let text;
  if (typeof el.cloneNode === 'function') {
    const clone = el.cloneNode(true);
    if (removeSelector && clone.querySelectorAll) clone.querySelectorAll(removeSelector).forEach(n => n.remove());
    text = (clone.innerText || clone.textContent || '').trim();
  } else {
    text = (el.innerText || el.textContent || '').trim();
  }
  textCache.set(el, { raw, text });
  return text;
}

/** Keeps only matches that are not inside another match (a turn wrapper can contain the message). */
function topLevel(nodes) {
  const set = new Set(nodes);
  return nodes.filter(n => {
    for (let p = n.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
    return true;
  });
}

// ============================================================================ Claude

// support.claude.com/en/articles/8606394 (checked 2026-09-24): chatting on paid plans (Pro, Max,
// Team, Enterprise) is 200K, except these models at 1M. Free plan has standard 200K context window.
const CLAUDE_LIMIT_SOURCE = 'Claude Help Center: context window on paid plans (support.claude.com/en/articles/8606394)';
const CLAUDE_FREE_SOURCE = 'Claude Help Center: standard free context window (support.claude.com)';
// Haiku 5.5 shares the 1M window with Opus 5.5, Sonnet 5, Sonnet 5.5 and Fable 5.1 on paid plans.
const CLAUDE_1M_MODELS = new Set(['haiku-5.5', 'fable-5.1', 'opus-5.5', 'sonnet-5', 'sonnet-5.5']);
const CLAUDE_PAID_PLANS = new Set(['pro', 'max', 'team', 'enterprise']);
// Hidden-context estimates. claude.ai's prompt/tool sizes are not published; these follow the community
// measurements in lugia19/Claude-Usage-Extension (checked 2026-09-28). Keyed by the account/conversation setting flag.
const CLAUDE_SYSTEM_PROMPT_ESTIMATE = 3200;
const CLAUDE_PREFERENCES_BASE = 850; // Wrapper text around your preferences
// o200k undercounts Claude's (unpublished) tokenizer; same factor as that extension
const CLAUDE_TOKEN_SCALE = 1.4;
// Codename flags keep their codename: what they switch on is not documented
const CLAUDE_FEATURE_COSTS = {
  enabled_web_search: ['Web search', 10250],
  citation_info: ['Citations', 450],
  enabled_artifacts_attachments: ['Artifacts', 2200],
  preview_feature_uses_artifacts: ['Artifacts (preview)', 8400],
  preview_feature_uses_latex: ['LaTeX', 200],
  enabled_monkeys_in_a_barrel: ['Code execution', 5300],
  enabled_saffron: ['Memory', 4250],
  enabled_saffron_search: ['Memory search', 3000],
  enabled_melange: ['Memory files', 14000],
  enabled_bananagrams: ['Feature "bananagrams"', 750],
  enabled_sourdough: ['Feature "sourdough"', 900],
  enabled_foccacia: ['Feature "foccacia"', 1350],
  enabled_compass: ['Feature "compass"', 1000],
  enabled_turmeric: ['Feature "turmeric"', 2000]
};

/**
 * "claude-opus-5-5", "Opus 5.5", "claude-sonnet-4-5-20250929", "claude-3-5-sonnet-20241022" -> "opus-5.5",
 * "opus-5.5", "sonnet-4.5", "sonnet-3.5". null when no Claude family/version is present.
 * @param {string} value
 * @returns {string|null}
 */
export function claudeModelKey(value) {
  const s = String(value || '').toLowerCase();
  // Versions are 1-2 digits, so a date suffix ("sonnet-20241022") is never read as a version
  let m = s.match(/\b(opus|sonnet|haiku|fable)[\s-]*(\d{1,2})(?:[.-](\d{1,2}))?(?!\d)/);
  if (!m) {
    const old = s.match(/claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku)/);
    if (!old) return null;
    m = [null, old[3], old[1], old[2]];
  }
  const minor = m[3] && m[3] !== '0' ? `.${m[3]}` : '';
  return `${m[1]}-${m[2]}${minor}`;
}

export const ClaudeProvider = {
  name: 'Claude',
  hosts: ['claude.ai'],
  inputSelector: 'div.ProseMirror[contenteditable="true"], [data-testid="chat-input"], fieldset [contenteditable="true"]',
  replySelector: '.font-claude-response, .font-claude-message', // Assistant replies (Capsule reader)
  userSelector: '[data-testid="user-message"]', // The user's messages (Capsule transcript)
  hasApi: true,

  conversationId(url) {
    const m = String(url || '').match(/\/chat\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  },

  findInput(doc) {
    return doc.querySelector(this.inputSelector);
  },

  extractMessages(doc) {
    const nodes = topLevel(Array.from(doc.querySelectorAll('[data-testid="user-message"], .font-claude-response, .font-claude-message')));
    return nodes.map((el, i) => {
      const role = el.matches && el.matches('[data-testid="user-message"]') ? 'user' : 'assistant';
      const text = cleanText(el, 'button, .sr-only, [aria-hidden="true"]');
      return { id: `claude-dom-${i}-${role}`, role, text, parts: [{ type: 'text', text }], isStreaming: Boolean(el.closest && el.closest('[data-is-streaming="true"]')) };
    }).filter(m => m.text);
  },

  detectModel(doc) {
    const el = doc.querySelector('[data-testid="model-selector-dropdown"]');
    const text = el ? (el.textContent || '').trim() : '';
    return text && claudeModelKey(text) ? text : null;
  },

  detectPlan(doc) {
    const el = doc.querySelector('[data-testid="user-menu-button"]');
    const m = el ? (el.textContent || '').match(/\b(Free|Pro|Max|Team|Enterprise)(?:\s+plan)?\b/i) : null;
    return m ? { value: m[1].toLowerCase(), source: 'dom', evidenceType: 'OBSERVED' } : null;
  },

  modelKey: claudeModelKey,
  // claude.ai keeps tool calls but drops earlier tool results (e.g. search pages) from later requests
  dropsOldToolResults: true,
  tokenScale: CLAUDE_TOKEN_SCALE,
  // Limits also arrive in each reply's stream (the only source on plans where /usage is empty)
  limitStreamSource: 'CONTEXT_MONITOR_CLAUDE_LIMIT',

  displayName(raw) {
    const key = claudeModelKey(raw);
    if (!key) return raw || null;
    const [family, version] = key.split('-');
    return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${version}`;
  },

  /**
   * @returns {{ contextWindow: number|null, status: string, source: string, recognized: boolean }}
   */
  resolveLimit(rawModel, plan) {
    const key = claudeModelKey(rawModel);
    if (!key) return { contextWindow: null, status: 'UNKNOWN', source: 'Model not recognized', recognized: false };
    if (plan === 'free') return { contextWindow: 200000, status: 'VERIFIED', source: CLAUDE_FREE_SOURCE, recognized: true };
    if (!plan || plan === 'unknown') return { contextWindow: null, status: 'UNKNOWN', source: 'Plan unknown', recognized: true };
    if (!CLAUDE_PAID_PLANS.has(plan)) return { contextWindow: null, status: 'UNKNOWN', source: `No published context window for the ${plan} plan`, recognized: true };
    return { contextWindow: CLAUDE_1M_MODELS.has(key) ? 1000000 : 200000, status: 'VERIFIED', source: CLAUDE_LIMIT_SOURCE, recognized: true };
  },

  /** Organization id: the lastActiveOrg cookie, else the first organization of the account. */
  async _orgId(fetchJson) {
    const m = (typeof document !== 'undefined' ? document.cookie : '').match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
    const orgs = await fetchJson('/api/organizations');
    return Array.isArray(orgs) && orgs[0]?.uuid ? orgs[0].uuid : null;
  },

  /**
   * Reads the saved conversation (claude.ai's own same-origin API, cookie-authenticated) and the
   * account plan. Returns null when unavailable; the page is then read instead.
   */
  async fetchConversation(conversationId, fetchJson) {
    const org = await this._orgId(fetchJson);
    if (!org) return null;
    const optional = (path) => fetchJson(path).catch(() => null); // Hidden context is best effort
    const [conv, orgInfo, profile, account, usage] = await Promise.all([
      fetchJson(`/api/organizations/${org}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`),
      optional(`/api/organizations/${org}`),
      optional('/api/account_profile'),
      optional('/api/account'),
      optional(`/api/organizations/${org}/usage`)
    ]);
    const projectId = conv?.project_uuid || conv?.project?.uuid || null;
    const [project, kb] = projectId
      ? await Promise.all([optional(`/api/organizations/${org}/projects/${projectId}`), optional(`/api/organizations/${org}/projects/${projectId}/kb/stats`)])
      : [null, null];
    return {
      ...this.normalizeConversation(conv),
      plan: this.planFromOrganization(orgInfo),
      hidden: this.hiddenContext({ conv, profile, account, project, kb }),
      limits: this.parseUsage(usage)
    };
  },

  /**
   * Plan limits from a reply stream's `message_limit` event (see claude-limit-watcher.js):
   * 1. Paid plans: { windows: { "5h": { utilization: 0..1, resets_at }, "7d": {...} }, resetsAt }.
   * 2. Limit hit: { type: 'exceeded_limit', resetsAt } or { blocked: true }.
   * 3. Approaching limit: { remaining, resetsAt }.
   * 4. Free plan / within limit: { type: 'within_limit' }.
   * @returns {Array<{ key: string, label: string, percent?: number, remaining?: number, blocked?: boolean, resetsAt?: number|null, note?: string }>}
   */
  parseMessageLimit(ml) {
    if (!ml || typeof ml !== 'object') return [];
    const toMs = (v) => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : v ? Date.parse(v) || null : null);
    const windows = ml.windows && typeof ml.windows === 'object' ? ml.windows : null;
    if (windows) {
      const names = { '5h': ['session', 'Session (5h)'], '7d': ['weekly', 'Weekly'] };
      const out = [];
      for (const [win, [key, label]] of Object.entries(names)) {
        const w = windows[win];
        const u = w?.utilization;
        if (typeof u !== 'number' || !isFinite(u)) continue;
        out.push({
          key,
          label,
          percent: Math.round(u > 1 ? u : u * 100),
          resetsAt: toMs(w.resets_at ?? w.resetsAt ?? (key === 'session' ? ml.resetsAt : null))
        });
      }
      if (out.length) return out;
    }

    if (ml.type === 'exceeded_limit' || ml.blocked || ml.status === 'exceeded_limit') {
      const resetsAt = toMs(ml.resetsAt ?? ml.resets_at);
      return [{ key: 'session', label: 'Session', blocked: true, percent: 100, resetsAt, note: null }];
    }

    if (typeof ml.remaining === 'number') {
      const resetsAt = toMs(ml.resetsAt ?? ml.resets_at);
      return [{ key: 'session', label: 'Session', remaining: ml.remaining, resetsAt, note: null }];
    }

    if (ml.type === 'within_limit') {
      return [{ key: 'session', label: 'Session', note: 'Within limit · Dynamic' }];
    }

    return [];
  },

  /**
   * Plan usage limits from /api/organizations/{org}/usage, as claude.ai reports them.
   * Two shapes exist: { limits: [{ kind, percent, resets_at, scope }] } and the older top-level
   * { five_hour|seven_day|seven_day_opus|seven_day_sonnet: { utilization, resets_at } }.
   * @returns {Array<{ key: string, label: string, percent: number, resetsAt: number|null }>}
   */
  parseUsage(usage) {
    if (!usage || typeof usage !== 'object') return [];
    const at = (iso) => (iso ? new Date(iso).getTime() || null : null);
    const out = [];
    const add = (key, label, percent, resetsAt) => {
      if (typeof percent === 'number' && isFinite(percent)) out.push({ key, label, percent: Math.round(percent), resetsAt: at(resetsAt) });
    };
    if (Array.isArray(usage.limits)) {
      for (const l of usage.limits) {
        const model = l.scope?.model?.display_name;
        if (l.kind === 'session') add('session', 'Session (5h)', l.percent, l.resets_at);
        else if (l.kind === 'weekly_all') add('weekly', 'Weekly', l.percent, l.resets_at);
        else if (l.kind === 'weekly_scoped' && model) add(`weekly:${model}`, `Weekly · ${model}`, l.percent, l.resets_at);
      }
    } else {
      const top = [['five_hour', 'session', 'Session (5h)'], ['seven_day', 'weekly', 'Weekly'],
        ['seven_day_opus', 'weekly:Opus', 'Weekly · Opus'], ['seven_day_sonnet', 'weekly:Sonnet', 'Weekly · Sonnet']];
      for (const [field, key, label] of top) if (usage[field]) add(key, label, usage[field].utilization, usage[field].resets_at);
    }
    return out;
  },

  /**
   * What claude.ai sends with every message besides the chat itself. Text items carry their text
   * (counted by the tokenizer); fixed-cost items carry `tokens` and are estimates.
   * Sources: /api/account_profile, /api/account (+ conversation settings), the project and its kb/stats.
   * @returns {Array<{ kind: string, label: string, text: string, tokens?: number, estimated?: boolean, included?: boolean }>}
   */
  hiddenContext({ conv, profile, account, project, kb } = {}) {
    const items = [{
      kind: 'system_prompt', label: 'Claude system prompt (estimate)', tokens: CLAUDE_SYSTEM_PROMPT_ESTIMATE, estimated: true,
      text: `Not readable from the page. Estimated at ~${CLAUDE_SYSTEM_PROMPT_ESTIMATE.toLocaleString()} tokens.`
    }];
    const prefs = profile?.conversation_preferences;
    if (typeof prefs === 'string' && prefs.trim()) {
      items.push({ kind: 'instructions', label: 'Your preferences', text: prefs });
      items.push({ kind: 'instructions_base', label: 'Preferences framing (estimate)', tokens: CLAUDE_PREFERENCES_BASE, estimated: true,
        text: `Fixed text claude.ai wraps around your preferences, ~${CLAUDE_PREFERENCES_BASE} tokens.` });
    }

    const instructions = project?.prompt_template;
    if (typeof instructions === 'string' && instructions.trim()) items.push({ kind: 'project', label: 'Project instructions', text: instructions });
    const settings = { ...(account?.settings || {}), ...(conv?.settings || {}) };
    const kbTokens = Number(kb?.knowledge_size) || 0;
    if (kbTokens > 0) {
      // Large projects switch to search: files are retrieved as needed, not sent whole
      const searched = Boolean(settings.use_project_knowledge_search || kb?.use_project_knowledge_search);
      items.push({
        kind: 'project_knowledge', label: searched ? 'Project knowledge (searched as needed)' : 'Project knowledge', tokens: kbTokens,
        included: !searched, text: searched ? 'Project is in search mode: only retrieved parts are sent, so the full size is not counted.' : 'Size of the project knowledge files as reported by claude.ai.'
      });
    }

    // Enabled tools/features add fixed prompt text (sizes: community measurements, not published)
    for (const [flag, [label, tokens]] of Object.entries(CLAUDE_FEATURE_COSTS)) {
      if (settings[flag] === true) items.push({ kind: 'tool', label: `${label} (estimate)`, tokens, estimated: true, text: `${label} is enabled; its instructions add ~${tokens.toLocaleString()} tokens.` });
    }
    return items;
  },

  /** capabilities: claude_max / claude_pro / raven (Team or Enterprise); only "chat" -> free (inferred). */
  planFromOrganization(org) {
    const caps = Array.isArray(org?.capabilities) ? org.capabilities : null;
    if (!caps) return null;
    if (caps.includes('claude_max')) return { value: 'max', evidenceType: 'OBSERVED' };
    if (caps.includes('claude_pro')) return { value: 'pro', evidenceType: 'OBSERVED' };
    if (caps.includes('raven')) return { value: org.raven_type === 'enterprise' ? 'enterprise' : 'team', evidenceType: 'OBSERVED' };
    return { value: 'free', evidenceType: 'ESTIMATED' }; // No paid capability listed
  },

  /**
   * Active branch (current_leaf_message_uuid -> parents) of a claude.ai conversation, as turns.
   * Tool calls stay in the reply, tool results become "tool" turns; thinking is not resent, so it is skipped;
   * text extracted from attached files is part of the prompt and counted with the user turn.
   */
  normalizeConversation(conv) {
    const all = Array.isArray(conv?.chat_messages) ? conv.chat_messages : [];
    const byId = new Map(all.map(m => [m.uuid, m]));
    let chain = [];
    if (conv?.current_leaf_message_uuid && byId.has(conv.current_leaf_message_uuid)) {
      const seen = new Set();
      for (let m = byId.get(conv.current_leaf_message_uuid); m && !seen.has(m.uuid); m = byId.get(m.parent_message_uuid)) {
        seen.add(m.uuid);
        chain.unshift(m);
      }
    } else {
      chain = [...all].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    }

    const messages = [];
    let files = 0;
    let unknownFiles = 0;
    const fileList = [];
    for (const m of chain) {
      const role = m.sender === 'human' ? 'user' : 'assistant';
      const text = [];
      const tool = [];
      if (Array.isArray(m.content) && m.content.length > 0) {
        for (const block of m.content) {
          if (block.type === 'text' && block.text) text.push(block.text);
          // The call stays in the reply; only the result is dropped once a newer message is sent
          else if (block.type === 'tool_use') text.push(JSON.stringify(block.input ?? {}));
          else if (block.type === 'tool_result') {
            const c = Array.isArray(block.content) ? block.content.map(x => x.text || '').join('\n') : String(block.content ?? '');
            if (c) tool.push(c);
          }
        }
      } else if (m.text) {
        text.push(m.text);
      }
      for (const a of m.attachments || []) {
        files++;
        // Extracted text is part of the message and already counted there; anything else has no known cost
        fileList.push({ name: a.file_name, type: 'document', inText: Boolean(a.extracted_content) });
        if (a.extracted_content) text.push(a.extracted_content);
        else unknownFiles++;
      }
      const stored = [...(m.files || []), ...(m.files_v2 || [])];
      for (const f of stored) fileList.push({ name: f.file_name, type: f.file_kind || 'file' });
      files += stored.length;
      unknownFiles += stored.length;
      const createdAt = m.created_at ? (Date.parse(m.created_at) || null) : null;
      if (text.length) messages.push({ id: m.uuid, role, text: text.join('\n\n'), parts: [{ type: 'text', text: text.join('\n\n') }], createdAt, isStreaming: false });
      if (tool.length) messages.push({ id: `${m.uuid}-tool`, role: 'tool', text: tool.join('\n\n'), parts: [{ type: 'text', text: tool.join('\n\n') }], createdAt, isStreaming: false });
    }
    return {
      conversationId: conv?.uuid || null,
      model: conv?.model || null,
      messages,
      visibleTurns: chain.length,
      rawMessages: all.length, // Diagnostics: saved turns before normalization (spots a format change)
      attachments: { count: files, files: fileList, estimatedTokens: 0, hasUnknown: unknownFiles > 0 }
    };
  },

  /**
   * Computes the rolling 5-hour session window and estimated utilization on Free plans.
   * Rolling window rule: 5-hour timer starts from the first prompt sent within the window.
   */
  resolveSessionWindow(messages = [], model = null, now = Date.now(), storedWindow = null) {
    const WINDOW_MS = 5 * 3600 * 1000;
    const userTurns = messages.filter(m => m.role === 'user' && m.createdAt && m.createdAt <= now);
    const recentTurns = userTurns.filter(m => m.createdAt > now - WINDOW_MS);

    let windowStart = null;
    if (storedWindow?.startedAt && (now - storedWindow.startedAt < WINDOW_MS)) {
      windowStart = storedWindow.startedAt;
    }

    if (recentTurns.length > 0) {
      const earliestRecent = Math.min(...recentTurns.map(t => t.createdAt));
      windowStart = windowStart ? Math.min(windowStart, earliestRecent) : earliestRecent;
    }

    if (!windowStart) {
      return {
        limit: { key: 'session', label: 'Session (5h)', percent: 0, estimated: true, resetsAt: null, note: '0% · 5h window ready' },
        window: null
      };
    }

    const resetsAt = windowStart + WINDOW_MS;
    if (now >= resetsAt) {
      return {
        limit: { key: 'session', label: 'Session (5h)', percent: 0, estimated: true, resetsAt: null, note: '0% · 5h window ready' },
        window: null
      };
    }

    const turnsInWindow = Math.max(1, recentTurns.length || (storedWindow?.messageCount || 1));
    const tokensInWindow = messages
      .filter(m => m.createdAt && m.createdAt >= windowStart)
      .reduce((sum, m) => sum + (m.tokens || 0), 0);

    const modelKey = this.modelKey(model) || '';
    const isHaiku = modelKey.includes('haiku');
    const isSonnet = modelKey.includes('sonnet');
    const maxTurns = isHaiku ? 45 : isSonnet ? 20 : 30;
    const maxTokens = isHaiku ? 120000 : isSonnet ? 60000 : 80000;

    const turnRatio = turnsInWindow / maxTurns;
    const tokenRatio = tokensInWindow > 0 ? (tokensInWindow / maxTokens) : 0;
    const percent = Math.min(100, Math.max(1, Math.round(Math.max(turnRatio, tokenRatio) * 100)));

    const limit = {
      key: 'session',
      label: 'Session (5h)',
      percent,
      estimated: true,
      resetsAt,
      turns: turnsInWindow
    };

    const nextWindow = {
      startedAt: windowStart,
      resetsAt,
      messageCount: turnsInWindow,
      totalTokens: tokensInWindow,
      model: modelKey
    };

    return { limit, window: nextWindow };
  },

  /**
   * Detects limit reached banners or notices in Claude's DOM.
   * @returns {{ key: string, label: string, blocked: boolean, percent: number, resetsAt: number|null }|null}
   */
  detectLimitReached(doc, now = Date.now()) {
    const nodes = doc.querySelectorAll('[role="alert"], [role="status"], [class*="banner"], [class*="notice"], [data-testid*="limit"]');
    for (const n of nodes) {
      const text = (n?.textContent || '').replace(/\s+/g, ' ');
      if (text.length > 300) continue;
      if (!/(reached|hit|out of) (your|free)? messages?|message limit (reached|resets)|try again (at|after)/i.test(text)) continue;
      return { key: 'session', label: 'Session', blocked: true, percent: 100, resetsAt: this.parseResetTime(text, now) };
    }
    return null;
  },

  /** "at 5:30 PM" / "after 17:30" -> next such time; "in 3 hours" / "in 45 minutes" -> now + that. */
  parseResetTime(text, now = Date.now()) {
    const rel = text.match(/in (\d+) (hour|minute)s?/i);
    if (rel) return now + Number(rel[1]) * (/hour/i.test(rel[2]) ? 3600000 : 60000);
    const t = text.match(/(?:at|after|until) (\d{1,2})(?::(\d{2}))?\s*([AP]\.?M\.?)?/i);
    if (!t) return null;
    let h = Number(t[1]) % 12 + (t[3] && /p/i.test(t[3]) ? 12 : 0);
    if (!t[3]) h = Number(t[1]); // 24-hour clock
    const d = new Date(now);
    d.setHours(h, Number(t[2] || 0), 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
};

// ============================================================================ Gemini

// support.google.com/gemini/answer/16275805 (checked 2026-09-24): the context window depends on the
// plan, not the model: no AI plan 32K, Google AI Plus 128K, Google AI Pro and Ultra 1M.
const GEMINI_LIMIT_SOURCE = 'Gemini Apps Help: limits by plan (support.google.com/gemini/answer/16275805)';
const GEMINI_LIMITS = { free: 32000, plus: 128000, pro: 1000000, ultra: 1000000 };
// Gemini's system prompt is never sent to the page. Sizes are the public leaks in
// github.com/asgeirtj/system_prompts_leaks (Google/gemini-*.md), counted with Gemma 4 and rounded to 100
// (measured 2026-10-01; the date is the leak's commit). Each includes that account's tools and features,
// so a prompt with other features enabled differs: these stay estimates.
const GEMINI_SYSTEM_PROMPTS = [
  { family: 'flash', version: 3, tokens: 3400, date: '2026-09' },
  { family: 'flash', version: 3.5, tokens: 3900, date: '2026-07' },
  { family: 'flash', version: 3.7, tokens: 7900, date: '2026-08' },
  { family: 'flash', version: 3.8, tokens: 13800, date: '2026-09' },
  { family: 'pro', version: 3, tokens: 3000, date: '2025-12' },
  { family: 'pro', version: 3.1, tokens: 6100, date: '2026-09' }
];
// Tokens per image at the default resolution. Gemini 3+: 1120 (ai.google.dev/gemini-api/docs/media-resolution,
// checked 2026-10-01); 2.x: 258 per 768px tile (docs/tokens), so 258 is a floor there
const geminiImageTokens = (model) => (Number(String(model || '').match(/(\d+(?:\.\d+)?)/)?.[1] ?? Infinity) >= 3 ? 1120 : 258);
// support.google.com/gemini/answer/14620100 (Business / Enterprise, checked 2026-10-01): 1M on every edition where
// Gemini is a core service; 32K only where it is an additional service (not detectable from the page)
const GEMINI_WORKSPACE_SOURCE = 'Gemini Apps Help: work accounts, Business / Enterprise (support.google.com/gemini/answer/14620100)';
const GEMINI_WORKSPACE_LIMIT = 1000000;

// Gemini's own chat read (batchexecute rpc "hNvQHb", checked live 2026-10-01): newest turn first, 10 per
// page, continuation token at [1]. Each turn: [[c_id, r_id], _, [[userText]], [candidates, …, chosen id at 3,
// model name at 21], [epochSeconds]]; a candidate is [rc_id, [replyText], …].
const GEMINI_RPC_READ = 'hNvQHb';
// Plan tier + usage windows (rpc "jSf9Qc", source path /usage). Tier ids from HanaokaYuzu/Gemini-API
// (client.py _fetch_usage_info, 2026-08): 1 free, 2 Pro, 3 / 6 Ultra, 4 Plus
const GEMINI_RPC_USAGE = 'jSf9Qc';
const GEMINI_TIERS = { 1: 'free', 2: 'pro', 3: 'ultra', 4: 'plus', 6: 'ultra' };
// Last tier the usage RPC reported: { plan: { value, evidenceType } | null }
const geminiTier = { plan: null };
const GEMINI_PAGE_SIZE = 10;
const GEMINI_MAX_PAGES = 100; // 1,000 turns

/** "at" / session / build values from the page's inline WIZ_global_data script (content scripts cannot read window). */
function geminiSession(doc) {
  for (const script of doc.querySelectorAll('script')) {
    const t = script.textContent || '';
    if (!t.includes('"SNlM0e"')) continue;
    const get = (k) => t.match(new RegExp(`"${k}":"([^"]+)"`))?.[1] || null;
    const s = { at: get('SNlM0e'), sid: get('FdrFJe'), bl: get('cfb2h') };
    return s.at ? s : null;
  }
  return null;
}

/** One batchexecute call; returns the decoded payload, throws on an error row or HTTP error. */
async function geminiRpc(session, rpcId, payload, path) {
  const qs = new URLSearchParams({ rpcids: rpcId, 'source-path': path, hl: 'en', _reqid: String(100000 + Math.floor(Math.random() * 900000)), rt: 'c' });
  if (session.bl) qs.set('bl', session.bl);
  if (session.sid) qs.set('f.sid', session.sid);
  const body = new URLSearchParams({ 'f.req': JSON.stringify([[[rpcId, JSON.stringify(payload), null, 'generic']]]), at: session.at });
  const res = await fetch(`/_/BardChatUi/data/batchexecute?${qs}`, {
    method: 'POST', body, credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }
  });
  if (!res.ok) throw new Error(`HTTP error ${res.status}`);
  return parseBatchexecute(await res.text(), rpcId);
}

/** Payload of rpcId from a batchexecute response (")]}'" prefix, then length-prefixed JSON lines). */
export function parseBatchexecute(text, rpcId) {
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('[[')) continue;
    let rows;
    try { rows = JSON.parse(line); } catch { continue; }
    const row = rows.find(r => Array.isArray(r) && r[0] === 'wrb.fr' && r[1] === rpcId);
    if (!row) continue;
    if (typeof row[2] !== 'string') throw new Error(`Gemini error ${JSON.stringify(row[5]?.[0] ?? 'unknown')}`);
    return JSON.parse(row[2]);
  }
  throw new Error('Gemini response format changed');
}

export const GeminiProvider = {
  name: 'Gemini',
  hosts: ['gemini.google.com'],
  inputSelector: 'rich-textarea [contenteditable="true"], .ql-editor[contenteditable="true"]',
  replySelector: 'model-response', // Assistant replies (Capsule reader)
  userSelector: 'user-query', // The user's messages (Capsule transcript)
  hasApi: true,

  /**
   * Gemini's own tokenizer: Google's SDK counts gemini-3.1 and later (3.5 Flash, 3.1 Pro, …) with Gemma 4
   * (googleapis/python-genai _local_tokenizer_loader.py). Older models used Gemma 3, so counts for them
   * stay approximate. A model with no version shown is the app's current one.
   */
  tokenizer: {
    name: 'gemma4',
    file: 'assets/gemma4-tokenizer.bin',
    create: (buffer) => new GemmaCounter(buffer),
    exactFor(model) {
      const v = String(model || '').match(/(\d+(?:\.\d+)?)/);
      return !v || Number(v[1]) >= 3.1;
    }
  },

  /**
   * The whole saved chat through Gemini's own read call (the page only holds the turns scrolled into
   * view). Pages until there is no continuation token; one retry on a failed page.
   */
  async fetchConversation(conversationId) {
    // The session values are in an inline script that may not be parsed yet when the first read runs
    let session = geminiSession(document);
    for (let i = 0; !session && i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      session = geminiSession(document);
    }
    if (!session) return null;
    // Plan and usage limits come with every read; best effort, never blocks the conversation
    const usage = geminiRpc(session, GEMINI_RPC_USAGE, [], '/usage').catch(() => null);
    const turns = [];
    let token = null;
    for (let page = 0; page < GEMINI_MAX_PAGES; page++) {
      const payload = [`c_${conversationId}`, GEMINI_PAGE_SIZE, token, 1, [0], [4], null, 1];
      const read = () => geminiRpc(session, GEMINI_RPC_READ, payload, location.pathname);
      const data = await read().catch(read);
      if (!Array.isArray(data?.[0])) break;
      turns.push(...data[0]);
      token = data[1];
      if (!token) break;
    }
    const { plan, limits } = this.parseUsage(await usage);
    // A work account's window follows its Workspace edition, not this tier (the page's "Work" label decides)
    // The tier is applied by detectPlan on every pass, so a "Work" label that renders later still wins
    geminiTier.plan = plan;
    return { ...this.normalizeConversation(turns.reverse(), conversationId), plan: null, hidden: null, attachments: null, limits };
  },

  /**
   * Gemini's usage RPC (checked live 2026-10-01): [tierId, [[remainingCredits, usedFraction, window, [[resetSeconds, nanos]]], …], overage].
   * Window 1 = 5 hours, 2 = weekly, 3 = AI credits (skipped).
   * @returns {{ plan: Object|null, limits: Array<{ key: string, label: string, percent: number, resetsAt: number|null }> }}
   */
  parseUsage(data) {
    if (!Array.isArray(data)) return { plan: null, limits: [] };
    const value = GEMINI_TIERS[data[0]];
    const plan = value ? { value, evidenceType: 'OBSERVED' } : null;
    const names = { 1: ['session', 'Session (5h)'], 2: ['weekly', 'Weekly'] };
    const limits = [];
    for (const item of Array.isArray(data[1]) ? data[1] : []) {
      const name = names[item?.[2]];
      if (!name || typeof item[1] !== 'number') continue;
      const reset = item[3]?.[0]?.[0];
      limits.push({ key: name[0], label: name[1], percent: Math.round(item[1] * 100), resetsAt: typeof reset === 'number' ? reset * 1000 : null });
    }
    return { plan, limits };
  },

  /** Saved turns (oldest first) as messages; the reply is the chosen candidate. */
  normalizeConversation(turns, conversationId) {
    const messages = [];
    let model = null;
    for (const t of turns) {
      const id = Array.isArray(t?.[0]) ? t[0][1] : null;
      const user = Array.isArray(t?.[2]?.[0]) ? t[2][0].filter(x => typeof x === 'string').join('\n') : '';
      const reply = t?.[3];
      const candidates = Array.isArray(reply?.[0]) ? reply[0] : [];
      const chosen = candidates.find(c => c?.[0] === reply?.[3]) || candidates[0];
      const text = Array.isArray(chosen?.[1]) ? chosen[1].filter(x => typeof x === 'string').join('\n') : '';
      if (typeof reply?.[21] === 'string') model = reply[21];
      if (user) messages.push({ id: `${id}-user`, role: 'user', text: user, parts: [{ type: 'text', text: user }], isStreaming: false });
      if (text) messages.push({ id: `${id}-model`, role: 'assistant', text, parts: [{ type: 'text', text }], isStreaming: false });
    }
    return { conversationId, model, messages, visibleTurns: messages.length, rawMessages: turns.length };
  },

  /**
   * Context Gemini sends besides the visible turns, read from the page. The app's system prompt and
   * Gem instructions are not readable: the prompt is a fixed estimate. Images use Google's published
   * 258 tokens per image; other files have no readable size and stay unknown.
   */
  pageHiddenContext(model) {
    const p = this.systemPromptEstimate(model);
    const items = [{
      kind: 'system_prompt', label: `Gemini system prompt (estimate, ${p.basis})`, tokens: p.tokens, estimated: true,
      text: `Not readable from the page. Sized from the public ${p.basis} system prompt leak (${p.date}), ~${p.tokens.toLocaleString()} tokens; enabled tools change it.`
    }];
    if (/\/gem\//.test(location.pathname)) {
      items.push({ kind: 'project', label: 'Gem instructions (not readable)', tokens: 0, estimated: true, text: 'This chat uses a Gem; its instructions are sent but cannot be read from the page.' });
    }
    return items;
  },

  /**
   * Leaked prompt closest to the model: same family (Flash-Lite and Thinking count as Flash), the highest
   * leaked version at or below the model's, else the lowest above; no version -> the family's latest.
   * @returns {{ tokens: number, basis: string, date: string }}
   */
  systemPromptEstimate(model) {
    const s = String(model || '').toLowerCase();
    const family = /\bpro\b/.test(s) ? 'pro' : 'flash';
    const version = Number(s.match(/(\d+(?:\.\d+)?)/)?.[1]) || Infinity;
    const leaks = GEMINI_SYSTEM_PROMPTS.filter(l => l.family === family);
    const pick = leaks.filter(l => l.version <= version).pop() || leaks[0];
    return { tokens: pick.tokens, basis: `${pick.version} ${family === 'pro' ? 'Pro' : 'Flash'}`, date: pick.date };
  },

  pageAttachments(doc, model) {
    const queries = doc.querySelectorAll('user-query');
    let images = 0;
    let files = 0;
    const list = [];
    const perImage = geminiImageTokens(model);
    for (const q of queries) {
      // Each uploaded file is a <user-query-file-preview>; an image one holds an <img>
      for (const f of q.querySelectorAll('user-query-file-preview')) {
        if (f.querySelector('img')) { images++; list.push({ name: 'Image ' + images, type: 'image', tokens: perImage }); }
        else { files++; list.push({ name: 'File ' + files, type: 'file' }); }
      }
    }
    return { count: images + files, files: list, estimatedTokens: images * perImage, hasUnknown: files > 0, source: 'dom' };
  },

  conversationId(url) {
    const m = String(url || '').match(/\/app\/([0-9a-f]{8,})/i) || String(url || '').match(/\/gem\/[^/]+\/([0-9a-f]{8,})/i);
    return m ? m[1] : null;
  },

  findInput(doc) {
    return doc.querySelector(this.inputSelector);
  },

  extractMessages(doc) {
    const nodes = Array.from(doc.querySelectorAll('user-query, model-response'));
    return nodes.map((el, i) => {
      const role = String(el.tagName).toLowerCase() === 'user-query' ? 'user' : 'assistant';
      const content = role === 'user'
        ? (el.querySelector('.query-text') || el)
        : (el.querySelector('message-content') || el.querySelector('.model-response-text') || el);
      const text = cleanText(content, 'button, .cdk-visually-hidden, .screen-reader-only, model-thoughts, mat-icon');
      return { id: `gemini-dom-${i}-${role}`, role, text, parts: [{ type: 'text', text }], isStreaming: false };
    }).filter(m => m.text);
  },

  detectModel(doc) {
    // Current layout (checked 2026-09-29): <button aria-label="Open mode picker, currently 3.5 Flash-Lite">
    const picker = doc.querySelector('button[aria-label*="mode picker" i]');
    const current = picker?.getAttribute?.('aria-label')?.match(/currently\s+(.+)$/i);
    if (current) return current[1].trim();
    const el = picker || doc.querySelector('[data-test-id="bard-mode-menu-button"], [data-test-id*="mode-menu"] button, button.gds-mode-switch-button');
    const text = el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return text && text.length < 40 ? text : null;
  },

  /**
   * Gemini does not report usage; it only shows a message once a limit is hit. Reads alerts, snack
   * bars and the latest reply for that message. Returns a used-up limit, with the reset time when
   * the message names one ("try again at 5:30 PM" / "in 3 hours").
   * @returns {{ key: string, label: string, remaining: number, blocked: boolean, resetsAt: number|null }|null}
   */
  detectLimitReached(doc, now = Date.now()) {
    const replies = doc.querySelectorAll('model-response');
    const nodes = [...doc.querySelectorAll('[role="alert"], [role="status"], snack-bar-container, .mat-mdc-snack-bar-container'), replies[replies.length - 1]];
    for (const n of nodes) {
      const text = (n?.textContent || '').replace(/\s+/g, ' ');
      // A long reply that merely discusses limits is not the limit notice (notices are one or two lines)
      if (n === replies[replies.length - 1] && text.length > 400) continue;
      if (!/(reached|hit) (your|the) (\w+ )?limit|limit (reached|resets)|usage limit/i.test(text)) continue;
      return { key: 'limit', label: 'Gemini usage', remaining: 0, blocked: true, resetsAt: this.parseResetTime(text, now) };
    }
    return null;
  },

  /** "at 5:30 PM" / "after 17:30" -> next such time; "in 3 hours" / "in 45 minutes" -> now + that. */
  parseResetTime(text, now = Date.now()) {
    const rel = text.match(/in (\d+) (hour|minute)s?/i);
    if (rel) return now + Number(rel[1]) * (/hour/i.test(rel[2]) ? 3600000 : 60000);
    const t = text.match(/(?:at|after|until) (\d{1,2})(?::(\d{2}))?\s*([AP]\.?M\.?)?/i);
    if (!t) return null;
    let h = Number(t[1]) % 12 + (t[3] && /p/i.test(t[3]) ? 12 : 0);
    if (!t[3]) h = Number(t[1]); // 24-hour clock
    const d = new Date(now);
    d.setHours(h, Number(t[2] || 0), 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  },

  // Gemini meters compute, and long chats cost more per message: note it once the chat is this full
  longChatNoteAt: 50,

  /** Explicit "Google AI Pro/Ultra/Plus" text is OBSERVED; a bare PRO/ULTRA badge is only a hint. */
  detectPlan(doc) {
    // Work / school accounts carry a "Work" tier label by the avatar (checked live 2026-10-01)
    if (doc.querySelector('[class*="tier-enterprise"]')) return { value: 'workspace', source: 'dom', evidenceType: 'OBSERVED' };
    // Tier Gemini reported on the last read (personal accounts)
    if (geminiTier.plan) return { ...geminiTier.plan, source: 'account_api' };
    let seenHeader = false;
    for (const el of doc.querySelectorAll('header, top-bar-actions, [data-test-id*="pillbox"], .gds-pillbox, [role="banner"]')) {
      const text = el.textContent || '';
      const named = text.match(/Google AI (Ultra|Pro|Plus)\b/);
      if (named) return { value: named[1].toLowerCase(), source: 'dom', evidenceType: 'OBSERVED' };
      const badge = text.match(/\b(ULTRA|PRO|PLUS)\b/);
      if (badge) return { value: badge[1].toLowerCase(), source: 'dom_heuristic', evidenceType: 'ESTIMATED' };
      seenHeader = true;
    }
    // Paid plans show a badge in the top bar; a loaded top bar without one is the free plan (inferred)
    return seenHeader ? { value: 'free', source: 'dom_heuristic', evidenceType: 'ESTIMATED' } : null;
  },

  // The page shows the mode ("Flash", "Fast"), the saved chat the model ("3.6 Flash"): compare by family
  modelKey: (value) => {
    const s = String(value || '').toLowerCase();
    const family = s.match(/flash-lite|flash|pro|thinking|deep think/)?.[0] || (/\bfast\b/.test(s) ? 'flash' : null);
    return family || s.replace(/\s+/g, ' ').trim() || null;
  },

  displayName(raw) {
    return raw ? (/gemini/i.test(raw) ? raw : `Gemini · ${raw}`) : null;
  },

  resolveLimit(rawModel, plan) {
    if (plan === 'workspace') return { contextWindow: GEMINI_WORKSPACE_LIMIT, status: 'VERIFIED', source: GEMINI_WORKSPACE_SOURCE, recognized: true };
    if (!plan || plan === 'unknown' || !(plan in GEMINI_LIMITS)) {
      return { contextWindow: null, status: 'UNKNOWN', source: 'Plan unknown', recognized: Boolean(rawModel) };
    }
    // Google publishes the window per plan for every model, so the model is not needed for the limit
    return { contextWindow: GEMINI_LIMITS[plan], status: 'VERIFIED', source: GEMINI_LIMIT_SOURCE, recognized: true };
  }
};

export const PROVIDERS = [ClaudeProvider, GeminiProvider];

/** Adapter for a hostname, or null (ChatGPT uses its own coordinator). */
export function providerForHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return PROVIDERS.find(p => p.hosts.some(h => host === h || host.endsWith(`.${h}`))) || null;
}
