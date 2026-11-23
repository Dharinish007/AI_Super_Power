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

export const DEFAULT_FEATURES = Object.freeze({
  countdown: true,           // Feature 1: default ON
  alerts: true,              // Feature 2: default ON
  newChatSuggestion: true,   // Feature 3: default ON
  biggestItem: false,        // Feature 4: default OFF until verified
  usageHistory: false,       // Feature 5: default OFF until verified
  preSendEstimate: false,    // Feature 6: default OFF until verified
  checkpointExport: false    // Feature 7: default OFF until verified
});

export const DEFAULT_SETTINGS = Object.freeze({
  version: 2,
  widgets: { context: { enabled: true, fields: ['tokens', 'percent', 'model', 'exchangesLeft'] }, capsule: { enabled: true } },
  capsule: { method: 'ask-ai' },
  context: { alerts: true },
  display: { theme: 'auto', compact: false, badges: true },
  features: DEFAULT_FEATURES,
  export: { defaultFormat: 'markdown' }
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
  const feat = obj(r.features);
  const ctx = obj(r.context);

  // Synchronize alerts: if either explicitly defines a boolean, respect it; default to DEFAULT_FEATURES.alerts
  let alertsVal = DEFAULT_FEATURES.alerts;
  if (typeof feat.alerts === 'boolean') {
    alertsVal = feat.alerts;
  } else if (typeof ctx.alerts === 'boolean') {
    alertsVal = ctx.alerts;
  }

  return {
    version: 2,
    widgets: { context: { enabled: bool(wc.enabled, true), fields }, capsule: { enabled: bool(obj(w.capsule).enabled, true) } },
    capsule: { method: oneOf(obj(r.capsule).method, CAPSULE_METHODS) },
    context: { alerts: alertsVal },
    display: { theme: oneOf(d.theme, THEMES), compact: bool(d.compact, false), badges: bool(d.badges, true) },
    features: {
      countdown: bool(feat.countdown, DEFAULT_FEATURES.countdown),
      alerts: alertsVal,
      newChatSuggestion: bool(feat.newChatSuggestion, DEFAULT_FEATURES.newChatSuggestion),
      biggestItem: bool(feat.biggestItem, DEFAULT_FEATURES.biggestItem),
      usageHistory: bool(feat.usageHistory, DEFAULT_FEATURES.usageHistory),
      preSendEstimate: bool(feat.preSendEstimate, DEFAULT_FEATURES.preSendEstimate),
      checkpointExport: bool(feat.checkpointExport, DEFAULT_FEATURES.checkpointExport)
    },
    export: {
      defaultFormat: oneOf(obj(r.export).defaultFormat, ['markdown', 'pdf', 'excel'])
    }
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
  const pContext = obj(p.context);
  const pFeatures = obj(p.features);
  const pExport = obj(p.export);

  // Keep alerts in sync across features.alerts and context.alerts
  let syncedAlerts;
  if (typeof pFeatures.alerts === 'boolean') {
    syncedAlerts = pFeatures.alerts;
  } else if (typeof pContext.alerts === 'boolean') {
    syncedAlerts = pContext.alerts;
  }

  const mergedFeatures = {
    ...cur.features,
    ...pFeatures,
    ...(syncedAlerts !== undefined ? { alerts: syncedAlerts } : {})
  };
  const mergedContext = {
    ...cur.context,
    ...pContext,
    ...(syncedAlerts !== undefined ? { alerts: syncedAlerts } : {})
  };

  const next = normalizeSettings({
    version: 2,
    widgets: { context: { ...cur.widgets.context, ...obj(obj(p.widgets).context) }, capsule: { ...cur.widgets.capsule, ...obj(obj(p.widgets).capsule) } },
    capsule: { ...cur.capsule, ...obj(p.capsule) },
    context: mergedContext,
    display: { ...cur.display, ...obj(p.display) },
    features: mergedFeatures,
    export: { ...cur.export, ...pExport }
  });
  await area.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Resets all settings to default values and saves back to storage. */
export async function resetSettings(area) {
  const defaults = normalizeSettings({});
  await area.set({ [SETTINGS_KEY]: defaults });
  return defaults;
}

/**
 * Migrates settings to v2 if version is missing or < 2.
 * Automatically saves migrated settings back to storage if needed.
 */
export async function migrateSettings(area) {
  try {
    const raw = (await area.get(SETTINGS_KEY))?.[SETTINGS_KEY];
    if (!raw || typeof raw !== 'object' || raw.version !== 2) {
      const migrated = normalizeSettings(raw);
      await area.set({ [SETTINGS_KEY]: migrated });
      return { migrated: true, settings: migrated };
    }
    return { migrated: false, settings: normalizeSettings(raw) };
  } catch (_) {
    return { migrated: false, settings: normalizeSettings() };
  }
}
