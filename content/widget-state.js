/**
 * Context Monitor - Widget View State
 *
 * Maps the engine's context state into the provider-neutral shape the widget renders.
 * The widget never reads engine internals; any future provider adapter (Claude, Gemini, ...)
 * only needs to produce this shape. Pure function: formatting only, no recalculation.
 */

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
 * Rough count of user+assistant exchanges that still fit, from this chat's own average size.
 * null when the window is unknown or too few turns exist to average.
 * @param {{ remainingTokens: number|null, turns: number, stats?: { user: number, assistant: number } }} vm
 */
export function exchangesLeft(vm) {
  if (vm.remainingTokens === null || vm.remainingTokens === undefined || !vm.stats || vm.turns < 4) return null;
  const perExchange = ((vm.stats.user + vm.stats.assistant) / vm.turns) * 2;
  return perExchange > 0 ? Math.floor(vm.remainingTokens / perExchange) : null;
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
      { label: 'You', value: (s.tokens?.user ?? 0).toLocaleString() },
      { label: `${provider} + tools`, value: (s.tokens?.assistant ?? 0).toLocaleString() },
      {
        label: 'Attachments',
        value: s.observables?.attachmentsCount
          ? `${s.observables.attachmentsCount} · ${(s.tokens?.attachments ?? 0).toLocaleString()} est.`
          : 'None'
      },
      ...(hiddenItems.length
        ? [
            { label: 'Hidden (read from API)', value: sum(hiddenItems.filter(i => !i.estimated && i.included !== false)).toLocaleString() },
            // One row for every estimate (system prompt, and on Claude the enabled tools); details in the viewer
            ...(hiddenItems.some(i => i.estimated)
              ? [{ label: hiddenItems.filter(i => i.estimated).length > 1 ? 'System prompt + tools' : `${provider} system prompt`, value: `≈${sum(hiddenItems.filter(i => i.estimated)).toLocaleString()}`, tag: 'ESTIMATED' }]
              : [])
          ]
        : [{ label: 'Hidden context', value: 'Not measurable', tag: 'UNKNOWN' }]),
      // Saved in the chat but not in the current context: shown, never counted in Used
      ...(stale.count ? [{ label: 'Older tool output', value: `${stale.count} · ${stale.tokens.toLocaleString()} not resent` }] : []),
      ...(dropped.count ? [{ label: 'Older turns', value: `${dropped.count} · ${dropped.tokens.toLocaleString()} outside window` }] : [])
    ],
    // Headline split for the panel's stat row (display only; same numbers as the breakdown)
    stats: { user: s.tokens?.user ?? 0, assistant: s.tokens?.assistant ?? 0, hidden: s.tokens?.hidden ?? 0 },
    // What the page never shows: label, token count and the text itself, for the viewer
    hiddenItems: hiddenItems.map(i => ({
      label: i.label, tokens: i.tokens || 0, text: i.text || '',
      note: i.included === false ? 'not counted' : (i.estimated ? 'estimate' : null)
    })),
    // Plan usage limits (Claude only; empty elsewhere): percent used and time until reset
    // Percent-based (Claude) or count-based (ChatGPT: `remaining`, `blocked`)
    limits: (s.limits || []).map(l => ({ key: l.key, label: l.label, percent: l.percent, remaining: l.remaining, blocked: Boolean(l.blocked), note: l.note || null, resetIn: formatResetIn(l.resetsAt) })),
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
    ready: true
  };
  vm.exchangesLeft = exchangesLeft(vm);
  return vm;
}
