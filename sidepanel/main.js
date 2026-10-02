/**
 * AI Context Monitor - Side panel. Shows the active tab of this window: Context | Capsules | Skills |
 * Settings. The engine runs in the tab; this page renders its view state and calls back through the
 * panel channel. Capsules, Skills and Settings are read from chrome.storage.local directly.
 * Built into sidepanel/sidepanel.js by scripts/build.js (one IIFE: no top-level await, hence the wrapper).
 */

import { STYLES } from '../ui/styles.js';
import { h, textButton, show, setText, download } from '../ui/dom.js';
import { ContextView } from '../ui/context-view.js';
import { CapsulePanel } from '../ui/capsule-panel.js';
import { SettingsView } from '../ui/settings-view.js';
import { connectPanel, panelStatus, isSupportedUrl, PAGE_CALLS } from '../content/panel-channel.js';
import { readSettings, SETTINGS_KEY } from '../content/settings.js';
import { CAPSULES_KEY, CAPSULE_HANDOFF_KEY, SKILLS_KEY } from '../content/capsule.js';
import { formatChatExport } from '../content/widget-state.js';

(async () => {
  const TABS = [ // Adding a feature = one entry here (+ a Settings section)
    { id: 'context', label: 'Context' },
    { id: 'capsules', label: 'Capsules' },
    { id: 'skills', label: 'Skills' },
    { id: 'settings', label: '⚙', title: 'Settings' }
  ];
  const MESSAGES = {
    unsupported: 'Open ChatGPT, Claude or Gemini to see this chat\'s context.',
    reload: 'Reload this page to start.',
    reading: 'Reading the conversation…'
  };

  const storage = chrome.storage.local;
  document.head.appendChild(h('style', null, null, STYLES));
  const root = document.body;
  root.className = 'root panelpage';

  // The current tab's channel; replaced when the active tab changes
  let link = null;
  let tabInfo = { id: null, url: null, loading: false };
  let vm = null;
  let settings = await readSettings(storage);
  let active = 'context';

  const toastEl = h('div', 'toast', root);
  toastEl.setAttribute('role', 'status');
  let toastTimer = null;
  const toast = (text, ms = 1500) => {
    setText(toastEl, text);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  };
  // The Page the Capsule panels use: always the current tab's; with no tab link every call rejects ("Page not reachable")
  const page = {
    get provider() { return link?.page.provider || 'AI'; },
    ...Object.fromEntries([...PAGE_CALLS, 'watchCapsule'].map(n => [n, (...args) => (link ? link.page[n](...args) : Promise.reject(new Error('No chat in this tab')))]))
  };

  const nav = h('div', 'tabs', root);
  nav.setAttribute('role', 'tablist');
  const tabBtns = Object.fromEntries(TABS.map(t => {
    const b = textButton(nav, t.label, () => select(t.id), 'tab');
    b.setAttribute('role', 'tab');
    if (t.title) { b.title = t.title; b.setAttribute('aria-label', t.title); }
    return [t.id, b];
  }));
  const empty = h('div', 'empty', root);
  const ctxView = ContextView(root, { settings, actions: {
    refresh: () => link?.call('refresh'),
    copyDiagnostics: async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify((await link.call('diagnostics')) || { note: 'no state yet' }, null, 2));
        toast('Diagnostics copied');
      } catch (_) { toast('Copy failed'); }
    },
    // Same as the widget: the chat as shown on the page
    exportChat: async (format) => {
      let msgs;
      try { msgs = await page.transcript(); } catch (_) { return toast('Page not reachable'); }
      if (!msgs.length) return toast('Open a conversation first');
      download(root, 'chat', format, formatChatExport(msgs, format, { provider: page.provider }), format === 'json' ? 'application/json' : 'text/plain');
      toast(`Exported ${msgs.length} messages shown on the page`, 2500);
    },
    saveAsCapsule: () => { select('capsules'); caps.capture(); }
  } });
  const caps = CapsulePanel(root, { kind: 'capsule', storage, page, toast, reveal: () => select('capsules') });
  const skills = CapsulePanel(root, { kind: 'skill', storage, page, toast, reveal: () => select('skills') });
  const settingsView = SettingsView(root, { storage });

  render(); // Until the active tab is known

  // Tooltips: the native title, from data-tip (set by the shared components)
  const tipFor = (e) => { const t = e.target.closest?.('[data-tip]'); if (t && t.title !== t.dataset.tip) t.title = t.dataset.tip; };
  root.addEventListener('pointerover', tipFor);
  root.addEventListener('focusin', tipFor);

  function select(id) { active = id; render(); }

  function render() {
    const status = panelStatus({ url: tabInfo.url, connected: Boolean(link) || tabInfo.loading, ready: Boolean(vm) && vm.ready !== false });
    // Context needs a live tab; Capsules / Skills lists work without one (Insert etc. toast when no tab answers)
    const blocked = active === 'context' && status !== 'live';
    show(empty, blocked);
    setText(empty, MESSAGES[status] || '');
    show(ctxView.el, !blocked && active === 'context');
    show(ctxView.foot, !blocked && active === 'context');
    show(caps.view, active === 'capsules');
    show(skills.view, active === 'skills');
    show(settingsView.el, active === 'settings');
    for (const [id, b] of Object.entries(tabBtns)) b.setAttribute('aria-selected', String(id === active));
    const theme = settings.display.theme;
    root.classList.toggle('light', theme === 'light' || (theme === 'auto' && !matchMedia('(prefers-color-scheme: dark)').matches));
  }

  // A Capsule wait belongs to the tab it started in: end it when that tab's link goes
  function endWaits() {
    const stopped = caps.stop();
    skills.stop();
    if (stopped) toast('Capsule wait stopped: the tab changed');
  }

  function setState(s) {
    vm = s;
    if (s) ctxView.update(s);
    caps.setView(s);
    skills.setView(s);
    render();
  }

  function follow(tab) {
    if (!tab) return;
    const same = tab.id === tabInfo.id;
    tabInfo = { id: tab.id, url: tab.url, loading: tab.status === 'loading' };
    // Same tab, still linked: the content script follows its own in-page navigation (a full navigation drops the port)
    if (same && link) return render();
    if (link) endWaits();
    link?.disconnect();
    link = null;
    vm = null;
    // A loading page's content script is not listening yet ("Reading…" until then): connect at 'complete'
    if (!tabInfo.loading && isSupportedUrl(tab.url)) {
      try {
        // No content script in the tab (opened before install / update): Chrome drops the port at once -> 'reload'
        const l = connectPanel({ tabs: chrome.tabs, tabId: tab.id, onState: (s) => { if (link === l) setState(s); },
          onDisconnect: () => { void chrome.runtime.lastError; if (link === l) { link = null; endWaits(); setState(null); } } });
        link = l;
      } catch (_) { link = null; }
    }
    setState(vm);
  }

  const win = await chrome.windows.getCurrent();
  const activeTab = async () => (await chrome.tabs.query({ active: true, windowId: win.id }))[0];
  chrome.tabs.onActivated.addListener(({ windowId }) => { if (windowId === win.id) activeTab().then(follow); });
  chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (tab.active && tab.windowId === win.id && (info.url || info.status)) follow(tab); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch[SETTINGS_KEY]) {
      readSettings(storage).then(s => {
        settings = s;
        settingsView.update(s);
        ctxView.setSettings(s);
        if (vm) ctxView.update(vm); // compact numbers apply now
        render();
      });
    }
    if (ch[CAPSULES_KEY] || ch[CAPSULE_HANDOFF_KEY]) caps.refresh();
    if (ch[SKILLS_KEY]) skills.refresh();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

  settingsView.update(settings);
  caps.refresh();
  skills.refresh();
  follow(await activeTab());
})().catch((e) => console.error('[Context Monitor] Side panel failed to start:', e));
