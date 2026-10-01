/** Unit Tests for content/panel-channel.js: URL support, panel states, the port protocol over fake ports. */

import { PANEL_PORT, isSupportedUrl, panelStatus, servePanel, connectPanel } from '../../content/panel-channel.js';

/** Two linked fake ports, like chrome.runtime.Port. */
function portPair() {
  const mk = () => ({ name: PANEL_PORT, _m: [], _d: [], onMessage: { addListener(f) { this.f = f; } }, onDisconnect: { addListener(f) { this.f = f; } } });
  const a = mk(); const b = mk();
  a.postMessage = (m) => queueMicrotask(() => b.onMessage.f?.(structuredClone(m)));
  b.postMessage = (m) => queueMicrotask(() => a.onMessage.f?.(structuredClone(m)));
  a.disconnect = () => queueMicrotask(() => b.onDisconnect.f?.());
  b.disconnect = () => queueMicrotask(() => a.onDisconnect.f?.());
  return [a, b];
}
const tick = () => new Promise(r => setTimeout(r, 0));

export async function runPanelChannelTests() {
  console.log('--- Running Panel Channel Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => { if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; } else { console.error(`  ❌ [FAIL] ${name}`); failed++; } };

  assert('Supported sites', ['https://chatgpt.com/c/1', 'https://chat.openai.com/', 'https://claude.ai/chat/x', 'https://gemini.google.com/app'].every(isSupportedUrl));
  assert('Other sites / no URL not supported', !isSupportedUrl('https://example.com') && !isSupportedUrl(undefined) && !isSupportedUrl('chrome://newtab'));
  assert('Status: other site', panelStatus({ url: 'https://example.com', connected: false }) === 'unsupported');
  assert('Status: supported, no script', panelStatus({ url: 'https://claude.ai/', connected: false }) === 'reload');
  assert('Status: connected, no data', panelStatus({ url: 'https://claude.ai/', connected: true, ready: false }) === 'reading');
  assert('Status: live', panelStatus({ url: 'https://claude.ai/', connected: true, ready: true }) === 'live');

  // Tab side
  let onConnect = null;
  const runtime = { onConnect: { addListener(f) { onConnect = f; } } };
  const page = { provider: 'Claude', fill: async (t) => t === 'ok', countTokens: async (ts) => ts.map(t => t.length),
    watchCapsule: async (cb) => { page.cb = cb; return () => { page.stopped = true; }; } };
  let refreshed = 0;
  const server = servePanel({ runtime, page, getState: () => ({ ready: true, usedTokens: 5 }),
    actions: { refresh: () => { refreshed++; }, diagnostics: () => ({ v: 1 }) } });

  // Panel side
  const [tabEnd, panelEnd] = portPair();
  const states = [];
  const tabs = { connect: (id, o) => { assert('Connects to the right tab with the panel port name', id === 7 && o.name === PANEL_PORT); return panelEnd; } };
  const client = connectPanel({ tabs, tabId: 7, onState: (s) => states.push(s), onDisconnect: () => states.push('gone') });
  onConnect(tabEnd);
  await tick();
  assert('State sent on connect', states[0]?.usedTokens === 5);
  server.push({ ready: true, usedTokens: 9 });
  await tick();
  assert('Pushed state arrives', states.at(-1).usedTokens === 9);

  assert('Remote fill', (await client.page.fill('ok')) === true && (await client.page.fill('no')) === false);
  assert('Remote countTokens', JSON.stringify(await client.page.countTokens(['ab'])) === '[2]');
  assert('Remote provider name comes with the state', client.page.provider === 'Claude');
  assert('Actions', (await client.call('diagnostics')).v === 1);
  await client.call('refresh');
  assert('Refresh runs', refreshed === 1);
  let bad = null; try { await client.call('evil'); } catch (e) { bad = e.message; }
  assert('Unknown call rejected', bad === 'Unknown call: evil');

  const got = [];
  const stop = await client.page.watchCapsule((c) => got.push(c.title));
  page.cb({ title: 'T', body: 'b' });
  await tick(); await tick();
  assert('Capsule found in the tab reaches the panel', JSON.stringify(got) === '["T"]');
  stop(); await tick(); await tick();
  assert('Stopping in the panel stops the tab watcher', page.stopped === true);

  // A port with another name is ignored; after disconnect, push does nothing
  const [other] = portPair(); other.name = 'x'; let otherGot = 0; other.postMessage = () => { otherGot++; };
  onConnect(other); server.push({ ready: true }); await tick();
  assert('Other ports ignored', otherGot === 0);
  panelEnd.disconnect(); await tick();
  server.push({ ready: true, usedTokens: 1 }); await tick();
  assert('No push after the panel disconnects', states.filter(s => s?.usedTokens === 1).length === 0);

  return { passed, failed };
}
