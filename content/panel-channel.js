/**
 * Context Monitor - Panel channel
 *
 * One port per tab between the content script (engine) and the side panel (view). The tab pushes the
 * view state; the panel calls Page methods and a few actions by name. Nothing flows while the panel is
 * closed: the port only exists while it is open. Only names in PAGE_CALLS / ACTION_CALLS can be called.
 */

export const PANEL_PORT = 'panel';
export const PAGE_CALLS = ['hasConversation', 'takeSelection', 'fill', 'latestReply', 'transcript', 'countTokens', 'limitReached'];
const ACTION_CALLS = ['refresh', 'diagnostics'];
// Same hosts as manifest host_permissions (a plain list: providers.js would pull the Gemma tokenizer into the panel bundle)
const SUPPORTED_HOSTS = ['chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com'];

/** ChatGPT, Claude or Gemini. */
export function isSupportedUrl(url) {
  let host;
  try { host = new URL(url).hostname; } catch (_) { return false; }
  return SUPPORTED_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
}

/** What the panel shows for the active tab. */
export function panelStatus({ url, connected, ready }) {
  if (!isSupportedUrl(url)) return 'unsupported';
  if (!connected) return 'reload';
  return ready ? 'live' : 'reading';
}

/**
 * Tab side. `push(state)` sends the latest view state to an open panel (no-op when closed). Throttled
 * like the toolbar badge: the first push goes out at once, then at most one per 250 ms with the latest
 * state (streaming runs ~20 passes a second).
 */
export function servePanel({ runtime, page, getState, actions }) {
  let port = null;
  let pending = null;
  let timer = null;
  const watchers = new Map(); // call id -> stop (the current port's only)
  // Everything below talks to one port at a time: the newest. Replies for an older port are dropped.
  const drop = (p) => {
    if (port !== p) return;
    port = null; pending = null; clearTimeout(timer); timer = null;
    for (const stop of watchers.values()) stop();
    watchers.clear();
  };
  const send = (p, m) => { if (port !== p) return; try { p.postMessage(m); } catch (_) { drop(p); } };
  const flush = () => {
    timer = null;
    if (!pending || !port) return;
    send(port, { type: 'STATE', state: pending, provider: page.provider });
    pending = null;
    timer = setTimeout(flush, 250);
  };
  runtime.onConnect.addListener((p) => {
    if (p.name !== PANEL_PORT) return;
    if (port) { const old = port; drop(old); try { old.disconnect(); } catch (_) {} } // one panel per tab
    port = p;
    p.onDisconnect.addListener(() => drop(p));
    p.onMessage.addListener(async (m) => {
      if (m?.type === 'STOP_WATCH') { watchers.get(m.id)?.(); watchers.delete(m.id); return; }
      if (m?.type !== 'CALL') return;
      try {
        let value;
        if (m.name === 'watchCapsule') {
          const stop = await page.watchCapsule((capsule) => send(p, { type: 'CAPSULE', id: m.id, capsule }), ...(m.args || []));
          if (port === p) watchers.set(m.id, stop); else stop(); // the panel left while it started
        } else if (PAGE_CALLS.includes(m.name)) value = await page[m.name](...(m.args || []));
        else if (ACTION_CALLS.includes(m.name)) value = await actions[m.name](...(m.args || []));
        else throw new Error(`Unknown call: ${m.name}`);
        send(p, { type: 'REPLY', id: m.id, ok: true, value });
      } catch (e) { send(p, { type: 'REPLY', id: m.id, ok: false, error: String(e?.message || e) }); }
    });
    send(p, { type: 'STATE', state: getState(), provider: page.provider });
  });
  return {
    push(state) {
      if (!port) return;
      pending = state;
      if (!timer) flush();
    }
  };
}

/** Panel side. Returns a Page whose calls run in the tab. */
export function connectPanel({ tabs, tabId, onState, onDisconnect = () => {} }) {
  const port = tabs.connect(tabId, { name: PANEL_PORT });
  const pending = new Map();
  const capsuleCbs = new Map();
  let seq = 0;
  let provider = 'AI';
  port.onMessage.addListener((m) => {
    if (m?.type === 'STATE') { provider = m.provider || provider; onState(m.state); }
    else if (m?.type === 'REPLY') { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.ok ? p.resolve(m.value) : p.reject(new Error(m.error))); }
    else if (m?.type === 'CAPSULE') { capsuleCbs.get(m.id)?.(m.capsule); capsuleCbs.delete(m.id); }
  });
  const closed = () => { for (const p of pending.values()) p.reject(new Error('Disconnected')); pending.clear(); capsuleCbs.clear(); };
  port.onDisconnect.addListener(() => { closed(); onDisconnect(); });
  const call = (name, args = []) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    try { port.postMessage({ type: 'CALL', id, name, args }); } catch (e) { pending.delete(id); reject(e); }
  });
  const page = {
    get provider() { return provider; },
    ...Object.fromEntries(PAGE_CALLS.map(n => [n, (...args) => call(n, args)])),
    async watchCapsule(onFound, opts) {
      const id = seq + 1; // call() takes this id
      capsuleCbs.set(id, onFound);
      try { await call('watchCapsule', opts ? [opts] : []); } catch (e) { capsuleCbs.delete(id); throw e; }
      return () => { capsuleCbs.delete(id); try { port.postMessage({ type: 'STOP_WATCH', id }); } catch (_) {} };
    }
  };
  return { page, call, disconnect: () => { closed(); port.disconnect(); } }; // Chrome fires onDisconnect on the other end only
}
