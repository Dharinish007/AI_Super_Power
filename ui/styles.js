/**
 * Context Monitor - shared widget CSS (the STYLES string injected into each shadow root).
 * Moved out of overlay-ui.js so the side panel bundle reuses the same look.
 */

export const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .root {
    --bg: #0F1115; --surface: #171A21; --glass: rgba(23, 26, 33, .85); --border: #262A33; --text: #E6E8EC; --muted: #8A91A0;
    --accent: #D97757; --good: #4ADE80; --warn: #FBBF24; --warn-text: #FBBF24; --danger: #F87171; --track: #262A33; --hover: rgba(255, 255, 255, .06);
    --s1: #D97757; --s2: #60A5FA; --s3: #A78BFA; --s4: #34D399; --s5: #F472B6; --s6: #FBBF24; --s7: #22D3EE; --s8: #94A3B8;
    --shadow: 0 8px 30px rgba(0, 0, 0, .25); --on-accent: #0F1115;
    --ui: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    position: relative; font: 12.5px/1.45 var(--ui); color: var(--text); color-scheme: dark;
    -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums;
  }
  .root.light {
    --bg: #FAF9F6; --surface: #FFFFFF; --glass: rgba(255, 255, 255, .85); --border: #E7E4DD; --text: #1F2328; --muted: #6B7280;
    --accent: #C15F3C; --good: #16A34A; --warn: #D97706; --warn-text: #B45309; --danger: #DC2626; --track: #EFECE6; --hover: rgba(0, 0, 0, .04);
    --s1: #C15F3C; --s2: #2563EB; --s3: #7C3AED; --s4: #059669; --s5: #DB2777; --s6: #D97706; --s7: #0891B2; --s8: #64748B;
    --shadow: 0 8px 30px rgba(0, 0, 0, .12); --on-accent: #FFFFFF; color-scheme: light;
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
  .tip { position: absolute; z-index: 1; max-width: 240px; padding: 6px 8px; border-radius: 6px; background: var(--text); color: var(--surface);
    font-size: 11px; line-height: 1.4; pointer-events: none; opacity: 0; transition: opacity .1s ease; }
  .tip.show { opacity: 1; }

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

  .hide { display: none !important; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;
