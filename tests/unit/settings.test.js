/** Unit Tests for content/settings.js: defaults, repair of bad values, partial writes. */

import { SETTINGS_KEY, DEFAULT_SETTINGS, DEFAULT_FEATURES, CONTEXT_FIELDS, normalizeSettings, readSettings, writeSettings, resetSettings, migrateSettings } from '../../content/settings.js';

function fakeArea(init = {}) {
  const data = structuredClone(init);
  return { data, async get(k) { return k in data ? { [k]: structuredClone(data[k]) } : {}; }, async set(o) { Object.assign(data, structuredClone(o)); } };
}

export async function runSettingsTests() {
  console.log('--- Running Settings Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => { if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; } else { console.error(`  ❌ [FAIL] ${name}`); failed++; } };

  const d = normalizeSettings(undefined);
  assert('Defaults: both widgets on', d.widgets.context.enabled === true && d.widgets.capsule.enabled === true);
  assert('Defaults: four Context fields', JSON.stringify(d.widgets.context.fields) === '["tokens","percent","model","exchangesLeft"]');
  assert('Defaults: Capsule method ask-ai, alerts on, theme auto', d.capsule.method === 'ask-ai' && d.context.alerts === true && d.display.theme === 'auto');
  assert('Defaults are not shared objects', normalizeSettings({}).widgets !== DEFAULT_SETTINGS.widgets);

  const bad = normalizeSettings({ widgets: { context: { enabled: 'no', fields: ['tokens', 'nope', 'tokens', 7] }, capsule: null }, capsule: { method: 'api-key' }, display: { theme: 'pink', compact: 1 } });
  assert('Bad enabled -> default', bad.widgets.context.enabled === true && bad.widgets.capsule.enabled === true);
  assert('Unknown / duplicate fields dropped', JSON.stringify(bad.widgets.context.fields) === '["tokens"]');
  assert('Unknown method -> ask-ai', bad.capsule.method === 'ask-ai');
  assert('Bad theme -> auto; compact must be boolean', bad.display.theme === 'auto' && bad.display.compact === false);
  assert('Empty field list is allowed', normalizeSettings({ widgets: { context: { fields: [] } } }).widgets.context.fields.length === 0);
  assert('Every field key has a label', CONTEXT_FIELDS.every(f => f.key && f.label));

  const area = fakeArea();
  assert('Read with nothing stored = defaults', (await readSettings(area)).capsule.method === 'ask-ai');
  const w = await writeSettings(area, { widgets: { capsule: { enabled: false } } });
  assert('Write merges a partial patch', w.widgets.capsule.enabled === false && w.widgets.context.enabled === true);
  assert('Write stores the normalized object', area.data[SETTINGS_KEY].widgets.capsule.enabled === false);
  const w2 = await writeSettings(area, { capsule: { method: 'quick' } });
  assert('Second write keeps the first', w2.widgets.capsule.enabled === false && w2.capsule.method === 'quick');
  assert('Read survives a throwing area', (await readSettings({ get: () => { throw new Error('x'); } })).capsule.method === 'ask-ai');

  // Schema v2 & Feature Flags
  assert('DEFAULT_FEATURES is frozen', Object.isFrozen(DEFAULT_FEATURES));
  assert('Normalized settings include version 2', d.version === 2);
  assert('Default features 1-3 are ON', d.features.countdown === true && d.features.alerts === true && d.features.newChatSuggestion === true);
  assert('Default features 4-7 are OFF', d.features.biggestItem === false && d.features.usageHistory === false && d.features.preSendEstimate === false && d.features.checkpointExport === false);

  // Migration from legacy v1 (no version field)
  const legacyArea = fakeArea({ [SETTINGS_KEY]: { widgets: { context: { enabled: true } }, capsule: { method: 'quick' } } });
  const migResult = await migrateSettings(legacyArea);
  assert('migrateSettings migrates legacy v1 to v2', migResult.migrated === true && migResult.settings.version === 2);
  assert('migrateSettings preserves user choices from v1', migResult.settings.capsule.method === 'quick');
  assert('migrateSettings writes back to storage', legacyArea.data[SETTINGS_KEY].version === 2);

  // Re-migrating v2 is a no-op
  const noopResult = await migrateSettings(legacyArea);
  assert('migrateSettings on v2 returns migrated=false', noopResult.migrated === false);

  // Synchronization between context.alerts and features.alerts
  const alertOff = await writeSettings(area, { context: { alerts: false } });
  assert('writeSettings({ context: { alerts: false } }) updates both context and features', alertOff.context.alerts === false && alertOff.features.alerts === false);
  const alertOn = await writeSettings(area, { features: { alerts: true } });
  assert('writeSettings({ features: { alerts: true } }) updates both context and features', alertOn.context.alerts === true && alertOn.features.alerts === true);

  // resetSettings
  const resetResult = await resetSettings(area);
  assert('resetSettings restores default features and version 2', resetResult.version === 2 && resetResult.features.countdown === true && resetResult.features.biggestItem === false);
  assert('resetSettings saves back to storage area', area.data[SETTINGS_KEY].version === 2);

  return { passed, failed };
}
