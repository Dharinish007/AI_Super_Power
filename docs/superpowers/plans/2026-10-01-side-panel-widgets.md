# Side Panel + Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating in-page widget with a Chrome Side Panel (Context · Capsules · Skills · Settings), and leave two small, separately draggable widgets (Context, Capsule) on the chat page.

**Architecture:** The engine stays in the content script. The content script talks to the side panel over one `chrome.runtime` port per tab: it pushes the view state, and the panel sends commands (fill the chat box, read the page, count tokens). The UI pieces that both sides draw move into `ui/`. The build concatenates them into the content-script bundle, and also into a second bundle, `sidepanel/sidepanel.js`. Settings live in one `chrome.storage.local` object that both sides read.

**Tech Stack:** Plain JS (ES modules), Manifest V3, `chrome.sidePanel` (Chrome 116+), the existing regex concatenation bundler (`scripts/build.js`), the existing assert-style test runner (`npm test`), ESLint.

**Spec:** `docs/superpowers/specs/2026-10-01-side-panel-widgets-design.md`

## Global Constraints

- No new network requests, no API key, no server. Only one new permission: `sidePanel`.
- **Fill, never auto-send.** Nothing in this plan clicks a Send button or presses Enter.
- `"minimum_chrome_version": "116"`.
- Every number keeps its EXACT / OBSERVED / ESTIMATED / UNKNOWN label.
- Page-derived strings are only ever assigned as text, never as HTML (same rule as `overlay-ui.js`).
- Bundler rule: every `import` / `export` is a single line starting at column 0 (see the header of `scripts/build.js`).
- Settings defaults: both widgets on; Context widget fields `['tokens', 'percent', 'model', 'exchangesLeft']`; Capsule method `'ask-ai'`.
- Widgets never open the side panel unless Task 1's spike proves `chrome.sidePanel.open()` works from a widget click.
- After every task, all of these pass: `npm run build`, `npm test`, `npm run lint`, `npm run validate` (Definition of Done in `GEMINI.md`). If `scripts/validate-extension.js` rejects the new `side_panel` / `sidePanel` manifest entries, teach it about them in Task 1.
- Work on a branch: `git checkout -b feat/side-panel`. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `manifest.json` | modify | `side_panel`, `sidePanel` permission, minimum Chrome, version 1.1.0 |
| `background/service-worker.js` | modify | the toolbar icon opens the panel (no more `TOGGLE_OVERLAY`) |
| `sidepanel/sidepanel.html` | create | panel page shell |
| `sidepanel/main.js` | create | tab list, active-tab tracking, panel states, wiring |
| `sidepanel/sidepanel.js` | generated | panel bundle (by `scripts/build.js`) |
| `content/settings.js` | create | settings defaults, normalize, read, write |
| `content/panel-channel.js` | create | port protocol: `servePanel` (tab side), `connectPanel` (panel side), `panelStatus`, `isSupportedUrl` |
| `content/page-actions.js` | create | `createPage(adapter)`: the in-page implementation of the page interface |
| `content/capsule.js` | modify | add `captureCapsule` (the Capsule widget's flow) |
| `content/widget-state.js` | modify | add `widgetFields(vm, fields)` |
| `content/widgets.js` | create | `Widgets` class: Context pill, Capsule pill, `makeDraggable`, alerts, sidebar badges |
| `ui/dom.js` | create | DOM helpers moved out of `overlay-ui.js` |
| `ui/styles.js` | create | the `STYLES` string moved out of `overlay-ui.js` |
| `ui/capsule-panel.js` | create | `CapsulePanel` moved out of `overlay-ui.js`, now using the async page interface |
| `ui/context-view.js` | create | Context tab view (hero, sections, diagnostics) moved out of `ContextWidget` |
| `ui/settings-view.js` | create | Settings tab |
| `content/overlay-ui.js` | delete (Task 9) | replaced by `widgets.js` plus `ui/*` |
| `content/coordinator-common.js` | modify | remove `listenForToggle` |
| `content/content-main.js`, `content/provider-coordinator.js` | modify | use `Widgets` + `servePanel` instead of `ContextWidget` |
| `scripts/build.js` | modify | new modules; second bundle |
| `scripts/package-extension.js` | modify | ship `sidepanel/` |
| `tests/unit/settings.test.js`, `tests/unit/panel-channel.test.js`, `tests/unit/page-actions.test.js` | create | |
| `tests/unit/capsule.test.js`, `tests/unit/widget-state.test.js`, `tests/unit/bundle-integrity.test.js`, `tests/run-tests.js` | modify | |
| `PRIVACY.md`, `CHROMEWEBSTORE.md`, `CHANGELOG.md`, `README.md` | modify | |

### The page interface (used by Tasks 4, 5, 6, 8 and 9)

`CapsulePanel` and the Capsule widget never touch `document` directly. They receive a `page` object; every method is async:

```js
/**
 * @typedef {Object} Page
 * @property {string} provider                             'ChatGPT' | 'Claude' | 'Gemini'
 * @property {() => Promise<boolean>} hasConversation      an assistant reply exists on the page
 * @property {() => Promise<string>} takeSelection         selected chat text ('' when none)
 * @property {(text: string) => Promise<boolean>} fill     puts text in the chat box; false = box not found
 * @property {() => Promise<string>} latestReply           newest assistant reply's text ('' when none)
 * @property {() => Promise<Array<{role:string,text:string}>>} transcript
 * @property {(texts: string[]) => Promise<Array<number|null>>} countTokens
 * @property {(onFound: (capsule:{title:string,body:string}) => void) => Promise<() => void>} watchCapsule
 *           starts waiting for a Capsule in a new reply (ignores the one already on the page); resolves to a stop function
 * @property {() => Promise<boolean>} limitReached         the site's limit blocks new messages
 */
```

The in-page version is `createPage(adapter)` (Task 4). The panel's version is `connectPanel(...).page` (Task 6), which sends each call over the port.

---

### Task 1: Side panel shell + spike

**Files:**
- Modify: `manifest.json`, `background/service-worker.js`, `scripts/package-extension.js`
- Create: `sidepanel/sidepanel.html`, `sidepanel/main.js`

**Interfaces:**
- Produces: `sidepanel/sidepanel.html` loads `sidepanel.js`. In this task `sidepanel.js` is hand-written; Task 8 turns it into a generated bundle.

- [ ] **Step 1: Manifest.** Add to `manifest.json`:

```json
"minimum_chrome_version": "116",
"side_panel": { "default_path": "sidepanel/sidepanel.html" },
```
Add `"sidePanel"` to `permissions`. Change `action.default_title` to `"AI Context Monitor: open the side panel"`.

- [ ] **Step 2: Service worker.** In `background/service-worker.js`, replace the `chrome.action?.onClicked` block (the last 4 lines) with the code below. Update the header comment: "The toolbar icon opens the side panel."

```js
// Toolbar icon: opens the side panel (Chrome narrows the page to make room)
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
```

- [ ] **Step 3: Panel page.** Create `sidepanel/sidepanel.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Context Monitor</title>
</head>
<body>
  <div id="app">Open ChatGPT, Claude or Gemini</div>
  <script type="module" src="sidepanel.js"></script>
</body>
</html>
```
Create `sidepanel/main.js` with a one-line placeholder module, then copy it to `sidepanel/sidepanel.js` (Task 8 replaces both):

```js
// Side panel entry. Built into sidepanel/sidepanel.js by scripts/build.js (Task 8).
```

- [ ] **Step 4: Packager.** In `scripts/package-extension.js`, add the panel page and the script it loads to `filesToInclude`:

```js
  ...(manifest.side_panel ? [manifest.side_panel.default_path, path.posix.join(path.posix.dirname(manifest.side_panel.default_path), 'sidepanel.js')] : []),
```

- [ ] **Step 5: Spike: can a widget click open the panel?** Temporarily add this listener to the service worker:

```js
chrome.runtime.onMessage.addListener((m, sender) => { if (m?.type === 'SPIKE_OPEN_PANEL') chrome.sidePanel.open({ tabId: sender.tab.id }).catch(e => console.warn('spike', e.message)); });
```
On chatgpt.com, load the unpacked extension. Run `chrome.runtime.sendMessage({type:'SPIKE_OPEN_PANEL'})` from a click handler in the existing widget (temporarily add `onclick` to the pill). Check the service worker console. Write the result into the spec's "Opening the panel from a widget" paragraph: **works**, or **fails with "may only be called in response to a user gesture"**. Then remove the spike code.

- [ ] **Step 6: Manual check.** Reload the extension. Clicking the icon opens the panel on the right and ChatGPT narrows. The old widget still shows (it's removed in Task 9). The badge still works.

- [ ] **Step 7: Verify and commit.**

Run: `npm run lint && npm test && npm run pack`. Expected: all pass; the pack log lists `sidepanel/sidepanel.html` and `sidepanel/sidepanel.js`.

```bash
git add manifest.json background/service-worker.js sidepanel scripts/package-extension.js docs/superpowers/specs/2026-10-01-side-panel-widgets-design.md
git commit -m "feat: side panel shell; toolbar icon opens it"
```

---

### Task 2: Settings module

**Files:**
- Create: `content/settings.js`, `tests/unit/settings.test.js`
- Modify: `tests/run-tests.js`

**Interfaces:**
- Produces:
  - `SETTINGS_KEY = 'settings'`
  - `CONTEXT_FIELDS: Array<{key, label}>`
  - `DEFAULT_SETTINGS`
  - `normalizeSettings(raw) → Settings`
  - `readSettings(area) → Promise<Settings>`
  - `writeSettings(area, patch) → Promise<Settings>`

- [ ] **Step 1: Write the failing test.** Create `tests/unit/settings.test.js`:

```js
/** Unit Tests for content/settings.js: defaults, repair of bad values, partial writes. */

import { SETTINGS_KEY, DEFAULT_SETTINGS, CONTEXT_FIELDS, normalizeSettings, readSettings, writeSettings } from '../../content/settings.js';

function fakeArea(init = {}) {
  const data = structuredClone(init);
  return { data, async get(k) { return k in data ? { [k]: structuredClone(data[k]) } : {}; }, async set(o) { Object.assign(data, structuredClone(o)); } };
}

export async function runSettingsTests() {
  console.log('--- Running Settings Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => { if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; } else { console.error(`  ❌ [FAIL] ${name}`); failed++; } };

  const d = normalizeSettings(undefined);
  assert('Defaults: both widgets on', d.widgets.context.enabled === true && d.widgets.capsule.enabled === true);
  assert('Defaults: four Context fields', JSON.stringify(d.widgets.context.fields) === '["tokens","percent","model","exchangesLeft"]');
  assert('Defaults: Capsule method ask-ai, alerts on, theme auto', d.capsule.method === 'ask-ai' && d.context.alerts === true && d.display.theme === 'auto');
  assert('Defaults are not shared objects', normalizeSettings({}).widgets !== DEFAULT_SETTINGS.widgets);

  const bad = normalizeSettings({ widgets: { context: { enabled: 'no', fields: ['tokens', 'nope', 'tokens', 7] }, capsule: null }, capsule: { method: 'api-key' }, display: { theme: 'pink', compact: 1 } });
  assert('Bad enabled -> default', bad.widgets.context.enabled === true && bad.widgets.capsule.enabled === true);
  assert('Unknown / duplicate fields dropped', JSON.stringify(bad.widgets.context.fields) === '["tokens"]');
  assert('Unknown method -> ask-ai', bad.capsule.method === 'ask-ai');
  assert('Bad theme -> auto; compact must be boolean', bad.display.theme === 'auto' && bad.display.compact === false);
  assert('Empty field list is allowed', normalizeSettings({ widgets: { context: { fields: [] } } }).widgets.context.fields.length === 0);
  assert('Every field key has a label', CONTEXT_FIELDS.every(f => f.key && f.label));

  const area = fakeArea();
  assert('Read with nothing stored = defaults', (await readSettings(area)).capsule.method === 'ask-ai');
  const w = await writeSettings(area, { widgets: { capsule: { enabled: false } } });
  assert('Write merges a partial patch', w.widgets.capsule.enabled === false && w.widgets.context.enabled === true);
  assert('Write stores the normalized object', area.data[SETTINGS_KEY].widgets.capsule.enabled === false);
  const w2 = await writeSettings(area, { capsule: { method: 'quick' } });
  assert('Second write keeps the first', w2.widgets.capsule.enabled === false && w2.capsule.method === 'quick');
  assert('Read survives a throwing area', (await readSettings({ get: () => { throw new Error('x'); } })).capsule.method === 'ask-ai');

  return { passed, failed };
}
```
Register it in `tests/run-tests.js`: add `import { runSettingsTests } from './unit/settings.test.js';` and `runSettingsTests,` to `SUITES`.

- [ ] **Step 2: Run, expect FAIL.** Run: `npm test`. Expected: the run fails with a "Cannot find module ... content/settings.js" error.

- [ ] **Step 3: Implement.** Create `content/settings.js`:

```js
/**
 * Context Monitor - Settings
 *
 * One object in chrome.storage.local, read by the side panel and by the widgets on every site. Reads
 * always go through normalizeSettings, so a missing, old or hand-edited value never breaks the UI.
 */

export const SETTINGS_KEY = 'settings';

/** Fields the Context widget can show, in display order. */
export const CONTEXT_FIELDS = [
  { key: 'tokens', label: 'Tokens used / window' },
  { key: 'percent', label: '% of window' },
  { key: 'model', label: 'Model' },
  { key: 'exchangesLeft', label: 'Exchanges left' },
  { key: 'limits', label: 'Plan usage limits' },
  { key: 'alert', label: 'Alert message' }
];

const CAPSULE_METHODS = ['ask-ai', 'quick'];
const THEMES = ['auto', 'dark', 'light'];

export const DEFAULT_SETTINGS = Object.freeze({
  widgets: { context: { enabled: true, fields: ['tokens', 'percent', 'model', 'exchangesLeft'] }, capsule: { enabled: true } },
  capsule: { method: 'ask-ai' },
  context: { alerts: true },
  display: { theme: 'auto', compact: false, badges: true }
});

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const oneOf = (v, list) => (list.includes(v) ? v : list[0]);

/** @returns {typeof DEFAULT_SETTINGS} a fresh, valid settings object */
export function normalizeSettings(raw) {
  const r = obj(raw);
  const w = obj(r.widgets);
  const wc = obj(w.context);
  const keys = CONTEXT_FIELDS.map(f => f.key);
  const fields = Array.isArray(wc.fields) ? [...new Set(wc.fields.filter(k => keys.includes(k)))] : [...DEFAULT_SETTINGS.widgets.context.fields];
  const d = obj(r.display);
  return {
    widgets: { context: { enabled: bool(wc.enabled, true), fields }, capsule: { enabled: bool(obj(w.capsule).enabled, true) } },
    capsule: { method: oneOf(obj(r.capsule).method, CAPSULE_METHODS) },
    context: { alerts: bool(obj(r.context).alerts, true) },
    display: { theme: oneOf(d.theme, THEMES), compact: bool(d.compact, false), badges: bool(d.badges, true) }
  };
}

/** @param {{ get: Function }} area chrome.storage.local (or a fake) */
export async function readSettings(area) {
  try { return normalizeSettings((await area.get(SETTINGS_KEY))?.[SETTINGS_KEY]); } catch (_) { return normalizeSettings(); }
}

/** Merges `patch` (any subset, two levels deep) into the stored settings; returns the result. */
export async function writeSettings(area, patch) {
  const cur = await readSettings(area);
  const p = obj(patch);
  const next = normalizeSettings({
    widgets: { context: { ...cur.widgets.context, ...obj(obj(p.widgets).context) }, capsule: { ...cur.widgets.capsule, ...obj(obj(p.widgets).capsule) } },
    capsule: { ...cur.capsule, ...obj(p.capsule) },
    context: { ...cur.context, ...obj(p.context) },
    display: { ...cur.display, ...obj(p.display) }
  });
  await area.set({ [SETTINGS_KEY]: next });
  return next;
}
```

- [ ] **Step 4: Run, expect PASS.** Run: `npm test`. Expected: the Settings suite passes, and the run ends with `Total Failed: 0`.

- [ ] **Step 5: Commit.**

```bash
git add content/settings.js tests/unit/settings.test.js tests/run-tests.js
git commit -m "feat: settings module with defaults and repair"
```

---

### Task 3: Move the shared UI helpers and styles to `ui/`

This is a move with no behaviour change. It lets the side panel bundle reuse the same helpers and look.

**Files:**
- Create: `ui/dom.js`, `ui/styles.js`
- Modify: `content/overlay-ui.js`, `scripts/build.js`

**Interfaces:**
- Produces:
  - `ui/dom.js` exports `h, icon, iconButton, approx, TAG_TIPS, Section, RowList, HiddenStack, textButton, download, setText, setAttr, setClass, show, fmtK, fmtInt, levelName, reducedMotion, ICONS`, plus every other module-level helper that `overlay-ui.js` uses from `CapsulePanel` or `ContextWidget`.
  - `ui/styles.js` exports `STYLES`.

- [ ] **Step 1: Move the code.** Cut `const STYLES = \`...\`` (`overlay-ui.js`, from line 28 to the closing backtick before `const MARGIN`) into `ui/styles.js` as `export const STYLES = \`...\`;`. Cut `ICONS` and every helper function from `const ICONS` down to just before `function CapsulePanel` into `ui/dom.js`, exporting each one. Also search the rest of the file for small helpers defined elsewhere (`setText`, `setAttr`, `setClass`, `show`, `fmtK`, `fmtInt`, `levelName`, `reducedMotion`) and move them too:

Run: `grep -n "^function \|^const [a-zA-Z]* = (" content/overlay-ui.js`

Leave `MARGIN`, `TOP_SAFE`, `SNAP_Y`, `DRAG_THRESHOLD`, `DEFAULT_POS` and `THEMES` in `overlay-ui.js` (they move to `widgets.js` in Task 9).

- [ ] **Step 2: Import them.** At the top of `overlay-ui.js` add single-line imports:

```js
import { STYLES } from '../ui/styles.js';
import { h, icon, iconButton, approx, TAG_TIPS, Section, RowList, HiddenStack, textButton, download, setText, setAttr, setClass, show, fmtK, fmtInt, levelName, reducedMotion, ICONS } from '../ui/dom.js';
```
List exactly the names you moved; ESLint (`no-undef`, `no-unused-vars`) tells you if one is missing or extra.

- [ ] **Step 3: Bundle order.** In `scripts/build.js` `MODULES`, insert `'ui/dom.js', 'ui/styles.js',` immediately before `'content/overlay-ui.js'`.

- [ ] **Step 4: Verify.** Run: `npm run build && npm run lint && npm test`. Expected: all pass (`bundle-integrity` confirms the committed bundle matches its sources). Load the unpacked extension on chatgpt.com: the widget looks and works exactly as before.

- [ ] **Step 5: Commit.**

```bash
git add ui content/overlay-ui.js content/content-script.js scripts/build.js
git commit -m "refactor: move shared UI helpers and styles to ui/"
```

---

### Task 4: The page interface, and `CapsulePanel` on it

After this task, `CapsulePanel` works from anywhere: it only talks to a `Page`.

**Files:**
- Create: `content/page-actions.js`, `ui/capsule-panel.js`, `tests/unit/page-actions.test.js`
- Modify: `content/overlay-ui.js`, `scripts/build.js`, `tests/run-tests.js`

**Interfaces:**
- Consumes: from `content/capsule.js`: `readLatestCapsule`, `latestReplyText`, `readTranscript`, `insertText`, `chatLimitReached`.
- Produces: `createPage(adapter, doc = document) → Page` (see "The page interface"); `CapsulePanel(parent, { kind, storage, page, toast, reveal }) → { view, refresh, setView, capture, stop }` in `ui/capsule-panel.js`.

- [ ] **Step 1: Write the failing test.** Create `tests/unit/page-actions.test.js`:

```js
/** Unit Tests for content/page-actions.js: the in-page Page used by CapsulePanel and the widgets. */

import { createPage } from '../../content/page-actions.js';
import { CAPSULE_START, CAPSULE_END } from '../../content/capsule.js';

/** Minimal document: replies / user turns by selector, a chat box, a MutationObserver stand-in. */
function fakeDoc({ replies = [], users = [], input = null } = {}) {
  const mk = (role) => (t) => ({ innerText: t, parentElement: null, matches: (s) => s === role, querySelectorAll: () => [] });
  const nodes = { R: replies.map(mk('R')), U: users.map(mk('U')) };
  return {
    nodes, body: {},
    querySelector: (s) => (s === 'R' ? nodes.R[0] || null : null),
    querySelectorAll: (s) => (s === 'R' ? nodes.R : s === 'U' ? nodes.U : s.includes('R') ? [...nodes.U, ...nodes.R] : []),
    getSelection: () => ({ toString: () => '  picked  ' }),
    input
  };
}
const capsuleText = (t) => `${CAPSULE_START}\nTitle: ${t}\n## Goal\ng\n${CAPSULE_END}`;

export async function runPageActionsTests() {
  console.log('--- Running Page Actions Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => { if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; } else { console.error(`  ❌ [FAIL] ${name}`); failed++; } };

  const empty = createPage({ provider: 'X', replySelector: 'R', userSelector: 'U', findInput: () => null }, fakeDoc());
  assert('No reply -> no conversation', (await empty.hasConversation()) === false);
  assert('Fill without a chat box -> false', (await empty.fill('hi')) === false);
  assert('Latest reply empty', (await empty.latestReply()) === '');
  assert('countTokens without a counter -> nulls', JSON.stringify(await empty.countTokens(['a', 'b'])) === '[null,null]');

  const doc = fakeDoc({ replies: ['hello'] });
  const page = createPage({ provider: 'X', replySelector: 'R', userSelector: 'U', findInput: () => null, countTokens: (t) => t.length }, doc);
  assert('Reply -> conversation', (await page.hasConversation()) === true);
  assert('Selection trimmed', (await page.takeSelection()) === 'picked');
  assert('countTokens maps each text', JSON.stringify(await page.countTokens(['ab', 'abc'])) === '[2,3]');
  assert('Provider passed through', page.provider === 'X');

  // watchCapsule ignores the Capsule already on the page, reports the new one once, and stops
  doc.nodes.R.push({ innerText: capsuleText('Old'), parentElement: null, matches: (s) => s === 'R', querySelectorAll: () => [] });
  let observerCb = null;
  const observed = [];
  globalThis.MutationObserver = class { constructor(cb) { observerCb = cb; } observe() { observed.push(1); } disconnect() { observerCb = null; } };
  const found = [];
  const stop = await page.watchCapsule((c) => found.push(c.title));
  observerCb?.(); await new Promise(r => setTimeout(r, 600));
  assert('Old Capsule ignored', found.length === 0 && observed.length === 1);
  doc.nodes.R.push({ innerText: capsuleText('New'), parentElement: null, matches: (s) => s === 'R', querySelectorAll: () => [] });
  observerCb?.(); await new Promise(r => setTimeout(r, 600));
  assert('New Capsule reported once, then watching stops', JSON.stringify(found) === '["New"]' && observerCb === null);
  stop();
  delete globalThis.MutationObserver;

  return { passed, failed };
}
```
Register `runPageActionsTests` in `tests/run-tests.js`.

- [ ] **Step 2: Run, expect FAIL.** Run: `npm test`. Expected: the run fails with "Cannot find module ... page-actions.js".

- [ ] **Step 3: Implement `content/page-actions.js`.** This is the watcher logic moved from `CapsulePanel.startWaiting` (`overlay-ui.js` ~578-595):

```js
/**
 * Context Monitor - Page actions
 *
 * The one place the UI touches the AI site's page: read the chat, fill the chat box, wait for a
 * Capsule. CapsulePanel and the widgets call these through the Page interface (all async), so the
 * side panel can make the same calls over the panel channel (content/panel-channel.js).
 */

import { readLatestCapsule, latestReplyText, readTranscript, insertText, chatLimitReached } from './capsule.js';

/**
 * @param {{ provider: string, findInput: () => Element|null, replySelector: string|null, userSelector?: string|null, countTokens?: (t: string) => number }} adapter
 * @param {Document} [doc]
 */
export function createPage(adapter, doc = document) {
  const { replySelector, userSelector } = adapter;
  return {
    provider: adapter.provider,
    async hasConversation() { return Boolean(replySelector && doc.querySelector(replySelector)); },
    async takeSelection() { return String(doc.getSelection?.()?.toString() || '').trim(); },
    async fill(text) { const input = adapter.findInput(); return Boolean(input && insertText(input, text)); },
    async latestReply() { return replySelector ? latestReplyText(doc, replySelector) : ''; },
    async transcript() { return readTranscript(doc, userSelector, replySelector); },
    async countTokens(texts) {
      return texts.map((t) => { try { return adapter.countTokens ? adapter.countTokens(t) : null; } catch (_) { return null; } });
    },
    async limitReached() { return chatLimitReached(doc); },
    /** Waits for a Capsule in a new reply (at most one read per 500 ms while it streams); reports it once. */
    async watchCapsule(onFound) {
      const ignoreBody = readLatestCapsule(doc, replySelector)?.body ?? null;
      let timer = null;
      const observer = new MutationObserver(() => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          const capsule = readLatestCapsule(doc, replySelector, ignoreBody);
          if (!capsule) return;
          stop();
          onFound(capsule);
        }, 500);
      });
      const stop = () => { clearTimeout(timer); observer.disconnect(); };
      observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
      return stop;
    }
  };
}
```
Check `chatLimitReached`'s real signature in `content/capsule.js` (`grep -n "export function chatLimitReached" content/capsule.js`) and match it. If it needs the latest view state rather than the document, make `limitReached` read `adapter.getLimitReached?.() ?? false` instead, and pass `getLimitReached` from the coordinators in Task 9.

- [ ] **Step 4: Move `CapsulePanel` to `ui/capsule-panel.js` and make it async.** Cut `function CapsulePanel` (`overlay-ui.js` 414–~868) into `ui/capsule-panel.js` as `export function CapsulePanel(parent, ctx)`. Rewrite each page touch as a `ctx.page` call:

| Before (sync, `document`) | After |
|---|---|
| `!ctx.replySelector \|\| !document.querySelector(ctx.replySelector)` | `!(await ctx.page.hasConversation())` |
| `takeSelection()` (reads `window.getSelection`) | `await ctx.page.takeSelection()` |
| `const input = ctx.findInput(); input && insertText(input, X)` | `await ctx.page.fill(X)` |
| `readLatestCapsule(document, ctx.replySelector)` + `startWaiting(ignoreBody, from)` + `MutationObserver` | `watcher = { from, stop: await ctx.page.watchCapsule((c) => { draftFrom(c, from); ctx.reveal(); ctx.toast('Capsule ready: review and save'); }) }` |
| `stopWaiting()` | `watcher?.stop(); watcher = null; mode('idle')` |
| `latestReplyText(document, ctx.replySelector)` | `await ctx.page.latestReply()` |
| `readTranscript(document, ctx.userSelector, ctx.replySelector)` | `await ctx.page.transcript()` |
| `ctx.countTokens(text)` (sync) | `(await ctx.page.countTokens([text]))[0]` |
| `ctx.provider` | `ctx.page.provider` |

Make the click handlers `async`. `tokensOf` becomes async: render the card without the cost line, then add the line when the count arrives. Keep the per-version cache, but cache the Promise instead of the number. Keep all user-visible wording identical. `renderList`'s picked-cost line does the same: set it after `await`.

- [ ] **Step 5: Wire it into the old widget.** In `overlay-ui.js`, import `CapsulePanel` from `../ui/capsule-panel.js` and `createPage` from `./page-actions.js`. In the constructor, build `this.page = createPage(this.adapter)`, and pass `{ kind, storage, page: this.page, toast, reveal }` where it currently passes `findInput`/`replySelector`/`countTokens`/`provider`. In `scripts/build.js` `MODULES`, add `'content/page-actions.js', 'ui/capsule-panel.js',` right after `'content/capsule.js'`.

- [ ] **Step 6: Verify.** Run: `npm run build && npm run lint && npm test`. Expected: all pass. On chatgpt.com, check by hand: Create Capsule fills the box → send → the draft opens; Quick, Hand-off, Use last reply, Insert, Insert all, Update, and cost lines all still work.

- [ ] **Step 7: Commit.**

```bash
git add content/page-actions.js ui/capsule-panel.js content/overlay-ui.js content/content-script.js scripts/build.js tests/unit/page-actions.test.js tests/run-tests.js
git commit -m "refactor: CapsulePanel talks to the page through an async Page"
```

---

### Task 5: `captureCapsule`, the Capsule widget's one-click flow

**Files:**
- Modify: `content/capsule.js`, `tests/unit/capsule.test.js`

**Interfaces:**
- Consumes: `Page`, `CapsuleStore`, `buildCapsulePrompt`, `buildQuickCapsule`.
- Produces: `captureCapsule({ method, page, store, onStatus }) → Promise<{ cancel: () => void }>`. `onStatus(s)` receives one of:
  - `{ state: 'waiting' }` (prompt filled; the user must press Enter)
  - `{ state: 'saved', title, quick: boolean, reason?: 'limit' }`
  - `{ state: 'error', text }`
  - `{ state: 'cancelled' }`

- [ ] **Step 1: Write the failing test.** Append to `runCapsuleTests` in `tests/unit/capsule.test.js`, before `return { passed, failed };`. Add `captureCapsule` to the import list.

```js
  // captureCapsule: the Capsule widget's one click
  const fakePage = (o = {}) => {
    const p = { provider: 'ChatGPT', filled: null, watchers: [],
      hasConversation: async () => o.conv ?? true, takeSelection: async () => o.sel ?? '', limitReached: async () => o.limit ?? false,
      transcript: async () => o.transcript ?? [{ role: 'user', text: 'Build a login page' }, { role: 'assistant', text: 'Sure, here it is' }],
      fill: async (t) => { p.filled = t; return o.fill ?? true; },
      watchCapsule: async (cb) => { p.watchers.push(cb); return () => { p.stopped = true; }; } };
    return p;
  };
  const statuses = (arr) => (s) => arr.push(s);

  const cs1 = new CapsuleStore(fakeArea()); const st1 = []; const p1 = fakePage();
  await captureCapsule({ method: 'ask-ai', page: p1, store: cs1, onStatus: statuses(st1) });
  assert('Ask AI: prompt filled, waiting', p1.filled.includes(CAPSULE_START) && st1[0].state === 'waiting');
  p1.watchers[0]({ title: 'Login', body: '## Goal\nlogin' });
  await new Promise(r => setTimeout(r, 0));
  const saved1 = await cs1.list();
  assert('Ask AI: reply saved automatically with its title and site', saved1.length === 1 && saved1[0].title === 'Login' && saved1[0].source === 'ChatGPT');
  assert('Ask AI: saved status', st1.at(-1).state === 'saved' && st1.at(-1).title === 'Login' && st1.at(-1).quick === false);

  const cs2 = new CapsuleStore(fakeArea()); const st2 = []; const p2 = fakePage();
  await captureCapsule({ method: 'quick', page: p2, store: cs2, onStatus: statuses(st2) });
  assert('Quick: saved at once, nothing filled', p2.filled === null && (await cs2.list()).length === 1 && st2.at(-1).quick === true);

  const cs3 = new CapsuleStore(fakeArea()); const st3 = []; const p3 = fakePage({ limit: true });
  await captureCapsule({ method: 'ask-ai', page: p3, store: cs3, onStatus: statuses(st3) });
  assert('Limit reached: Ask AI falls back to Quick and says why', p3.filled === null && st3.at(-1).state === 'saved' && st3.at(-1).reason === 'limit');

  const st4 = []; await captureCapsule({ method: 'ask-ai', page: fakePage({ conv: false }), store: new CapsuleStore(fakeArea()), onStatus: statuses(st4) });
  assert('No conversation -> error', st4.at(-1).state === 'error' && st4.at(-1).text === 'Open a conversation first');
  const st5 = []; await captureCapsule({ method: 'ask-ai', page: fakePage({ fill: false }), store: new CapsuleStore(fakeArea()), onStatus: statuses(st5) });
  assert('Chat box missing -> error', st5.at(-1).state === 'error' && st5.at(-1).text === 'Chat box not found');

  const st6 = []; const p6 = fakePage();
  const run6 = await captureCapsule({ method: 'ask-ai', page: p6, store: new CapsuleStore(fakeArea()), onStatus: statuses(st6) });
  run6.cancel();
  assert('Cancel stops waiting', p6.stopped === true && st6.at(-1).state === 'cancelled');

  const cs7 = new CapsuleStore(fakeArea()); const st7 = [];
  await captureCapsule({ method: 'quick', page: fakePage({ sel: 'Only this part\nmore' }), store: cs7, onStatus: statuses(st7) });
  assert('Quick with a selection: selection kept as-is', (await cs7.list())[0].body === 'Only this part\nmore' && (await cs7.list())[0].title === 'Only this part');
