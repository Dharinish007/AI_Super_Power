/**
 * Context Monitor - Platform Strip Adapters
 *
 * One adapter per platform (Claude, Gemini, ChatGPT) transforming platform state into
 * standardized StripComponent data contract:
 *   type Row = { label, state, percent?, resetsAt?, source, note? }
 *   type Context = { used?, limit?, source }
 *   type Adapter = () => { rows: Row[], context?: Context, msgsLeft?: number }
 *
 * Rules:
 * - Adapters must NEVER throw. On failure, return rows: [] and hide strip.
 * - Claude: rows "5h" and "Weekly". Context ring against published limit. Show "~N msgs left", labeled est.
 * - Gemini: rows "5h" and "Weekly" (one weighted pool). No message count. Show note "Heavy tasks use more".
 *           Context limit from Gemini API model info at runtime; if unavailable, use state C.
 *           Replace "~28 msgs left" with reset time (e.g. "resets in 2h 10m").
 * - ChatGPT: a text row "No limit · subject to safeguards" (state "unlimited"). Tool rows appear only when tracked.
 *            Context: count only, no ring fill, no percent, unless user reference is set in settings.
 */

import { threshold, formatReset } from '../shared/formatters.js';

/**
 * Adapter for Claude (claude.ai)
 * @param {Object} [viewState]
 * @param {Object} [_settings]
 * @returns {{ rows: Array<Object>, context?: Object, msgsLeft?: number, provider: string, breakdown?: Object, biggest?: Object, model?: string, modelFamily?: string }}
 */
export function claudeAdapter(viewState = {}, _settings = {}) {
  try {
    if (!viewState) return { rows: [], context: undefined };

    const limits = Array.isArray(viewState.limits) ? viewState.limits : [];
    const rows = [];

    // Session (5h) row: always present for Claude
    const session = limits.find(l => l.id === '5h' || l.key === '5h' || l.key === 'session' || l.label?.toLowerCase().includes('session') || l.label?.toLowerCase().includes('5h'));
    const sessionPct = (session && typeof session.percent === 'number' && Number.isFinite(session.percent))
      ? Math.round(session.percent)
      : (limits.length === 0 ? 0 : undefined);
    const sessionState = sessionPct !== undefined
      ? threshold(sessionPct).state
      : (session?.blocked ? 'danger' : 'unknown');

    if (session || limits.length === 0) {
      rows.push({
        label: '5h',
        state: sessionState,
        percent: sessionPct,
        resetsAt: session?.resetsAt ? (typeof session.resetsAt === 'number' ? new Date(session.resetsAt).toISOString() : String(session.resetsAt)) : undefined,
        source: session?.estimated ? 'estimated' : 'measured',
        note: session?.note
      });
    }

    // Weekly row: always present for Claude
    const weekly = limits.find(l => l.key === 'weekly' || l.label?.toLowerCase().includes('weekly') || l.label?.toLowerCase().includes('7d'));
    const weeklyPct = (weekly && typeof weekly.percent === 'number' && Number.isFinite(weekly.percent))
      ? Math.round(weekly.percent)
      : (limits.length === 0 ? 0 : undefined);
    const weeklyState = weeklyPct !== undefined
      ? threshold(weeklyPct).state
      : (weekly?.blocked ? 'danger' : 'unknown');

    if (weekly || limits.length === 0) {
      rows.push({
        label: 'Weekly',
        state: weeklyState,
        percent: weeklyPct,
        resetsAt: weekly?.resetsAt ? (typeof weekly.resetsAt === 'number' ? new Date(weekly.resetsAt).toISOString() : String(weekly.resetsAt)) : undefined,
        source: weekly?.estimated ? 'estimated' : 'measured',
        note: weekly?.note
      });
    }

    let context;
    if (typeof viewState.usedTokens === 'number' && Number.isFinite(viewState.usedTokens)) {
      context = {
        used: viewState.usedTokens,
        limit: (typeof viewState.contextLimit === 'number' && Number.isFinite(viewState.contextLimit)) ? viewState.contextLimit : 200000,
        source: 'estimated'
      };
    } else {
      context = {
        used: 0,
        limit: (typeof viewState.contextLimit === 'number' && Number.isFinite(viewState.contextLimit)) ? viewState.contextLimit : 200000,
        source: 'estimated'
      };
    }

    const msgsLeft = (typeof viewState.exchangesLeft === 'number' && Number.isFinite(viewState.exchangesLeft))
      ? viewState.exchangesLeft
      : undefined;

    return {
      rows,
      context,
      msgsLeft,
      provider: 'Claude',
      breakdown: {
        user: viewState.stats?.user,
        assistant: viewState.stats?.assistant,
        system: viewState.stats?.hidden
      },
      biggest: viewState.biggestItem || viewState.biggest?.[0],
      messages: viewState.messages || [],
      title: viewState.title || (viewState.model ? `${viewState.model} Chat` : 'Claude Chat'),
      model: viewState.model,
      modelFamily: viewState.modelFamily
    };
  } catch (_) {
    return { rows: [], context: undefined };
  }
}

