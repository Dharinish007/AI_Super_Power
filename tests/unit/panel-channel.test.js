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

  // One panel per tab: a second connect replaces the first; replies and watchers stay with their own port
  {
    const stops = [];
    let conn = null;
    const pg2 = { provider: 'Claude', fill: (t) => new Promise(r => setTimeout(() => r(t), t === 'one' ? 30 : 60)),
      watchCapsule: async () => { const s = { stopped: false }; stops.push(s); return () => { s.stopped = true; }; } };
    servePanel({ runtime: { onConnect: { addListener(f) { conn = f; } } }, page: pg2, getState: () => ({ ready: true }), actions: {} });
    const open = () => {
      const [tabEnd, panelEnd] = portPair();
      const c = connectPanel({ tabs: { connect: () => panelEnd }, tabId: 1, onState() {}, onDisconnect: () => { c.gone = true; } });
      conn(tabEnd);
      return c;
    };
    const c1 = open();
    await c1.page.watchCapsule(() => {});
    const slow = c1.page.fill('one').then(() => 'resolved', (e) => e.message);
    await tick();
    const c2 = open();
    await tick();
    await c2.page.watchCapsule(() => {});
    assert('Second connect: the old panel is disconnected and its watcher stopped', c1.gone === true && stops[0].stopped === true);
    assert('Second connect: the new panel watcher is kept', stops[1].stopped === false);
    assert('Second connect: replies go to the right port', (await c2.page.fill('two')) === 'two');
    assert('Second connect: the old panel call never resolves with a reply', (await slow) === 'Disconnected');
  }

  // Panel-side disconnect rejects what is waiting (Chrome doesn't fire onDisconnect on the caller's own end)
  {
    const [, panelEnd] = portPair();
    const c = connectPanel({ tabs: { connect: () => panelEnd }, tabId: 1, onState() {} });
    const waiting = c.call('diagnostics').then(() => 'resolved', (e) => e.message);
    c.disconnect();
    assert('disconnect() rejects pending calls', (await waiting) === 'Disconnected');
  }

  // Throttle: first push at once, then one trailing send with the latest state
  {
    let conn = null;
    const srv = servePanel({ runtime: { onConnect: { addListener(f) { conn = f; } } }, page: { provider: 'Claude' }, getState: () => ({ n: 0 }), actions: {} });
    const [tabEnd, panelEnd] = portPair();
    const seen = [];
    connectPanel({ tabs: { connect: () => panelEnd }, tabId: 1, onState: (s) => seen.push(s.n) });
    conn(tabEnd);
    await tick();
    srv.push({ n: 1 }); srv.push({ n: 2 }); srv.push({ n: 3 });
    await tick();
    assert('Throttle: the first push goes out at once', seen.join() === '0,1');
    await new Promise(r => setTimeout(r, 320));
    assert('Throttle: the trailing send carries the latest state', seen.join() === '0,1,3');
  }

  return { passed, failed };
}