```

- [ ] **Step 2: Run, expect FAIL.** Run: `npm test`. Expected: the run fails with "captureCapsule is not exported" (or a SyntaxError on the import).

- [ ] **Step 3: Implement.** Append to `content/capsule.js`. The Quick path is the same logic as CapsulePanel's `quickBtn` handler:

```js
/**
 * The Capsule widget's one click. 'ask-ai' fills the chat box with the Capsule prompt (the user sends
 * it) and saves the Capsule found in the reply; 'quick' builds it from the page and saves at once.
 * When the site's limit is reached, 'ask-ai' cannot work and Quick is used instead.
 * @param {{ method: 'ask-ai'|'quick', page: Object, store: CapsuleStore, onStatus: (s: Object) => void }} o
 * @returns {Promise<{ cancel: () => void }>}
 */
export async function captureCapsule({ method, page, store, onStatus }) {
  const none = { cancel() {} };
  if (!(await page.hasConversation())) { onStatus({ state: 'error', text: 'Open a conversation first' }); return none; }
  const selection = await page.takeSelection();
  const limit = await page.limitReached();
  const save = async (capsule, quick, reason) => {
    try {
      const saved = await store.save({ ...capsule, source: page.provider });
      onStatus({ state: 'saved', title: saved?.title ?? capsule.title, quick, ...(reason ? { reason } : {}) });
    } catch (_) { onStatus({ state: 'error', text: 'Save failed' }); }
  };
  if (method === 'quick' || limit) {
    const capsule = selection
      ? { title: selection.split('\n').find(l => l.trim()).trim().slice(0, 60), body: selection }
      : buildQuickCapsule(await page.transcript());
    if (!capsule) { onStatus({ state: 'error', text: 'Open a conversation first' }); return none; }
    await save(capsule, true, limit && method !== 'quick' ? 'limit' : undefined);
    return none;
  }
  if (!(await page.fill(buildCapsulePrompt(selection)))) { onStatus({ state: 'error', text: 'Chat box not found' }); return none; }
  const stop = await page.watchCapsule((capsule) => save(capsule, false));
  onStatus({ state: 'waiting' });
  return { cancel() { stop(); onStatus({ state: 'cancelled' }); } };
}
```
Check what `CapsuleStore.save` returns (`grep -n "async save" -A15 content/capsule.js`). If it doesn't return the saved item, use `capsule.title`.

- [ ] **Step 4: Run, expect PASS.** Run: `npm run build && npm test`. Expected: `Total Failed: 0`.

- [ ] **Step 5: Commit.**

```bash
git add content/capsule.js content/content-script.js tests/unit/capsule.test.js
git commit -m "feat: captureCapsule - one-click Capsule with the chosen method"
```

---

### Task 6: Panel channel (the port protocol)

**Files:**
- Create: `content/panel-channel.js`, `tests/unit/panel-channel.test.js`
- Modify: `content/content-main.js`, `content/provider-coordinator.js`, `scripts/build.js`, `tests/run-tests.js`

**Interfaces:**
- Consumes: `Page` (Task 4), `providerForHost` from `content/providers.js`.
- Produces:
  - `PANEL_PORT = 'panel'`
  - `isSupportedUrl(url) → boolean`
  - `panelStatus({ url, connected, ready }) → 'unsupported'|'reload'|'reading'|'live'`
  - `servePanel({ runtime, page, getState, actions }) → { push(state) }`, where `actions` is `{ refresh(), diagnostics() → Object, exportChat(format) → string }`
  - `connectPanel({ tabs, tabId, onState, onCapsule, onDisconnect }) → { page: Page, call(type, args) → Promise, disconnect() }`
- Messages:
  - tab → panel: `{ type: 'STATE', state }`, `{ type: 'CAPSULE', id, capsule }`, `{ type: 'REPLY', id, ok, value | error }`
  - panel → tab: `{ type: 'CALL', id, name, args }`, where `name` is a `Page` method, or `'refresh' | 'diagnostics' | 'exportChat'`

- [ ] **Step 1: Write the failing test.** Create `tests/unit/panel-channel.test.js`:

```js
/** Unit Tests for content/panel-channel.js: URL support, panel states, the port protocol over fake ports. */

