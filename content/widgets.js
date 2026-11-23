/**
 * Context Monitor - In-page UI Widgets:
 * 1. Glance strip (one line, always visible, mounted above the chat input):
 *    "🟢 48% · ~28 msgs left · resets 7:20 PM"
 *    Clicking it toggles the Detail drawer.
 * 2. Detail drawer (collapsed by default, remembers state in extension storage):
 *    - Header: "Context 96K / 200K · est." + Gear icon button
 *    - Stacked bar with legend: You 4% | Claude & tools 55% | System & memory 41%
 *    - "Biggest item: <name> · <tokens>" row (shown only when data exists)
 *    - Usage section: exactly two rows (Session & Weekly)
 *    - Developer view (growth, diagnostics, raw numbers; hidden by default)
 * 3. Capsule pill ("💊 Capsule"):
 *    Floating, draggable, unchanged prompt-capture tool.
 */

import { CapsuleStore, captureCapsule } from './capsule.js';
import { createPage } from './page-actions.js';
import { SETTINGS_KEY, normalizeSettings, writeSettings } from './settings.js';
import { chatIdFromHref, recordUsage } from './widget-state.js';
import { STYLES } from '../ui/styles.js';
import { h, setText, show, reducedMotion, RowList } from '../ui/dom.js';
import { StripComponent } from '../ui/strip-component.js';
import { getAdapterForProvider } from './strip-adapters.js';
import { AlertManager } from './alerts.js';
import { PreSendEstimator } from './pre-send.js';
import { addSample, downsampleHistory } from './history.js';
import { ExportDialog } from '../ui/export-dialog.js';
import { ClaudeMessageParser } from './export/claude-message-parser.js';

const MARGIN = 8; // Viewport clamp
const TOP_SAFE = 72; // Snap top: below the sites' top bars (Share, account buttons)
const SNAP_Y = 48; // Snap to a top/bottom corner when released this close
const DRAG_THRESHOLD = 4; // Pointer movement that turns a press into a drag
const DEFAULT_POS = { context: { side: 'right', dx: 16, yFromBottom: 96 }, capsule: { side: 'right', dx: 16, yFromBottom: 52 } };
const CAPSULE_LABEL = '💊 Capsule';
const WIDGET_CSS = `
  .root.w { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  .root.w.left { align-items: flex-start; }
  .root.w.top { flex-direction: column-reverse; }
  .pill.dragging { cursor: grabbing; }
  .pill.good .num { color: var(--good); } .pill.warn .num { color: var(--warn-text); } .pill.bad .num { color: var(--danger); }
  .root.w .toast { position: static; transform: none; max-width: 240px; opacity: 1; }
`;

const validPos = (p) => Boolean(p) && ['left', 'right'].includes(p.side) && Number.isFinite(p.dx) && (Number.isFinite(p.y) || Number.isFinite(p.yFromBottom));

/**
 * Pill positions from the stored per-site value (preserved for backward compatibility & tests).
 * @returns {{ pos: { context: Object, capsule: Object }, migrated: boolean }}
 */
export function widgetPositions(stored) {
  const p = stored?.pos;
  if (validPos(p)) return { pos: { context: { side: p.side, dx: p.dx, y: p.y }, capsule: { ...DEFAULT_POS.capsule } }, migrated: true };
  const pick = (key) => (validPos(p?.[key]) ? p[key] : { ...DEFAULT_POS[key] });
  return { pos: { context: pick('context'), capsule: pick('capsule') }, migrated: false };
}

/**
 * Free drag for the Capsule pill: pointer events, translate3d, clamped to the viewport.
 */
