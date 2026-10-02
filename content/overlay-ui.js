/**
 * Context Monitor - Context Widget (provider-neutral UI)
 *
 * Renders the view state from widget-state.js (toWidgetState). It knows nothing about any AI site:
 * the adapter supplies a name, `onRefresh()` and `getDiagnostics()`. Everything lives in a shadow
 * root, so the host page's CSS cannot reach it and ours never leaks out.
 *
 *   Collapsed (default)  pill "39.3K • Medium" — click expands, drag moves
 *   Expanded             header (drag handle: theme / collapse / close)
 *                        Context tab: ContextView (ui/context-view.js: hero, stats, sections, Diagnostics,
 *                        footer) plus the Display section
 *
 * Position: free drag (pointer events, translate3d), clamped to the viewport, snapped to the nearest
 * side on release (hold Alt to skip), anchored to that side so expanding never pushes it off screen.
 * Position, expanded state and theme persist per site in chrome.storage.local.
 * Components build their DOM once; updates write only what changed, and page-derived strings are
 * only ever assigned as text, never HTML.
 *
 * Header tabs: Context (above) | Capsules (CapsulePanel in ui/capsule-panel.js: create, edit, save, insert)
 * | Skills (the same panel with kind 'skill': reusable instructions).
 */

import { CAPSULES_KEY, CAPSULE_HANDOFF_KEY, readTranscript, SKILLS_KEY } from './capsule.js';
import { createPage } from './page-actions.js';
import { CapsulePanel } from '../ui/capsule-panel.js';
import { alertLevel, formatChatExport, chatIdFromHref, recordUsage } from './widget-state.js';
import { ContextView } from '../ui/context-view.js';
import { STYLES } from '../ui/styles.js';
import { h, iconButton, Section, textButton, download, setText, setAttr, setClass, show, fmtK, fmtInt, levelName, reducedMotion, ICONS } from '../ui/dom.js';

const MARGIN = 8; // Viewport clamp
const TOP_SAFE = 72; // Default/snap top: below the sites' top bars (Share, account buttons)
const SNAP_Y = 48; // Snap to a top/bottom corner when released this close
const DRAG_THRESHOLD = 4; // Pointer movement that turns a press into a drag
const DEFAULT_POS = { side: 'right', dx: 16, y: TOP_SAFE };
const THEMES = ['auto', 'dark', 'light'];

export class ContextWidget {
  /**
   * @param {{ provider?: string, findInput?: () => Element|null, replySelector?: string, onRefresh?: () => any, getDiagnostics?: () => Object }} [adapter]
   *   `findInput` finds the site's chat box and `replySelector` matches assistant replies (Capsules).
   */
  constructor(adapter = {}) {
    this.adapter = {
      provider: adapter.provider || 'AI',
      findInput: adapter.findInput || (() => null),
      replySelector: adapter.replySelector || null,
      userSelector: adapter.userSelector || null,
      countTokens: adapter.countTokens || null,
      onRefresh: adapter.onRefresh || (() => {}),
      getDiagnostics: adapter.getDiagnostics || (() => this.latestState?.diagnostics)
    };
    // What the Capsules / Skills tabs use to read and fill the page
    this.page = createPage({ ...this.adapter, getLimits: () => this.latestState?.limits || [] });
    this.hostElement = null;
    this.shadowRoot = null;
    this.isExpanded = false;
    this.isVisible = true;
    this.tab = 'context';
    this.theme = 'auto';
    this.pos = { ...DEFAULT_POS };
    this.latestState = null;
    this._alerted = new Map();
    this.parts = null;
    this._posRaf = null;
    this._drag = null;
    this._justDragged = false;
    this._storeKey = typeof location !== 'undefined' ? `ui:${location.hostname}` : 'ui';
    this._usageKey = typeof location !== 'undefined' ? `usage:${location.hostname}` : 'usage';
    this.compact = false; // Hero number as 61.3K instead of 61,302
    this.badges = true; // Usage % next to the chats in the site's sidebar
    this._usage = {};
  }