import { PANEL_PORT, isSupportedUrl, panelStatus, servePanel, connectPanel } from '../../content/panel-channel.js';

/** Two linked fake ports, like chrome.runtime.Port. */
function portPair() {
  const mk = () => ({ name: PANEL_PORT, _m: [], _d: [], onMessage: { addListener(f) { this.f = f; } }, onDisconnect: { addListener(f) { this.f = f; } } });
  const a = mk(); const b = mk();
  a.postMessage = (m) => queueMicrotask(() => b.onMessage.f?.(structuredClone(m)));
  b.postMessage = (m) => queueMicrotask(() => a.onMessage.f?.(structuredClone(m)));
  a.disconnect = () => queueMicrotask(() => b.onDisconnect.f?.());
  b.disconnect = () => queueMicrotask(() => a.onDisconnect.f?.());
  return [a, b];
}
const tick = () => new Promise(r => setTimeout(r, 0));

export async function runPanelChannelTests() {
  console.log('--- Running Panel Channel Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => { if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; } else { console.error(`  ❌ [FAIL] ${name}`); failed++; } };

  assert('Supported sites', ['https://chatgpt.com/c/1', 'https://chat.openai.com/', 'https://claude.ai/chat/x', 'https://gemini.google.com/app'].every(isSupportedUrl));
  assert('Other sites / no URL not supported', !isSupportedUrl('https://example.com') && !isSupportedUrl(undefined) && !isSupportedUrl('chrome://newtab'));
  assert('Status: other site', panelStatus({ url: 'https://example.com', connected: false }) === 'unsupported');
  assert('Status: supported, no script', panelStatus({ url: 'https://claude.ai/', connected: false }) === 'reload');
  assert('Status: connected, no data', panelStatus({ url: 'https://claude.ai/', connected: true, ready: false }) === 'reading');
  assert('Status: live', panelStatus({ url: 'https://claude.ai/', connected: true, ready: true }) === 'live');

  // Tab side
  let onConnect = null;
  const runtime = { onConnect: { addListener(f) { onConnect = f; } } };
  const page = { provider: 'Claude', fill: async (t) => t === 'ok', countTokens: async (ts) => ts.map(t => t.length),
    watchCapsule: async (cb) => { page.cb = cb; return () => { page.stopped = true; }; } };
  let refreshed = 0;
  const server = servePanel({ runtime, page, getState: () => ({ ready: true, usedTokens: 5 }),
    actions: { refresh: () => { refreshed++; }, diagnostics: () => ({ v: 1 }), exportChat: (f) => `chat.${f}` } });

  // Panel side
  const [tabEnd, panelEnd] = portPair();
  const states = [];
  const tabs = { connect: (id, o) => { assert('Connects to the right tab with the panel port name', id === 7 && o.name === PANEL_PORT); return panelEnd; } };
  const client = connectPanel({ tabs, tabId: 7, onState: (s) => states.push(s), onDisconnect: () => states.push('gone') });
  onConnect(tabEnd);
  await tick();
  assert('State sent on connect', states[0]?.usedTokens === 5);
  server.push({ ready: true, usedTokens: 9 });
  await tick();
  assert('Pushed state arrives', states.at(-1).usedTokens === 9);

  assert('Remote fill', (await client.page.fill('ok')) === true && (await client.page.fill('no')) === false);
  assert('Remote countTokens', JSON.stringify(await client.page.countTokens(['ab'])) === '[2]');
  assert('Remote provider name comes with the state', client.page.provider === 'Claude');
  assert('Actions', (await client.call('diagnostics')).v === 1 && (await client.call('exportChat', ['md'])) === 'chat.md');
  await client.call('refresh');
  assert('Refresh runs', refreshed === 1);
  let bad = null; try { await client.call('evil'); } catch (e) { bad = e.message; }
  assert('Unknown call rejected', bad === 'Unknown call: evil');

  const got = [];
  const stop = await client.page.watchCapsule((c) => got.push(c.title));
  page.cb({ title: 'T', body: 'b' });
  await tick(); await tick();
  assert('Capsule found in the tab reaches the panel', JSON.stringify(got) === '["T"]');
  stop(); await tick(); await tick();
  assert('Stopping in the panel stops the tab watcher', page.stopped === true);

  // A port with another name is ignored; after disconnect, push does nothing
  const [other] = portPair(); other.name = 'x'; let otherGot = 0; other.postMessage = () => { otherGot++; };
  onConnect(other); server.push({ ready: true }); await tick();
  assert('Other ports ignored', otherGot === 0);
  panelEnd.disconnect(); await tick();
  server.push({ ready: true, usedTokens: 1 }); await tick();
  assert('No push after the panel disconnects', states.filter(s => s?.usedTokens === 1).length === 0);

  return { passed, failed };
}
```
Register `runPanelChannelTests` in `tests/run-tests.js`.

- [ ] **Step 2: Run, expect FAIL.** Run: `npm test`. Expected: the run fails with "Cannot find module ... panel-channel.js".

- [ ] **Step 3: Implement `content/panel-channel.js`.**

```js
/**
 * Context Monitor - Panel channel
 *
 * One port per tab between the content script (engine) and the side panel (view). The tab pushes the
 * view state; the panel calls Page methods and a few actions by name. Nothing flows while the panel is
 * closed: the port only exists while it is open. Only names in CALLS can be called.
 */

import { providerForHost } from './providers.js';

export const PANEL_PORT = 'panel';
const PAGE_CALLS = ['hasConversation', 'takeSelection', 'fill', 'latestReply', 'transcript', 'countTokens', 'limitReached'];
const ACTION_CALLS = ['refresh', 'diagnostics', 'exportChat'];

/** ChatGPT, Claude or Gemini. */
export function isSupportedUrl(url) {
  let host;
  try { host = new URL(url).hostname; } catch (_) { return false; }
  return ['chatgpt.com', 'chat.openai.com'].includes(host) || Boolean(providerForHost(host));
}

/** What the panel shows for the active tab. */
export function panelStatus({ url, connected, ready }) {
  if (!isSupportedUrl(url)) return 'unsupported';
  if (!connected) return 'reload';
  return ready ? 'live' : 'reading';
}

/** Tab side. `push(state)` sends the latest view state to an open panel (no-op when closed). */
export function servePanel({ runtime, page, getState, actions }) {
  let port = null;
  const watchers = new Map(); // call id -> stop
  const post = (m) => { try { port?.postMessage(m); } catch (_) { port = null; } };
  runtime.onConnect.addListener((p) => {
    if (p.name !== PANEL_PORT) return;
    port = p;
    p.onDisconnect.addListener(() => { if (port === p) port = null; for (const stop of watchers.values()) stop(); watchers.clear(); });
    p.onMessage.addListener(async (m) => {
      if (m?.type === 'STOP_WATCH') { watchers.get(m.id)?.(); watchers.delete(m.id); return; }
      if (m?.type !== 'CALL') return;
      try {
        let value;
        if (m.name === 'watchCapsule') {
          watchers.set(m.id, await page.watchCapsule((capsule) => { watchers.delete(m.id); post({ type: 'CAPSULE', id: m.id, capsule }); }));
        } else if (PAGE_CALLS.includes(m.name)) value = await page[m.name](...(m.args || []));
        else if (ACTION_CALLS.includes(m.name)) value = await actions[m.name](...(m.args || []));
        else throw new Error(`Unknown call: ${m.name}`);
        post({ type: 'REPLY', id: m.id, ok: true, value });
      } catch (e) { post({ type: 'REPLY', id: m.id, ok: false, error: String(e?.message || e) }); }
    });
    post({ type: 'STATE', state: getState(), provider: page.provider });
  });
  return { push(state) { if (port) post({ type: 'STATE', state, provider: page.provider }); } };
}

/** Panel side. Returns a Page whose calls run in the tab. */
export function connectPanel({ tabs, tabId, onState, onDisconnect = () => {} }) {
  const port = tabs.connect(tabId, { name: PANEL_PORT });
  const pending = new Map();
  const capsuleCbs = new Map();
  let seq = 0;
  let provider = 'AI';
  port.onMessage.addListener((m) => {
    if (m?.type === 'STATE') { provider = m.provider || provider; onState(m.state); }
    else if (m?.type === 'REPLY') { const p = pending.get(m.id); pending.delete(m.id); if (p) (m.ok ? p.resolve(m.value) : p.reject(new Error(m.error))); }
    else if (m?.type === 'CAPSULE') { capsuleCbs.get(m.id)?.(m.capsule); capsuleCbs.delete(m.id); }
  });
  port.onDisconnect.addListener(() => { for (const p of pending.values()) p.reject(new Error('Disconnected')); pending.clear(); onDisconnect(); });
  const call = (name, args = []) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    try { port.postMessage({ type: 'CALL', id, name, args }); } catch (e) { pending.delete(id); reject(e); }
  });
  const page = {
    get provider() { return provider; },
    ...Object.fromEntries(PAGE_CALLS.map(n => [n, (...args) => call(n, args)])),
    async watchCapsule(onFound) {
      const id = seq + 1; // call() takes this id
      capsuleCbs.set(id, onFound);
      await call('watchCapsule');
      return () => { capsuleCbs.delete(id); try { port.postMessage({ type: 'STOP_WATCH', id }); } catch (_) {} };
    }
  };
  return { page, call, disconnect: () => port.disconnect() };
}
```

- [ ] **Step 4: Run, expect PASS.** Run: `npm test`. Expected: `Total Failed: 0`.

- [ ] **Step 5: Wire it into both coordinators.** In `scripts/build.js` `MODULES`, add `'content/panel-channel.js',` after `'content/providers.js'` (it imports `providerForHost`, so it must come after it). It doesn't need to move before the coordinators, because they only call it inside `init()`, and by then the whole bundle has been evaluated.

In `content/content-main.js` `init()` (next to `listenForToggle(this.overlayUI)`), and the same in `content/provider-coordinator.js`:

```js
    this.panel = servePanel({
      runtime: chrome.runtime,
      page: this.overlayUI.page,
      getState: () => this._lastViewState || toWidgetState(null, { provider: 'ChatGPT' }),
      actions: { refresh: () => this.refresh(), diagnostics: () => this.getDiagnostics(), exportChat: (format) => this.exportChat(format) }
    });
