/**
 * Context Monitor - Context view: hero (tokens, bar, window, model), stats, Save-as-Capsule card,
 * sections (Breakdown, Biggest messages, Growth, Attachments, Hidden context, Usage limits) and
 * Diagnostics (closed by default), then the footer (confidence, Copy diagnostics, Refresh).
 * Moved out of content/overlay-ui.js. Renders a view state; knows nothing about where it is shown:
 * anything that reads the AI site goes through `actions`.
 */

import { alertLevel } from '../content/widget-state.js';
import { h, Section, RowList, HiddenStack, textButton, iconButton, approx, TAG_TIPS, ICONS, setText, setAttr, setClass, show, fmtK, fmtInt, tone, levelName, reducedMotion, limitText, headlineLimit } from './dom.js';

/**
 * Builds a scrolling `.body` and a `.foot` under `parent` (siblings, so the footer stays put while the body scrolls).
 * @param {HTMLElement} parent
 * @param {{ actions: { refresh: () => any, copyDiagnostics: () => any, exportChat: (format: string) => any, saveAsCapsule: () => any },
 *   settings: { display: { compact: boolean } } }} opts
 * @returns {{ el: HTMLElement, foot: HTMLElement, update: (vm: Object) => void, setSettings: (s: Object) => void }}
 */
