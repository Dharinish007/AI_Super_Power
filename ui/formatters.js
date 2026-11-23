/**
 * Context Monitor - Pure UI Formatters & Thresholds
 *
 * Single source of truth for formatting percentages, remaining messages,
 * reset timestamps, and token counts across all surfaces (Strip component, Detail drawer, Side panel).
 * Pure functions: formatting only, no recalculation.
 */

/**
 * Returns threshold state for a percentage:
 * - under 50%: 'ok' ('good', green #10a37f, 🟢)
 * - 50-80%: 'warn' ('warn', amber #f59e0b, 🟡)
 * - over 80%: 'danger' ('bad', red #ef4444, 🔴, symbol ⚠)
 * @param {number|null|undefined} pct
 * @returns {{ state: 'ok'|'warn'|'danger'|'unknown', level: 'good'|'warn'|'bad'|'', color: string|null, emoji: '🟢'|'🟡'|'🔴'|'', symbol: string }}
 */
export function threshold(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return { state: 'unknown', level: '', color: null, emoji: '', symbol: '' };
  }
  const rounded = Math.round(pct);
  if (rounded > 80) {
    return { state: 'danger', level: 'bad', color: '#ef4444', emoji: '🔴', symbol: '⚠' };
  }
  if (rounded >= 50) {
    return { state: 'warn', level: 'warn', color: '#f59e0b', emoji: '🟡', symbol: '' };
  }
  return { state: 'ok', level: 'good', color: '#10a37f', emoji: '🟢', symbol: '' };
}

/**
 * Formats a context usage percentage with color, state, and status level.
 * Always pairs color with text. At 80%+ includes the ⚠ symbol.
 * @param {number|null|undefined} pct
 * @returns {{ text: string, display: string, level: 'good'|'warn'|'bad', state: 'ok'|'warn'|'danger', emoji: '🟢'|'🟡'|'🔴', color: string, symbol: string, raw: number }|null}
 */
export function formatPercent(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  const rounded = Math.round(pct);
  const t = threshold(pct);
  return {
    text: `${rounded}%`,
    display: t.symbol ? `${rounded}% ${t.symbol}` : `${rounded}%`,
    level: t.level,
    state: t.state,
    emoji: t.emoji,
    color: t.color,
    symbol: t.symbol,
    raw: pct
  };
}

/**
 * Returns color string for a percentage: green (<50%), amber (50-80%), red (>80%).
 * @param {number|null|undefined} pct
 * @returns {string|null}
 */
export function colorForPercent(pct) {
  const p = formatPercent(pct);
  return p ? p.color : null;
}

/**
 * Returns status level for a percentage: 'good' (<50%), 'warn' (50-80%), 'bad' (>80%).
 * @param {number|null|undefined} pct
 * @returns {'good'|'warn'|'bad'|''}
 */
export function levelForPercent(pct) {
  const p = formatPercent(pct);
  return p ? p.level : '';
}

/**
 * Formats remaining messages/exchanges left.
 * e.g., "~28 msgs left".
 * @param {number|null|undefined} count
 * @param {{ est?: boolean, split?: boolean }} [options]
 * @returns {string|{ top: string, bottom: string }|null}
 */
export function formatMsgs(count, options = {}) {
  if (count === null || count === undefined || !Number.isFinite(count) || count < 0) {
    return null;
  }
  const num = Math.round(count);
  if (options.split) {
    return { top: `~${num} msgs`, bottom: 'left' };
  }
  if (options.est) {
    return `~${num} msgs left · est.`;
  }
  return `~${num} msgs left`;
}

/**
 * Backwards compatible alias for formatMsgs.
 * @param {number|null|undefined} exchangesLeft
 * @returns {string|null}
 */
export function formatLeft(exchangesLeft) {
  return formatMsgs(exchangesLeft);
}

/**
 * Formats reset time:
 * - If under 24 hours: "resets 7:20 PM" (or "resets in 2h 10m" if options.relative is true)
 * - If 24 hours or more: "resets in 1d 8h"
 * Returns null if missing, invalid, or in the past.
 * @param {number|string|null|undefined} resetsAt Timestamp (ms/s) or ISO date string
 * @param {number} [now] Current timestamp
 * @param {{ relative?: boolean }} [options]
 * @returns {string|null}
 */
export function formatReset(resetsAt, now = Date.now(), options = {}) {
  if (!resetsAt) return null;
  const ts = typeof resetsAt === 'number'
    ? (resetsAt < 1e12 ? resetsAt * 1000 : resetsAt)
    : typeof resetsAt === 'string'
      ? Date.parse(resetsAt)
      : null;
  if (!ts || !Number.isFinite(ts) || ts <= now) return null;

  const diffMs = ts - now;
  const minTotal = Math.round(diffMs / 60000);
  if (options.relative || diffMs >= 24 * 3600 * 1000) {
    if (diffMs < 3600 * 1000) {
      return `resets in ${Math.max(1, minTotal)}m`;
    }
    if (diffMs < 24 * 3600 * 1000) {
      const hr = Math.floor(minTotal / 60);
      const min = minTotal % 60;
      return min > 0 ? `resets in ${hr}h ${min}m` : `resets in ${hr}h`;
    }
    const d = Math.floor(minTotal / 1440);
    const hr = Math.floor((minTotal % 1440) / 60);
    return `resets in ${d}d ${hr}h`;
  }
  const d = new Date(ts);
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `resets ${timeStr}`;
}

/**
 * Formats token count with rounded K/M suffixes.
 * Avoids false precision like "96,009" -> "96K" or "~96K".
 * Returns null if missing/invalid (never "N/A").
 * @param {number|null|undefined} tokens
 * @param {{ approx?: boolean }} [options]
 * @returns {string|null}
 */
export function formatTokens(tokens, options = {}) {
  if (tokens === null || tokens === undefined || !Number.isFinite(tokens)) return null;
  const prefix = options.approx ? '~' : '';
  if (tokens < 1000) return `${prefix}${Math.round(tokens)}`;
  if (tokens < 1e6) {
    return `${prefix}${(Math.round(tokens / 100) / 10).toString().replace(/\.0$/, '')}K`;
  }
  return `${prefix}${(Math.round(tokens / 1e4) / 100).toString().replace(/\.0$/, '')}M`;
}
