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
// Team, Enterprise) is 200K, except these models at 1M. The Free plan is not published.
const CLAUDE_LIMIT_SOURCE = 'Claude Help Center: context window on paid plans (support.claude.com/en/articles/8606394)';
const CLAUDE_1M_MODELS = new Set(['fable-5.1', 'opus-5.5', 'sonnet-5']);
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
    const m = el ? (el.textContent || '').match(/\b(Free|Pro|Max|Team|Enterprise)\s+plan\b/i) : null;
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
   * { windows: { "5h": { utilization: 0..1, resets_at }, "7d": {...} }, resetsAt }.
   * resets_at may be epoch seconds, epoch ms or ISO; utilization is a fraction (a value > 1 is taken as a percent).
   * @returns {Array<{ key: string, label: string, percent: number, resetsAt: number|null }>}
   */
  parseMessageLimit(ml) {
    const windows = ml && typeof ml === 'object' ? ml.windows : null;
    if (!windows || typeof windows !== 'object') return [];
    const toMs = (v) => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : v ? Date.parse(v) || null : null);
    const names = { '5h': ['session', 'Session (5h)'], '7d': ['weekly', 'Weekly'] };
    const out = [];
    for (const [win, [key, label]] of Object.entries(names)) {
      const w = windows[win];
      const u = w?.utilization;
      if (typeof u !== 'number' || !isFinite(u)) continue;
      out.push({ key, label, percent: Math.round(u > 1 ? u : u * 100), resetsAt: toMs(w.resets_at ?? w.resetsAt ?? (key === 'session' ? ml.resetsAt : null)) });
    }
    return out;
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
        if (a.extracted_content) text.push(a.extracted_content);
        else unknownFiles++;
      }
      const fileCount = (m.files || []).length + (m.files_v2 || []).length;
      files += fileCount;
      unknownFiles += fileCount;
      if (text.length) messages.push({ id: m.uuid, role, text: text.join('\n\n'), parts: [{ type: 'text', text: text.join('\n\n') }], isStreaming: false });
      if (tool.length) messages.push({ id: `${m.uuid}-tool`, role: 'tool', text: tool.join('\n\n'), parts: [{ type: 'text', text: tool.join('\n\n') }], isStreaming: false });
    }
    return {
      conversationId: conv?.uuid || null,
      model: conv?.model || null,
      messages,
      visibleTurns: chain.length,
      rawMessages: all.length, // Diagnostics: saved turns before normalization (spots a format change)
      attachments: { count: files, estimatedTokens: 0, hasUnknown: unknownFiles > 0 }
    };
  }
};

// ============================================================================ Gemini

// support.google.com/gemini/answer/16275805 (checked 2026-09-24): the context window depends on the
// plan, not the model: no AI plan 32K, Google AI Plus 128K, Google AI Pro and Ultra 1M.
const GEMINI_LIMIT_SOURCE = 'Gemini Apps Help: limits by plan (support.google.com/gemini/answer/16275805)';
const GEMINI_LIMITS = { free: 32000, plus: 128000, pro: 1000000, ultra: 1000000 };
// ponytail: unpublished, a rough guess; replace with a measured value when one exists
const GEMINI_SYSTEM_PROMPT_ESTIMATE = 1500;
// ai.google.dev/gemini-api/docs/tokens: an image (up to 384px each side) is 258 tokens; larger ones are tiled, so this is a floor
const GEMINI_IMAGE_TOKENS = 258;
// conversation id -> turn count at which the whole chat was seen loaded
const geminiCompleteAt = new Map();

export const GeminiProvider = {
  name: 'Gemini',
  hosts: ['gemini.google.com'],
  inputSelector: 'rich-textarea [contenteditable="true"], .ql-editor[contenteditable="true"]',
  replySelector: 'model-response', // Assistant replies (Capsule reader)
  hasApi: false,

  /**
   * Gemini loads older turns as you scroll up. The page holds the whole chat once its history is
   * scrolled to the top with nothing loading; that turn count is remembered, so scrolling back down
   * (or new turns) keeps the chat complete.
   */
  pageMayBePartial(doc, conversationId, turnCount) {
    if (!conversationId) return false;
    const known = geminiCompleteAt.get(conversationId);
    if (known !== undefined && turnCount >= known) return false;
    const first = doc.querySelector('user-query, model-response');
    if (!first) return true;
    let scroller = first.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    const atTop = !scroller || scroller.scrollTop <= 0;
    const loading = Boolean(doc.querySelector('infinite-scroller mat-progress-spinner, infinite-scroller [role="progressbar"]'));
    if (!atTop || loading) return true;
    geminiCompleteAt.set(conversationId, turnCount);
    return false;
  },

  /**
   * Context Gemini sends besides the visible turns, read from the page. The app's system prompt and
   * Gem instructions are not readable: the prompt is a fixed estimate. Images use Google's published
   * 258 tokens per image; other files have no readable size and stay unknown.
   */
  pageHiddenContext() {
    const items = [{
      kind: 'system_prompt', label: 'Gemini system prompt (estimate)', tokens: GEMINI_SYSTEM_PROMPT_ESTIMATE, estimated: true,
      text: `Not readable from the page. Estimated at ~${GEMINI_SYSTEM_PROMPT_ESTIMATE.toLocaleString()} tokens.`
    }];
    if (/\/gem\//.test(location.pathname)) {
      items.push({ kind: 'project', label: 'Gem instructions (not readable)', tokens: 0, estimated: true, text: 'This chat uses a Gem; its instructions are sent but cannot be read from the page.' });
    }
    return items;
  },

  pageAttachments(doc) {
    const queries = doc.querySelectorAll('user-query');
    let images = 0;
    let files = 0;
    for (const q of queries) {
      images += q.querySelectorAll('img:not([role="presentation"]):not(mat-icon img)').length;
      files += q.querySelectorAll('uploaded-file, [data-test-id*="uploaded-file"], .file-preview-container').length;
    }
    return { count: images + files, estimatedTokens: images * GEMINI_IMAGE_TOKENS, hasUnknown: files > 0, source: 'dom' };
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

  modelKey: (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim() || null,

  displayName(raw) {
    return raw ? (/gemini/i.test(raw) ? raw : `Gemini · ${raw}`) : null;
  },

  resolveLimit(rawModel, plan) {
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
