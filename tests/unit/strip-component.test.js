/**
 * Unit Tests for StripComponent (ui/strip-component.js)
 */

import { StripComponent } from '../../src/ui/widget/strip-component.js';

class MockNode {
  constructor(tag, isSvg = false) {
    this.tagName = tag.toUpperCase();
    this.isSvg = isSvg;
    this.children = [];
    this.parentElement = null;
    this._attrs = {};
    this.style = {};
    this._textContent = '';
    this.hidden = false;
    this.type = '';
    this.dataset = {};
    this._className = '';
    this.classList = {
      _classes: new Set(),
      add: (...cls) => {
        for (const c of cls) {
          if (c) this.classList._classes.add(c);
        }
        this._syncFromClasses();
      },
      remove: (...cls) => {
        for (const c of cls) this.classList._classes.delete(c);
        this._syncFromClasses();
      },
      toggle: (c, force) => {
        const has = this.classList._classes.has(c);
        const next = typeof force === 'boolean' ? force : !has;
        if (next) this.classList._classes.add(c);
        else this.classList._classes.delete(c);
        this._syncFromClasses();
        return next;
      },
      contains: (c) => this.classList._classes.has(c)
    };
    this._listeners = {};
  }

  get className() {
    return this.isSvg ? { baseVal: this._className, toString: () => this._className } : this._className;
  }

  set className(val) {
    const s = typeof val === 'object' && val?.baseVal ? val.baseVal : String(val ?? '');
    this._className = s;
    this.classList._classes = new Set(s.split(/\s+/).filter(Boolean));
  }

  _syncFromClasses() {
    this._className = Array.from(this.classList._classes).join(' ');
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, val) {
    this._attrs[name] = String(val);
    if (name === 'class') {
      this.classList._classes = new Set(String(val).split(/\s+/).filter(Boolean));
      this._syncFromClasses();
    }
  }

  getAttribute(name) {
    return this._attrs[name] ?? null;
  }

  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }

  dispatchEvent(evt) {
    const list = this._listeners[evt.type] || [];
    for (const fn of list) fn(evt);
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map(c => c.textContent).join(' ');
  }

  set textContent(val) {
    this._textContent = String(val ?? '');
    this.children = [];
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  querySelectorAll(sel) {
    const out = [];
    const check = (node) => {
      let match = false;
      if (sel.startsWith('.')) {
        const c = sel.slice(1);
        match = node.classList?.contains?.(c);
      } else if (sel.startsWith('[')) {
        const m = sel.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]+)")?\]/);
        if (m) match = m[2] !== undefined ? node.getAttribute(m[1]) === m[2] : node.getAttribute(m[1]) !== null;
      } else {
        match = node.tagName.toLowerCase() === sel.toLowerCase();
      }
      if (match) out.push(node);
      for (const child of node.children) check(child);
    };
    for (const child of this.children) check(child);
    return out;
  }

  closest(sel) {
    let p = this;
    while (p) {
      if (sel.startsWith('.')) {
        if (p.classList?.contains?.(sel.slice(1))) return p;
      }
      p = p.parentElement;
    }
    return null;
  }
}

function setupMockDocument() {
  const listeners = {};
  const doc = {
    createElement: (tag) => new MockNode(tag, false),
    createElementNS: (ns, tag) => new MockNode(tag, true),
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); }
  };
  globalThis.document = doc;
  return doc;
}