```
In `provider-coordinator.js`, use `p.name` instead of `'ChatGPT'` (that's how its line 377 names the provider). At every `this.overlayUI.update(X)` call (`content-main.js` 327, 781; `provider-coordinator.js` 235, 377), store and push the view state as well:

```js
      const vs = toWidgetState(contextState, { provider: 'ChatGPT' });
      this._lastViewState = vs;
      this.overlayUI.update(vs);
      this.panel?.push(vs);
```
`exportChat(format)`: find what the widget's export button calls today (`grep -n "formatChatExport" content/overlay-ui.js`). Add a coordinator method that returns that same text, `formatChatExport(<same inputs>, format)`, so the panel can download it.

Push is throttled at the source: `update` already runs at most once per pass. If streaming makes it noisy (watch `syncsSent` in diagnostics), wrap `push` with the same 250 ms trailing throttle pattern as `badgeSender`.

- [ ] **Step 6: Verify.** Run: `npm run build && npm run lint && npm test`. Expected: all pass.

- [ ] **Step 7: Commit.**

```bash
git add content/panel-channel.js content/content-main.js content/provider-coordinator.js content/content-script.js scripts/build.js tests/unit/panel-channel.test.js tests/run-tests.js
git commit -m "feat: panel channel - view state to the side panel, page calls back"
```

---

### Task 7: Context view as a standalone component

**Files:**
- Create: `ui/context-view.js`
- Modify: `content/overlay-ui.js`, `scripts/build.js`, `tests/unit/widget-state.test.js`

**Interfaces:**
- Consumes: `ui/dom.js` helpers, view state (`toWidgetState` output).
- Produces: `ContextView(parent, { actions, settings }) → { el, update(vm), setSettings(settings) }`, where `actions` is `{ refresh(), copyDiagnostics(), exportChat(format), saveAsCapsule() }`.

- [ ] **Step 1: Test that the view state crosses the port intact.** In `tests/unit/widget-state.test.js`, after the existing full-state assertions, add the test below. It uses the same fixture variable those tests pass to `toWidgetState`; name it accordingly.

```js
  const vsFull = toWidgetState(state, { provider: 'ChatGPT' });
  assert('View state is plain data (survives the panel port)', JSON.stringify(structuredClone(vsFull)) === JSON.stringify(vsFull));
