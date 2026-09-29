/**
 * Context Monitor - Context Widget (provider-neutral UI)
 *
 * Renders the view state from widget-state.js (toWidgetState). It knows nothing about any AI site:
 * the adapter supplies a name, `onRefresh()` and `getDiagnostics()`. Everything lives in a shadow
 * root, so the host page's CSS cannot reach it and ours never leaks out.
 *
 *   Collapsed (default)  pill "39.3K • Medium" — click expands, drag moves
 *   Expanded             header (drag handle: theme / collapse / close)
 *                        hero: token count, usage bar, window, model, limit line, warning
 *                        stats: You / <Site> + tools / Hidden
 *                        sections (closed by default): Breakdown, Hidden context, Usage limits, Diagnostics
 *                        footer: confidence, Copy diagnostics, Refresh
 *
 * Position: free drag (pointer events, translate3d), clamped to the viewport, snapped to the nearest
 * side on release (hold Alt to skip), anchored to that side so expanding never pushes it off screen.
 * Position, expanded state and theme persist per site in chrome.storage.local.
 * Components build their DOM once; updates write only what changed, and page-derived strings are
 * only ever assigned as text, never HTML.
 */

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .root {
    --bg: #0F1115; --surface: #171A21; --glass: rgba(23, 26, 33, .85); --border: #262A33; --text: #E6E8EC; --muted: #8A91A0;
    --accent: #D97757; --good: #4ADE80; --warn: #FBBF24; --warn-text: #FBBF24; --danger: #F87171; --track: #262A33; --hover: rgba(255, 255, 255, .06);
    --s1: #D97757; --s2: #60A5FA; --s3: #A78BFA; --s4: #34D399; --s5: #F472B6; --s6: #FBBF24; --s7: #22D3EE; --s8: #94A3B8;
    --shadow: 0 8px 30px rgba(0, 0, 0, .25);
    --ui: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    position: relative; font: 12.5px/1.45 var(--ui); color: var(--text); color-scheme: dark;
    -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums;
  }
  .root.light {
    --bg: #FAF9F6; --surface: #FFFFFF; --glass: rgba(255, 255, 255, .85); --border: #E7E4DD; --text: #1F2328; --muted: #6B7280;
    --accent: #C15F3C; --good: #16A34A; --warn: #D97706; --warn-text: #B45309; --danger: #DC2626; --track: #EFECE6; --hover: rgba(0, 0, 0, .04);
    --s1: #C15F3C; --s2: #2563EB; --s3: #7C3AED; --s4: #059669; --s5: #DB2777; --s6: #D97706; --s7: #0891B2; --s8: #64748B;
    --shadow: 0 8px 30px rgba(0, 0, 0, .12); color-scheme: light;
  }
  button { all: unset; box-sizing: border-box; cursor: pointer; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }

  /* Pill (collapsed) */
  .pill { display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; border-radius: 999px;
    background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); white-space: nowrap;
    font-weight: 600; cursor: grab; touch-action: none; user-select: none; }
  .pill .num { font-family: var(--mono); font-size: 12.5px; }
  .pill .sep, .pill .lvl { color: var(--muted); font-weight: 500; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex: none; }
  .dot.HIGH { background: var(--good); } .dot.MEDIUM { background: var(--warn); } .dot.LOW { background: var(--muted); }

  /* Panel (expanded) */
  .panel { width: 320px; display: flex; flex-direction: column; max-height: 70vh; border-radius: 12px; overflow: hidden;
    background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); }
  @supports ((backdrop-filter: blur(12px)) or (-webkit-backdrop-filter: blur(12px))) {
    .panel, .pill { background: var(--glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
  }
  .open .panel { animation: in .15s ease; }
  @keyframes in { from { opacity: 0; transform: translateY(-4px); } }
  .head { display: flex; align-items: center; gap: 4px; padding: 8px 8px 8px 16px; border-bottom: 1px solid var(--border);
    cursor: grab; touch-action: none; user-select: none; }
  .head .title { flex: 1; min-width: 0; font-weight: 600; font-size: 12px; letter-spacing: .02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .head .title span { color: var(--muted); font-weight: 500; }
  .dragging .pill, .dragging .head { cursor: grabbing; }
  .ib { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: var(--muted); flex: none; }
  .ib:hover { background: var(--hover); color: var(--text); }
  .ib:disabled { opacity: .5; cursor: default; }
  .spin svg { animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .body { overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
  .body::-webkit-scrollbar { width: 6px; } .body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  .hero { padding: 16px 16px 12px; }
  .hero .top { display: flex; align-items: baseline; gap: 8px; }
  .hero .big { font-family: var(--mono); font-size: 28px; font-weight: 600; letter-spacing: -.02em; line-height: 1; }
  .hero .unit { color: var(--muted); font-size: 11px; }
  .hero .pct { margin-left: auto; font-family: var(--mono); font-weight: 600; font-size: 13px; }
  .bar { height: 6px; border-radius: 999px; background: var(--track); overflow: hidden; margin: 12px 0 8px; position: relative; }
  .bar b { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--good); transition: width .35s ease; }
  .bar.warn b { background: var(--warn); } .bar.bad b { background: var(--danger); }
  .bar.unknown b { width: 30% !important; background: var(--muted); opacity: .45; animation: slide 1.6s ease-in-out infinite; }
  @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
  .meta { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 11.5px; min-width: 0; }
  .meta .model { margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .line { margin-top: 6px; font-size: 11.5px; color: var(--muted); }
  .line:empty { display: none; }
  .line.warn { color: var(--warn-text); } /* #D97706 is 3.2:1 on white: text uses a darker amber (5.0:1) */

  .approx { display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 4px;
    border: 1px solid var(--border); color: var(--muted); font-size: 10.5px; font-weight: 600; cursor: help; margin-left: 4px; }

  .stats { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
  .stat { padding: 8px 16px; min-width: 0; }
  .stat + .stat { border-left: 1px solid var(--border); }
  .stat .k { color: var(--muted); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stat .v { font-family: var(--mono); font-weight: 600; font-size: 13px; }

  .sec { border-bottom: 1px solid var(--border); }
  .sec-h { display: flex; align-items: center; width: 100%; padding: 10px 16px; font-size: 10.5px; font-weight: 700;
    letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .sec-h:hover { color: var(--text); background: var(--hover); }
  .sec-h svg { margin-left: auto; transition: transform .15s ease; }
  .sec-h[aria-expanded="true"] svg { transform: rotate(180deg); }
  .sec-b { padding: 0 16px 12px; }
  .sec-b[hidden] { display: none; }

  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 3px 0; }
  .row .k { color: var(--muted); white-space: nowrap; }
  .row .v { text-align: right; min-width: 0; overflow-wrap: anywhere; font-weight: 500; }
  .divider { border-top: 1px dashed var(--border); margin: 6px 0; }

  .stack { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--track); gap: 2px; margin: 4px 0 10px; }
  .stack i { display: block; min-width: 3px; }
  .leg { display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 6px; margin: 0 -6px; border-radius: 6px; width: calc(100% + 12px); }
  .leg:hover { background: var(--hover); }
  .leg .sw { width: 8px; height: 8px; border-radius: 2px; flex: none; }
  .leg .sw.off { background: transparent !important; border: 1px solid var(--muted); }
  .leg .l { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .leg .t { font-family: var(--mono); color: var(--muted); }
  pre { margin: 4px 0 8px; padding: 8px; max-height: 180px; overflow: auto; background: var(--bg); border: 1px solid var(--border);
    border-radius: 8px; font: 11px/1.5 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; scrollbar-width: thin; }
  pre[hidden] { display: none; }

  .evidence { list-style: none; display: flex; flex-direction: column; gap: 4px; margin-top: 8px; font-size: 11.5px; }
  .evidence li { display: flex; gap: 6px; }
  .evidence .y { color: var(--good); } .evidence .n { color: var(--warn-text); }
  .fine { color: var(--muted); font-size: 11px; margin-top: 8px; }

  .foot { display: flex; align-items: center; gap: 4px; padding: 6px 8px 6px 16px; border-top: 1px solid var(--border); }
  .foot .conf { flex: 1; display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11.5px; }

  .toast { position: absolute; left: 50%; bottom: 48px; transform: translateX(-50%); padding: 6px 12px; border-radius: 8px;
    background: var(--text); color: var(--surface); font-size: 11.5px; font-weight: 600; pointer-events: none; opacity: 0; transition: opacity .15s ease; }
  .toast.show { opacity: 1; }
  .tip { position: absolute; z-index: 1; max-width: 240px; padding: 6px 8px; border-radius: 6px; background: var(--text); color: var(--surface);
    font-size: 11px; line-height: 1.4; pointer-events: none; opacity: 0; transition: opacity .1s ease; }
  .tip.show { opacity: 1; }

  .hide { display: none !important; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

const MARGIN = 8; // Viewport clamp
const TOP_SAFE = 72; // Default/snap top: below the sites' top bars (Share, account buttons)
const SNAP_Y = 48; // Snap to a top/bottom corner when released this close
const DRAG_THRESHOLD = 4; // Pointer movement that turns a press into a drag
const DEFAULT_POS = { side: 'right', dx: 16, y: TOP_SAFE };
const THEMES = ['auto', 'dark', 'light'];

const ICONS = {
  chevron: 'M4 6l4 4 4-4',
  collapse: 'M4 8h8',
  close: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.55M13 2.5v3h-3',
  copy: 'M5.5 5.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M2.5 6.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1z',
  auto: 'M8 2.5a5.5 5.5 0 1 0 0 11zM8 2.5a5.5 5.5 0 0 1 0 11',
  dark: 'M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z',
  light: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1'
};

const fmtK = (n) => {
  if (n === null || n === undefined) return '—';
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}K`;
  return `${(Math.round(n / 1e4) / 100).toString()}M`;
};
const fmtInt = (n) => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString());
const tone = (p) => (p === null || p === undefined ? '' : p > 85 ? 'bad' : p >= 60 ? 'warn' : '');
const levelName = (lvl) => (lvl ? lvl.charAt(0) + lvl.slice(1).toLowerCase() : 'Low');
const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function h(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}
/** Writes only when the value changed: identical updates cause no DOM mutation. */
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setClass = (node, cls) => { if (node.className !== cls) node.className = cls; };
const setAttr = (node, name, value) => { if (node.getAttribute(name) !== value) node.setAttribute(name, value); };
const show = (node, visible) => { node.classList.toggle('hide', !visible); };

/** Stroked 16x16 icon. */
function icon(parent, d) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  parent.appendChild(svg);
  return { svg, path };
}

function iconButton(parent, d, label) {
  const b = h('button', 'ib', parent);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.dataset.tip = label;
  return { b, ...icon(b, d) };
}

/** The single "≈" badge (estimated / unverified / unknown), explained in a tooltip. */
function approx(parent, tip) {
  const s = h('span', 'approx', parent, '≈');
  s.dataset.tip = tip;
  s.setAttribute('aria-label', tip);
  s.tabIndex = 0;
  return s;
}
const TAG_TIPS = {
  ESTIMATED: 'Estimated: not reported by the site',
  UNKNOWN: 'Not measurable from the page',
  UNVERIFIED: 'Window from our limits table, not confirmed for this plan'
};

/** "28% · resets in 3h 57m" / "5 left · resets in 30d" / "limit reached", or a note before the site reports it. */
const limitText = (l) => {
  if (l.note) return l.note;
  const reset = l.resetIn ? ` · resets in ${l.resetIn}` : '';
  if (l.key === 'limit') return `limit reached${reset}`;
  if (l.remaining !== undefined && l.remaining !== null) return `${l.blocked ? 'used up' : `${l.remaining} left`}${reset}`;
  if (l.percent === null || l.percent === undefined) return 'updates after your next message';
  return `${l.percent}%${reset}`;
};
/** Headline limit: the session, else anything used up, else the allowance closest to running out. */
const headlineLimit = (limits = []) => limits.find(l => l.key === 'session') || limits.find(l => l.blocked) ||
  limits.filter(l => typeof l.remaining === 'number').sort((a, b) => a.remaining - b.remaining)[0] || null;

/** Collapsible section; closed by default, open state survives updates (DOM is built once). */
function Section(parent, title) {
  const el = h('section', 'sec', parent);
  const head = h('button', 'sec-h', el);
  head.type = 'button';
  h('span', null, head, title);
  icon(head, ICONS.chevron);
  head.setAttribute('aria-expanded', 'false');
  const body = h('div', 'sec-b', el);
  body.hidden = true;
  head.addEventListener('click', () => {
    const open = head.getAttribute('aria-expanded') !== 'true';
    head.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
  });
  return { el, body };
}

/** Label/value rows; rebuilt only when the rows change. */
function RowList(parent) {
  const el = h('div', null, parent);
  let signature = null;
  return {
    update(rows) {
      const next = JSON.stringify(rows);
      if (next === signature) return;
      signature = next;
      el.textContent = '';
      for (const r of rows) {
        const row = h('div', 'row', el);
        h('span', 'k', row, r.label);
        const v = h('span', 'v', row, r.value);
        if (r.tip) approx(v, r.tip);
      }
    }
  };
}

/**
 * Hidden context as one stacked bar (counted items, exact tokens on hover) plus a legend. Each legend
 * entry opens that item's text. Items not counted are listed but left out of the bar.
 */
function HiddenStack(parent) {
  const bar = h('div', 'stack', parent);
  bar.setAttribute('role', 'img');
  const legend = h('div', null, parent);
  let signature = null;
  return {
    update(items) {
      const next = JSON.stringify(items);
      if (next === signature) return;
      signature = next;
      const open = new Set([...legend.querySelectorAll('.leg[aria-expanded="true"]')].map(b => b.dataset.key));
      bar.textContent = '';
      legend.textContent = '';
      const counted = items.filter(i => i.note !== 'not counted' && i.tokens > 0);
      const total = counted.reduce((n, i) => n + i.tokens, 0);
      bar.setAttribute('aria-label', `Hidden context: ${total.toLocaleString()} tokens in ${counted.length} parts`);
      items.forEach((it, idx) => {
        const color = `var(--s${(idx % 8) + 1})`;
        const est = it.note === 'estimate';
        const off = it.note === 'not counted';
        if (!off && it.tokens > 0) {
          const seg = h('i', null, bar);
          seg.style.flex = `${it.tokens} 0 0`;
          seg.style.background = color;
          seg.dataset.tip = `${it.label}: ${est ? '≈' : ''}${it.tokens.toLocaleString()} tokens`;
        }
        const key = `${idx}:${it.label}`;
        const row = h('button', 'leg', legend);
        row.type = 'button';
        row.dataset.key = key;
        const sw = h('span', `sw${off ? ' off' : ''}`, row);
        sw.style.background = color;
        h('span', 'l', row, it.label);
        h('span', 't', row, `${est ? '≈' : ''}${it.tokens.toLocaleString()}${off ? ' · not counted' : ''}`);
        const pre = h('pre', null, legend, it.text || '(no text)');
        const isOpen = open.has(key);
        row.setAttribute('aria-expanded', String(isOpen));
        pre.hidden = !isOpen;
        row.addEventListener('click', () => {
          const o = row.getAttribute('aria-expanded') !== 'true';
          row.setAttribute('aria-expanded', String(o));
          pre.hidden = !o;
        });
      });
    }
  };
}

export class ContextWidget {
  /**
   * @param {{ provider?: string, findInput?: () => Element|null, onRefresh?: () => any, getDiagnostics?: () => Object }} [adapter]
   *   `findInput` is accepted for compatibility; the widget no longer positions itself by the chat input.
   */
  constructor(adapter = {}) {
    this.adapter = {
      provider: adapter.provider || 'AI',
      onRefresh: adapter.onRefresh || (() => {}),
      getDiagnostics: adapter.getDiagnostics || (() => this.latestState?.diagnostics)
    };
    this.hostElement = null;
    this.shadowRoot = null;
    this.isExpanded = false;
    this.isVisible = true;
    this.theme = 'auto';
    this.pos = { ...DEFAULT_POS };
    this.latestState = null;
    this.parts = null;
    this._shownTokens = null;
    this._countRaf = null;
    this._posRaf = null;
    this._drag = null;
    this._justDragged = false;
    this._storeKey = typeof location !== 'undefined' ? `ui:${location.hostname}` : 'ui';
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
    this._loadPrefs();
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
    const title = h('div', 'title', head, 'Context ');
    h('span', null, title, `· ${provider}`);
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

    const body = h('div', 'body', panel);
    const hero = h('div', 'hero', body);
    const top = h('div', 'top', hero);
    const big = h('span', 'big', top, '—');
    h('span', 'unit', top, 'tokens');
    const pct = h('span', 'pct', top);
    const bar = h('div', 'bar', hero);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Context window used');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    const fill = h('b', null, bar);
    const meta = h('div', 'meta', hero);
    const windowText = h('span', null, meta);
    const windowBadge = approx(meta, 'Window size is not known for this model/plan');
    const modelText = h('span', 'model', meta);
    const limitLine = h('div', 'line', hero);
    const warnLine = h('div', 'line warn', hero);
    warnLine.setAttribute('role', 'status');

    const stats = h('div', 'stats', body);
    const stat = (label) => {
      const c = h('div', 'stat', stats);
      const k = h('div', 'k', c, label);
      return { k, v: h('div', 'v', c, '—') };
    };
    const sUser = stat('You');
    const sAsst = stat(`${provider} + tools`);
    const sHidden = stat('Hidden');

    const brk = Section(body, 'Breakdown');
    const brkRows = RowList(brk.body);
    h('div', 'divider', brk.body);
    const totals = RowList(brk.body);

    const hid = Section(body, 'Hidden context');
    const hidStack = HiddenStack(hid.body);
    h('div', 'fine', hid.body, `Read from ${provider}'s own data. ≈ marks estimates; anything else ${provider} adds on its servers is not visible.`);

    const lim = Section(body, 'Usage limits');
    const limRows = RowList(lim.body);

    const diag = Section(body, 'Diagnostics');
    const diagWarn = h('div', 'line warn', diag.body);
    const diagRows = RowList(diag.body);
    const evidence = h('ul', 'evidence', diag.body);
    h('div', 'fine', diag.body, 'Counts visible text, hidden context the site exposes, and estimates where it does not.');

    const foot = h('div', 'foot', panel);
    const conf = h('div', 'conf', foot);
    const confDot = h('span', 'dot', conf);
    const confText = h('span', null, conf);
    const copyBtn = iconButton(foot, ICONS.copy, 'Copy diagnostics');
    const refreshBtn = iconButton(foot, ICONS.refresh, 'Refresh');
    copyBtn.b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(this.adapter.getDiagnostics() || { note: 'no state yet' }, null, 2));
        this._toast('Diagnostics copied');
      } catch (_) {
        this._toast('Copy failed');
      }
    });
    refreshBtn.b.addEventListener('click', async () => {
      if (refreshBtn.b.disabled) return;
      refreshBtn.b.disabled = true;
      refreshBtn.b.classList.add('spin');
      try { await this.adapter.onRefresh(); } catch (_) { /* the next automatic pass still updates */ } finally {
        refreshBtn.b.disabled = false;
        refreshBtn.b.classList.remove('spin');
      }
    });

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
      pill, pillDot, pillNum, pillLvl, panel, head, themeBtn, big, pct, bar, fill, windowText, windowBadge, modelText, limitLine, warnLine,
      sUser, sAsst, sHidden, brkRows, totals, hid, hidStack, lim, limRows, diagWarn, diagRows, evidence, confDot, confText, toast, tip
    };
  }

  /** @param {Object} viewState Output of toWidgetState() */
  update(viewState) {
    this.latestState = viewState;
    if (!this.hostElement) this.mount();
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

    const vm = this.latestState || { ready: false, usedTokens: 0, percentage: null, evidence: [], breakdown: [], hiddenItems: [], limits: [], confidenceLevel: 'LOW', confidence: 0, provider: this.adapter.provider, model: 'Detecting…' };
    const lvl = vm.ready === false ? 'LOW' : vm.confidenceLevel;
    setClass(p.pillDot, `dot ${lvl}`);
    setText(p.pillNum, vm.ready === false ? '…' : fmtK(vm.usedTokens));
    setText(p.pillLvl, vm.ready === false ? 'Reading' : levelName(vm.confidenceLevel));
    setAttr(p.pill, 'aria-label', vm.ready === false
      ? 'Context usage: reading conversation. Expand panel.'
      : `Context usage ${fmtInt(vm.usedTokens)} tokens${vm.percentage !== null ? `, ${vm.percentage}% of window` : ''}, confidence ${levelName(vm.confidenceLevel)}. Expand panel.`);

    if (this.isExpanded) this._renderPanel(vm);
    this._schedulePosition();
  }

  _renderPanel(vm) {
    const p = this.parts;
    const ready = vm.ready !== false;
    this._countTo(ready ? vm.usedTokens : null);
    setText(p.pct, ready && vm.percentage !== null ? `${vm.percentage === 0 && vm.usedTokens > 0 ? '<0.1' : vm.percentage}%` : '');
    const known = ready && vm.percentage !== null;
    setClass(p.bar, `bar ${known ? tone(vm.percentage) : 'unknown'}`.trim());
    const width = known ? `${Math.min(100, vm.percentage)}%` : '';
    if (p.fill.style.width !== width) p.fill.style.width = width;
    if (known) setAttr(p.bar, 'aria-valuenow', String(vm.percentage)); else p.bar.removeAttribute('aria-valuenow');
    setText(p.windowText, !ready ? 'Reading conversation…' : vm.contextLimit ? `of ${fmtK(vm.contextLimit)} window` : 'window unknown');
    show(p.windowBadge, ready && (!vm.contextLimit || vm.limitStatus !== 'VERIFIED'));
    p.windowBadge.dataset.tip = vm.contextLimit ? TAG_TIPS.UNVERIFIED : `Window size is not known${vm.plan ? '' : ' (plan not detected)'}`;
    const model = [vm.model, vm.modelFamily].filter(Boolean).join(' · ');
    setText(p.modelText, model);
    setAttr(p.modelText, 'title', `${vm.provider}: ${model}`);
    const head = headlineLimit(vm.limits);
    setText(p.limitLine, head ? `${head.key === 'session' ? 'Session' : head.label} ${limitText(head)}` : '');
    setText(p.warnLine, vm.warning || '');

    const st = vm.stats || { user: 0, assistant: 0, hidden: 0 };
    setText(p.sUser.v, ready ? fmtK(st.user) : '—');
    setText(p.sAsst.v, ready ? fmtK(st.assistant) : '—');
    setText(p.sHidden.v, ready ? fmtK(st.hidden) : '—');

    const tokens = (n) => (!ready || n === null || n === undefined ? '—' : `${n.toLocaleString()}`);
    p.brkRows.update((vm.breakdown || []).map(b => ({ label: b.label, value: b.value, tip: b.tag ? TAG_TIPS[b.tag] || b.tag : null })));
    p.totals.update([
      { label: 'Used', value: tokens(vm.usedTokens) },
      { label: 'Remaining', value: tokens(vm.remainingTokens) },
      { label: 'Window', value: vm.contextLimit ? vm.contextLimit.toLocaleString() : 'Unknown', tip: vm.contextLimit && vm.limitStatus === 'VERIFIED' ? null : (vm.contextLimit ? TAG_TIPS.UNVERIFIED : TAG_TIPS.UNKNOWN) }
    ]);

    const items = vm.hiddenItems || [];
    show(p.hid.el, items.length > 0);
    p.hidStack.update(items);
    show(p.lim.el, (vm.limits || []).length > 0);
    p.limRows.update((vm.limits || []).map(l => ({ label: l.label, value: limitText(l) })));

    setText(p.diagWarn, vm.warning || '');
    p.diagRows.update([
      { label: 'Provider', value: vm.provider },
      { label: 'Model', value: model || '—' },
      { label: 'Plan', value: vm.plan || 'Unknown' },
      { label: 'Source', value: vm.source || '—' },
      { label: 'Turns', value: ready ? String(vm.turns) : '—' }
    ]);
    const evSig = JSON.stringify(vm.evidence || []);
    if (p.evidence.dataset.sig !== evSig) {
      p.evidence.dataset.sig = evSig;
      p.evidence.textContent = '';
      for (const e of vm.evidence || []) {
        const li = h('li', null, p.evidence);
        h('span', e.ok ? 'y' : 'n', li, e.ok ? '✓' : '!');
        h('span', null, li, e.text);
      }
    }
    setClass(p.confDot, `dot ${ready ? vm.confidenceLevel : 'LOW'}`);
    setText(p.confText, ready ? `${levelName(vm.confidenceLevel)} confidence · ${vm.confidence}%` : 'Reading…');
  }

  /** Token count animates from the last shown value (instant with reduced motion). */
  _countTo(target) {
    const el = this.parts.big;
    if (this._countRaf) cancelAnimationFrame(this._countRaf);
    if (target === null) { setText(el, '—'); this._shownTokens = null; return; }
    const from = this._shownTokens;
    if (from === null || from === target || reducedMotion() || typeof requestAnimationFrame !== 'function') {
      this._shownTokens = target;
      setText(el, fmtInt(target));
      return;
    }
    const start = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - start) / 400);
      const v = from + (target - from) * (1 - Math.pow(1 - k, 3));
      setText(el, fmtInt(v));
      this._shownTokens = k < 1 ? v : target;
      this._countRaf = k < 1 ? requestAnimationFrame(step) : null;
    };
    this._countRaf = requestAnimationFrame(step);
  }

  _setExpanded(open) {
    this.isExpanded = open;
    this.render();
    this._savePrefs();
    if (open) this.parts.head.focus({ preventScroll: true });
  }

  _toast(text) {
    const t = this.parts.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 1500);
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
        this.isExpanded = Boolean(s.expanded);
        this.render();
      }).catch(() => {});
    } catch (_) {}
  }

  _savePrefs() {
    const store = this._storage();
    if (!store) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try { store.set({ [this._storeKey]: { pos: this.pos, expanded: this.isExpanded, theme: this.theme } }).catch(() => {}); } catch (_) {}
    }, 200);
  }

  unmount() {
    this.hostElement?.remove();
    this.hostElement = null;
    this.shadowRoot = null;
    this.parts = null;
  }
}
