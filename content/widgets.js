/**
 * Context Monitor - Widgets: two small pills on the chat page, each dragged on its own.
 *   Context  "5.7K · 2%" (badge colours) → click expands a card with the fields chosen in Settings
 *   Capsule  "💊 Capsule" → click runs captureCapsule with the chosen method; click again cancels
 * Everything else lives in the side panel (toolbar icon). Also here, because they belong to the page:
 * the 80% / 95% alerts (toasts on the Context pill) and the usage % next to chats in the sidebar.
 * Alt+T hides / shows both pills for this page view; Settings turns each one off for good.
 *
 * Each pill is its own shadow host (the page's CSS cannot reach it), moved only with transform and
 * anchored to its nearer side and top / bottom edge. Positions persist per site in chrome.storage.local
 * (`ui:<hostname>` = { pos: { context, capsule } }). Page-derived strings are only ever assigned as text.
 */

import { CapsuleStore, captureCapsule } from './capsule.js';
import { createPage } from './page-actions.js';
import { SETTINGS_KEY, normalizeSettings, writeSettings } from './settings.js';
import { alertLevel, chatIdFromHref, recordUsage, widgetFields } from './widget-state.js';
import { STYLES } from '../ui/styles.js';
import { h, setText, setAttr, show, fmtK, fmtInt, reducedMotion } from '../ui/dom.js';

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
  .wcard { width: 220px; padding: 10px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); }
  .wcard .fine:first-child { margin-top: 0; }
  .root.w .toast { position: static; transform: none; max-width: 240px; opacity: 1; }
