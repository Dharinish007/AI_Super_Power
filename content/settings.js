/**
 * Context Monitor - Settings
 *
 * One object in chrome.storage.local, read by the side panel and by the widgets on every site. Reads
 * always go through normalizeSettings, so a missing, old or hand-edited value never breaks the UI.
 */

export const SETTINGS_KEY = 'settings';

/** Fields the Context widget can show, in display order. */
export const CONTEXT_FIELDS = [
  { key: 'tokens', label: 'Tokens used / window' },
  { key: 'percent', label: '% of window' },
  { key: 'model', label: 'Model' },
  { key: 'exchangesLeft', label: 'Exchanges left' },
  { key: 'limits', label: 'Plan usage limits' },
  { key: 'alert', label: 'Alert message' }
];

const CAPSULE_METHODS = ['ask-ai', 'quick'];
const THEMES = ['auto', 'dark', 'light'];

export const DEFAULT_SETTINGS = Object.freeze({
  widgets: { context: { enabled: true, fields: ['tokens', 'percent', 'model', 'exchangesLeft'] }, capsule: { enabled: true } },
  capsule: { method: 'ask-ai' },
  context: { alerts: true },
  display: { theme: 'auto', compact: false, badges: true }
});

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const oneOf = (v, list) => (list.includes(v) ? v : list[0]);

/** @returns {typeof DEFAULT_SETTINGS} a fresh, valid settings object */
export function normalizeSettings(raw) {
  const r = obj(raw);
  const w = obj(r.widgets);
  const wc = obj(w.context);
  const keys = CONTEXT_FIELDS.map(f => f.key);
  const fields = Array.isArray(wc.fields) ? [...new Set(wc.fields.filter(k => keys.includes(k)))] : [...DEFAULT_SETTINGS.widgets.context.fields];
  const d = obj(r.display);
  return {
    widgets: { context: { enabled: bool(wc.enabled, true), fields }, capsule: { enabled: bool(obj(w.capsule).enabled, true) } },
    capsule: { method: oneOf(obj(r.capsule).method, CAPSULE_METHODS) },
    context: { alerts: bool(obj(r.context).alerts, true) },
    display: { theme: oneOf(d.theme, THEMES), compact: bool(d.compact, false), badges: bool(d.badges, true) }
  };
}

/** @param {{ get: Function }} area chrome.storage.local (or a fake) */
export async function readSettings(area) {
  try { return normalizeSettings((await area.get(SETTINGS_KEY))?.[SETTINGS_KEY]); } catch (_) { return normalizeSettings(); }
}

/** Merges `patch` (any subset, two levels deep) into the stored settings; returns the result. */
export async function writeSettings(area, patch) {
  const cur = await readSettings(area);
  const p = obj(patch);
  const next = normalizeSettings({
    widgets: { context: { ...cur.widgets.context, ...obj(obj(p.widgets).context) }, capsule: { ...cur.widgets.capsule, ...obj(obj(p.widgets).capsule) } },
    capsule: { ...cur.capsule, ...obj(p.capsule) },
    context: { ...cur.context, ...obj(p.context) },
    display: { ...cur.display, ...obj(p.display) }
  });
  await area.set({ [SETTINGS_KEY]: next });
  return next;
}