export function ContextView(parent, { actions, settings }) {
  let cfg = settings;
  let shownTokens = null;
  let countRaf = null;

  const el = h('div', 'body', parent);
  const hero = h('div', 'hero', el);
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
  // At 80% full: save the chat as a Capsule now, and continue in a new chat with it
  const saveCard = h('div', 'card warn hide', hero);
  const saveText = h('div', 't', saveCard);
  h('div', 'm', saveCard, 'Save it as a Capsule, then insert it in a new chat to keep going.');
  textButton(h('div', 'btns', saveCard), '📦 Save as Capsule', () => actions.saveAsCapsule());

  const stats = h('div', 'stats', el);
  const stat = (label) => {
    const c = h('div', 'stat', stats);
    const k = h('div', 'k', c, label);
    return { k, v: h('div', 'v', c, '—') };
  };
  const sUser = stat('You');
  const sAsst = stat('');
  const sHidden = stat('Hidden');

  const brk = Section(el, 'Breakdown');
  const brkRows = RowList(brk.body);
  h('div', 'divider', brk.body);
  const totals = RowList(brk.body);

  const bigSec = Section(el, 'Biggest messages');
  const bigRows = RowList(bigSec.body);
  h('div', 'fine', bigSec.body, 'The largest turns in this chat. Trim them, or save them to a file, to free room.');
  const exportBtns = h('div', 'btns', bigSec.body);
  for (const [label, format] of [['📄 Markdown', 'md'], ['📝 Text', 'txt'], ['🧾 JSON', 'json']]) {
    textButton(exportBtns, label).addEventListener('click', () => actions.exportChat(format));
  }

  const growth = Section(el, 'Growth');
  const spark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  spark.setAttribute('viewBox', '0 0 200 40');
  spark.setAttribute('preserveAspectRatio', 'none');
  spark.setAttribute('class', 'spark');
  spark.setAttribute('role', 'img');
  const sparkLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  spark.appendChild(sparkLine);
  growth.body.appendChild(spark);
  const growthText = h('div', 'fine', growth.body);

  const att = Section(el, 'Attachments');
  const attRows = RowList(att.body);
  h('div', 'fine', att.body, 'Images use an estimate; documents the site reads server-side have no known cost here.');

  const hid = Section(el, 'Hidden context');
  const hidStack = HiddenStack(hid.body);
  const hidFine = h('div', 'fine', hid.body);

  const lim = Section(el, 'Usage limits');
  const limRows = RowList(lim.body);

  const diag = Section(el, 'Diagnostics');
  const diagWarn = h('div', 'line warn', diag.body);
  const diagRows = RowList(diag.body);
  const evidence = h('ul', 'evidence', diag.body);
  h('div', 'fine', diag.body, 'Counts visible text, hidden context the site exposes, and estimates where it does not. Everything runs in your browser: nothing is sent anywhere.');

  const foot = h('div', 'foot', parent);
  const conf = h('div', 'conf', foot);
  const confDot = h('span', 'dot', conf);
  const confText = h('span', null, conf);
  const copyBtn = iconButton(foot, ICONS.copy, 'Copy diagnostics');
  const refreshBtn = iconButton(foot, ICONS.refresh, 'Refresh');
  copyBtn.b.addEventListener('click', () => actions.copyDiagnostics());
  refreshBtn.b.addEventListener('click', async () => {
    if (refreshBtn.b.disabled) return;
    refreshBtn.b.disabled = true;
    refreshBtn.b.classList.add('spin');
    try { await actions.refresh(); } catch (_) { /* the next automatic pass still updates */ } finally {
      refreshBtn.b.disabled = false;
      refreshBtn.b.classList.remove('spin');
    }
  });

  const num = (n) => (cfg.display.compact ? fmtK(Math.round(n)) : fmtInt(n));

  /** Token count animates from the last shown value (instant with reduced motion). */
  function countTo(target) {
    if (countRaf) cancelAnimationFrame(countRaf);
    if (target === null) { setText(big, '—'); shownTokens = null; return; }
    const from = shownTokens;
    if (from === null || from === target || reducedMotion() || typeof requestAnimationFrame !== 'function') {
      shownTokens = target;
      setText(big, num(target));
      return;
    }
    const start = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - start) / 400);
      const v = from + (target - from) * (1 - Math.pow(1 - k, 3));
      setText(big, num(v));
      shownTokens = k < 1 ? v : target;
      countRaf = k < 1 ? requestAnimationFrame(step) : null;
    };
    countRaf = requestAnimationFrame(step);
  }

  /** Tokens by turn as a line, scaled to the window when known (so the slope reads as "how fast it fills"). */
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

  /** @param {Object} vm Output of toWidgetState() */
  function update(vm) {
    const ready = vm.ready !== false;
    countTo(ready ? vm.usedTokens : null);
    setText(pct, ready && vm.percentage !== null ? `${vm.percentage === 0 && vm.usedTokens > 0 ? '<0.1' : vm.percentage}%` : '');
    const known = ready && vm.percentage !== null;
    setClass(bar, `bar ${known ? tone(vm.percentage) : 'unknown'}`.trim());
    const width = known ? `${Math.min(100, vm.percentage)}%` : '';
    if (fill.style.width !== width) fill.style.width = width;
    if (known) setAttr(bar, 'aria-valuenow', String(vm.percentage)); else bar.removeAttribute('aria-valuenow');
    setText(windowText, !ready ? 'Reading conversation…' : vm.contextLimit ? `of ${fmtK(vm.contextLimit)} window${vm.exchangesLeft !== null && vm.exchangesLeft !== undefined ? ` · ~${vm.exchangesLeft} exchanges left` : ''}` : 'window unknown');
    show(windowBadge, ready && (!vm.contextLimit || vm.limitStatus !== 'VERIFIED'));
    windowBadge.dataset.tip = vm.contextLimit ? TAG_TIPS.UNVERIFIED : `Window size is not known${vm.plan ? '' : ' (plan not detected)'}`;
    const model = [vm.model, vm.modelFamily].filter(Boolean).join(' · ');
    setText(modelText, model);
    setAttr(modelText, 'title', `${vm.provider}: ${model}`);
    const head = headlineLimit(vm.limits);
    setText(limitLine, head ? `${head.key === 'session' ? 'Session' : head.label} ${limitText(head)}` : '');
    setText(warnLine, vm.warning || '');
    const full = ready && vm.percentage !== null && alertLevel(vm.percentage) >= 80;
    show(saveCard, full);
    if (full) setText(saveText, `💡 This chat is ${vm.percentage}% full`);

    const st = vm.stats || { user: 0, assistant: 0, hidden: 0 };
    setText(sAsst.k, `${vm.provider} + tools`);
    setText(sUser.v, ready ? fmtK(st.user) : '—');
    setText(sAsst.v, ready ? fmtK(st.assistant) : '—');
    setText(sHidden.v, ready ? fmtK(st.hidden) : '—');

    const tokens = (n) => (!ready || n === null || n === undefined ? '—' : `${n.toLocaleString()}`);
    brkRows.update((vm.breakdown || []).map(b => ({ label: b.label, value: b.value, tip: b.tag ? b.why || TAG_TIPS[b.tag] || b.tag : null, mark: b.tag === 'EXACT' || b.tag === 'OBSERVED' ? '✓' : undefined })));
    bigRows.update((vm.biggest || []).map(m => ({ label: `#${m.turn} ${m.role === 'user' ? 'You' : vm.provider}: ${m.preview.slice(0, 32)}`, value: fmtK(m.tokens) })));
    renderSpark(vm, ready);
    show(att.el, (vm.attachmentFiles || []).length > 0);
    attRows.update((vm.attachmentFiles || []).map(f => ({
      label: f.name,
      value: f.tokens !== null ? `~${f.tokens.toLocaleString()}` : f.inText ? 'in message text' : 'cost unknown'
    })));
    totals.update([
      { label: 'Used', value: tokens(vm.usedTokens) },
      { label: 'Remaining', value: tokens(vm.remainingTokens) },
      { label: 'Window', value: vm.contextLimit ? vm.contextLimit.toLocaleString() : 'Unknown', tip: vm.contextLimit && vm.limitStatus === 'VERIFIED' ? null : (vm.contextLimit ? TAG_TIPS.UNVERIFIED : TAG_TIPS.UNKNOWN) }
    ]);

    const items = vm.hiddenItems || [];
    show(hid.el, items.length > 0);
    hidStack.update(items);
    setText(hidFine, `Read from ${vm.provider}'s own data. ≈ marks estimates; anything else ${vm.provider} adds on its servers is not visible.`);
    show(lim.el, (vm.limits || []).length > 0);
    limRows.update((vm.limits || []).map(l => ({ label: l.label, value: limitText(l) })));

    setText(diagWarn, vm.warning || '');
    diagRows.update([
      { label: 'Provider', value: vm.provider },
      { label: 'Model', value: model || '—' },
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
    setClass(confDot, `dot ${ready ? vm.confidenceLevel : 'LOW'}`);
    setText(confText, ready ? `${levelName(vm.confidenceLevel)} confidence · ${vm.confidence}%` : 'Reading…');
  }

  return { el, foot, update, setSettings(s) { cfg = s; } };
}
