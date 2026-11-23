/**
 * Context Monitor - Export Dialog & UI Wiring Test Suite
 */

import { slugifyTitle, ExportDialog } from '../../src/ui/widget/export-dialog.js';
import { StripComponent } from '../../src/ui/widget/strip-component.js';
import { createParagraphBlock, createUnknownBlock } from '../../src/engine/export/types.js';

// Minimal Mock DOM Node for headless testing of UI Dialog & StripComponent
class MockElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this._attrs = {};
    this.style = {};
    this.dataset = {};
    this.title = '';
    this._textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.type = '';
    this.classList = {
      _classes: new Set(),
      add: (...cls) => { for (const c of cls) if (c) this.classList._classes.add(c); },
      remove: (...cls) => { for (const c of cls) this.classList._classes.delete(c); },
      contains: (c) => this.classList._classes.has(c)
    };
    this._listeners = {};
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  setAttribute(name, val) {
    this._attrs[name] = String(val);
  }

  getAttribute(name) {
    return this._attrs[name] ?? null;
  }

  removeAttribute(name) {
    delete this._attrs[name];
  }

  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }

  removeEventListener(type, fn) {
    if (this._listeners[type]) {
      this._listeners[type] = this._listeners[type].filter(f => f !== fn);
    }
  }

  dispatchEvent(evt) {
    const list = this._listeners[evt.type] || [];
    for (const fn of list) fn(evt);
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map(c => c.textContent).join(' ');
  }

  set textContent(val) {
    this._textContent = String(val ?? '');
    this.children = [];
  }

  set innerHTML(html) {
    this._textContent = html;
  }

  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  querySelectorAll(sel) {
    const results = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (sel.startsWith('.')) {
          const cls = sel.slice(1);
          if (child.className && child.className.includes(cls)) results.push(child);
          else if (child.classList?.contains(cls)) results.push(child);
        } else if (sel.startsWith('#')) {
          if (child.id === sel.slice(1)) results.push(child);
        } else if (child.tagName.toLowerCase() === sel.toLowerCase()) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }
}

export function runExportDialogTests() {
  console.log('--- Running Export Dialog & UI Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name}`);
      failed++;
    }
  };

  // 1. Slugify Title
  {
    assert('slugifyTitle handles normal title',
      slugifyTitle('Performance Review and Analysis') === 'performance-review-and-analysis');

    assert('slugifyTitle strips special punctuation and emojis',
      slugifyTitle('Claude 3.5: Speed & Latency (v2) 🚀') === 'claude-35-speed-latency-v2');

    assert('slugifyTitle falls back on empty string or null',
      slugifyTitle('') === 'chat-export' && slugifyTitle(null) === 'chat-export');

    assert('slugifyTitle clamps to 50 characters',
      slugifyTitle('a'.repeat(75)).length === 50);
  }

  // 2. Dialog Component in Mock DOM
  const origDoc = globalThis.document;
  const origWin = globalThis.window;
  const origUrl = globalThis.URL;

  try {
    const mockBody = new MockElement('body');
    const mockWinListeners = {};

    globalThis.document = {
      createElement: (tag) => new MockElement(tag),
      createElementNS: (_, tag) => new MockElement(tag),
      body: mockBody,
      getElementById: () => null
    };

    globalThis.window = {
      addEventListener: (type, fn) => {
        if (!mockWinListeners[type]) mockWinListeners[type] = [];
        mockWinListeners[type].push(fn);
      },
      removeEventListener: (type, fn) => {
        if (mockWinListeners[type]) {
          mockWinListeners[type] = mockWinListeners[type].filter(f => f !== fn);
        }
      },
      dispatchEvent: (evt) => {
        const list = mockWinListeners[evt.type] || [];
        for (const fn of list) fn(evt);
      },
      open: () => ({ document: { open() {}, write() {}, close() {} } })
    };

    globalThis.URL = {
      createObjectURL: () => 'blob:mock-url',
      revokeObjectURL: () => {}
    };

    // Test A: Chat without tables -> Excel disabled
    {
      const chatWithoutTables = {
        title: 'Plain Chat',
        provider: 'Claude',
        model: 'Claude 3.5 Sonnet',
        source: 'api',
        messages: [
          { role: 'user', blocks: [createParagraphBlock('Hello')] }
        ]
      };

      const dialog = new ExportDialog({ data: chatWithoutTables, tables: [] });
      dialog.open(mockBody);

      assert('dialog mounts host container to body', mockBody.children.length === 1);
      assert('dialog selects markdown format by default when no tables', dialog.selectedFormat === 'markdown');

      const card = mockBody.children[0];
      const excelOpt = card.querySelector('.asp-format-excel');
      assert('excel option container exists in dialog', Boolean(excelOpt));

      const excelRadio = excelOpt?.querySelector('input');
      assert('excel radio is disabled when 0 tables exist', excelRadio?.disabled === true);

      // Close dialog
      dialog.close();
      assert('dialog.close removes container from body', mockBody.children.length === 0);
    }

    // Test B: Chat with tables & unsupported items -> Excel enabled & warning rendered
    {
      const chatWithTables = {
        title: 'Benchmark Review',
        provider: 'Claude',
        model: 'Claude 3.5 Sonnet',
        source: 'dom',
        messages: [
          {
            role: 'assistant',
            blocks: [
              createParagraphBlock('Analysis'),
              createUnknownBlock('canvas_widget', { summary: 'Interactive Canvas' })
            ]
          }
        ]
      };
      const tables = [{ sheetName: 'Benchmarks', headers: ['Metric'], rows: [['Latency']] }];

      const dialog = new ExportDialog({ data: chatWithTables, tables, defaultFormat: 'excel' });
      dialog.open(mockBody);

      assert('dialog respects defaultFormat: excel when tables exist', dialog.selectedFormat === 'excel');

      const card = mockBody.children[0];
      const excelOpt = card.querySelector('.asp-format-excel');
      const excelRadio = excelOpt?.querySelector('input');
      assert('excel radio is enabled when tables exist', excelRadio?.disabled === false);

      const unkNotice = card.querySelector('.asp-unsupported-notice');
      assert('unsupported block notice is displayed', Boolean(unkNotice) && unkNotice.textContent.includes('1 unsupported item(s)'));

      // Execution test
      let closed = false;
      dialog.onClose = () => { closed = true; };
      dialog.executeExport();
      assert('executeExport completes and invokes onClose callback', closed === true);
    }

    // Test C: StripComponent drawer Export button wiring
    {
      const shadowHost = new MockElement('div');
      let exportClicked = false;

      const comp = new StripComponent(shadowHost, {
        onExportClick: () => { exportClicked = true; }
      });

      assert('StripComponent creates dExport button in drawer header', Boolean(comp.dExport?.b));
      assert('dExport button has drawer-export class and aria-label',
        comp.dExport.b.classList.contains('drawer-export') &&
        comp.dExport.b.getAttribute('aria-label') === 'Export conversation');

      // Click event
      comp.dExport.b.dispatchEvent({ type: 'click', stopPropagation() {} });
      assert('clicking dExport button triggers onExportClick callback', exportClicked === true);
    }

  } finally {
    globalThis.document = origDoc;
    globalThis.window = origWin;
    globalThis.URL = origUrl;
  }

  return { passed, failed };
}
