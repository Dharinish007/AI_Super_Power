/**
 * Context Monitor - Widget View State
 *
 * Maps the engine's context state into the provider-neutral shape the widget renders.
 * The widget never reads engine internals; any future provider adapter (Claude, Gemini, ...)
 * only needs to produce this shape. Pure function: formatting only, no recalculation.
 */

import { CONTEXT_FIELDS } from './settings.js';
import { fmtK, limitText } from '../ui/dom.js';

/**
 * "gpt-5-6" -> "GPT-5.6", "gpt-5-5-thinking" -> "GPT-5.5 Thinking", "gpt-4o-mini" -> "GPT-4o Mini".
 * Display formatting only; unknown shapes pass through unchanged.
 * @param {string} slug
 * @returns {string}
 */
export function formatModelName(slug) {
  if (!slug || typeof slug !== 'string') return 'Unknown model';
  const m = slug.trim().match(/^gpt-(\d+[a-z]?)(?:[-.](\d+))?(?:-(.+))?$/i);
  if (!m) return slug.trim();
  const version = m[2] ? `${m[1]}.${m[2]}` : m[1];
  const rest = m[3] ? ' ' + m[3].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : '';
  return `GPT-${version}${rest}`;
}

/** "3h 57m", "2d 4h", "12m" until `at` (ms); null when unknown or past. */
export function formatResetIn(at, now = Date.now()) {
  if (!at) return null;
  const min = Math.round((at - now) / 60000);
  if (min <= 0) return null;
  const d = Math.floor(min / 1440);
  const hr = Math.floor((min % 1440) / 60);
  if (d) return `${d}d ${hr}h`;
  return hr ? `${hr}h ${min % 60}m` : `${min}m`;
}

/** Alert step reached by a percentage: 0 (quiet), 80 or 95. */
export function alertLevel(pct) {
  return pct >= 95 ? 95 : pct >= 80 ? 80 : 0;
}

/**
 * Running token total after each turn (what the chat has cost so far), thinned to at most `max`
 * points so a very long chat stays cheap to draw; the last point is always the true total.
 * @param {Array<{ tokens: number }>} messages
 * @returns {{ points: number[], total: number, turns: number }}
 */
export function growthSeries(messages, max = 48) {
  let sum = 0;
  const cumulative = (messages || []).map(m => (sum += m.tokens || 0));
  if (cumulative.length <= max) return { points: cumulative, total: sum, turns: cumulative.length };
  const step = (cumulative.length - 1) / (max - 1);
  return { points: Array.from({ length: max }, (_, i) => cumulative[Math.round(i * step)]), total: sum, turns: cumulative.length };
}

/** Attachment rows from either detector shape: { name, type, size, tokens } with tokens null when the cost is unknown. */
export function normalizeAttachments(files) {
  if (!Array.isArray(files)) return [];
  return files.filter(Boolean).map(f => ({
    name: String(f.name || 'File'),
    type: f.type || 'file',
    size: f.size || null,
    inText: Boolean(f.inText),
    tokens: Number.isFinite(f.tokens) ? f.tokens : (f.isUnknown || !Number.isFinite(f.estimatedTokens) ? null : f.estimatedTokens)
  }));
}

