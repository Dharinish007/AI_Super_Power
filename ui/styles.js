/**
 * Context Monitor - shared widget CSS (the STYLES string injected into each shadow root).
 * Moved out of overlay-ui.js so the side panel bundle reuses the same look.
 */

export const STYLES = `
  :host { all: initial; display: block; width: 100%; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :host, .root, .glance-container {
    --bg: #0F1117; --surface: #1E222B; --surface-hover: #272C37; --glass: rgba(30, 34, 43, .90);
    --border: rgba(255, 255, 255, .18); --border-hover: rgba(255, 255, 255, .35);
    --text: #FFFFFF; --muted: #D1D5DB;
    --accent: #E07A5F; --good: #4ADE80; --warn: #FBBF24; --warn-text: #FDE047; --danger: #F87171;
    --track: rgba(255, 255, 255, .15); --hover: rgba(255, 255, 255, .10);
    --s1: #E07A5F; --s2: #60A5FA; --s3: #A78BFA; --s4: #34D399; --s5: #F472B6; --s6: #FBBF24; --s7: #22D3EE; --s8: #94A3B8;
    --shadow: 0 4px 20px -2px rgba(0, 0, 0, .60), 0 0 0 1px rgba(255, 255, 255, .15);
    --shadow-hover: 0 6px 24px -2px rgba(0, 0, 0, .75), 0 0 0 1px rgba(255, 255, 255, .25);
    --on-accent: #0F1117;
    --ui: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    position: relative; font: 12.5px/1.45 var(--ui); color: var(--text); color-scheme: dark;
    -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums;
  }
  :host(.light), .root.light, .glance-container.light {
    --bg: #FFFFFF; --surface: #F8F9FA; --surface-hover: #F1F3F5; --glass: rgba(248, 249, 250, .94);
    --border: rgba(0, 0, 0, .15); --border-hover: rgba(0, 0, 0, .30);
    --text: #0F172A; --muted: #475569;
    --accent: #C15F3C; --good: #059669; --warn: #D97706; --warn-text: #B45309; --danger: #DC2626;
    --track: rgba(0, 0, 0, 0.08); --hover: rgba(0, 0, 0, 0.05);
    --s1: #C15F3C; --s2: #2563EB; --s3: #7C3AED; --s4: #059669; --s5: #DB2777; --s6: #D97706; --s7: #0891B2; --s8: #64748B;
    --shadow: 0 4px 16px -2px rgba(0, 0, 0, .08), 0 0 0 1px rgba(0, 0, 0, .08);
    --shadow-hover: 0 6px 20px -2px rgba(0, 0, 0, .12), 0 0 0 1px rgba(0, 0, 0, .12);
    --on-accent: #FFFFFF; color: var(--text); color-scheme: light;
  }
  button { all: unset; box-sizing: border-box; cursor: pointer; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }

  /* Pill (collapsed) */
  .pill { display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px; border-radius: 999px;
    background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); white-space: nowrap;
    font-weight: 600; cursor: grab; touch-action: none; user-select: none; }
  .pill .num { font-family: var(--mono); font-size: 12.5px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex: none; }
  .dot.HIGH { background: var(--good); } .dot.MEDIUM { background: var(--warn); } .dot.LOW { background: var(--muted); }

  @supports ((backdrop-filter: blur(12px)) or (-webkit-backdrop-filter: blur(12px))) {
    .pill { background: var(--glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
  }
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
  .row .k { color: var(--muted); white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .row .v { text-align: right; min-width: 0; overflow-wrap: anywhere; font-weight: 500; }
  .divider { border-top: 1px dashed var(--border); margin: 6px 0; }

  .stack { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--track); gap: 2px; margin: 4px 0 10px; }
  .stack i { display: block; min-width: 3px; }
  .leg { display: flex; align-items: center; gap: 8px; padding: 4px 6px; margin: 0 -6px; border-radius: 6px; width: calc(100% + 12px); }
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
  .spark { display: block; width: 100%; height: 40px; }
  .spark polyline { fill: none; stroke: var(--accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; stroke-linejoin: round; }

  /* Tabs (header) */
  .tabs { flex: 1; min-width: 0; display: flex; gap: 2px; margin-left: -8px; }
  .tab { padding: 4px 8px; border-radius: 6px; font-weight: 600; font-size: 12px; color: var(--muted); white-space: nowrap; }
  .tab:hover, .tab[aria-selected="true"] { background: var(--hover); color: var(--text); }

  /* Capsules */
  .caps { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
  .caps > * { flex-shrink: 0; } /* A long list scrolls; it never squeezes the buttons and cards */
  .caps .fine { margin-top: 0; }
  .btns { display: flex; gap: 6px; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; justify-content: center; height: 26px; padding: 0 10px; border-radius: 7px;
    border: 1px solid var(--border); font-weight: 600; font-size: 11.5px; white-space: nowrap; }
  .btn:hover { background: var(--hover); }
  .btn.primary { width: 100%; height: 34px; font-size: 12.5px; background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .btn.primary:hover { filter: brightness(1.08); }
  .btn.danger { color: var(--danger); }
  .field { display: block; width: 100%; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg);
    color: var(--text); font: inherit; outline: none; }
  .field:focus { border-color: var(--accent); }
  textarea.field { min-height: 220px; resize: vertical; font: 11px/1.5 var(--mono); scrollbar-width: thin; }
  .card { padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; display: flex; flex-direction: column; gap: 6px; }
  .card.wait { border-style: dashed; border-color: var(--accent); }
  .card.warn { border-color: var(--warn); }
  .card.warn .t { color: var(--warn-text); }
  .card .m.bad { color: var(--danger); }
  .hero .card { margin-top: 10px; }

  /* Library: search, tags, pin, tick several */
  .two { display: flex; gap: 6px; }
  .two .field { flex: 1; min-width: 0; }
  .two select.field { flex: 0 1 auto; max-width: 120px; }
  .card .th { display: flex; align-items: center; gap: 8px; }
  .card .th .t { flex: 1; min-width: 0; }
  .card input[type=checkbox] { width: 14px; height: 14px; flex: none; accent-color: var(--accent); cursor: pointer; }
  .card.on { border-color: var(--accent); }
  .pin { flex: none; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; opacity: .35; filter: grayscale(1); }
  .pin:hover { opacity: .8; background: var(--hover); }
  .pin.on { opacity: 1; filter: none; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { font-size: 11px; color: var(--accent); padding: 0 4px; border-radius: 4px; }
  .chip:hover { background: var(--hover); }
  .pick { position: sticky; bottom: 0; z-index: 1; background: var(--surface); border-color: var(--accent); box-shadow: 0 -6px 16px rgba(0, 0, 0, .18); }
  .card .t { font-weight: 600; overflow-wrap: anywhere; }
  .card .m { color: var(--muted); font-size: 11px; }
  .caps-h { font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-top: 4px; }

  /* Side panel page: the document itself is the .root (":host" above matches nothing outside a shadow root) */
  .panelpage { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: var(--bg); }
  .panelpage > .tabs { flex: none; margin: 0; padding: 8px; border-bottom: 1px solid var(--border); }
  .panelpage > .body { flex: 1; min-height: 0; }
  .panelpage > .empty { margin: 24px 16px; text-align: center; color: var(--muted); }
  .settings { padding: 4px 16px 16px; }
  .settings .group { border: 0; margin-top: 12px; }
  .settings legend { margin-bottom: 4px; font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .settings .row { justify-content: flex-start; align-items: center; gap: 8px; cursor: pointer; }
  .settings input { flex: none; accent-color: var(--accent); }

  /* Glance Strip & Detail Drawer */
  .glance-container { display: flex; flex-direction: column; width: 100%; max-width: 768px; margin: 0 auto 6px; box-sizing: border-box; }
  .glance-strip {
    display: inline-flex; align-items: center; gap: 8px; width: fit-content; max-width: 100%;
    padding: 4px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border);
    font: 500 12px/1.4 var(--ui); color: var(--text); cursor: pointer; user-select: none;
    transition: background .15s ease, border-color .15s ease;
  }
  .glance-strip:hover { background: var(--hover); border-color: var(--muted); }
  .glance-strip.good { border-color: rgba(74, 222, 128, .3); }
  .glance-strip.warn { border-color: rgba(251, 191, 36, .3); }
  .glance-strip.bad { border-color: rgba(248, 113, 113, .3); }
  .glance-strip.good .glance-pct { color: var(--good); font-weight: 600; }
  .glance-strip.warn .glance-pct { color: var(--warn-text); font-weight: 600; }
  .glance-strip.bad .glance-pct { color: var(--danger); font-weight: 600; }
  .glance-dot { flex: none; font-size: 11px; }
  .glance-sep { color: var(--muted); opacity: .6; }
  .glance-left { color: var(--text); }
  .glance-reset { color: var(--muted); }

  .detail-drawer {
    width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    padding: 12px 14px; margin-bottom: 6px; box-shadow: var(--shadow); box-sizing: border-box;
    display: flex; flex-direction: column; gap: 8px;
  }
  .detail-drawer[hidden] { display: none; }
  .drawer-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .drawer-title { font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--text); }
  .model-caption { font-size: 11px; color: var(--muted); margin-left: 6px; }
  .drawer-gear { opacity: .7; } .drawer-gear:hover { opacity: 1; }

  /* Stacked Bar */
  .stack-bar { display: flex; height: 8px; border-radius: 999px; overflow: hidden; background: var(--track); width: 100%; margin: 4px 0 2px; }
  .stack-bar .seg { display: block; height: 100%; transition: width .3s ease; }
  .stack-bar .seg-user { background: var(--s2); }
  .stack-bar .seg-asst { background: var(--s1); }
  .stack-bar .seg-sys { background: var(--s3); }

  .drawer-legend { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); flex-wrap: wrap; margin-top: 2px; }
  .drawer-legend .sep { opacity: .4; }
  .drawer-legend span[data-tip] { cursor: help; border-bottom: 1px dotted var(--muted); }

  .drawer-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 12px; padding: 2px 0; }
  .drawer-row .k { color: var(--muted); }
  .drawer-row .v { color: var(--text); font-weight: 500; font-family: var(--mono); }
  .biggest-row { border-top: 1px solid var(--border); padding-top: 6px; margin-top: 2px; }

  .drawer-usage { border-top: 1px solid var(--border); padding-top: 6px; margin-top: 2px; display: flex; flex-direction: column; gap: 4px; }
  .usage-row { font-size: 12px; color: var(--text); }

  .dev-view { border-top: 1px dashed var(--border); margin-top: 8px; padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .dev-view[hidden] { display: none; }
  .sec-title { font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }

  /* Strip Box (2-column usage & context strip) */
  .strip-box {
    display: flex; justify-content: space-between; align-items: center; width: 100%;
    padding: 8px 14px; border-radius: 10px; background: var(--surface);
    border: 1px solid var(--border); box-shadow: var(--shadow); user-select: none;
    box-sizing: border-box; cursor: pointer; color: var(--text);
    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
  }
  .strip-box:hover { background: var(--surface-hover); border-color: var(--border-hover); box-shadow: var(--shadow-hover); }
  .strip-left { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
  .strip-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex: none; }
  .u-row { display: flex; align-items: center; gap: 8px; font-size: 11.5px; }
  .u-label {
    display: inline-flex; align-items: center; justify-content: center;
    font-family: var(--mono); font-weight: 700; font-size: 10.5px;
    letter-spacing: 0.03em; min-width: 28px; padding: 1px 6px; border-radius: 4px;
    color: var(--text); background: var(--track); border: 1px solid var(--border);
    flex: none;
  }
  .u-bar-track {
    width: 120px; height: 7px; border-radius: 999px; background: var(--track);
    overflow: hidden; flex: none; box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.18);
  }
  .u-bar-fill { height: 100%; border-radius: 999px; transition: width .35s cubic-bezier(0.4, 0, 0.2, 1); }
  .u-bar-fill.solid-ok { background: var(--good); }
  .u-bar-fill.solid-warn { background: var(--warn); }
  .u-bar-fill.solid-danger { background: var(--danger); }
  .u-bar-fill.hatched-ok {
    background: repeating-linear-gradient(45deg, var(--good), var(--good) 3px, transparent 3px, transparent 6px);
    background-color: rgba(74, 222, 128, 0.25);
  }
  .u-bar-fill.hatched-warn {
    background: repeating-linear-gradient(45deg, var(--warn), var(--warn) 3px, transparent 3px, transparent 6px);
    background-color: rgba(251, 191, 36, 0.25);
  }
  .u-bar-fill.hatched-danger {
    background: repeating-linear-gradient(45deg, var(--danger), var(--danger) 3px, transparent 3px, transparent 6px);
    background-color: rgba(248, 113, 113, 0.25);
  }
  .u-bar-fill.neutral { background: var(--muted); opacity: .4; }
  .u-pct { font-family: var(--mono); font-weight: 700; font-size: 11.5px; min-width: 40px; text-align: right; }
  .u-pct.ok { color: var(--good); }
  .u-pct.warn { color: var(--warn-text); }
  .u-pct.danger { color: var(--danger); }
  .u-pct.neutral { color: var(--muted); }
  .u-reset { font-family: var(--mono); color: var(--muted); font-size: 11px; white-space: nowrap; }
  .u-note { color: var(--muted); font-size: 11px; font-weight: 500; }

  .ctx-msgs { font-family: var(--mono); font-size: 11px; color: var(--muted); line-height: 1.15; text-align: right; font-weight: 500; }
  .ctx-row { display: flex; align-items: center; gap: 7px; color: var(--text); }
  .ctx-ring-btn { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border-radius: 6px; padding: 1px 3px; }
  .ctx-ring-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .ctx-ring-svg { width: 22px; height: 22px; transform: rotate(-90deg); flex: none; }
  .ctx-ring-track { fill: none; stroke: var(--track); stroke-width: 2.75; }
  .ctx-ring-arc { fill: none; stroke-width: 2.75; stroke-linecap: round; transition: stroke-dashoffset .35s cubic-bezier(0.4, 0, 0.2, 1); }
  .ctx-ring-arc.ok { stroke: var(--good); }
  .ctx-ring-arc.warn { stroke: var(--warn); }
  .ctx-ring-arc.danger { stroke: var(--danger); }
  .ctx-ring-arc.hatched { stroke-opacity: 0.85; }
  .ctx-pct { font-family: var(--mono); font-weight: 700; font-size: 12px; }
  .ctx-pct.ok { color: var(--good); }
  .ctx-pct.warn { color: var(--warn-text); }
  .ctx-pct.danger { color: var(--danger); }
  .ctx-pct.neutral { color: var(--text); }

  .new-chat-suggestion { color: var(--warn-text); font-size: 11.5px; padding: 4px 0; border-top: 1px solid var(--border); margin-top: 2px; }
  .sparkline-row { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 4px; margin-top: 2px; }
  .drawer-sparkline { width: 120px; height: 24px; stroke: var(--accent); stroke-width: 1.5; fill: none; stroke-linecap: round; }
  .draft-estimate { display: inline-flex; align-items: center; font-size: 11px; color: var(--muted); padding: 2px 8px; border-radius: 4px; background: var(--surface); border: 1px solid var(--border); margin-bottom: 4px; width: fit-content; }
  .visible-only-badge { font-size: 10px; color: var(--muted); margin-left: 4px; font-weight: normal; }

  .hide { display: none !important; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;