```
Run: `npm test`. Expected: PASS. If it fails, the view state holds a function or a Map; convert it to plain data in `toWidgetState` before continuing.

- [ ] **Step 2: Extract the view.** Move the Context-tab part of `ContextWidget` into `ui/context-view.js`. That part is:
  - from `_build`: everything from `const body = h('div', 'body', panel);` through the footer (hero, stats, Save-as-Capsule card, sections: Breakdown, Hidden context, Usage limits, Biggest messages, Growth, Attachments, Diagnostics, and the footer with confidence, Copy diagnostics, Refresh, Export)
  - `_renderPanel`, `_countTo`, `_renderSpark`, `_num`, `_showTip`

Shape:

```js
/**
 * Context Monitor - Context view: hero (tokens, bar, window, model), stats, Save-as-Capsule card,
 * sections (Breakdown, Hidden context, Usage limits, Biggest messages, Growth, Attachments) and
 * Diagnostics (closed by default). Renders a view state; knows nothing about where it is shown.
 */

import { h, Section, RowList, HiddenStack, textButton, approx, setText, setAttr, setClass, show, fmtK, fmtInt, levelName, reducedMotion } from './dom.js';

export function ContextView(parent, { actions, settings }) {
  const el = h('div', 'body', parent);
  let cfg = settings;
  // ... the moved _build body: buttons call actions.refresh(), actions.copyDiagnostics(),
  //     actions.exportChat('md'|'txt'|'json'), actions.saveAsCapsule()
  function update(vm) { /* the moved _renderPanel body; cfg.display.compact replaces this.compact */ }
  return { el, update, setSettings(s) { cfg = s; } };
}
```
Keep the import line to the names the moved code actually uses (lint enforces it). Make **Diagnostics the last section**; its `Section` starts closed, as today.

- [ ] **Step 3: Use it in the old widget.** In `ContextWidget._build`, replace the moved block with:

```js
    const ctxView = ContextView(panel, { settings: { display: { compact: this.compact } }, actions: {
      refresh: () => this.adapter.onRefresh(),
      copyDiagnostics: () => navigator.clipboard.writeText(JSON.stringify(this.adapter.getDiagnostics(), null, 2)).then(() => this._toast('Diagnostics copied'), () => this._toast('Copy failed')),
      exportChat: (f) => this._exportChat(f),
      saveAsCapsule: () => { this._setTab('capsules'); this.parts.caps.capture(); }
    } });