function makeDraggable(host, handle, getPos, onMoved) {
  let drag = null;
  let raf = null;
  let placeRaf = null;
  let justDragged = false;
  const size = () => ({ w: host.offsetWidth || 120, h: host.offsetHeight || 32 });
  const xy = () => {
    const p = getPos();
    const { w, h: ht } = size();
    return { x: p.side === 'left' ? p.dx : innerWidth - w - p.dx, y: Number.isFinite(p.y) ? p.y : innerHeight - ht - p.yFromBottom };
  };
  const apply = (x, y) => {
    const { w, h: ht } = size();
    const cx = Math.round(Math.max(MARGIN, Math.min(x, innerWidth - w - MARGIN)));
    const cy = Math.round(Math.max(MARGIN, Math.min(y, innerHeight - ht - MARGIN)));
    const t = `translate3d(${cx}px, ${cy}px, 0)`;
    if (host.style.transform !== t) host.style.transform = t;
  };
  const placeNow = () => { placeRaf = null; if (!drag?.moved) { const { x, y } = xy(); apply(x, y); } };
  const place = () => { if (typeof requestAnimationFrame !== 'function') placeNow(); else placeRaf ??= requestAnimationFrame(placeNow); };
  const settle = (x, y, snap, animate) => {
    const { w, h: ht } = size();
    const vw = innerWidth;
    const vh = innerHeight;
    const side = x + w / 2 < vw / 2 ? 'left' : 'right';
    let dx = side === 'left' ? x : vw - w - x;
    if (snap) {
      dx = 16;
      if (Math.abs(y - TOP_SAFE) < SNAP_Y) y = TOP_SAFE;
      else if (Math.abs(vh - ht - MARGIN - y) < SNAP_Y) y = vh - ht - MARGIN;
    }
    dx = Math.max(MARGIN, Math.min(dx, vw - w - MARGIN));
    y = Math.max(MARGIN, Math.min(y, vh - ht - MARGIN));
    onMoved(y + ht / 2 > vh / 2 ? { side, dx, yFromBottom: vh - ht - y } : { side, dx, y });
    if (animate && !reducedMotion()) {
      host.style.transition = 'transform .15s ease';
      setTimeout(() => { host.style.transition = ''; }, 170);
    }
    place();
  };
  handle.addEventListener('pointerdown', (e) => {
    justDragged = false;
    if (e.button !== 0) return;
    const { x, y } = xy();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x0: x, y0: y, x, y, moved: false };
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  });
  handle.addEventListener('pointermove', (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      handle.classList.add('dragging');
      document.documentElement.style.userSelect = 'none';
    }
    e.preventDefault();
    d.x = d.x0 + dx;
    d.y = d.y0 + dy;
    if (!raf) raf = requestAnimationFrame(() => { raf = null; apply(d.x, d.y); });
  });
  const end = (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    try { handle.releasePointerCapture(d.id); } catch (_) {}
    drag = null;
    if (!d.moved) return;
    justDragged = true;
    handle.classList.remove('dragging');
    document.documentElement.style.userSelect = '';
    settle(d.x, d.y, !e.altKey && e.type !== 'pointercancel', true);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  return { place, wasDragged: () => { const was = justDragged; justDragged = false; return was; } };
}

export class Widgets {
  /**
   * @param {{ provider?: string, findInput?: () => Element|null, replySelector?: string, userSelector?: string, countTokens?: Function }} [adapter]
   */
  constructor(adapter = {}) {
    this.adapter = {
      provider: adapter.provider || 'AI',
      findInput: adapter.findInput || (() => null),
      replySelector: adapter.replySelector || null,
      userSelector: adapter.userSelector || null,
      countTokens: adapter.countTokens || null,
      onExportClick: adapter.onExportClick || null
    };
    this.page = createPage({ ...this.adapter, getLimits: () => this.vm?.limits || [] });
    this.settings = normalizeSettings();
    this.pos = widgetPositions(null).pos;
    this.vm = null;
    this.glance = null;
    this.cap = null;
    this.loaded = false;
    this.hidden = false;
    this.drawerOpen = false; // Collapsed on first load
    this.devOpen = false;
    this.run = null;
    this._alerted = new Map();
    this.alertManager = new AlertManager({
      toastFn: (msg) => this.stripComponent?.showToast(msg, 4000)
    });
    this.preSendEstimator = new PreSendEstimator({
      tokenizer: (text) => (typeof this.adapter.countTokens === 'function' ? this.adapter.countTokens(text) : Math.ceil((text || '').length / 4)),
      onEstimate: (tokens) => this.stripComponent?.setDraftEstimate(tokens)
    });
    this._history = [];
    this._lastHistorySample = 0;
    this._usage = {};
    const host = typeof location !== 'undefined' ? location.hostname : '';
    this._storeKey = host ? `ui:${host}` : 'ui';
    this._usageKey = host ? `usage:${host}` : 'usage';
    this._historyKey = host ? `usage_history:${host}` : 'usage_history';
  }