/** Conversation id from a sidebar link (ChatGPT /c/, Claude /chat/, Gemini /app/); null for anything else. */
export function chatIdFromHref(href) {
  const m = String(href || '').match(/\/(?:c|chat|app)\/([0-9a-z][0-9a-z-]{7,})(?:[/?#]|$)/i);
  return m ? m[1] : null;
}

/** Remembers a chat's last usage percentage; keeps only the `limit` most recently seen chats. Returns a new map. */
export function recordUsage(map, id, pct, now = Date.now(), limit = 200) {
  if (!id || pct === null || pct === undefined || !Number.isFinite(pct)) return { ...map };
  const next = { ...map, [id]: { pct: Math.round(pct), at: now } };
  const ids = Object.keys(next);
  if (ids.length <= limit) return next;
  ids.sort((a, b) => next[b].at - next[a].at);
  return Object.fromEntries(ids.slice(0, limit).map(k => [k, next[k]]));
}

/** The n largest turns in the context, biggest first: what to trim (or move to a file) to free room. */
export function biggestMessages(messages, n = 5) {
  return (messages || [])
    .map((m, i) => {
      const role = m.role || 'user';
      const who = role === 'user' ? 'You' : (role === 'assistant' ? 'Assistant' : 'System');
      const turn = m.turn ?? (i + 1);
      return {
        turn,
        role,
        label: `${who} (#${turn})`,
        tokens: m.tokens || 0,
        preview: m.preview || '',
        element: m.element || null
      };
    })
    .filter(m => m.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, n);
}

/**
 * The chat as a file body.
 * @param {Array<{ role: string, text: string }>} messages
 * @param {'md'|'txt'|'json'} format
 * @param {{ provider?: string, title?: string }} [meta]
 */
export function formatChatExport(messages, format, { provider = 'AI', title = 'Chat export' } = {}) {
  const who = (m) => (m.role === 'user' ? 'You' : provider);
  if (format === 'json') return JSON.stringify({ provider, messages: messages.map(m => ({ role: m.role, text: m.text })) }, null, 2);
  if (format === 'txt') return messages.map(m => who(m) + ': ' + m.text).join('\n\n');
  if (format === 'md') return '# ' + title + '\n\n' + messages.map(m => '**' + who(m) + '**\n\n' + m.text).join('\n\n---\n\n') + '\n';
  throw new Error(`Unknown export format: ${format}`);
}

/**
 * @param {Object} s Context state produced by ContextCalculator + coordinator
 * @param {{ provider?: string }} [opts]
 * @returns {{
 *   provider: string, model: string, modelFamily: string|null, plan: string|null,
 *   usedTokens: number, contextLimit: number|null, remainingTokens: number|null,
 *   percentage: number|null, limitStatus: string, confidence: number, confidenceLevel: string,
 *   evidence: Array<{ ok: boolean, text: string }>, breakdown: Array<{ label: string, value: string, tag?: string }>,
 *   source: string, turns: number, warning: string|null, diagnostics: Object|null, ready: boolean
 * }}
 */
export function toWidgetState(s, opts = {}) {
  const provider = opts.provider || 'AI';
  // No state yet, or a saved conversation whose turns are still loading: never render "0 tokens"
  if (!s || s.observables?.awaitingData) {
    return {
      provider, conversationId: s?.observables?.conversationId || null, model: 'Detecting…', modelFamily: null, plan: null,
      usedTokens: 0, contextLimit: null, remainingTokens: null, percentage: null,
      context: {
        used: 0,
        limit: 200000,
        segments: [
          { id: 'user', label: 'You', tokens: 0 },
          { id: 'assistant', label: `${provider} & tools`, tokens: 0 },
          { id: 'system', label: 'System & memory', tokens: 0 }
        ],
        source: 'dom',
        confidence: 'estimate'
      },
      limitStatus: 'UNKNOWN', confidence: 0, confidenceLevel: 'LOW',
      evidence: [], breakdown: [], stats: { user: 0, assistant: 0, hidden: 0 }, hiddenItems: [], limits: [], source: '', turns: 0, warning: null, diagnostics: s?.diagnostics || null, ready: false
    };
  }

  // Family matches render as "<slug> (<Family>)"; split them back apart for display
  const rawName = s.model?.id !== 'unknown' ? (s.model?.displayName || '') : '';
  const fam = rawName.match(/^(.*)\s\(([^)]+)\)$/);
  const slug = fam ? fam[1] : rawName;
  const modelFamily = fam ? fam[2] : null;
  let model = rawName ? formatModelName(slug) : 'Model unknown';
  if (modelFamily) {
    // "GPT-5.5 Thinking" + family "Thinking" -> "GPT-5.5" · "Thinking"
    model = model.replace(new RegExp(`\\s${modelFamily}$`, 'i'), '');
  }

  const tier = s.plan?.tier && s.plan.tier !== 'unknown' ? s.plan.tier : null;
  const usedTokens = s.tokens?.totalMeasurable ?? 0;
  const contextLimit = s.model?.contextWindow || null;
  const percentage = contextLimit ? (s.utilization?.percentage ?? null) : null;
  const dataSource = s.observables?.dataSource;
  const authoritative = dataSource === 'authoritative';

  const hiddenItems = s.tokens?.hiddenItems || [];
  const sum = (items) => items.reduce((n, i) => n + (i.tokens || 0), 0);
  const stale = s.tokens?.excluded?.staleTools || { count: 0, tokens: 0 };
  const dropped = s.tokens?.excluded?.outOfWindow || { count: 0, tokens: 0 };
  const confidence = s.confidence?.percentage ?? Math.round((s.confidence?.score || 0) * 100);

  // How the conversation count was learned. An approximate tokenizer (Claude, Gemini) caps it at ESTIMATED.
  const convoClass = s.accuracy?.conversation && (s.tokenizerExact === false && s.accuracy.conversation === 'EXACT' ? 'ESTIMATED' : s.accuracy.conversation);
  const convoTag = convoClass ? {
    tag: convoClass,
    why: convoClass === 'EXACT' ? 'Counted locally with the model\'s own tokenizer over the full conversation the site returned.'
      : authoritative ? 'Full conversation from the site, counted locally; this provider\'s own tokenizer is not public, so the count is approximate.'
        : 'Counted locally from the text visible on the page; the site may count a little differently.'
  } : {};

  const isLowerBound = s.completeness?.isLowerBound ?? (!authoritative && Boolean(s.completeness?.domIsPartial));

  const vm = {
    provider,
    conversationId: s.observables?.conversationId || null,
    model,
    modelFamily,
    plan: tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : null,
    usedTokens,
    contextLimit,
    remainingTokens: contextLimit ? Math.max(0, contextLimit - usedTokens) : null,
    percentage,
    limitStatus: contextLimit ? (s.model?.limitStatus === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED') : 'UNKNOWN',
    confidence,
    confidenceLevel: s.confidence?.level || 'LOW',
    evidence: (s.confidence?.factors || []).map(f => ({ ok: f.type === 'positive', text: f.text })),
    breakdown: [
      { label: 'You', value: (s.tokens?.user ?? 0).toLocaleString(), ...convoTag },
      { label: `${provider} + tools`, value: (s.tokens?.assistant ?? 0).toLocaleString(), ...convoTag },
      {
        label: 'Attachments',
        value: s.observables?.attachmentsCount
          ? `${s.observables.attachmentsCount} · ${(s.tokens?.attachments ?? 0).toLocaleString()} est.`
          : 'None',
        ...(s.accuracy?.attachments ? { tag: s.accuracy.attachments, why: 'Files and images are listed from the page; their token cost is not reported by the site.' } : {})
      },
      ...(hiddenItems.length
        ? [
            { label: 'Hidden (read from API)', value: sum(hiddenItems.filter(i => !i.estimated && i.included !== false)).toLocaleString() },
            // One row for every estimate (system prompt, and on Claude the enabled tools); details in the viewer
            ...(hiddenItems.some(i => i.estimated)
              ? [{ label: hiddenItems.filter(i => i.estimated).length > 1 ? 'System prompt + tools' : `${provider} system prompt`, value: `≈${sum(hiddenItems.filter(i => i.estimated)).toLocaleString()}`, tag: 'ESTIMATED', why: 'Fixed cost of the hidden instructions and tools; the size is an estimate, not reported by the site.' }]
              : [])
          ]
        : [{ label: 'Hidden context', value: 'Not measurable', tag: 'UNKNOWN', why: 'Server-side instructions, memory and tools are not visible to the page, so they cannot be counted.' }]),
      // Saved in the chat but not in the current context: shown, never counted in Used
      ...(stale.count ? [{ label: 'Older tool output', value: `${stale.count} · ${stale.tokens.toLocaleString()} not resent` }] : []),
      ...(dropped.count ? [{ label: 'Older turns', value: `${dropped.count} · ${dropped.tokens.toLocaleString()} outside window` }] : [])
    ],
    // Headline split for the panel's stat row (display only; same numbers as the breakdown)
    biggest: s.biggestItem ? [s.biggestItem] : biggestMessages(s.tokens?.contextMessages),
    biggestItem: s.biggestItem || null,
    messages: opts.messages || s.messages || s.observables?.messages || (s.tokens?.contextMessages || []),
    growth: growthSeries(s.tokens?.contextMessages),
    attachmentFiles: normalizeAttachments(s.observables?.attachmentFiles),
    stats: { user: s.tokens?.user ?? 0, assistant: s.tokens?.assistant ?? 0, hidden: s.tokens?.hidden ?? 0 },
    // What the page never shows: label, token count and the text itself, for the viewer
    hiddenItems: hiddenItems.map(i => ({
      label: i.label, tokens: i.tokens || 0, text: i.text || '',
      note: i.included === false ? 'not counted' : (i.estimated ? 'estimate' : null)
    })),
    // Standardized context conforming to shared contract
    context: {
      used: usedTokens,
      limit: contextLimit || 200000,
      segments: [
        { id: 'user', label: 'You', tokens: s.tokens?.user ?? 0 },
        { id: 'assistant', label: `${provider} & tools`, tokens: s.tokens?.assistant ?? 0 },
        { id: 'system', label: 'System & memory', tokens: s.tokens?.hidden ?? 0 }
      ],
      source: authoritative ? 'api' : (dataSource?.startsWith('dom') ? 'dom' : 'estimate'),
      confidence: 'estimate'
    },
    // Plan usage limits (Claude only; empty elsewhere): percent used and time until reset
    // Percent-based (Claude) or count-based (ChatGPT: `remaining`, `blocked`)
    limits: (s.limits || []).map(l => {
      const id = (l.id && l.id !== 'session') ? l.id : (l.key === 'session' ? '5h' : (l.key || '5h'));
      const label = (l.label && l.label !== 'Session' && l.label !== 'Session (5h)') ? l.label : (id === 'weekly' ? 'Weekly' : '5h');
      return {
        id,
        key: id,
        label,
        used: typeof l.used === 'number' ? l.used : (typeof l.percent === 'number' ? l.percent : 0),
        total: typeof l.total === 'number' ? l.total : 100,
        source: l.source || (l.estimated ? 'estimate' : 'api'),
        percent: l.percent,
        remaining: l.remaining,
        blocked: Boolean(l.blocked),
        estimated: Boolean(l.estimated),
        note: l.note || null,
        resetsAt: l.resetsAt || null,
        resetIn: formatResetIn(l.resetsAt)
      };
    }),
    source: authoritative ? 'Full conversation (API)' : dataSource === 'dom_fallback' ? 'Page text (API unavailable)'
      : dataSource === 'dom_unsaved' ? 'Page text (not saved yet)' : 'Page text',
    turns: s.observables?.messagesCount ?? 0,
    // usedTokens counts visible conversation text only; true when turns may also be missing
    isLowerBound,
    conflicts: (s.conflicts || []).map(c => ({ field: c.field, winning: c.winning, discarded: c.discarded })),
    // Only warn when the count really depends on what the page has rendered
    warning: s.observables?.apiError
      ? s.observables.apiError
      : isLowerBound
        ? 'Count may be low: only turns rendered on the page were read.'
        : dropped.count
          ? `Chat is longer than the window: the oldest ${dropped.count} turns are no longer seen by the model. Start a new chat to keep full context.`
          : null,
    diagnostics: s.diagnostics || null,
    // Exchanges that still fit at the chat's current pace (context-advisor.js); null when unknown
    exchangesLeft: s.intelligence?.growth?.exchangesLeft ?? null,
    ready: true
  };
  return vm;
}

/**
 * The Context widget's expanded card: the chosen fields, in CONTEXT_FIELDS order, without blanks.
 * @param {Object} vm Output of toWidgetState()
 * @param {string[]} fields Keys from settings.widgets.context.fields
 * @returns {Array<{ key: string, label: string, value: string }>}
 */
export function widgetFields(vm, fields) {
  if (!vm || vm.ready === false) return [];
  const known = (v) => v !== null && v !== undefined;
  const value = {
    tokens: () => (vm.contextLimit ? `${fmtK(vm.usedTokens)} / ${fmtK(vm.contextLimit)}` : fmtK(vm.usedTokens)),
    percent: () => (known(vm.percentage) ? `${vm.percentage}%` : null),
    model: () => vm.model || null,
    exchangesLeft: () => (known(vm.exchangesLeft) ? `~${vm.exchangesLeft}` : null),
    limits: () => (vm.limits?.length ? vm.limits.map(l => `${l.label} ${limitText(l)}`).join(' | ') : null),
    alert: () => vm.warning || null
  };
  return CONTEXT_FIELDS.filter(f => fields.includes(f.key)).map(f => ({ key: f.key, label: f.label, value: value[f.key]() })).filter(f => f.value);
}