  mount() {
    if (this.hostElement || typeof document === 'undefined') return;
    document.getElementById('chatgpt-context-monitor-host')?.remove();
    const host = this.hostElement = document.createElement('div');
    host.id = 'chatgpt-context-monitor-host';
    // Fixed at the origin, moved only with transform (no layout work while dragging)
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483000;contain:layout style;will-change:transform;';
    this.shadowRoot = host.attachShadow({ mode: 'open' });
    h('style', null, this.shadowRoot, STYLES);
    const root = h('div', 'root', this.shadowRoot);
    this.parts = { root, ...this._build(root) };
    (document.body || document.documentElement).appendChild(host);

    window.addEventListener('resize', () => this._schedulePosition());
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => this._applyTheme());
    // Alt+T shows/hides the panel on any page state
    window.addEventListener('keydown', (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyT') {
        e.preventDefault();
        this.isVisible = !this.isVisible;
        this.render();
      }
    }, true);
    // A Capsule saved or deleted on another site / tab shows up here too
    try {
      chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[CAPSULES_KEY] || changes[CAPSULE_HANDOFF_KEY]) this.parts?.caps.refresh();
        if (changes[SKILLS_KEY]) this.parts?.skills.refresh();
      });
    } catch (_) {}
    this.parts.caps.refresh();
    this.parts.skills.refresh();
    this._loadPrefs();
    this._startBadgeWatch();
    this.render();
  }

  _build(root) {
    const provider = this.adapter.provider;

    // Pill
    const pill = h('button', 'pill', root);
    pill.type = 'button';
    pill.setAttribute('aria-expanded', 'false');
    const pillDot = h('span', 'dot', pill);
    const pillNum = h('span', 'num', pill);
    h('span', 'sep', pill, '•');
    const pillLvl = h('span', 'lvl', pill);
    pill.addEventListener('click', () => {
      if (this._justDragged) { this._justDragged = false; return; }
      this._setExpanded(true);
    });

    // Panel
    const panel = h('div', 'panel', root);
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', `${provider} context usage`);
    const head = h('div', 'head', panel);
    head.tabIndex = 0;
    head.setAttribute('aria-label', 'Move panel: drag, or use arrow keys. Double-click to reset position.');
    const tabs = h('div', 'tabs', head);
    tabs.setAttribute('role', 'tablist');
    const tab = (label, key) => {
      const b = textButton(tabs, label, () => this._setTab(key), 'tab');
      b.setAttribute('role', 'tab');
      return b;
    };
    const tabContext = tab('Context', 'context');
    const tabCaps = tab('Capsules', 'capsules');
    const tabSkills = tab('Skills', 'skills');
    const themeBtn = iconButton(head, ICONS.auto, 'Theme: auto');
    const collapseBtn = iconButton(head, ICONS.collapse, 'Collapse');
    const closeBtn = iconButton(head, ICONS.close, 'Close (Alt+T to reopen)');
    themeBtn.b.addEventListener('click', () => {
      this.theme = THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length];
      this._applyTheme();
      this._savePrefs();
    });
    collapseBtn.b.addEventListener('click', () => this._setExpanded(false));
    closeBtn.b.addEventListener('click', () => { this.isVisible = false; this.render(); });

    const ctxView = ContextView(panel, { settings: { display: { compact: this.compact } }, actions: {
      refresh: () => this.adapter.onRefresh(),
      copyDiagnostics: async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(this.adapter.getDiagnostics() || { note: 'no state yet' }, null, 2));
          this._toast('Diagnostics copied');
        } catch (_) {
          this._toast('Copy failed');
        }
      },
      exportChat: (f) => this._exportChat(f),
      saveAsCapsule: () => { this._setTab('capsules'); this.parts.caps.capture(); }
    } });

    const display = Section(ctxView.el, 'Display');
    const displayBtns = h('div', 'btns', display.body);
    const compactBtn = textButton(displayBtns, '', () => { this.compact = !this.compact; this._savePrefs(); this.render(); });
    const badgesBtn = textButton(displayBtns, '', () => { this.badges = !this.badges; this._savePrefs(); this._paintBadges(); this.render(); });

    const panelCtx = {
      page: this.page,
      storage: this._storage(),
      toast: (text) => this._toast(text),
      reveal: () => {
        this.isVisible = true;
        this._setTab('capsules');
        if (!this.isExpanded) this._setExpanded(true);
      }
    };
    const caps = CapsulePanel(panel, panelCtx);
    const skills = CapsulePanel(panel, { ...panelCtx, kind: 'skill' });

    const toast = h('div', 'toast', root);
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    const tip = h('div', 'tip', root);
    tip.setAttribute('aria-hidden', 'true');

    // Tooltips for anything with data-tip (bar segments, badges, icon buttons)
    root.addEventListener('pointerover', (e) => {
      const t = e.target.closest?.('[data-tip]');
      if (t && !this._drag?.moved) this._showTip(t);
    });
    root.addEventListener('pointerout', (e) => { if (e.target.closest?.('[data-tip]')) tip.classList.remove('show'); });
    root.addEventListener('focusin', (e) => { if (e.target.dataset?.tip) this._showTip(e.target); });
    root.addEventListener('focusout', () => tip.classList.remove('show'));

    // Drag from the pill or the header (never from a header button)
    for (const handle of [pill, head]) {
      handle.addEventListener('pointerdown', (e) => this._dragStart(e, handle));
      handle.addEventListener('pointermove', (e) => this._dragMove(e));
      handle.addEventListener('pointerup', (e) => this._dragEnd(e));
      handle.addEventListener('pointercancel', (e) => this._dragEnd(e));
    }
    head.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      this.pos = { ...DEFAULT_POS };
      this._position();
      this._savePrefs();
    });
    head.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 40 : 10;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d || e.target !== head) return;
      e.preventDefault();
      const { x, y } = this._xy();
      this._settle(x + d[0], y + d[1], false);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isExpanded) { e.stopPropagation(); this._setExpanded(false); pill.focus(); }
    });

    return {
      pill, pillDot, pillNum, pillLvl, panel, ctxView, body: ctxView.el, foot: ctxView.foot, compactBtn, badgesBtn, head, tabContext, tabCaps, tabSkills, caps, skills, themeBtn, toast, tip
    };
  }

  /** @param {Object} viewState Output of toWidgetState() */
  update(viewState) {
    this.latestState = viewState;
    if (!this.hostElement) this.mount();
    this._maybeAlert(viewState);
    this._trackUsage(viewState);
    this.parts?.caps.setView(viewState);
    this.parts?.skills.setView(viewState);
    // SPA re-renders can drop our node; re-attach instead of rebuilding
    if (!this.hostElement.isConnected) (document.body || document.documentElement).appendChild(this.hostElement);
    this.render();
  }

  render() {
    if (!this.hostElement || !this.parts) return;
    const display = this.isVisible ? '' : 'none';
    if (this.hostElement.style.display !== display) this.hostElement.style.display = display;
    const p = this.parts;
    this._applyTheme();
    setClass(p.root, `root${this._isDark() ? '' : ' light'}${this.isExpanded ? ' open' : ''}${this._drag?.moved ? ' dragging' : ''}`);
    show(p.pill, !this.isExpanded);
    show(p.panel, this.isExpanded);
    setAttr(p.pill, 'aria-expanded', String(this.isExpanded));
    const onContext = this.tab === 'context';
    show(p.body, onContext);
    show(p.foot, onContext);
    show(p.caps.view, this.tab === 'capsules');
    show(p.skills.view, this.tab === 'skills');
    setAttr(p.tabContext, 'aria-selected', String(onContext));
    setAttr(p.tabCaps, 'aria-selected', String(this.tab === 'capsules'));
    setAttr(p.tabSkills, 'aria-selected', String(this.tab === 'skills'));

    const vm = this.latestState || { ready: false, usedTokens: 0, percentage: null, evidence: [], breakdown: [], hiddenItems: [], limits: [], confidenceLevel: 'LOW', confidence: 0, provider: this.adapter.provider, model: 'Detecting…' };
    const lvl = vm.ready === false ? 'LOW' : vm.confidenceLevel;
    setClass(p.pillDot, `dot ${lvl}`);
    setText(p.pillNum, vm.ready === false ? '…' : fmtK(vm.usedTokens));
    setText(p.pillLvl, vm.ready === false ? 'Reading' : levelName(vm.confidenceLevel));
    setAttr(p.pill, 'aria-label', vm.ready === false
      ? 'Context usage: reading conversation. Expand panel.'
      : `Context usage ${fmtInt(vm.usedTokens)} tokens${vm.percentage !== null ? `, ${vm.percentage}% of window` : ''}, confidence ${levelName(vm.confidenceLevel)}. Expand panel.`);

    if (this.isExpanded) {
      p.ctxView.setSettings({ display: { compact: this.compact } });
      p.ctxView.update(vm);
      setText(p.compactBtn, `Exact numbers: ${this.compact ? 'off' : 'on'}`);
      setText(p.badgesBtn, `Sidebar badges: ${this.badges ? 'on' : 'off'}`);
    }
    this._schedulePosition();
  }

  _setExpanded(open) {
    this.isExpanded = open;
    this.render();
    this._savePrefs();
    if (open) this.parts.head.focus({ preventScroll: true });
  }

  /** @param {'context'|'capsules'|'skills'} key */
  _setTab(key) {
    if (this.tab !== key && key === 'capsules') this.parts.caps.refresh();
    if (this.tab !== key && key === 'skills') this.parts.skills.refresh();
    this.tab = key;
    this.render();
    this._savePrefs();
  }

  /** Saves the chat as shown on the page (md / txt / json). */
  _exportChat(format) {
    const msgs = readTranscript(document, this.adapter.userSelector, this.adapter.replySelector);
    if (!msgs.length) return this._toast('Open a conversation first');
    download(this.parts.body, 'chat', format, formatChatExport(msgs, format, { provider: this.adapter.provider }), format === 'json' ? 'application/json' : 'text/plain');
    this._toast(`Exported ${msgs.length} messages shown on the page`, 2500);
  }

  _toast(text, ms = 1500) {
    const t = this.parts.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /** Remembers this chat's usage and shows it next to the chat in the sidebar. */
  _trackUsage(vm) {
    if (!vm.ready || !vm.conversationId || vm.percentage === null) return;
    const before = this._usage[vm.conversationId]?.pct;
    this._usage = recordUsage(this._usage, vm.conversationId, vm.percentage);
    if (this._usage[vm.conversationId]?.pct === before) return;
    this._paintBadges();
    clearTimeout(this._usageTimer);
    this._usageTimer = setTimeout(() => {
      try { this._storage()?.set({ [this._usageKey]: this._usage }).catch(() => {}); } catch (_) {}
    }, 1000);
  }

  _paintBadges() {
    const links = document.querySelectorAll('a[href*="/c/"], a[href*="/chat/"], a[href*="/app/"]');
    const inChat = [this.adapter.replySelector, this.adapter.userSelector].filter(Boolean).join(',');
    for (const a of links) {
      let badge = a.querySelector(':scope > [data-ctx-badge]');
      const id = this.badges && !(inChat && a.closest(inChat)) ? chatIdFromHref(a.getAttribute('href')) : null;
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
      const color = u.pct > 85 ? '#F87171' : u.pct >= 60 ? '#FBBF24' : '';
      if (badge.style.color !== color) badge.style.color = color;
    }
  }

  _startBadgeWatch() {
    this._storage()?.get(this._usageKey).then((r) => {
      if (r?.[this._usageKey] && typeof r[this._usageKey] === 'object') this._usage = { ...r[this._usageKey], ...this._usage };
      this._paintBadges();
    }).catch(() => {});
    // The site re-renders its sidebar constantly: repaint at most every 400 ms, only when something changed
    this._badgeObserver = new MutationObserver(() => {
      if (this._badgeTimer) return;
      this._badgeTimer = setTimeout(() => { this._badgeTimer = null; this._paintBadges(); }, 400);
    });
    this._badgeObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  /** One toast per chat when usage first reaches 80% and again at 95%; never repeats for the same step. */
  _maybeAlert(vm) {
    if (!vm.ready || vm.percentage === null) return;
    const lvl = alertLevel(vm.percentage);
    const key = vm.conversationId || '';
    if (lvl <= (this._alerted.get(key) || 0)) return;
    this._alerted.set(key, lvl);
    this._toast(lvl === 95
      ? `Context ${vm.percentage}% full: start a new chat soon`
      : `Context ${vm.percentage}% full: consider wrapping up`, 4000);
    if (!reducedMotion()) this.parts.ctxView.bar.animate?.([{ transform: 'scaleY(1)' }, { transform: 'scaleY(2.2)' }, { transform: 'scaleY(1)' }], { duration: 700, iterations: 2 });
  }

  _showTip(target) {
    const { tip, root } = this.parts;
    tip.textContent = target.dataset.tip;
    const r = target.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    tip.classList.add('show');
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = r.left - rr.left + r.width / 2 - tw / 2;
    left = Math.max(4, Math.min(left, rr.width - tw - 4));
    let top = r.top - rr.top - th - 6;
    if (r.top - th - 6 < 0) top = r.bottom - rr.top + 6; // No room above: show below
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  // ------------------------------------------------------------------ theme

  _isDark() {
    if (this.theme === 'dark') return true;
    if (this.theme === 'light') return false;
    return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  }

  _applyTheme() {
    if (!this.parts) return;
    const { root, themeBtn } = this.parts;
    root.classList.toggle('light', !this._isDark());
    const label = `Theme: ${this.theme}`;
    if (themeBtn.b.getAttribute('aria-label') !== label) {
      themeBtn.b.setAttribute('aria-label', label);
      themeBtn.b.dataset.tip = label;
      themeBtn.path.setAttribute('d', ICONS[this.theme]);
    }
  }

  // ------------------------------------------------------------------ drag & position

  _dragStart(e, handle) {
    if (e.button !== 0 || (handle === this.parts.head && e.target.closest('button'))) return;
    const { x, y } = this._xy();
    this._drag = { id: e.pointerId, handle, sx: e.clientX, sy: e.clientY, x0: x, y0: y, x, y, moved: false };
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  }

  _dragMove(e) {
    const d = this._drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return; // Still a click
      d.moved = true;
      this.parts.tip.classList.remove('show');
      this.parts.root.classList.add('dragging');
      document.documentElement.style.userSelect = 'none';
    }
    e.preventDefault();
    d.x = d.x0 + dx;
    d.y = d.y0 + dy;
    if (!this._posRaf) this._posRaf = requestAnimationFrame(() => { this._posRaf = null; this._applyXY(d.x, d.y); });
  }

  _dragEnd(e) {
    const d = this._drag;
    if (!d || e.pointerId !== d.id) return;
    try { d.handle.releasePointerCapture(d.id); } catch (_) {}
    this._drag = null;
    if (!d.moved) return;
    this._justDragged = d.handle === this.parts.pill; // Swallow the click that follows a pill drag
    this.parts.root.classList.remove('dragging');
    document.documentElement.style.userSelect = '';
    this._settle(d.x, d.y, !e.altKey && e.type !== 'pointercancel', true);
  }

  /**
   * Stores a position given as top-left x/y: anchored to the nearer side, optionally snapped to that
   * side (and to a top/bottom corner when close), then applied and saved.
   */
  _settle(x, y, snap, animate = false) {
    const { w, h: ht } = this._size();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const side = x + w / 2 < vw / 2 ? 'left' : 'right';
    let dx = side === 'left' ? x : vw - w - x;
    if (snap) {
      dx = 16;
      if (Math.abs(y - TOP_SAFE) < SNAP_Y) y = TOP_SAFE;
      else if (Math.abs(vh - ht - MARGIN - y) < SNAP_Y) y = vh - ht - MARGIN;
    }
    // Store what is shown: the clamped position, so collapsing/reloading never jumps
    dx = Math.max(MARGIN, Math.min(dx, vw - w - MARGIN));
    y = Math.max(MARGIN, Math.min(y, vh - ht - MARGIN));
    this.pos = { side, dx, y };
    if (animate && !reducedMotion()) {
      this.hostElement.style.transition = 'transform .15s ease';
      setTimeout(() => { if (this.hostElement) this.hostElement.style.transition = ''; }, 170);
    }
    this._position();
    this._savePrefs();
  }

  _size() {
    const el = this.isExpanded ? this.parts.panel : this.parts.pill;
    const r = el.getBoundingClientRect();
    return { w: r.width || (this.isExpanded ? 320 : 150), h: r.height || 32 };
  }

  /** Current top-left from the stored side-anchored position. */
  _xy() {
    const { w } = this._size();
    const x = this.pos.side === 'left' ? this.pos.dx : window.innerWidth - w - this.pos.dx;
    return { x, y: this.pos.y };
  }

  _applyXY(x, y) {
    const { w, h: ht } = this._size();
    const cx = Math.round(Math.max(MARGIN, Math.min(x, window.innerWidth - w - MARGIN)));
    const cy = Math.round(Math.max(MARGIN, Math.min(y, window.innerHeight - ht - MARGIN)));
    const t = `translate3d(${cx}px, ${cy}px, 0)`;
    if (this.hostElement.style.transform !== t) this.hostElement.style.transform = t;
  }

  _position() {
    if (!this.hostElement || !this.parts || this._drag?.moved) return;
    const { x, y } = this._xy();
    this._applyXY(x, y);
  }

  /** One layout pass per frame for resizes and content changes. */
  _schedulePosition() {
    if (this._posRaf || typeof requestAnimationFrame !== 'function') return this._position();
    this._posRaf = requestAnimationFrame(() => { this._posRaf = null; this._position(); });
  }

  // ------------------------------------------------------------------ preferences

  _storage() {
    try { return typeof chrome !== 'undefined' ? chrome.storage?.local || null : null; } catch (_) { return null; }
  }

  _loadPrefs() {
    const store = this._storage();
    if (!store) return;
    try {
      store.get(this._storeKey).then((r) => {
        const s = r?.[this._storeKey];
        if (!s || typeof s !== 'object') return;
        if (s.pos && ['left', 'right'].includes(s.pos.side) && Number.isFinite(s.pos.dx) && Number.isFinite(s.pos.y)) this.pos = s.pos;
        if (THEMES.includes(s.theme)) this.theme = s.theme;
        if (['context', 'capsules', 'skills'].includes(s.tab)) this.tab = s.tab;
        this.isExpanded = Boolean(s.expanded);
        this.compact = Boolean(s.compact);
        this.badges = s.badges !== false;
        this.render();
      }).catch(() => {});
    } catch (_) {}
  }

  _savePrefs() {
    const store = this._storage();
    if (!store) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { store.set({ [this._storeKey]: { pos: this.pos, expanded: this.isExpanded, theme: this.theme, tab: this.tab, compact: this.compact, badges: this.badges } }).catch(() => {}); } catch (_) {}
    }, 200);
  }

  unmount() {
    this._badgeObserver?.disconnect();
    this.parts?.caps.stop();
    this.parts?.skills.stop();
    this.hostElement?.remove();
    this.hostElement = null;
    this.shadowRoot = null;
    this.parts = null;
  }
}