```
In `render()`/`_renderPanel`, call `this.parts.ctxView.update(vm)`. `_exportChat` is the existing export button's handler body moved into a method; reuse it unchanged. In `scripts/build.js` `MODULES`, add `'ui/context-view.js',` after `'ui/capsule-panel.js'`.

- [ ] **Step 4: Verify.** Run: `npm run build && npm run lint && npm test`. Expected: all pass. Check by hand on all three sites: the widget's Context tab looks and behaves as before (count-up animation, alerts, sections, copy diagnostics, export, the Save-as-Capsule card at 80%).

- [ ] **Step 5: Commit.**

```bash
git add ui/context-view.js content/overlay-ui.js content/content-script.js scripts/build.js tests/unit/widget-state.test.js
git commit -m "refactor: Context view as a standalone component"
```

---

### Task 8: The side panel app + Settings tab

**Files:**
- Create: `ui/settings-view.js`
- Replace: `sidepanel/main.js` (and the generated `sidepanel/sidepanel.js`)
- Modify: `scripts/build.js`, `tests/unit/bundle-integrity.test.js`, `sidepanel/sidepanel.html`

**Interfaces:**
- Consumes:
  - `ContextView` (Task 7), `CapsulePanel` (Task 4)
  - `connectPanel`, `panelStatus` (Task 6)
  - `readSettings`, `writeSettings`, `CONTEXT_FIELDS`, `SETTINGS_KEY` (Task 2)
  - `STYLES` (Task 3)
- Produces:
  - `SettingsView(parent, { storage }) → { el, update(settings) }`
  - `bundledSidePanel` (string) exported from `scripts/build.js`

- [ ] **Step 1: Bundle test first.** In `tests/unit/bundle-integrity.test.js`, add the check below, next to the existing "bundle up to date" check (same import style):

```js
  const { bundledSidePanel } = await import('../../scripts/build.js');
  const onDiskPanel = fs.readFileSync(path.join(root, 'sidepanel', 'sidepanel.js'), 'utf8');
  assert('Side panel bundle is up to date with its sources (run npm run build)', bundledSidePanel === onDiskPanel);
```
Use the file's existing `root`/`fs`/`path` names. Run: `npm test`. Expected: FAIL (`bundledSidePanel` is undefined).

- [ ] **Step 2: Second bundle in `scripts/build.js`.**

```js
// Side panel: an extension page, so no tokenizer and no site adapters; only the views and the channel
const PANEL_MODULES = [
  'content/settings.js', 'content/widget-state.js', 'content/capsule.js', 'content/providers.js', 'content/panel-channel.js',
  'ui/dom.js', 'ui/styles.js', 'ui/capsule-panel.js', 'ui/context-view.js', 'ui/settings-view.js', 'sidepanel/main.js'
];

export const bundledSidePanel = `/**
 * AI Context Monitor - Side panel
 * Auto-generated by scripts/build.js. Do not edit directly.
 */

(function() {
  'use strict';

${PANEL_MODULES.map(m => `  // --- ${m} ---\n  ${readCleanModule(m)}`).join('\n\n')}
})();
`;
```
Where the script writes `content/content-script.js`, also write `sidepanel/sidepanel.js`:

```js
  fs.writeFileSync(path.join(rootDir, 'sidepanel', 'sidepanel.js'), bundledSidePanel);
```
In `sidepanel/sidepanel.html`, change `type="module"` to a plain `<script src="sidepanel.js"></script>` (the bundle is an IIFE). In `eslint.config.js` `ignores`, add `'sidepanel/sidepanel.js'`. If `content/providers.js` imports engine modules, drop it from `PANEL_MODULES` and move `isSupportedUrl`'s host list to a plain constant in `panel-channel.js`. Check with `grep -n "^import" content/providers.js`.

- [ ] **Step 3: Settings view.** Create `ui/settings-view.js`:

```js
/**
 * Context Monitor - Settings tab: Widgets (two toggles, Context widget fields), Capsules (method),
 * Context (alerts), Display (theme, compact numbers, sidebar badges). Every change is written at once;
 * the widgets on every site pick it up through storage.onChanged.
 */

import { h } from './dom.js';
import { CONTEXT_FIELDS, writeSettings } from '../content/settings.js';

export function SettingsView(parent, { storage }) {
  const el = h('div', 'body settings', parent);
  const inputs = [];
  const save = (patch) => writeSettings(storage, patch).catch(() => {});

  const group = (title) => { const g = h('fieldset', 'group', el); h('legend', null, g, title); return g; };
  const check = (g, label, get, patch) => {
    const row = h('label', 'row', g);
    const box = h('input', null, row); box.type = 'checkbox';
    h('span', null, row, label);
    box.addEventListener('change', () => save(patch(box.checked)));
    inputs.push((s) => { box.checked = get(s); });
  };
  const radio = (g, name, value, label, get, patch) => {
    const row = h('label', 'row', g);
    const r = h('input', null, row); r.type = 'radio'; r.name = name; r.value = value;
    h('span', null, row, label);
    r.addEventListener('change', () => r.checked && save(patch(value)));
    inputs.push((s) => { r.checked = get(s) === value; });
  };

  const w = group('Widgets');
  check(w, 'Context widget', s => s.widgets.context.enabled, v => ({ widgets: { context: { enabled: v } } }));
  check(w, 'Capsule widget', s => s.widgets.capsule.enabled, v => ({ widgets: { capsule: { enabled: v } } }));
  h('div', 'fine', w, 'Context widget shows:');
  for (const f of CONTEXT_FIELDS) {
    check(w, f.label, s => s.widgets.context.fields.includes(f.key), (on) => ({ widgets: { context: { fields: on ? [...current.widgets.context.fields, f.key] : current.widgets.context.fields.filter(k => k !== f.key) } } }));
  }

  const c = group('Capsules: one-click method');
  radio(c, 'method', 'ask-ai', 'Ask this AI (fills the chat box; you press Enter)', s => s.capsule.method, v => ({ capsule: { method: v } }));
  radio(c, 'method', 'quick', 'Quick (no AI): built from the page', s => s.capsule.method, v => ({ capsule: { method: v } }));

  const x = group('Context');
  check(x, 'Alerts at 80% and 95%', s => s.context.alerts, v => ({ context: { alerts: v } }));

  const d = group('Display');
  for (const t of ['auto', 'dark', 'light']) radio(d, 'theme', t, `Theme: ${t}`, s => s.display.theme, v => ({ display: { theme: v } }));
  check(d, 'Compact numbers (61.3K)', s => s.display.compact, v => ({ display: { compact: v } }));
  check(d, 'Usage % next to chats in the sidebar', s => s.display.badges, v => ({ display: { badges: v } }));

  let current = null;
  return { el, update(s) { current = s; for (const set of inputs) set(s); } };
}
```
Field checkboxes keep their order from `CONTEXT_FIELDS` when the widget renders them (Task 9 sorts by `CONTEXT_FIELDS`), so appending a key here is fine.

- [ ] **Step 4: Panel app.** Replace `sidepanel/main.js`:

```js
/**
 * AI Context Monitor - Side panel. Shows the active tab of this window: Context | Capsules | Skills |
 * Settings. The engine runs in the tab; this page renders its view state and calls back through the
 * panel channel. Capsules, Skills and Settings are read from chrome.storage.local directly.
 */

import { STYLES } from '../ui/styles.js';
import { h, textButton, show, setText } from '../ui/dom.js';
import { ContextView } from '../ui/context-view.js';
import { CapsulePanel } from '../ui/capsule-panel.js';
import { SettingsView } from '../ui/settings-view.js';
import { connectPanel, panelStatus } from '../content/panel-channel.js';
import { readSettings, SETTINGS_KEY } from '../content/settings.js';
import { CAPSULES_KEY, CAPSULE_HANDOFF_KEY, SKILLS_KEY } from '../content/capsule.js';

const TABS = [ // Adding a feature = one entry here (+ a Settings section)
  { id: 'context', label: 'Context' },
  { id: 'capsules', label: 'Capsules' },
  { id: 'skills', label: 'Skills' },
  { id: 'settings', label: '⚙', title: 'Settings' }
];
const MESSAGES = {
  unsupported: 'Open ChatGPT, Claude or Gemini to see this chat\'s context.',
  reload: 'Reload this page to start.',
  reading: 'Reading the conversation…'
};

const storage = chrome.storage.local;
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: STYLES.replace(':host { all: initial; }', '') + '\nhtml,body{margin:0;height:100%}' }));
const root = h('div', 'root panelpage', document.body);
document.getElementById('app')?.remove();

// The current tab's channel; replaced when the active tab changes
let link = null;
let tabInfo = { id: null, url: null };
let vm = null;
let settings = await readSettings(storage);
let active = 'context';

const toast = (text) => { setText(toastEl, text); toastEl.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('show'), 1800); };
const page = new Proxy({}, { get: (_, k) => link?.page[k] ?? (k === 'provider' ? 'AI' : async () => { throw new Error('No chat'); }) });

const nav = h('div', 'tabs', root); nav.setAttribute('role', 'tablist');
const tabBtns = Object.fromEntries(TABS.map(t => {
  const b = textButton(nav, t.label, () => select(t.id), 'tab');
  b.setAttribute('role', 'tab'); if (t.title) b.title = t.title;
  return [t.id, b];
}));
const empty = h('div', 'card empty', root);
const ctxView = ContextView(root, { settings, actions: {
  refresh: () => link?.call('refresh'),
  copyDiagnostics: async () => { try { await navigator.clipboard.writeText(JSON.stringify(await link.call('diagnostics'), null, 2)); toast('Diagnostics copied'); } catch (_) { toast('Copy failed'); } },
  exportChat: async (f) => { try { download(await link.call('exportChat', [f]), f); } catch (_) { toast('Export failed'); } },
  saveAsCapsule: () => { select('capsules'); caps.capture(); }
} });
const caps = CapsulePanel(root, { kind: 'capsule', storage, page, toast, reveal: () => select('capsules') });
const skills = CapsulePanel(root, { kind: 'skill', storage, page, toast, reveal: () => select('skills') });
const settingsView = SettingsView(root, { storage });
const toastEl = h('div', 'toast', root);

function download(text, ext) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = `chat.${ext}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function select(id) { active = id; render(); }

