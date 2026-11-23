/**
 * Context Monitor - Simplified Context view
 *
 * Answers two questions:
 * 1. Can I keep going in this chat?
 * 2. When do I hit the limit, and when does it reset?
 *
 * Structure:
 * - Header: "Context 96K / 200K · est." + small model caption + Gear button
 * - Stacked bar with legend: You 4% | Claude & tools 55% | System & memory 41%
 *   Tooltip on "System & memory": system prompt, memory, tool definitions
 * - "Biggest item: <name> · <tokens>" row (shown only when data exists)
 * - Usage section with exactly two rows:
 *   Session 67% · resets 7:20 PM
 *   Weekly 7% · resets in 1d 8h
 * - Dev view (growth sparkline, diagnostics, exact raw numbers; hidden by default, toggled by gear)
 * - Footer: Copy diagnostics & Refresh buttons (confidence score removed)
 */

import { alertLevel } from '../content/widget-state.js';
import { h, RowList, textButton, iconButton, ICONS, setText, show, fmtK, fmtInt } from './dom.js';
import { formatTokens, formatPercent, formatReset } from './formatters.js';

/**
 * Builds a scrolling `.body` and a `.foot` under `parent`.
 * @param {HTMLElement} parent
 * @param {{ actions: { refresh: () => any, copyDiagnostics: () => any, exportChat: (format: string) => any, saveAsCapsule: () => any },
 *   settings: { display: { compact: boolean } } }} opts
 * @returns {{ el: HTMLElement, foot: HTMLElement, update: (vm: Object) => void, setSettings: (s: Object) => void }}
 */