`;

const validPos = (p) => Boolean(p) && ['left', 'right'].includes(p.side) && Number.isFinite(p.dx) && (Number.isFinite(p.y) || Number.isFinite(p.yFromBottom));

/**
 * Pill positions from the stored per-site value. The old single widget saved `pos: { side, dx, y }`:
 * that becomes the Context pill's position, the Capsule pill starts at its default, and `migrated`
 * says the new shape should be written back.
 * @returns {{ pos: { context: Object, capsule: Object }, migrated: boolean }}
 */
export function widgetPositions(stored) {
  const p = stored?.pos;
  if (validPos(p)) return { pos: { context: { side: p.side, dx: p.dx, y: p.y }, capsule: { ...DEFAULT_POS.capsule } }, migrated: true };
  const pick = (key) => (validPos(p?.[key]) ? p[key] : { ...DEFAULT_POS[key] });
  return { pos: { context: pick('context'), capsule: pick('capsule') }, migrated: false };
}

/**
 * Free drag for one pill: pointer events, translate3d, clamped to the viewport, snapped to the
 * nearest side on release (hold Alt to skip). `onMoved(pos)` saves the new position.
 * `place()` re-positions at most once per frame (it reads layout).
 * @returns {{ place(): void, wasDragged(): boolean }}
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
  // Anchored to the nearer side and the nearer top / bottom edge, so resizes and the card never push it off screen
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
    // Store what is shown: the clamped position, so reloading never jumps
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
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return; // Still a click
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
    justDragged = true; // Swallow the click that follows a drag
    handle.classList.remove('dragging');
    document.documentElement.style.userSelect = '';
    settle(d.x, d.y, !e.altKey && e.type !== 'pointercancel', true);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 10;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const { x, y } = xy();
    settle(x + d[0], y + d[1], false, false);
  });
  return { place, wasDragged: () => { const was = justDragged; justDragged = false; return was; } };
}

export class Widgets {
  /**
   * @param {{ provider?: string, findInput?: () => Element|null, replySelector?: string, userSelector?: string, countTokens?: Function }} [adapter]
   *   Same shape the coordinators pass; `findInput` / `replySelector` are what the Capsule pill fills and reads.
   */
  constructor(adapter = {}) {
    this.adapter = {
      provider: adapter.provider || 'AI',
      findInput: adapter.findInput || (() => null),
      replySelector: adapter.replySelector || null,
      userSelector: adapter.userSelector || null,
      countTokens: adapter.countTokens || null
    };
    // What the Capsule pill and the side panel (over the panel channel) use to read and fill the page
    this.page = createPage({ ...this.adapter, getLimits: () => this.vm?.limits || [] });
    this.settings = normalizeSettings();
    this.pos = widgetPositions(null).pos;
    this.vm = null;
    this.ctx = null;
    this.cap = null;
    this.loaded = false; // Hidden until Settings are read: a pill turned off never flashes
    this.hidden = false; // Alt+T, this page view only
    this.expanded = false;
    this.run = null; // Active Capsule wait ({ cancel })
    this._alerted = new Map();
    this._usage = {};
    const host = typeof location !== 'undefined' ? location.hostname : '';
    this._storeKey = host ? `ui:${host}` : 'ui';
    this._usageKey = host ? `usage:${host}` : 'usage';
  }

  mount() {
    if (this.ctx || typeof document === 'undefined') return;
    this.ctx = this._host('chatgpt-context-monitor-host', 'context');
    this.cap = this._host('chatgpt-context-monitor-capsule', 'capsule');
    this._buildContext();
    this._buildCapsule();

    window.addEventListener('resize', () => this._render());
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => this._render());
    window.addEventListener('keydown', (e) => {
      if (!this.ctx || !e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyT') return;
      e.preventDefault();
      this.hidden = !this.hidden;
      this._render();
    }, true);
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[SETTINGS_KEY] || !this.ctx) return;
        this.settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
        this._settingsFresh = true; // Newer than what _load may still be reading
        if (!this.settings.widgets.capsule.enabled) this._cancelRun();
        this._paintBadges();
        this._render();
      });
    } catch (_) {}
    // The site re-renders its sidebar constantly: repaint at most every 400 ms, only when something changed
    this._badgeObserver = new MutationObserver(() => {
      if (this._badgeTimer) return;
      this._badgeTimer = setTimeout(() => { this._badgeTimer = null; this._paintBadges(); }, 400);
    });
    this._badgeObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    this._load().finally(() => { this.loaded = true; this._paintBadges(); this._render(); });
  }

  /** One fixed shadow host per pill, so each one positions on its own. */
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

  _buildContext() {
    const { root, pill } = this.ctx;
    pill.title = 'Context usage: click for details, drag to move (Alt+T hides)';
    pill.setAttribute('aria-expanded', 'false');
    this.ctx.num = h('span', 'num', pill, '—');
    const card = this.ctx.card = h('div', 'wcard hide', root);
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', `${this.adapter.provider} context usage`);
    this.ctx.empty = h('p', 'fine', card);
    this.ctx.rows = h('div', null, card);
    this.ctx.rowEls = new Map();
    h('p', 'fine', card, 'More in the side panel');
    const toast = this.ctx.toast = h('div', 'toast hide', root);
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    // The card comes before the pill: above it when bottom-anchored, below it (column-reverse) when top-anchored
    root.append(toast, card, pill);
    pill.addEventListener('click', () => { if (!this.ctx.drag.wasDragged()) this._setExpanded(!this.expanded); });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.expanded) { e.stopPropagation(); this._setExpanded(false); pill.focus(); }
    });
  }

  _buildCapsule() {
    const { pill } = this.cap;
    pill.title = 'Save this chat as a Capsule (method in Settings); click again to cancel. Drag to move.';
    this.cap.label = h('span', null, pill, CAPSULE_LABEL);
    this.cap.label.setAttribute('aria-live', 'polite');
    pill.addEventListener('click', () => { if (!this.cap.drag.wasDragged()) this._capsuleClick(); });
  }

  /** @param {Object} viewState Output of toWidgetState() */
  update(viewState) {
    this.vm = viewState;
    if (!this.ctx) this.mount();
    if (!this.ctx) return;
    this._trackUsage(viewState);
    // SPA re-renders can drop our nodes; re-attach instead of rebuilding
    for (const p of [this.ctx, this.cap]) if (!p.host.isConnected) (document.body || document.documentElement).appendChild(p.host);
    this._render();
  }

  _render() {
    if (!this.ctx) return;
    const s = this.settings;
    const dark = s.display.theme === 'dark' || (s.display.theme === 'auto' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches));
    for (const [p, on] of [[this.ctx, s.widgets.context.enabled], [this.cap, s.widgets.capsule.enabled]]) {
      const display = on && this.loaded && !this.hidden ? '' : 'none';
      if (p.host.style.display !== display) p.host.style.display = display;
      p.root.classList.toggle('light', !dark);
      p.root.classList.toggle('left', this.pos[p.key].side === 'left');
      p.root.classList.toggle('top', !Number.isFinite(this.pos[p.key].yFromBottom));
    }

    const { pill, num, card } = this.ctx;
    const vm = this.vm;
    const ready = Boolean(vm) && vm.ready !== false;
    const pct = ready ? vm.percentage ?? null : null;
    setText(num, ready ? `${fmtK(vm.usedTokens)}${pct !== null ? ` · ${pct}%` : ''}` : '—');
    const level = pct === null ? '' : pct >= 85 ? 'bad' : pct >= 65 ? 'warn' : 'good';
    for (const t of ['good', 'warn', 'bad']) pill.classList.toggle(t, t === level);
    setAttr(pill, 'aria-label', ready
      ? `Context usage ${fmtInt(vm.usedTokens)} tokens${pct !== null ? `, ${pct}% of window` : ''}. ${this.expanded ? 'Hide' : 'Show'} details.`
      : 'Context usage: reading conversation.');
    setAttr(pill, 'aria-expanded', String(this.expanded));
    show(card, this.expanded);
    if (this.expanded) this._renderCard(ready);
    this.ctx.drag.place();
    this.cap.drag.place();
    // Only while the Context pill is shown (a hidden toast would use up the chat's alert); fires once it shows
    if (ready && s.context.alerts && this.ctx.host.style.display !== 'none') this._maybeAlert(vm);
  }

  /** Rows are rebuilt only when the chosen / available fields change; otherwise only values are written. */
  _renderCard(ready) {
    const { rows, rowEls, empty } = this.ctx;
    const fields = ready ? widgetFields(this.vm, this.settings.widgets.context.fields) : [];
    const keys = fields.map(f => f.key).join();
    if (keys !== [...rowEls.keys()].join()) {
      rowEls.clear();
      rows.replaceChildren();
      for (const f of fields) {
        const row = h('div', 'row', rows);
        h('span', 'k', row, f.label);
        rowEls.set(f.key, h('span', 'v', row));
      }
    }
    for (const f of fields) setText(rowEls.get(f.key), f.value);
    setText(empty, !ready ? 'Reading the conversation…' : fields.length ? '' : 'No fields chosen: pick them in the side panel\'s Settings.');
    show(empty, !ready || !fields.length);
  }

  _setExpanded(open) {
    this.expanded = open;
    this._render();
  }

  // ------------------------------------------------------------------ Capsule pill

  /** R11: errors become a status; the run handle is dropped on saved / error / cancelled. */
  async _capsuleClick() {
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

  /** Drops the handle first (R11), so cancel() runs once. */
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

  /** Pill text; with `ms`, back to the plain label after that long. */
  _capsuleText(text, ms) {
    clearTimeout(this._capTimer);
    if (!this.cap) return;
    setText(this.cap.label, text);
    if (ms) this._capTimer = setTimeout(() => this._capsuleText(CAPSULE_LABEL), ms);
    this.cap.drag.place(); // The pill's width changed
  }

  // ------------------------------------------------------------------ alerts & sidebar badges

  _toast(text, ms = 1500) {
    const t = this.ctx.toast;
    t.textContent = text;
    show(t, true);
    this.ctx.drag.place();
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { show(t, false); this.ctx?.drag.place(); }, ms);
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
    if (!reducedMotion()) this.ctx.pill.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 700, iterations: 2 });
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
      const color = u.pct > 85 ? '#F87171' : u.pct >= 60 ? '#FBBF24' : '';
      if (badge.style.color !== color) badge.style.color = color;
    }
  }

  // ------------------------------------------------------------------ storage

  _storage() {
    try { return typeof chrome !== 'undefined' ? chrome.storage?.local || null : null; } catch (_) { return null; }
  }

  /** Settings, positions and sidebar usage; migrates the old single widget's per-site prefs once. */
  async _load() {
    const area = this._storage();
    if (!area) return;
    try {
      const r = (await area.get([SETTINGS_KEY, this._storeKey, this._usageKey])) || {};
      const old = r[this._storeKey] && typeof r[this._storeKey] === 'object' ? r[this._storeKey] : {};
      const { pos, migrated } = widgetPositions(old);
      this.pos = pos;
      if (migrated) area.set({ [this._storeKey]: { pos } }).catch(() => {});
      // R5: the old widget kept theme / exact numbers / sidebar badges per site; Settings owns them now
      if (!r[SETTINGS_KEY] && ['theme', 'compact', 'badges'].some(k => k in old)) {
        const next = await writeSettings(area, { display: { theme: old.theme, compact: old.compact, badges: old.badges } });
        if (!this._settingsFresh) this.settings = next;
      } else if (!this._settingsFresh) {
        this.settings = normalizeSettings(r[SETTINGS_KEY]);
      }
      const usage = r[this._usageKey];
      if (usage && typeof usage === 'object') this._usage = { ...usage, ...this._usage };
    } catch (_) {}
  }

  _savePos() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { this._storage()?.set({ [this._storeKey]: { pos: this.pos } }).catch(() => {}); } catch (_) {}
    }, 200);
  }

  unmount() {
    this._badgeObserver?.disconnect();
    this._cancelRun();
    this.ctx?.host.remove();
    this.cap?.host.remove();
    this.ctx = null;
    this.cap = null;
  }
}