function render() {
  const status = panelStatus({ url: tabInfo.url, connected: Boolean(link), ready: vm?.ready !== false && Boolean(vm) });
  const needsChat = active !== 'settings' && status !== 'live';
  // Capsules / Skills lists work without a chat (insert needs one; the panel says so on click)
  const blocked = needsChat && (active === 'context' || status === 'unsupported' || status === 'reload');
  show(empty, blocked); setText(empty, MESSAGES[status] || '');
  show(ctxView.el, !blocked && active === 'context');
  show(caps.view, !blocked && active === 'capsules');
  show(skills.view, !blocked && active === 'skills');
  show(settingsView.el, active === 'settings');
  for (const [id, b] of Object.entries(tabBtns)) b.setAttribute('aria-selected', String(id === active));
  root.classList.toggle('light', settings.display.theme === 'light' || (settings.display.theme === 'auto' && !matchMedia('(prefers-color-scheme: dark)').matches));
}

async function follow(tab) {
  if (!tab || tab.id === tabInfo.id && tab.url === tabInfo.url && link) return;
  link?.disconnect(); link = null; vm = null;
  tabInfo = { id: tab.id, url: tab.url };
  if (panelStatus({ url: tab.url, connected: true, ready: true }) !== 'unsupported') {
    try {
      const l = connectPanel({ tabs: chrome.tabs, tabId: tab.id,
        onState: (s) => { vm = s; ctxView.update(s); caps.setView(s); skills.setView(s); render(); },
        onDisconnect: () => { if (link === l) { link = null; vm = null; render(); } } });
      link = l;
    } catch (_) { link = null; }
  }
  render();
}

const win = await chrome.windows.getCurrent();
const activeTab = async () => (await chrome.tabs.query({ active: true, windowId: win.id }))[0];
chrome.tabs.onActivated.addListener(({ windowId }) => { if (windowId === win.id) activeTab().then(follow); });
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (tab.active && tab.windowId === win.id && (info.url || info.status === 'complete')) follow(tab); });
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch[SETTINGS_KEY]) readSettings(storage).then(s => { settings = s; settingsView.update(s); ctxView.setSettings(s); render(); });
  if (ch[CAPSULES_KEY] || ch[CAPSULE_HANDOFF_KEY]) caps.refresh();
  if (ch[SKILLS_KEY]) skills.refresh();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

settingsView.update(settings);
caps.refresh(); skills.refresh();
follow(await activeTab());
```
The bundle wraps everything in a plain IIFE, so top-level `await` won't work there. Wrap the body of `main.js` after the imports in `(async () => { ... })();`. The regex bundler only strips imports at column 0, so the wrapper is safe. `connectPanel` does not report a missing receiver synchronously: `chrome.tabs.connect` to a tab without our content script fires `onDisconnect` right away (with `chrome.runtime.lastError` set). That path sets `link = null`, and `panelStatus` then gives `'reload'`.

Add a few panel-only styles to the end of `ui/styles.js` (inside the string):

```css
  .panelpage { min-height: 100vh; background: var(--bg); color: var(--text); padding: 8px 10px; }
  .panelpage .tabs { position: sticky; top: 0; z-index: 1; background: var(--bg); padding-bottom: 6px; }
  .panelpage .empty { margin-top: 24px; text-align: center; }
  .settings .group { border: 0; margin: 10px 0; } .settings legend { font-weight: 600; margin-bottom: 4px; }
  .settings .row { display: flex; gap: 8px; align-items: center; padding: 3px 0; }
```
Use the variable names that `STYLES` already defines; check with `grep -n "\-\-bg\|\-\-text" ui/styles.js`.

- [ ] **Step 5: Verify.** Run: `npm run build && npm run lint && npm test`. Expected: all pass, including the side panel bundle check. Check by hand, with the unpacked extension and the panel open:
  - On chatgpt.com: live numbers update while a reply streams.
  - Switching to claude.ai switches the content.
  - On a new tab: "Open ChatGPT, Claude or Gemini".
  - On a supported tab opened before the extension was reloaded: "Reload this page to start".
  - Capsules → Create fills that tab's chat box; the draft appears in the panel after sending. Insert lands in the tab.
  - Settings changes persist after closing and reopening the panel.
  - The panel is usable at its narrowest width.

- [ ] **Step 6: Commit.**

```bash
git add sidepanel ui scripts/build.js eslint.config.js tests/unit/bundle-integrity.test.js
git commit -m "feat: side panel app - Context, Capsules, Skills, Settings"
```

---

### Task 9: Widgets replace the floating panel

**Files:**
- Create: `content/widgets.js`
- Delete: `content/overlay-ui.js`
- Modify:
  - `content/widget-state.js`, `tests/unit/widget-state.test.js`
  - `content/content-main.js`, `content/provider-coordinator.js`, `content/coordinator-common.js`
  - `scripts/build.js`

**Interfaces:**
- Consumes:
  - `createPage` (Task 4), `captureCapsule` (Task 5)
  - `readSettings`, `SETTINGS_KEY`, `CONTEXT_FIELDS` (Task 2)
  - `STYLES`, `ui/dom.js` helpers
- Produces:
  - `widgetFields(vm, fields) → Array<{ key, label, value }>` in `widget-state.js`
  - `class Widgets { constructor(adapter); page; mount(); update(viewState); unmount() }`. It replaces `ContextWidget` in both coordinators; `adapter` has the same shape as `ContextWidget`'s.

- [ ] **Step 1: Failing test for `widgetFields`.** Add to `tests/unit/widget-state.test.js` (and import `widgetFields`):

```js
  // Context widget card: only the chosen fields, in the fixed order, blanks dropped
  const vmw = { ready: true, usedTokens: 5700, contextLimit: 256000, percentage: 2, model: 'GPT-5.6', exchangesLeft: 40,
    limits: [{ label: '5-hour', percent: 30, resetIn: '2h 10m', blocked: false }], warning: null };
  const f1 = widgetFields(vmw, ['model', 'tokens', 'percent']);
  assert('Fields in display order, not pick order', f1.map(f => f.key).join() === 'tokens,percent,model');
  assert('Token value formatted with window', f1[0].value === '5.7K / 256K');
  assert('Percent value', f1[1].value === '2%');
  assert('Limits joined', widgetFields(vmw, ['limits'])[0].value === '5-hour 30% · resets in 2h 10m');
  assert('Empty values dropped (no alert, unknown exchanges)', widgetFields({ ...vmw, exchangesLeft: null }, ['exchangesLeft', 'alert']).length === 0);
  assert('Unknown window: tokens only', widgetFields({ ...vmw, contextLimit: null, percentage: null }, ['tokens', 'percent'])[0].value === '5.7K' && widgetFields({ ...vmw, contextLimit: null, percentage: null }, ['tokens', 'percent']).length === 1);
  assert('Not ready -> nothing', widgetFields({ ready: false }, ['tokens']).length === 0);
```
Run: `npm test`. Expected: FAIL (`widgetFields` is not exported).

- [ ] **Step 2: Implement `widgetFields`** in `content/widget-state.js`. `fmtK` lives in `ui/dom.js`, but `widget-state.js` must stay free of imports (it is pure formatting), so a local `k` helper does the same job:

```js
import { CONTEXT_FIELDS } from './settings.js';

const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n));

/**
 * The Context widget's expanded card: the chosen fields, in CONTEXT_FIELDS order, without blanks.
 * @returns {Array<{ key: string, label: string, value: string }>}
 */
export function widgetFields(vm, fields) {
  if (!vm || vm.ready === false) return [];
  const value = {
    tokens: () => (vm.contextLimit ? `${k(vm.usedTokens)} / ${k(vm.contextLimit)}` : k(vm.usedTokens)),
    percent: () => (vm.percentage === null || vm.percentage === undefined ? null : `${vm.percentage}%`),
    model: () => vm.model || null,
    exchangesLeft: () => (vm.exchangesLeft === null || vm.exchangesLeft === undefined ? null : `~${vm.exchangesLeft}`),
    limits: () => (vm.limits?.length ? vm.limits.map(l => `${l.label} ${l.percent}%${l.resetIn ? ` · resets in ${l.resetIn}` : ''}`).join(' | ') : null),
    alert: () => vm.warning || null
  };
  return CONTEXT_FIELDS.filter(f => fields.includes(f.key)).map(f => ({ key: f.key, label: f.label, value: value[f.key]() })).filter(f => f.value);
}
```
Check that the `tokens` format matches the test (`5.7K / 256K`). If `ui/dom.js`'s `fmtK` gives the same output, import it from `../ui/dom.js` instead and drop `k`. In `scripts/build.js`, `content/settings.js` must come before `content/widget-state.js` in `MODULES`; add it there.

Run: `npm test`. Expected: PASS.

- [ ] **Step 3: Write `content/widgets.js`.** Bring these over from `overlay-ui.js`:
  - the drag code: `MARGIN`, `TOP_SAFE`, `SNAP_Y`, `DRAG_THRESHOLD`, `_dragStart/_dragMove/_dragEnd/_settle/_size/_xy/_applyXY/_position/_schedulePosition`
  - `_toast`, `_maybeAlert`
  - the sidebar badges: `_trackUsage/_paintBadges/_startBadgeWatch`
  - the Alt+T listener

Turn the drag code into a function so each pill drags on its own:

```js
/**
 * Context Monitor - Widgets: two small pills on the chat page, each dragged on its own.
 *   Context  "5.7K · 2%" (badge colours) → click expands a card with the fields chosen in Settings
 *   Capsule  "💊 Capsule" → click runs captureCapsule with the chosen method; click again cancels
 * Everything else lives in the side panel (toolbar icon). Also here, because they belong to the page:
 * the 80% / 95% alerts (toasts on the Context pill) and the usage % next to chats in the sidebar.
 * Alt+T hides / shows both pills for this page view; Settings turns each one off for good.
 */

