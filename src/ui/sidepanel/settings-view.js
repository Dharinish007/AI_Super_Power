/**
 * Context Monitor - Settings tab: Widgets (two toggles, Context widget fields), Capsules (method),
 * Context (alerts), Display (theme, compact numbers, sidebar badges). Every change is written at once;
 * the widgets on every site pick it up through storage.onChanged.
 */

import { h, textButton } from '../shared/dom.js';
import { CONTEXT_FIELDS, writeSettings, resetSettings } from '../../core/settings.js';

/**
 * @param {HTMLElement} parent
 * @param {{ storage: Object }} opts chrome.storage.local (or a fake)
 * @returns {{ el: HTMLElement, update: (settings: Object) => void }} `update` shows the stored settings
 */
export function SettingsView(parent, { storage }) {
  const el = h('div', 'body settings', parent);
  const inputs = [];
  // One write at a time: each read-modify-write starts from the previous one's result
  let queue = Promise.resolve();
  const save = (patch) => { queue = queue.then(() => writeSettings(storage, patch)).catch((e) => console.warn('[Context Monitor] Settings not saved', e)); };

  const group = (title) => { const g = h('fieldset', 'group', el); h('legend', null, g, title); return g; };
  const input = (g, type, label, get, onChange) => {
    const row = h('label', 'row', g);
    const box = h('input', null, row);
    box.type = type;
    h('span', null, row, label);
    box.addEventListener('change', onChange);
    inputs.push((s) => { box.checked = get(s); });
    return box;
  };
  const check = (g, label, get, patch) => { const box = input(g, 'checkbox', label, get, () => save(patch(box.checked))); return box; };
  const radio = (g, name, value, label, get, patch) => {
    const r = input(g, 'radio', label, s => get(s) === value, () => r.checked && save(patch(value)));
    r.name = name;
    r.value = value;
  };

  const w = group('Widgets');
  check(w, 'Context widget', s => s.widgets.context.enabled, v => ({ widgets: { context: { enabled: v } } }));
  check(w, 'Capsule widget', s => s.widgets.capsule.enabled, v => ({ widgets: { capsule: { enabled: v } } }));
  h('div', 'fine', w, 'Context widget shows:');
  // The ticked boxes, in CONTEXT_FIELDS order
  const fields = () => ({ widgets: { context: { fields: CONTEXT_FIELDS.filter((_, i) => fieldBoxes[i].checked).map(f => f.key) } } });
  const fieldBoxes = CONTEXT_FIELDS.map(f => check(w, f.label, s => s.widgets.context.fields.includes(f.key), fields));

  const f = group('Features');
  check(f, 'Reset countdown (live updates every 60s)', s => s.features.countdown, v => ({ features: { countdown: v } }));
  check(f, 'Threshold alerts at 80% with hysteresis', s => s.features.alerts, v => ({ features: { alerts: v }, context: { alerts: v } }));
  check(f, 'Suggest new chat in drawer at 80%+ context', s => s.features.newChatSuggestion, v => ({ features: { newChatSuggestion: v } }));
  check(f, 'Show biggest item in drawer', s => s.features.biggestItem, v => ({ features: { biggestItem: v } }));
  check(f, 'Record usage history and sparkline', s => s.features.usageHistory, v => ({ features: { usageHistory: v } }));
  check(f, 'Pre-send draft token estimate', s => s.features.preSendEstimate, v => ({ features: { preSendEstimate: v } }));
  check(f, 'Checkpoint export to Markdown', s => s.features.checkpointExport, v => ({ features: { checkpointExport: v } }));

  const c = group('Capsules: one-click method');
  radio(c, 'method', 'ask-ai', 'Ask this AI (fills the chat box; you press Enter)', s => s.capsule.method, v => ({ capsule: { method: v } }));
  radio(c, 'method', 'quick', 'Quick (no AI): built from the page', s => s.capsule.method, v => ({ capsule: { method: v } }));

  const x = group('Context');
  check(x, 'Alerts at 80% and 95% (on the Context widget)', s => s.context.alerts, v => ({ context: { alerts: v }, features: { alerts: v } }));

  const d = group('Display');
  for (const t of ['auto', 'dark', 'light']) radio(d, 'theme', t, `Theme: ${t}`, s => s.display.theme, v => ({ display: { theme: v } }));
  check(d, 'Compact numbers (61.3K)', s => s.display.compact, v => ({ display: { compact: v } }));
  check(d, 'Usage % next to chats in the sidebar', s => s.display.badges, v => ({ display: { badges: v } }));

  const r = group('Reset');
  const resetBtn = textButton(r, 'Reset all settings to defaults', async () => {
    try {
      const def = await resetSettings(storage);
      for (const set of inputs) set(def);
    } catch (err) {
      console.warn('[Context Monitor] Reset settings failed', err);
    }
  });
  resetBtn.style.marginTop = '4px';

  return { el, update(s) { for (const set of inputs) set(s); } };
}