/**
 * Adapter for Gemini (gemini.google.com)
 * @param {Object} [viewState]
 * @param {Object} [_settings]
 * @returns {{ rows: Array<Object>, context?: Object, msgsLeft?: undefined, rightNote?: string, provider: string, breakdown?: Object, biggest?: Object, model?: string, modelFamily?: string }}
 */
export function geminiAdapter(viewState = {}, _settings = {}) {
  try {
    if (!viewState) return { rows: [], context: undefined };

    const limits = Array.isArray(viewState.limits) ? viewState.limits : [];
    const rows = [];

    // Gemini: 5h and Weekly (one weighted pool). Show note "Heavy tasks use more".
    // Both 5h and Weekly rows are always present
    const session = limits.find(l => l.id === '5h' || l.key === '5h' || l.key === 'session' || l.label?.toLowerCase().includes('session') || l.label?.toLowerCase().includes('5h'));
    const sessionPct = (session && typeof session.percent === 'number' && Number.isFinite(session.percent))
      ? Math.round(session.percent)
      : 0;
    const sessionState = (session && typeof session.percent === 'number' && Number.isFinite(session.percent))
      ? threshold(sessionPct).state
      : (session?.blocked ? 'danger' : 'ok');

    rows.push({
      label: '5h',
      state: sessionState,
      percent: sessionPct,
      resetsAt: session?.resetsAt ? (typeof session.resetsAt === 'number' ? new Date(session.resetsAt).toISOString() : String(session.resetsAt)) : undefined,
      source: session?.estimated ? 'estimated' : 'measured'
    });

    const weekly = limits.find(l => l.id === 'weekly' || l.key === 'weekly' || l.label?.toLowerCase().includes('weekly'));
    const weeklyPct = (weekly && typeof weekly.percent === 'number' && Number.isFinite(weekly.percent))
      ? Math.round(weekly.percent)
      : 0;
    const weeklyState = (weekly && typeof weekly.percent === 'number' && Number.isFinite(weekly.percent))
      ? threshold(weeklyPct).state
      : (weekly?.blocked ? 'danger' : 'ok');

    rows.push({
      label: 'Weekly',
      state: weeklyState,
      percent: weeklyPct,
      resetsAt: weekly?.resetsAt ? (typeof weekly.resetsAt === 'number' ? new Date(weekly.resetsAt).toISOString() : String(weekly.resetsAt)) : undefined,
      source: weekly?.estimated ? 'estimated' : 'measured'
    });

    // Replace "~28 msgs left" with "resets in 2h 10m" (or nearest reset time)
    const headReset = session?.resetsAt || weekly?.resetsAt || null;
    const rightNote = headReset ? formatReset(headReset, Date.now(), { relative: true }) : null;

    let context;
    if (typeof viewState.usedTokens === 'number' && Number.isFinite(viewState.usedTokens)) {
      context = {
        used: viewState.usedTokens,
        // Context limit from the Gemini API model info at runtime; if unavailable, use state C (omit limit)
        limit: (typeof viewState.contextLimit === 'number' && Number.isFinite(viewState.contextLimit)) ? viewState.contextLimit : undefined,
        source: 'estimated'
      };
    } else {
      context = {
        used: 0,
        limit: (typeof viewState.contextLimit === 'number' && Number.isFinite(viewState.contextLimit)) ? viewState.contextLimit : undefined,
        source: 'estimated'
      };
    }

    return {
      rows,
      context,
      msgsLeft: undefined, // Gemini shows NO message count!
      rightNote,
      provider: 'Gemini',
      breakdown: {
        user: viewState.stats?.user,
        assistant: viewState.stats?.assistant,
        system: viewState.stats?.hidden
      },
      biggest: viewState.biggestItem || viewState.biggest?.[0],
      messages: viewState.messages || [],
      title: viewState.title || (viewState.model ? `${viewState.model} Chat` : 'Gemini Chat'),
      model: viewState.model,
      modelFamily: viewState.modelFamily
    };
  } catch (_) {
    return { rows: [], context: undefined };
  }
}