export function ContextView(parent, { actions }) {
  let devOpen = false;

  const el = h('div', 'body', parent);

  // --- Main Header & Stacked Bar (Hero) ---
  const hero = h('div', 'hero', el);

  const topRow = h('div', 'drawer-header', hero);
  const titleBox = h('div', 'top', topRow);
  const titleEl = h('span', 'drawer-title', titleBox, 'Context —');
  const modelCaption = h('span', 'model-caption', titleBox);
  const gearBtn = iconButton(topRow, ICONS.gear, 'Developer diagnostics');
  gearBtn.b.classList.add('drawer-gear');
  gearBtn.b.setAttribute('aria-expanded', 'false');

  // Save card when chat is full (>= 80%)
  const saveCard = h('div', 'card warn hide', hero);
  const saveText = h('div', 't', saveCard);
  h('div', 'm', saveCard, 'Save it as a Capsule, then insert it in a new chat to keep going.');
  textButton(h('div', 'btns', saveCard), '📦 Save as Capsule', () => actions.saveAsCapsule());

  // One stacked bar
  const stackBar = h('div', 'stack-bar', hero);
  stackBar.setAttribute('role', 'progressbar');
  stackBar.setAttribute('aria-label', 'Context distribution');
  const segUser = h('span', 'seg seg-user', stackBar);
  const segAsst = h('span', 'seg seg-asst', stackBar);
  const segSys = h('span', 'seg seg-sys', stackBar);

  // Legend
  const legend = h('div', 'drawer-legend', hero);
  const legUser = h('span', null, legend);
  h('span', 'sep', legend, '|');
  const legAsst = h('span', null, legend);
  h('span', 'sep', legend, '|');
  const legSys = h('span', null, legend);
  const sysTip = 'System prompt, memory, tool definitions';
  legSys.dataset.tip = sysTip;
  legSys.title = sysTip;

  const warnLine = h('div', 'line warn hide', hero);
  warnLine.setAttribute('role', 'status');

  // --- Main Content: Biggest Item & Usage ---
  const mainSec = h('div', 'drawer-main', el);
  mainSec.style.cssText = 'padding: 0 16px 12px;';

  // "Biggest item: <name> · <tokens>" row (shown only when data exists)
  const bigRow = h('div', 'drawer-row biggest-row hide', mainSec);
  h('span', 'k', bigRow, 'Biggest item:');
  const bigVal = h('span', 'v', bigRow);

  // Usage section with exactly two rows (Session & Weekly)
  const usageSec = h('div', 'drawer-usage hide', mainSec);
  const sessionRow = h('div', 'drawer-row usage-row hide', usageSec);
  const weeklyRow = h('div', 'drawer-row usage-row hide', usageSec);

  // --- Developer View (Hidden by default, opened by gear icon) ---
  const devView = h('div', 'dev-view hide', mainSec);
  h('div', 'sec-title', devView, 'Developer Diagnostics & Growth');

  // Growth sparkline
  const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  spark.setAttribute('viewBox', '0 0 200 40');
  spark.setAttribute('preserveAspectRatio', 'none');
  spark.setAttribute('class', 'spark');
  spark.setAttribute('role', 'img');
  const sparkLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  spark.appendChild(sparkLine);
  devView.appendChild(spark);
  const growthText = h('div', 'fine', devView);

  // Raw numbers
  h('div', 'sec-title', devView, 'Exact Raw Counts');
  const rawRows = RowList(devView);

  // Export chat buttons
  h('div', 'sec-title', devView, 'Export Chat');
  const exportBtns = h('div', 'btns', devView);
  for (const [label, format] of [['📄 Markdown', 'md'], ['📝 Text', 'txt'], ['🧾 JSON', 'json']]) {
    textButton(exportBtns, label).addEventListener('click', () => actions.exportChat(format));
  }

  // Diagnostics metadata
  h('div', 'sec-title', devView, 'Diagnostics');
  const diagRows = RowList(devView);
  const evidence = h('ul', 'evidence', devView);

  // Toggle Dev View
  gearBtn.b.addEventListener('click', () => {
    devOpen = !devOpen;
    show(devView, devOpen);
    gearBtn.b.setAttribute('aria-expanded', String(devOpen));
  });

  // --- Footer ---
  const foot = h('div', 'foot', parent);
  const footNote = h('span', 'fine', foot, 'Context Monitor');
  footNote.style.flex = '1';
  const copyBtn = iconButton(foot, ICONS.copy, 'Copy diagnostics');
  const refreshBtn = iconButton(foot, ICONS.refresh, 'Refresh');

  copyBtn.b.addEventListener('click', () => actions.copyDiagnostics());
  refreshBtn.b.addEventListener('click', async () => {
    if (refreshBtn.b.disabled) return;
    refreshBtn.b.disabled = true;
    refreshBtn.b.classList.add('spin');
    try { await actions.refresh(); } catch (_) {} finally {
      refreshBtn.b.disabled = false;
      refreshBtn.b.classList.remove('spin');
    }
  });

  /** Tokens by turn sparkline */
  function renderSpark(vm, ready) {
    const g = ready ? vm.growth : null;
    if (!g || g.points.length < 2) {
      sparkLine.setAttribute('points', '');
      setText(growthText, 'Appears after a few messages.');
      return;
    }
    const topV = Math.max(vm.contextLimit || 0, g.total) || 1;
    const pts = g.points.map((v, i) => `${((i / (g.points.length - 1)) * 200).toFixed(1)},${(38 - (v / topV) * 36).toFixed(1)}`).join(' ');
    if (sparkLine.getAttribute('points') !== pts) sparkLine.setAttribute('points', pts);
    spark.setAttribute('aria-label', `Message tokens by turn: ${fmtInt(g.total)} over ${g.turns} turns`);
    setText(growthText, `${g.turns} turns · ${fmtInt(g.total)} message tokens${vm.contextLimit ? ` of ${fmtK(vm.contextLimit)}` : ''}`);
  }

  /** Update view with latest view state */
  function update(vm) {
    const ready = Boolean(vm) && vm.ready !== false;

    // 1. Header: "Context 96K / 200K · est."
    const used = ready ? formatTokens(vm.usedTokens) : null;
    const limit = ready ? formatTokens(vm.contextLimit) : null;
    const est = ready && vm.limitStatus !== 'VERIFIED' ? ' · est.' : '';
    const titleStr = ready && used
      ? (limit ? `Context ${used} / ${limit}${est}` : `Context ${used}${est}`)
      : 'Context —';
    setText(titleEl, titleStr);

    // Small model caption
    const modelStr = [vm.model, vm.modelFamily].filter(Boolean).join(' · ');
    setText(modelCaption, modelStr ? `(${modelStr})` : '');

    // Warning
    if (vm.warning) {
      setText(warnLine, vm.warning);
      show(warnLine, true);
    } else {
      show(warnLine, false);
    }

    // Save Capsule card at >= 80%
    const full = ready && vm.percentage !== null && alertLevel(vm.percentage) >= 80;
    show(saveCard, full);
    if (full) setText(saveText, `💡 This chat is ${vm.percentage}% full`);

    // 2. Stacked Bar & Legend
    const st = vm.stats || { user: 0, assistant: 0, hidden: 0 };
    const total = (st.user + st.assistant + st.hidden) || vm.usedTokens || 1;
    const youPct = Math.round((st.user / total) * 100);
    const asstPct = Math.round((st.assistant / total) * 100);
    const sysPct = Math.max(0, 100 - youPct - asstPct);

    segUser.style.width = `${youPct}%`;
    segAsst.style.width = `${asstPct}%`;
    segSys.style.width = `${sysPct}%`;

    setText(legUser, `You ${youPct}%`);
    setText(legAsst, `${vm.provider || 'Assistant'} & tools ${asstPct}%`);
    setText(legSys, `System & memory ${sysPct}%`);

    // 3. Biggest item row (shown only when data exists)
    const big = vm.biggest?.[0];
    if (ready && big && big.tokens > 0) {
      const role = big.role === 'user' ? 'You' : (vm.provider || 'Assistant');
      const name = `${role} (#${big.turn})`;
      setText(bigVal, `${name} · ${formatTokens(big.tokens)}`);
      show(bigRow, true);
    } else {
      show(bigRow, false);
    }

    // 4. Usage section with exactly two rows (Session & Weekly)
    const limits = vm.limits || [];
    const session = limits.find(l => l.key === 'session' || l.label?.toLowerCase().includes('session'));
    const weekly = limits.find(l => l.key === 'weekly' || l.label?.toLowerCase().includes('weekly'));
    let hasUsage = false;

    if (session) {
      const sPct = session.percent !== null && session.percent !== undefined
        ? formatPercent(session.percent)?.text
        : (session.remaining !== undefined && session.remaining !== null ? `${session.remaining} left` : null);
      const sReset = formatReset(session.resetsAt) || (session.resetIn ? `resets in ${session.resetIn}` : null);
      const parts = [sPct, sReset].filter(Boolean);
      if (parts.length) {
        setText(sessionRow, `Session ${parts.join(' · ')}`);
        show(sessionRow, true);
        hasUsage = true;
      } else {
        show(sessionRow, false);
      }
    } else {
      show(sessionRow, false);
    }

    if (weekly) {
      const wPct = weekly.percent !== null && weekly.percent !== undefined
        ? formatPercent(weekly.percent)?.text
        : (weekly.remaining !== undefined && weekly.remaining !== null ? `${weekly.remaining} left` : null);
      const wReset = formatReset(weekly.resetsAt) || (weekly.resetIn ? `resets in ${weekly.resetIn}` : null);
      const parts = [wPct, wReset].filter(Boolean);
      if (parts.length) {
        setText(weeklyRow, `Weekly ${parts.join(' · ')}`);
        show(weeklyRow, true);
        hasUsage = true;
      } else {
        show(weeklyRow, false);
      }
    } else {
      show(weeklyRow, false);
    }

    show(usageSec, hasUsage);

    // 5. Dev View details (growth, exact raw numbers, diagnostics)
    renderSpark(vm, ready);

    const numExact = (n) => (n !== null && n !== undefined ? n.toLocaleString() : 'Unknown');
    rawRows.update([
      { label: 'Used tokens', value: numExact(vm.usedTokens) },
      { label: 'Remaining tokens', value: numExact(vm.remainingTokens) },
      { label: 'Window size', value: numExact(vm.contextLimit) },
      { label: 'You', value: numExact(st.user) },
      { label: 'Assistant + tools', value: numExact(st.assistant) },
      { label: 'System & hidden', value: numExact(st.hidden) }
    ]);

    diagRows.update([
      { label: 'Provider', value: vm.provider || '—' },
      { label: 'Model', value: modelStr || '—' },
      { label: 'Plan', value: vm.plan || 'Unknown' },
      { label: 'Source', value: vm.source || '—' },
      { label: 'Turns', value: ready ? String(vm.turns) : '—' }
    ]);

    const evSig = JSON.stringify(vm.evidence || []);
    if (evidence.dataset.sig !== evSig) {
      evidence.dataset.sig = evSig;
      evidence.textContent = '';
      for (const e of vm.evidence || []) {
        const li = h('li', null, evidence);
        h('span', e.ok ? 'y' : 'n', li, e.ok ? '✓' : '!');
        h('span', null, li, e.text);
      }
    }
  }

  return { el, foot, update, setSettings(_s) {} };
}