const DEFAULT_POS = { context: { side: 'right', dx: 16, yFromBottom: 96 }, capsule: { side: 'right', dx: 16, yFromBottom: 52 } };

/**
 * Free drag for one pill: pointer events, translate3d, clamped to the viewport, snapped to the
 * nearest side on release (hold Alt to skip). `onMoved(pos)` saves the new position.
 * @returns {{ place(): void, wasDragged(): boolean }}
 */
function makeDraggable(host, handle, getPos, onMoved) { /* moved drag code, `this.pos` → getPos(), `this._savePrefs()` → onMoved(pos) */ }
```
Store positions under the existing per-site key (`ui:<hostname>`) as `{ pos: { context, capsule } }`.

**Migration:** if the stored value has the old shape (`s.pos.side` exists), use it as `pos.context`, use `DEFAULT_POS.capsule` for the Capsule pill, and write the new shape back.

Keep the old `y` (from top) model for the migrated Context pill. New defaults are bottom-anchored, so `_position` accepts either `y` or `yFromBottom`.

`class Widgets`:
- `constructor(adapter)`: stores the adapter; `this.page = createPage(adapter)`.
- `mount()`:
  - One shadow host per pill, so each one positions on its own. Both use `STYLES`.
  - `readSettings(chrome.storage.local)`, then apply it: hide a pill that is turned off, set the field list and the theme.
  - Subscribe to `storage.onChanged` for `SETTINGS_KEY`, and apply changes live.
  - Start the sidebar badge watch (honours `settings.display.badges`).
  - Register Alt+T.
- `update(vm)`:
  - Context pill text: `—` while `vm.ready === false`; otherwise `fmtK(vm.usedTokens)`, plus ` · ${vm.percentage}%` when known.
  - Colour class from the percentage (≥ 85 red, ≥ 65 amber, otherwise green).
  - If expanded, re-render the card from `widgetFields(vm, settings.widgets.context.fields)`, footer "More in the side panel".
  - `_maybeAlert(vm)` only when `settings.context.alerts`; `_trackUsage(vm)`.
- Context pill click (unless it was just dragged): toggle the card. Esc closes it.
- Capsule pill click:
  - If a run is active: `run.cancel()`.
  - Otherwise: `run = await captureCapsule({ method: settings.capsule.method, page: this.page, store: new CapsuleStore(chrome.storage.local), onStatus })`.
  - `onStatus` sets the pill text:
    - `waiting` → "Press Enter to send"
    - `saved` → "Saved ✓ · edit in side panel" for 4 s; with `reason === 'limit'` → "Limit reached: saved with Quick ✓"
    - `error` → the text, for 3 s
    - `cancelled` → back to "💊 Capsule"
  - If Task 1's spike showed `sidePanel.open` works, the saved text gets a click that sends `{ type: 'OPEN_PANEL' }`, and the service worker handles it with `chrome.sidePanel.open({ tabId: sender.tab.id })`.
- `unmount()`: disconnect the observers and remove both hosts.
- Assign page-derived text only through `setText` / `textContent`.

- [ ] **Step 4: Swap it in.**
  - In both coordinators, replace `import { ContextWidget } from './overlay-ui.js';` with `import { Widgets } from './widgets.js';` and `new ContextWidget(` with `new Widgets(`.
  - Delete `listenForToggle(this.overlayUI);` (both files), and delete `listenForToggle` from `content/coordinator-common.js` and from its import lines. `servePanel` (Task 6) uses `this.overlayUI.page`, which `Widgets` provides.
  - Delete `content/overlay-ui.js`.
  - In `scripts/build.js` `MODULES`, replace `'content/overlay-ui.js'` with `'content/widgets.js'`, and make sure the order is `content/settings.js` … `content/capsule.js`, `content/page-actions.js`, `ui/dom.js`, `ui/styles.js`, `ui/capsule-panel.js`, `ui/context-view.js`, `content/widgets.js`.
  - The page bundle no longer needs `ui/capsule-panel.js` or `ui/context-view.js`, since only the panel draws those now. Remove them from `MODULES` if nothing in the content bundle references them (`grep -n "CapsulePanel\|ContextView" content/*.js`).

- [ ] **Step 5: Verify.** Run: `npm run build && npm run lint && npm test`. Expected: all pass. Fix any test that imported `overlay-ui.js` (`grep -rn "overlay-ui" tests`). Check by hand on ChatGPT, Claude and Gemini:
  - **Both pills:** both show by default, bottom-right. Each drags on its own, snaps to a side, and keeps its own position after a reload.
  - **Old position:** a position saved with the old widget becomes the Context pill's position.
  - **Context pill:** while reading it shows a dash, never 0. Click shows only the ticked fields; Esc closes. Unticking a field in the side panel changes the card live.
  - **Capsule pill, Ask this AI:** click fills the box ("Press Enter to send"). After sending, it saves automatically and the pill shows "Saved ✓ · edit in side panel"; the Capsule appears in the panel's Capsules tab. Clicking while waiting cancels.
  - **Capsule pill, Quick:** saves at once. When the site's limit is reached, Ask this AI falls back to Quick and says so.
  - **Widget toggles:** turning a pill off in Settings hides it on every open tab at once.
  - **Page-level extras:** Alt+T hides and shows both pills; the 80% alert toast still appears (unless alerts are off); sidebar % badges still appear (unless turned off).
  - **Panel closed:** the pills keep working.

- [ ] **Step 6: Commit.**

```bash
git add -A content scripts/build.js tests
git commit -m "feat: Context and Capsule widgets replace the floating panel"
```

---

### Task 10: Docs, version, release check

**Files:**
- Modify: `manifest.json`, `package.json`, `PRIVACY.md`, `CHROMEWEBSTORE.md`, `CHANGELOG.md`, `README.md`, `GEMINI.md`

- [ ] **Step 1: Version.** Set `"version": "1.1.0"` in `manifest.json` and `package.json`. Update the version in `CHROMEWEBSTORE.md`.

- [ ] **Step 2: Store and privacy text.**
  - `CHROMEWEBSTORE.md`: add a permission justification. "`sidePanel`: shows the extension's main view (context, Capsules, Skills, settings) next to the chat. No data leaves the browser."
  - `PRIVACY.md`: add one sentence. "Settings (widget choices, Capsule method, display options) are stored locally in `chrome.storage.local`."
  - Update any wording that says the toolbar icon "shows / hides the widget" (`grep -rn "show / hide\|toggles the" *.md`).

- [ ] **Step 3: Changelog.** Under `[Unreleased]`, add this to the top of `### Changed`:

```markdown
- **Side panel:** the toolbar icon opens the extension in Chrome's side panel (Context · Capsules · Skills · Settings); the site narrows to make room. Breakdown and Diagnostics are sections of Context. Requires Chrome 116+ (`sidePanel` permission, no install warning).
- **Widgets:** the floating panel is replaced by two small pills, each dragged on its own: **Context** (click for the fields chosen in Settings) and **Capsule** (one click: Ask this AI fills the chat box and saves the Capsule from the reply, or Quick builds it from the page; falls back to Quick when the limit is reached). Both on by default; turn off in Settings.
- **Settings tab:** widget toggles and fields, Capsule method, alerts, theme, compact numbers, sidebar badges.
```
Then rename `[Unreleased]` to `[1.1.0] - <today's date>` and add a fresh empty `## [Unreleased]` above it.

- [ ] **Step 4a: GEMINI.md.** In the architecture diagram (section 2), replace the `overlay-ui.js` line with `content/widgets.js` (Context + Capsule pills) and `ui/*` (views shared with the side panel). Add a `[ SIDE PANEL ]` box (`sidepanel/`, port `panel` via `content/panel-channel.js`). Change "a toolbar icon click shows / hides the widget" to "a toolbar icon click opens the side panel". In the Build Pipeline Invariant, add that `npm run build` also writes `sidepanel/sidepanel.js`.

- [ ] **Step 4: README.** Update the architecture diagram and the UI section to show content script ⇄ panel channel ⇄ side panel, and the two widgets. Keep it short; point to the spec for details.

- [ ] **Step 5: Full check.** Run:

```bash
npm run build && npm run lint && npm test && npm run validate && npm run pack
```
Expected: everything passes; `dist/ai-context-monitor-1.1.0.zip` is written and lists `sidepanel/sidepanel.html`, `sidepanel/sidepanel.js` and `content/content-script.js`. Load the zip's unpacked contents in a clean Chrome profile and repeat the manual checks from Tasks 8 and 9 once on each site.

- [ ] **Step 6: Commit.**

```bash
git add manifest.json package.json PRIVACY.md CHROMEWEBSTORE.md CHANGELOG.md README.md GEMINI.md
git commit -m "release: 1.1.0 - side panel and widgets"
```

---

## Self-review notes

- **Spec coverage:**
  - Toolbar → panel: Task 1.
  - Panel tabs and states: Task 8.
  - Breakdown and Diagnostics as sections: Task 7.
  - Widgets on by default, each draggable, field choice, Esc to collapse, "More in the side panel": Task 9.
  - Capsule methods, auto-save, limit fallback, cancel: Task 5 and Task 9.
  - The widget can't open the panel (spike and conditional): Task 1 and Task 9.
  - Settings shape and sections: Task 2 and Task 8.
  - Engine stays in the tab; port and commands: Task 6.
  - Migration of positions and storage keys: Task 9 (Capsules / Skills keys are unchanged).
  - Permission, minimum Chrome, docs: Task 1 and Task 10.
  - Testing: every task.
- **Not covered by design:** own API key, more widgets, Brain v1.1 (all out of scope in the spec).
- **Known risks:**
  - The async `countTokens` in `CapsulePanel` (Task 4) changes when cost lines appear; they show a moment later.
  - Task 9 is the largest task. If review needs it smaller, split it into 9a (`widgetFields` + Context pill + drag) and 9b (Capsule pill + removal of `overlay-ui.js`).