/**
 * Adapter for ChatGPT (chatgpt.com)
 * @param {Object} [viewState]
 * @param {Object} [settings]
 * @returns {{ rows: Array<Object>, context?: Object, msgsLeft?: undefined, provider: string, breakdown?: Object, biggest?: Object, model?: string, modelFamily?: string }}
 */
export function chatgptAdapter(viewState = {}, settings = {}) {
  try {
    if (!viewState) return { rows: [], context: undefined };

    const limits = Array.isArray(viewState.limits) ? viewState.limits : [];
    const rows = [];

    // Text row: "No limit · subject to safeguards" (state "unlimited")
    rows.push({
      label: 'Text',
      state: 'unlimited',
      source: 'measured',
      note: 'No limit · subject to safeguards'
    });

    // Feature limit rows from limits_progress ONLY — no 5h row for ChatGPT.
    // Skip model: keys, text rows, session / 5h rows.
    for (const l of limits) {
      const key = String(l.key || l.id || '');
      if (key === 'limit' || key.startsWith('model:') || l.label?.toLowerCase().includes('text')) continue;
      if (key === '5h' || key === 'session' || key.includes('session')) continue;
      if (l.label?.toLowerCase().includes('session')) continue;

      const pct = typeof l.percent === 'number' && Number.isFinite(l.percent) ? Math.round(l.percent) : undefined;
      const st = pct !== undefined ? threshold(pct).state : (l.blocked ? 'danger' : 'unknown');
      rows.push({
        label: l.label || key || 'Tool',
        state: st,
        percent: pct,
        used: typeof l.used === 'number' ? l.used : undefined,
        max: typeof l.total === 'number' ? l.total : undefined,
        remaining: typeof l.remaining === 'number' ? l.remaining : undefined,
        resetsAt: l.resetsAt ? (typeof l.resetsAt === 'number' ? new Date(l.resetsAt).toISOString() : String(l.resetsAt)) : undefined,
        source: l.estimated ? 'estimated' : 'measured',
        note: l.note
      });
    }

    // Context: estimate (BPE tokenizer). "~" prefix via approx:true.
    // Use model contextWindow from widget state if available.
    const usedTokens = (typeof viewState.usedTokens === 'number' && Number.isFinite(viewState.usedTokens))
      ? viewState.usedTokens
      : 0;

    const contextLimit = viewState.contextLimit && Number.isFinite(viewState.contextLimit) && viewState.contextLimit > 0
      ? viewState.contextLimit
      : null;

    const userRef = settings?.context?.userReference || null;

    let context;
    if (contextLimit) {
      context = {
        used: usedTokens,
        limit: contextLimit,
        approx: true,
        source: 'estimated'
      };
    } else if (userRef && Number.isFinite(userRef) && userRef > 0) {
      context = {
        used: usedTokens,
        limit: undefined,
        refLimit: userRef,
        refType: 'user',
        approx: true,
        source: 'estimated'
      };
    } else {
      context = {
        used: usedTokens,
        limit: undefined, // State C: count only, no ring fill
        approx: true,
        source: 'estimated'
      };
    }

    return {
      rows,
      context,
      msgsLeft: undefined,
      rightNote: null,
      provider: 'ChatGPT',
      breakdown: {
        user: viewState.stats?.user,
        assistant: viewState.stats?.assistant,
        system: viewState.stats?.hidden
      },
      biggest: viewState.biggestItem || viewState.biggest?.[0],
      messages: viewState.messages || [],
      title: viewState.title || (viewState.model ? `${viewState.model} Chat` : 'ChatGPT Chat'),
      model: viewState.model,
      modelFamily: viewState.modelFamily
    };
  } catch (_) {
    return { rows: [], context: undefined };
  }
}

/**
 * Returns adapter function for provider name.
 * @param {string} providerName
 * @returns {Function}
 */
export function getAdapterForProvider(providerName) {
  const name = String(providerName || '').toLowerCase();
  if (name.includes('claude')) return claudeAdapter;
  if (name.includes('gemini')) return geminiAdapter;
  return chatgptAdapter;
}