export async function runStripComponentTests() {
  console.log('--- Running StripComponent Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; }
    else { console.error(`  ❌ [FAIL] ${name}`); failed++; }
  };

  const origDoc = globalThis.document;
  setupMockDocument();

  try {
    const parent = new MockNode('div');
    const comp = new StripComponent(parent);

    assert('Strip component mounts root, strip, drawer', Boolean(comp.root && comp.strip && comp.drawer));
    assert('Drawer is hidden by default', comp.drawer.hidden === true);

    // 1. Claude Data: 5h and Wk usage rows, 48% context, ~28 msgs left
    comp.render({
      rows: [
        { label: '5h', state: 'warn', percent: 67, resetsAt: Date.now() + 3600000, source: 'measured' },
        { label: 'Wk', state: 'ok', percent: 7, resetsAt: Date.now() + 100000000, source: 'measured' }
      ],
      context: { used: 96000, limit: 200000, source: 'estimated' },
      msgsLeft: 28,
      provider: 'Claude',
      breakdown: { user: 4000, assistant: 55000, system: 41000 },
      biggest: { role: 'assistant', turn: 2, tokens: 12000 }
    });

    assert('Strip displays left rows (2 rows)', comp.stripLeft.children.length === 2);
    assert('Msgs left rendered above ring for Claude', comp.ctxMsgs.textContent.includes('~28 msgs'));
    assert('Ring displays 48% with ok state', comp.ctxVal.textContent.includes('48%') && comp.ctxVal.classList.contains('ok'));
    assert('Drawer title shows context 96K / 200K · est.', comp.dTitle.textContent.includes('96K / 200K · est.'));
    assert('Drawer breakdown displays legend', comp.dLegUser.textContent.includes('You 2%') && comp.dLegAsst.textContent.includes('Claude & tools 28%'));
    assert('Drawer shows biggest item', comp.dBigVal.textContent.includes('12K'));

    // 1b. Zero context usage (B1 fix): empty ring, 0% across all segments, no 100% fallback
    comp.render({
      rows: [
        { label: '5h', state: 'ok', percent: 0, resetsAt: null, source: 'measured' },
        { label: 'Wk', state: 'ok', percent: 0, resetsAt: null, source: 'measured' }
      ],
      context: { used: 0, limit: 200000, source: 'estimated' },
      msgsLeft: 0,
      provider: 'Claude',
      breakdown: { user: 0, assistant: 0, system: 0 }
    });
    assert('Zero usage displays 0% ring with arc hidden', comp.ctxVal.textContent.includes('0%') && comp.ringArc.style.display === 'none');
    assert('Zero usage breakdown displays 0% for all segments',
      comp.dLegUser.textContent.includes('You 0%') &&
      comp.dLegAsst.textContent.includes('Claude & tools 0%') &&
      comp.dLegSys.textContent.includes('System 0%')
    );

    // 2. Danger threshold (> 80%) displays ⚠
    comp.render({
      rows: [
        { label: '5h', state: 'danger', percent: 85, resetsAt: Date.now() + 3600000, source: 'estimated' }
      ],
      context: { used: 180000, limit: 200000, source: 'estimated' },
      msgsLeft: 2,
      provider: 'Claude'
    });

    const pctRow = comp.stripLeft.querySelector('.u-pct');
    assert('Usage row at 85% includes ⚠ symbol', pctRow.textContent.includes('85% ⚠') && pctRow.classList.contains('danger'));
    assert('Estimated usage row gets hatched fill class', comp.stripLeft.querySelector('.u-bar-fill').classList.contains('hatched-danger'));
    assert('Ring displays 90% with warn/amber band', comp.ctxVal.textContent.includes('90%') && comp.ctxVal.classList.contains('warn'));

    // Test >90% (> 90% is danger / red)
    comp.render({
      rows: [{ label: '5h', state: 'danger', percent: 95, resetsAt: Date.now() + 3600000, source: 'estimated' }],
      context: { used: 190000, limit: 200000, source: 'estimated' },
      msgsLeft: 1,
      provider: 'Claude'
    });
    assert('Ring displays >90% (95%) with danger state', comp.ctxVal.classList.contains('danger'));

    // 3. Gemini: No message count, right note "resets in 2h 10m", row note "Heavy tasks use more"
    comp.render({
      rows: [
        { label: '5h', state: 'warn', percent: 50, resetsAt: Date.now() + 7200000, source: 'measured', note: 'Heavy tasks use more' },
        { label: 'Wk', state: 'ok', percent: 20, resetsAt: Date.now() + 86400000, source: 'measured' }
      ],
      context: { used: 30000, limit: 128000, source: 'estimated' },
      msgsLeft: null,
      rightNote: 'resets in 2h 10m',
      provider: 'Gemini'
    });

    assert('Gemini: msgsLeft is null, right note shows resets in 2h 10m', comp.ctxMsgs.textContent.includes('resets in 2h 10m'));
    assert('Gemini: usage row does not display heavy note', !comp.stripLeft.textContent.includes('Heavy tasks use more'));

    // 4. ChatGPT: Unlimited text row, colored context circle with percent
    comp.render({
      rows: [
        { label: 'Text', state: 'unlimited', source: 'measured', note: 'No limit · subject to safeguards' },
        { label: 'Uploads', state: 'ok', percent: 10, resetsAt: Date.now() + 3600000, source: 'measured' }
      ],
      context: { used: 12000, source: 'estimated' }, // No limit -> falls back to 128K for percent & color
      msgsLeft: null,
      provider: 'ChatGPT'
    });

    assert('ChatGPT shows text row "No limit · subject to safeguards"', comp.stripLeft.textContent.includes('No limit · subject to safeguards'));
    assert('ChatGPT context circle displays colored percent', comp.ctxVal.textContent.includes('%') && comp.ctxVal.classList.contains('ok'));
    assert('ChatGPT State C drawer title shows "~12K used · est."', comp.dTitle.textContent.includes('~12K used · est.'));

    // 5. ChatGPT State B (User Reference set)
    comp.render({
      rows: [
        { label: 'Text', state: 'unlimited', source: 'measured', note: 'No limit · subject to safeguards' }
      ],
      context: { used: 12000, refLimit: 128000, refType: 'user', source: 'estimated' },
      msgsLeft: null,
      provider: 'ChatGPT'
    });

    assert('State B ring displays percent against user reference', comp.ctxVal.textContent.includes('9%'));
    assert('State B drawer title shows "vs your 128K ref · est."', comp.dTitle.textContent.includes('vs your 128K ref · est.'));

    // 6. Adapter failure / empty rows and context hides the strip cleanly
    comp.render({ rows: [], context: null });
    assert('Empty data hides the strip', comp.strip.style.display === 'none');

    // 7. Drawer toggle interaction
    comp._toggleDrawer(true);
    assert('toggleDrawer(true) opens drawer and updates aria-expanded', comp.drawer.hidden === false && comp.strip.getAttribute('aria-expanded') === 'true');
    comp._toggleDrawer(false);
    assert('toggleDrawer(false) closes drawer', comp.drawer.hidden === true && comp.strip.getAttribute('aria-expanded') === 'false');

    // 8. "Consider a new chat" line in drawer
    // Context 80% measured -> should show
    comp.render({
      rows: [{ label: '5h', state: 'ok', percent: 30, source: 'measured' }],
      context: { used: 160000, limit: 200000, source: 'measured' }, // 80%
      provider: 'Claude'
    });
    assert('Consider new chat line shown at 80% measured context', comp.dNewChatRow.classList.contains('hide') === false);

    // Context 79% measured -> should hide
    comp.render({
      rows: [{ label: '5h', state: 'ok', percent: 30, source: 'measured' }],
      context: { used: 158000, limit: 200000, source: 'measured' }, // 79%
      provider: 'Claude'
    });
    assert('Consider new chat line hidden at 79% measured context', comp.dNewChatRow.classList.contains('hide') === true);

    // Context 80% estimated -> should hide (<85%)
    comp.render({
      rows: [{ label: '5h', state: 'ok', percent: 30, source: 'measured' }],
      context: { used: 160000, limit: 200000, source: 'estimated' }, // 80% est
      provider: 'Claude'
    });
    assert('Consider new chat line hidden at 80% estimated context', comp.dNewChatRow.classList.contains('hide') === true);

    // Context 85% estimated -> should show
    comp.render({
      rows: [{ label: '5h', state: 'ok', percent: 30, source: 'measured' }],
      context: { used: 170000, limit: 200000, source: 'estimated' }, // 85% est
      provider: 'Claude'
    });
    assert('Consider new chat line shown at 85% estimated context', comp.dNewChatRow.classList.contains('hide') === false);

    // 9. Pre-send draft estimate pill
    comp.setDraftEstimate(125);
    assert('setDraftEstimate(125) displays draft ≈ 125 tokens', comp.draftPill.textContent === 'draft ≈ 125 tokens' && !comp.draftPill.classList.contains('hide'));
    comp.setDraftEstimate(0);
    assert('setDraftEstimate(0) hides draft pill', comp.draftPill.classList.contains('hide'));

    // 10. Checkpoint export trigger
    let exportTriggered = false;
    comp.callbacks.onExportCheckpoint = () => { exportTriggered = true; };
    comp._exportCheckpoint();
    assert('_exportCheckpoint triggers onExportCheckpoint callback', exportTriggered === true);

  } finally {
    globalThis.document = origDoc;
  }

  return { passed, failed };
}