  mount() {
    if (this.glance || typeof document === 'undefined') return;
    // Remove any leftover floating context host or capsule host
    document.getElementById('chatgpt-context-monitor-host')?.remove();
    document.getElementById('chatgpt-context-monitor-capsule')?.remove();
    this.cap = null; // Capsules parked per user instructions: no floating pill

    this._buildGlance();
    this._ensureGlanceMounted();

    window.addEventListener('resize', () => this._render());
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => this._render());
    window.addEventListener('keydown', (e) => {
      if (!this.glance || !e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyT') return;
      e.preventDefault();
      this.hidden = !this.hidden;
      this._render();
    }, true);
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[SETTINGS_KEY] || !this.glance) return;
        this.settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
        this._settingsFresh = true;
        this._ensureGlanceMounted();
        this._paintBadges();
        this._render();
      });
    } catch (_) {}
    this._badgeObserver = new MutationObserver(() => {
      this._ensureGlanceMounted();
      if (this._badgeTimer) return;
      this._badgeTimer = setTimeout(() => { this._badgeTimer = null; this._paintBadges(); }, 400);
    });
    this._badgeObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });

    try {
      this._themeObserver = new MutationObserver(() => this._render());
      if (document.documentElement) {
        this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
      }
      if (document.body) {
        this._themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
      }
    } catch (_) {}

    this._load().finally(() => { this.loaded = true; this._paintBadges(); this._render(); });
  }

  _host(id, key) {
    document.getElementById(id)?.remove();
    const host = document.createElement('div');
    host.id = id;
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483000;contain:layout style;will-change:transform;display:none;';
    const shadow = host.attachShadow({ mode: 'open' });
    h('style', null, shadow, STYLES + WIDGET_CSS);
    const root = h('div', 'root w', shadow);
    const pill = h('button', 'pill', root);
    pill.type = 'button';
    const drag = makeDraggable(host, pill, () => this.pos[key], (pos) => { this.pos[key] = pos; this._savePos(); this._render(); });
    (document.body || document.documentElement).appendChild(host);
    return { host, root, pill, drag, key };
  }

  _buildCapsule() {
    if (!this.cap) return;
    const { pill } = this.cap;
    pill.title = 'Save this chat as a Capsule (method in Settings); click again to cancel. Drag to move.';
    this.cap.label = h('span', null, pill, CAPSULE_LABEL);
    this.cap.label.setAttribute('aria-live', 'polite');
    pill.addEventListener('click', () => { if (!this.cap.drag.wasDragged()) this._capsuleClick(); });
  }

  _buildGlance() {
    document.getElementById('chatgpt-context-monitor-glance')?.remove();
    const host = document.createElement('div');
    host.id = 'chatgpt-context-monitor-glance';
    host.style.cssText = 'display:flex;flex-direction:column;align-items:stretch;width:100%;z-index:20;margin:0 0 8px;contain:layout style;';
    const shadow = host.attachShadow({ mode: 'open' });
    h('style', null, shadow, STYLES + WIDGET_CSS);

    this.stripComponent = new StripComponent(shadow, {
      onToggleDrawer: (open) => {
        this.drawerOpen = open;
        try {
          this._storage()?.set({ 'ui:drawer_open': this.drawerOpen }).catch(() => {});
        } catch (_) {}
      },
      onToggleDev: (open) => {
        this.devOpen = open;
        if (open && this.vm) this._renderDevView();
      },
      onExportClick: () => {
        if (this.adapter.onExportClick) {
          this.adapter.onExportClick();
        } else {
          this._openExportDialog();
        }
      }
    });

    this.glance = {
      host,
      shadow,
      root: this.stripComponent.root,
      strip: this.stripComponent.strip,
      drawer: this.stripComponent.drawer,
      toast: this.stripComponent.toast
    };
  }

  _toggleDrawer(force) {
    if (!this.stripComponent) return;
    this.stripComponent._toggleDrawer(force);
  }

  _openExportDialog() {
    try {
      let exportData = null;
      if (typeof ClaudeMessageParser !== 'undefined') {
        const raw = this.latestState?.rawConversation;
        if (raw) {
          exportData = ClaudeMessageParser.parseFromApi(raw);
        } else if (typeof document !== 'undefined') {
          exportData = ClaudeMessageParser.parseFromDom(document);
        }
      }
      if (!exportData) {
        exportData = {
          title: (typeof document !== 'undefined' ? document.title : '') || 'Conversation',
          provider: this.adapter.provider || 'AI',
          messages: []
        };
      }
      const dialog = new ExportDialog({
        data: exportData,
        defaultFormat: this.settings?.export?.defaultFormat || 'markdown'
      });
      dialog.open();
    } catch (err) {
      console.warn('[AI Context Monitor] Failed to open export dialog:', err);
    }
  }

  _ensureGlanceMounted() {
    if (!this.glance || typeof document === 'undefined') return;
    const input = this.adapter.findInput(document);
    let anchor = null;
    if (input) {
      if (input.tagName === 'FORM') {
        anchor = input;
      } else {
        anchor = input.closest('fieldset') ||
                 input.closest('form') ||
                 input.closest('[data-testid="chat-input"]') ||
                 input.closest('[data-testid="composer"]') ||
                 input.parentElement;
      }
    }
    if (!anchor) {
      anchor = document.querySelector('form, [data-testid="composer"], [data-testid="chat-input"], [data-testid="prompt-textarea"]');
    }
    if (!anchor || !anchor.parentElement) return;

    if (this.glance.host.parentElement !== anchor.parentElement || this.glance.host.nextSibling !== anchor) {
      anchor.parentElement.insertBefore(this.glance.host, anchor);
    }
    if (this.settings?.features?.preSendEstimate && input) {
      this.preSendEstimator.attach(input);
    } else {
      this.preSendEstimator.detach();
    }
  }

  _isDarkMode() {
    const s = this.settings;
    if (s.display?.theme === 'dark') return true;
    if (s.display?.theme === 'light') return false;

    // Auto mode: inspect DOM first (ChatGPT, Claude, Gemini in-app themes)
    try {
      if (typeof document !== 'undefined') {
        const docEl = document.documentElement;
        const body = document.body;

        // 1. ChatGPT & Claude: <html class="dark"> or <body class="dark">
        if (docEl?.classList?.contains('dark') || body?.classList?.contains('dark')) return true;
        if (docEl?.classList?.contains('light') || body?.classList?.contains('light')) return false;

        // 2. Gemini: <html data-theme="dark"> or class="dark-theme"
        const docTheme = docEl?.getAttribute?.('data-theme') || body?.getAttribute?.('data-theme') ||
                         docEl?.getAttribute?.('data-mode') || body?.getAttribute?.('data-mode') ||
                         docEl?.getAttribute?.('color-scheme') || body?.getAttribute?.('color-scheme');
        if (docTheme === 'dark') return true;
        if (docTheme === 'light') return false;
        if (docEl?.classList?.contains('dark-theme') || body?.classList?.contains('dark-theme')) return true;

        // 3. Computed background color luminance of body, html, or main
        if (typeof window !== 'undefined' && window.getComputedStyle) {
          const els = [body, docEl, document.querySelector('main'), document.getElementById('root')].filter(Boolean);
          for (const el of els) {
            const bg = window.getComputedStyle(el)?.backgroundColor;
            const rgb = String(bg || '').match(/\d+/g);
            if (rgb && rgb.length >= 3) {
              const r = Number(rgb[0]), g = Number(rgb[1]), b = Number(rgb[2]);
              const a = rgb.length >= 4 ? Number(rgb[3]) : 1;
              if (a > 0.1) {
                const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                if (lum < 0.48) return true;
                if (lum > 0.52) return false;
              }
            }
          }
        }
      }
    } catch (_) {}

    return Boolean(typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  }

  update(viewState) {
    this.vm = viewState;
    if (!this.glance) this.mount();
    if (!this.glance) return;
    this._trackUsage(viewState);
    this._ensureGlanceMounted();
    if (this.cap && !this.cap.host.isConnected) (document.body || document.documentElement).appendChild(this.cap.host);
    this._render();
  }

  _render() {
    if (!this.glance) return;
    const s = this.settings;
    const dark = this._isDarkMode();

    this.glance.root.classList.toggle('light', !dark);
    this.glance.root.classList.toggle('dark', dark);
    if (this.glance.host) {
      this.glance.host.classList.toggle('light', !dark);
      this.glance.host.classList.toggle('dark', dark);
    }
    if (this.cap) {
      this.cap.root.classList.toggle('light', !dark);
      this.cap.root.classList.toggle('left', this.pos.capsule?.side === 'left');
      this.cap.root.classList.toggle('top', !Number.isFinite(this.pos.capsule?.yFromBottom));
      const capDisplay = s.widgets.capsule.enabled && this.loaded && !this.hidden ? '' : 'none';
      if (this.cap.host.style.display !== capDisplay) this.cap.host.style.display = capDisplay;
    }

    const glanceDisplay = s.widgets.context.enabled && this.loaded && !this.hidden ? '' : 'none';
    if (this.glance.host.style.display !== glanceDisplay) this.glance.host.style.display = glanceDisplay;

    const ready = Boolean(this.vm) && this.vm.ready !== false;
    this._renderGlance(ready);
    this.cap?.drag.place();

    if (ready && s.context.alerts && this.glance.host.style.display !== 'none') {
      this._maybeAlert(this.vm);
    }
  }

  _renderGlance(_ready) {
    if (!this.glance || !this.stripComponent) return;

    const adapter = getAdapterForProvider(this.adapter.provider);
    const vm = this.vm || {
      provider: this.adapter.provider,
      usedTokens: 0,
      limits: [],
      ready: true
    };
    const data = adapter(vm, this.settings);
    data.history = this._history;
    data.features = this.settings.features;
    data.percentage = vm.percentage;
    this.stripComponent.render(data);

    if (this.devOpen) this._renderDevView();
  }

  _renderDevView() {
    if (!this.stripComponent?.dDevContent || !this.vm) return;
    const vm = this.vm;
    const el = this.stripComponent.dDevContent;
    el.textContent = '';
    const dRawRows = RowList(el);
    const dDiagRows = RowList(el);
    const st = vm.stats || { user: 0, assistant: 0, hidden: 0 };
    const numExact = (n) => (n !== null && n !== undefined ? n.toLocaleString() : 'Unknown');

    dRawRows.update([
      { label: 'Used tokens', value: numExact(vm.usedTokens) },
      { label: 'Remaining tokens', value: numExact(vm.remainingTokens) },
      { label: 'Window', value: numExact(vm.contextLimit) },
      { label: 'You', value: numExact(st.user) },
      { label: 'Assistant + tools', value: numExact(st.assistant) },
      { label: 'System & hidden', value: numExact(st.hidden) }
    ]);

    const modelStr = [vm.model, vm.modelFamily].filter(Boolean).join(' · ');
    dDiagRows.update([
      { label: 'Provider', value: vm.provider || '—' },
      { label: 'Model', value: modelStr || '—' },
      { label: 'Plan', value: vm.plan || 'Unknown' },
      { label: 'Source', value: vm.source || '—' },
      { label: 'Turns', value: String(vm.turns || 0) }
    ]);
  }

  // ------------------------------------------------------------------ Capsule pill

  async _capsuleClick() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return this._capsuleStatus({ state: 'error', text: 'Extension updated: reload the page' });
    if (this.run) return this._cancelRun();
    if (this._capturing) return;
    this._capturing = true;
    this._waiting = false;
    this._capsuleText('Working…');
    try {
      const run = await captureCapsule({
        method: this.settings.capsule.method,
        page: this.page,
        store: new CapsuleStore(this._storage()),
        onStatus: (st) => this._capsuleStatus(st)
      });
      if (this._waiting) { this.run = run; if (!this.settings.widgets.capsule.enabled) this._cancelRun(); }
    } catch (_) {
      this._capsuleStatus({ state: 'error', text: 'Capsule failed' });
    } finally {
      this._capturing = false;
    }
  }

  _cancelRun() {
    const run = this.run;
    this.run = null;
    run?.cancel();
  }

  _capsuleStatus(st) {
    this._waiting = st.state === 'waiting';
    if (!this._waiting) this.run = null;
    if (st.state === 'waiting') this._capsuleText('Press Enter to send');
    else if (st.state === 'saved') this._capsuleText(st.reason === 'limit' ? 'Limit reached: saved with Quick ✓' : 'Saved ✓ · edit in side panel', 4000);
    else if (st.state === 'error') this._capsuleText(st.text || 'Capsule failed', 3000);
    else this._capsuleText(CAPSULE_LABEL);
  }

  _capsuleText(text, ms) {
    clearTimeout(this._capTimer);
    if (!this.cap) return;
    setText(this.cap.label, text);
    if (ms) this._capTimer = setTimeout(() => this._capsuleText(CAPSULE_LABEL), ms);
    this.cap.drag.place();
  }

  // ------------------------------------------------------------------ alerts & sidebar badges

  _toast(text, ms = 1500) {
    if (!this.glance?.toast) return;
    const t = this.glance.toast;
    t.textContent = text;
    show(t, true);
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { show(t, false); }, ms);
  }

  _maybeAlert(vm) {
    if (!vm.ready || vm.percentage === null) return;
    const sessionLimit = (vm.limits || []).find(l => l.key === 'session' || l.label?.toLowerCase().includes('5h') || l.label?.toLowerCase().includes('session'));
    const res = this.alertManager.evaluate({
      chatId: vm.conversationId || 'global',
      contextPct: vm.percentage,
      contextSource: vm.percentageSource || (vm.authoritative ? 'measured' : 'estimated'),
      sessionPct: sessionLimit?.percent,
      sessionSource: sessionLimit?.estimated ? 'estimated' : 'measured',
      enabled: this.settings?.features?.alerts !== false && this.settings?.context?.alerts !== false
    });
    if (res.fired && !reducedMotion()) {
      this.stripComponent?.strip?.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 600, iterations: 2 });
    }
  }

  _trackUsage(vm) {
    if (!vm.ready || !vm.conversationId || vm.percentage === null) return;
    const before = this._usage[vm.conversationId]?.pct;
    this._usage = recordUsage(this._usage, vm.conversationId, vm.percentage);
    if (this._usage[vm.conversationId]?.pct !== before) {
      this._paintBadges();
      clearTimeout(this._usageTimer);
      this._usageTimer = setTimeout(() => {
        try { this._storage()?.set({ [this._usageKey]: this._usage }).catch(() => {}); } catch (_) {}
      }, 1000);
    }

    // 5-minute periodic usage history sampling
    if (this.settings?.features?.usageHistory) {
      const now = Date.now();
      if (now - this._lastHistorySample >= 5 * 60 * 1000) {
        this._lastHistorySample = now;
        this._history = addSample(this._history, vm.percentage, now);
        try { this._storage()?.set({ [this._historyKey]: this._history }).catch(() => {}); } catch (_) {}
      }
    }
  }

  _paintBadges() {
    const links = document.querySelectorAll('a[href*="/c/"], a[href*="/chat/"], a[href*="/app/"]');
    const inChat = [this.adapter.replySelector, this.adapter.userSelector].filter(Boolean).join(',');
    for (const a of links) {
      let badge = a.querySelector(':scope > [data-ctx-badge]');
      const id = this.settings.display.badges && !(inChat && a.closest(inChat)) ? chatIdFromHref(a.getAttribute('href')) : null;
      const u = id && this._usage[id];
      if (!u) { badge?.remove(); continue; }
      if (!badge) {
        badge = document.createElement('span');
        badge.setAttribute('data-ctx-badge', '');
        badge.style.cssText = 'flex:none;margin-left:6px;padding:0 5px;border:1px solid currentColor;border-radius:4px;font:600 10px/16px system-ui,sans-serif;opacity:.75;';
        a.appendChild(badge);
      }
      const text = `${u.pct}%`;
      if (badge.textContent !== text) badge.textContent = text;
      badge.title = `Context ${text} full (Context Monitor)`;
      const color = u.pct > 80 ? '#F87171' : u.pct >= 50 ? '#FBBF24' : '#10A37F';
      if (badge.style.color !== color) badge.style.color = color;
    }
  }

  _storage() {
    try { return typeof chrome !== 'undefined' ? chrome.storage?.local || null : null; } catch (_) { return null; }
  }

  async _load() {
    const area = this._storage();
    if (!area) return;
    try {
      const r = (await area.get([SETTINGS_KEY, this._storeKey, this._usageKey, this._historyKey, 'ui:drawer_open'])) || {};
      const old = r[this._storeKey] && typeof r[this._storeKey] === 'object' ? r[this._storeKey] : {};
      const { pos, migrated } = widgetPositions(old);
      this.pos = pos;
      if (migrated) area.set({ [this._storeKey]: { pos } }).catch(() => {});
      if (!r[SETTINGS_KEY] && ['theme', 'compact', 'badges'].some(k => k in old)) {
        const next = await writeSettings(area, { display: { theme: old.theme, compact: old.compact, badges: old.badges } });
        if (!this._settingsFresh) this.settings = next;
      } else if (!this._settingsFresh) {
        this.settings = normalizeSettings(r[SETTINGS_KEY]);
      }
      const usage = r[this._usageKey];
      if (usage && typeof usage === 'object') this._usage = { ...usage, ...this._usage };

      const hist = r[this._historyKey];
      if (Array.isArray(hist)) this._history = downsampleHistory(hist);

      // Detail drawer is collapsed by default on first load; remembers state in storage
      if (typeof r['ui:drawer_open'] === 'boolean') {
        this.drawerOpen = r['ui:drawer_open'];
      } else {
        this.drawerOpen = false;
      }
    } catch (_) {}
  }

  _savePos() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { this._storage()?.set({ [this._storeKey]: { pos: this.pos } }).catch(() => {}); } catch (_) {}
    }, 200);
  }
}
