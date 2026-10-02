# Second Brain (phases 1–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product to **AI Super Powers**, group Capsules and Skills under a **🧠 Brain** section in the side panel, and add **Memory**: short facts about the user, added by hand or learned from a chat (reviewed in an inbox, updated by key), guarded against secrets, and injected into any AI with its token cost.

**Architecture:** Memory reuses the existing Library machinery: `CapsuleStore` (new `reject` hook, `plural` name, memory-only `category` / `key` fields) under storage key `memories`, and `CapsulePanel` with a third `kind: 'memory'`. Memory-specific logic (secret guard, Learn prompt, reply parser, inbox, approve-by-key, insert format) lives in a new pure module `content/memory.js`. "Learn" reuses the Capsule reply watcher with different markers, passed through the existing panel channel. Everything is side-panel code: the content-script bundle only gains the marker option.

**Tech Stack:** Plain JS ES modules, Manifest V3, `chrome.storage.local`, the regex concatenation bundler (`scripts/build.js`), the assert-style runner (`npm test`), ESLint.

**Spec:** `docs/superpowers/specs/2026-10-02-second-brain-design.md`

## Global Constraints

- Local only: no new network requests, no API key, no server, **no new permissions**.
- **Fill, never auto-send.** Nothing clicks Send or presses Enter.
- Nothing learned becomes memory without the user's ✅ (inbox).
- A memory that `looksSecret` is never stored (save, import, Learn).
- Memory fact ≤ **500** characters; inbox ≤ **50** entries; Learn prompt lists ≤ **100** existing keys.
- Categories, exactly: `profile, preference, project, instruction, skill, decision, other`.
- Key format: `category.topic-with-dashes` (topic ≤ 40 chars), else `null`.
- Markers, exactly: `=== MEMORY START ===` / `=== MEMORY END ===`.
- Product name **AI Super Powers**, short name **Super Powers**, export app id **ai-super-powers**. Internal comment headers and log prefixes are not renamed.
- Page-derived text is only ever set as text (`h(..., text)` / `textContent`), never HTML.
- Bundler rule: every `import` / `export` is one line starting at column 0 (header of `scripts/build.js`).
- After every task: `npm run build`, `npm test`, `npm run lint`, `npm run validate` all pass (GEMINI.md Definition of Done).
- Branch: `git checkout -b feat/second-brain` (from `feat/side-panel`). Do not commit the untracked `VERSION-1-FEATURES.md` (the user's file). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `manifest.json`, `package.json`, `package-lock.json`, `sidepanel/sidepanel.html`, `content/widgets.js`, `scripts/package-extension.js` | modify | Rename (Task 1), version 1.2.0 (Task 7) |
| `content/capsule.js` | modify | `CapsuleStore` `reject` / `plural`, memory fields, `MEMORY_CATEGORIES`, `normalizeMemoryKey`, custom markers in `parseCapsule` / `readLatestCapsule`, export app id |
| `content/page-actions.js` | modify | `watchCapsule(onFound, { markers })` |
| `content/panel-channel.js` | modify | Pass `watchCapsule` options over the port |
| `content/memory.js` | **create** | Secret guard, memory store factory, Learn prompt, reply parser, inbox, approve-by-key, insert format |
| `ui/capsule-panel.js` | modify | `kind: 'memory'`: Learn, inbox, category editor, Inject with cost |
| `ui/styles.js` | modify | Sub-tab row style |
| `sidepanel/main.js` | modify | Context · 🧠 Brain (Memory · Capsules · Skills) · ⚙ |
| `scripts/build.js` | modify | `content/memory.js` in the side-panel bundle |
| `tests/unit/memory.test.js` | **create** | Memory module tests |
| `tests/unit/capsule.test.js`, `tests/unit/panel-channel.test.js`, `tests/run-tests.js` | modify | New cases, register suite |
| `README.md`, `PRIVACY.md`, `CHROMEWEBSTORE.md`, `CHANGELOG.md`, `GEMINI.md` | modify | Name, Memory, privacy |

---

### Task 1: Rename to AI Super Powers

**Files:**
- Modify: `manifest.json:3-4,14`, `package.json:2`, `package-lock.json:2,8`, `sidepanel/sidepanel.html:6`, `content/widgets.js:429`, `content/capsule.js:405`, `scripts/package-extension.js:90`
- Modify: `README.md`, `PRIVACY.md`, `CHROMEWEBSTORE.md` (title lines and product-name mentions only), `GEMINI.md` (side panel line)
- Test: `tests/unit/capsule.test.js`

**Interfaces:**
- Produces: `exportCapsules(list, key)` JSON has `app: 'ai-super-powers'`.

- [ ] **Step 1: Write the failing test** (append before `return { passed, failed };` in `tests/unit/capsule.test.js`)

```js
  assert('Export file names the product', JSON.parse(exportCapsules([], CAPSULES_KEY)).app === 'ai-super-powers');
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test 2>&1 | grep "Export file names the product"`
Expected: `❌ [FAIL] Export file names the product`

- [ ] **Step 3: Rename**

`content/capsule.js:405`:
```js
  return JSON.stringify({ app: 'ai-super-powers', version: 1, exportedAt: Date.now(), [key]: list }, null, 2);
```
`manifest.json`:
```json
  "name": "AI Super Powers",
  "short_name": "Super Powers",
```
```json
    "default_title": "AI Super Powers: open the side panel",
```
`package.json` and both `"name"` entries at the top of `package-lock.json`: `"name": "ai-super-powers",`
`sidepanel/sidepanel.html:6`: `<title>AI Super Powers</title>`
`content/widgets.js:429`: ``badge.title = `Context ${text} full (AI Super Powers)`;``
`scripts/package-extension.js:90`: ``const zipPath = path.join(distDir, `ai-super-powers-${manifest.version}.zip`);``

Docs: replace the product name "AI Context Monitor" with "AI Super Powers" in the H1 / title lines and in sentences naming the product in `README.md`, `PRIVACY.md`, `CHROMEWEBSTORE.md`. Leave `CHANGELOG.md` history entries as they are. In `GEMINI.md`, change the side panel line to `tabs Context | Brain (Memory · Capsules · Skills) | Settings`.

Check that nothing user-visible still carries the old name:
Run: `grep -rn "AI Context Monitor\|ai-context-monitor" manifest.json package.json sidepanel/sidepanel.html content/widgets.js content/capsule.js scripts/package-extension.js README.md PRIVACY.md CHROMEWEBSTORE.md`
Expected: no output

- [ ] **Step 4: Build and run everything**

Run: `npm run build && npm test && npm run lint && npm run validate`
Expected: all pass, including `✅ [PASS] Export file names the product`

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/second-brain
git add manifest.json package.json package-lock.json sidepanel/sidepanel.html sidepanel/sidepanel.js content/widgets.js content/content-script.js content/capsule.js scripts/package-extension.js README.md PRIVACY.md CHROMEWEBSTORE.md GEMINI.md tests/unit/capsule.test.js
git commit -m "chore: rename to AI Super Powers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Store support for memories (reject hook, plural, category / key)

**Files:**
- Modify: `content/capsule.js` (`CapsuleStore`, `normalizeCapsule`, new exports)
- Test: `tests/unit/capsule.test.js`

**Interfaces:**
- Produces:
  - `MEMORY_CATEGORIES: string[]` = `['profile','preference','project','instruction','skill','decision','other']`
  - `normalizeMemoryKey(input: any): string|null`
  - `new CapsuleStore(area, { key?, noun?, plural?, reject? })`: `plural` defaults to `` `${noun}s` ``; `reject(item) => string|null` runs on every `save` (throws `Error(message)`) and every imported item (skipped).
  - Stored items keep `category` (one of `MEMORY_CATEGORIES`) and `key` (`normalizeMemoryKey`) when given or already stored; Capsules and Skills never get them.
  - `importMany` error text: `` `Not a ${this.plural} file` ``.

- [ ] **Step 1: Write the failing tests** (add `MEMORY_CATEGORIES, normalizeMemoryKey` to the import list at the top of `tests/unit/capsule.test.js`; append before `return { passed, failed };`)

```js
  // Memory support in the shared store
  assert('Memory categories', MEMORY_CATEGORIES.join() === 'profile,preference,project,instruction,skill,decision,other');
  assert('Memory key normalized', normalizeMemoryKey(' Preference.Favorite Fruit ') === 'preference.favorite-fruit');
  assert('Memory key: unknown category or no topic is null', normalizeMemoryKey('food.mango') === null && normalizeMemoryKey('profile.') === null && normalizeMemoryKey(5) === null);
  const ms = new CapsuleStore(fakeArea(), { key: 'memories', noun: 'Memory', plural: 'Memories', reject: (i) => (i.body.includes('sk-') ? 'Looks like a secret: not saved' : null) });
  const m1 = await ms.save({ title: 'Likes mango', body: 'Likes mango', category: 'preference', key: 'preference.favorite-fruit' });
  assert('Store keeps category and key', m1.category === 'preference' && m1.key === 'preference.favorite-fruit');
  const m2 = await ms.save({ id: m1.id, title: 'Likes apple', body: 'Likes apple' });
  assert('Edit without category / key keeps them', m2.category === 'preference' && m2.key === 'preference.favorite-fruit');
  const c1 = await new CapsuleStore(fakeArea()).save({ title: 't', body: 'b', category: 'profile', key: 'profile.name' });
  assert('Capsules ignore memory fields only when invalid; valid ones are kept as given', c1.category === 'profile');
  const c2 = await new CapsuleStore(fakeArea()).save({ title: 't', body: 'b' });
  assert('Capsule without memory fields has none', !('category' in c2) && !('key' in c2));
  let rej = null; try { await ms.save({ body: 'my key sk-abc' }); } catch (e) { rej = e.message; }
  assert('Reject hook refuses a save', rej === 'Looks like a secret: not saved' && (await ms.list()).length === 1);
  const imp = await ms.importMany(JSON.stringify({ memories: [{ id: 'a1', body: 'ok fact' }, { id: 'a2', body: 'sk-secret' }] }));
  assert('Reject hook skips imported items', imp.added === 1 && imp.skipped === 1);
  let wrongFile = null; try { await ms.importMany('{}'); } catch (e) { wrongFile = e.message; }
  assert('Import error uses the plural', wrongFile === 'Not a Memories file');
```

- [ ] **Step 2: Run to see them fail**

Run: `npm test 2>&1 | grep -E "Memory|memory|Reject|plural"`
Expected: import error (`MEMORY_CATEGORIES` not exported) or FAIL lines

- [ ] **Step 3: Implement** in `content/capsule.js`

After `export const CAPSULE_HANDOFF_KEY = 'capsuleHandoff';` add:
```js
/** Memory categories (content/memory.js); the shared store keeps `category` / `key` only when valid. */
export const MEMORY_CATEGORIES = ['profile', 'preference', 'project', 'instruction', 'skill', 'decision', 'other'];
```

Before `export class CapsuleStore` add:
```js
/** Memory key "category.topic-with-dashes" (topic ≤ 40 characters), or null. */
export function normalizeMemoryKey(input) {
  if (typeof input !== 'string') return null;
  const [cat, ...rest] = input.trim().toLowerCase().split('.');
  const topic = rest.join('-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return MEMORY_CATEGORIES.includes(cat) && topic ? `${cat}.${topic}` : null;
}

/** Memory-only fields: given ones replace, missing ones are kept; absent when never set (Capsules, Skills). */
function memoryFields(c, old = null) {
  const category = MEMORY_CATEGORIES.includes(c?.category) ? c.category : old?.category;
  const key = c?.key !== undefined ? normalizeMemoryKey(c.key) : old?.key;
  return { ...(category ? { category } : {}), ...(key ? { key } : {}) };
}
```

Constructor:
```js
  /**
   * @param {{ get: Function, set: Function }} area chrome.storage.local (or a fake with the same API)
   * @param {{ key?: string, noun?: string, plural?: string, reject?: ((item: Object) => string|null)|null }} [opts]
   *   Storage key, item name ('Capsule' / 'Skill' / 'Memory') and its plural for defaults, errors and the
   *   export file; `reject` refuses an item (save throws its message, import skips it)
   */
  constructor(area, { key = CAPSULES_KEY, noun = 'Capsule', plural = `${noun}s`, reject = null } = {}) {
    this.area = area;
    this.key = key;
    this.noun = noun;
    this.plural = plural;
    this.reject = reject;
  }
```

In `save`, add `...memoryFields(capsule, old),` after `pinned: ...,` in the `item` literal, and right after the literal:
```js
    const why = this.reject?.(item);
    if (why) throw new Error(why);
```

In `importMany`: ``const wrong = `Not a ${this.plural} file`;`` and change the skip test to:
```js
      if (!c || this.reject?.(c) || (i !== undefined && !(c.updatedAt > list[i].updatedAt))) { counts.skipped++; continue; }
```

In `normalizeCapsule`, add `...memoryFields(raw),` after `pinned: raw.pinned === true,`.

- [ ] **Step 4: Build and run everything**

Run: `npm run build && npm test && npm run lint && npm run validate`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add content/capsule.js content/content-script.js sidepanel/sidepanel.js tests/unit/capsule.test.js
git commit -m "feat: shared store supports memories - reject hook, plural, category and key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Custom reply markers through the watcher and the panel channel

**Files:**
- Modify: `content/capsule.js` (`parseCapsule`, `readLatestCapsule`), `content/page-actions.js` (`watchCapsule`), `content/panel-channel.js` (`servePanel`, `connectPanel`)
- Test: `tests/unit/capsule.test.js`, `tests/unit/panel-channel.test.js`

**Interfaces:**
- Produces:
  - `CAPSULE_MARKERS = { start: CAPSULE_START, end: CAPSULE_END }`
  - `parseCapsule(text, { loose?, markers? })`, `readLatestCapsule(doc, replySelector, ignoreBody?, markers?)`
  - Page: `watchCapsule(onFound, { markers }?)` → `Promise<stop>`; same signature on the panel side (`connectPanel(...).page.watchCapsule`).

- [ ] **Step 1: Write the failing tests**

`tests/unit/capsule.test.js` (add `CAPSULE_MARKERS` to the imports; append):
```js
  const MK = { start: '=== MEMORY START ===', end: '=== MEMORY END ===' };
  assert('Default markers are the Capsule ones', CAPSULE_MARKERS.start === CAPSULE_START && CAPSULE_MARKERS.end === CAPSULE_END);
  const pm = parseCapsule(`x\n${MK.start}\n- preference | preference.fruit | Likes mango\n${MK.end}`, { markers: MK });
  assert('parseCapsule with custom markers', pm?.body === '- preference | preference.fruit | Likes mango');
  assert('Capsule markers do not match a memory reply', parseCapsule(`${MK.start}\nx\n${MK.end}`) === null);
  assert('readLatestCapsule with custom markers', readLatestCapsule(fakeDoc([`${MK.start}\n- a | b | c\n${MK.end}`]), 'R', null, MK)?.body === '- a | b | c');
```

`tests/unit/panel-channel.test.js`: in the first fake `page` (the one with `watchCapsule: async (cb) => {...}`), record the options:
```js
    watchCapsule: async (cb, opts) => { page.cb = cb; page.opts = opts; return () => { page.stopped = true; }; } };
```
and right after the existing line `const stop = await client.page.watchCapsule((c) => got.push(c.title));` add:
```js
  assert('watchCapsule without options sends none', page.opts === undefined);
  const stopM = await client.page.watchCapsule(() => {}, { markers: { start: 'S', end: 'E' } });
  assert('watchCapsule options reach the tab', page.opts?.markers?.start === 'S' && page.opts.markers.end === 'E');
  stopM();
```

- [ ] **Step 2: Run to see them fail**

Run: `npm test 2>&1 | grep -E "markers|options"`
Expected: FAIL lines (or `CAPSULE_MARKERS` import error)

- [ ] **Step 3: Implement**

`content/capsule.js`, after `export const CAPSULE_END = ...;`:
```js
export const CAPSULE_MARKERS = Object.freeze({ start: CAPSULE_START, end: CAPSULE_END });
```
`parseCapsule`:
```js
/**
 * @param {string} text Reply text
 * @param {{ loose?: boolean, markers?: { start: string, end: string } }} [opts] loose: no markers needed
 *   (the whole reply is the Capsule); markers: other START / END lines (Memory's Learn reply)
 * @returns {{ title: string, body: string }|null} null when there is no complete Capsule
 */
export function parseCapsule(text, { loose = false, markers = CAPSULE_MARKERS } = {}) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  const start = src.indexOf(markers.start);
  const end = start < 0 ? -1 : src.indexOf(markers.end, start + markers.start.length);
  if (!loose && end < 0) return null; // No START, or the reply is still streaming
  let body = src.slice(start < 0 ? 0 : start + markers.start.length, end < 0 ? undefined : end).trim();
```
(the rest of the function is unchanged).

`readLatestCapsule`: add `@param {{ start: string, end: string }} [markers]` to its JSDoc and
```js
export function readLatestCapsule(doc, replySelector, ignoreBody = null, markers = CAPSULE_MARKERS) {
  if (!doc || !replySelector) return null;
  const replies = doc.querySelectorAll(replySelector);
  for (let i = replies.length - 1; i >= Math.max(0, replies.length - CAPSULE_REPLIES_SCANNED); i--) {
    const capsule = parseCapsule(replies[i].innerText || replies[i].textContent, { markers });
    if (capsule) return capsule.body === ignoreBody ? null : capsule;
  }
  return null;
}
```

`content/page-actions.js`, `watchCapsule`:
```js
    /**
     * Waits for a Capsule in a new reply (at most one read per 500 ms while it streams); reports it once.
     * @param {{ markers?: { start: string, end: string } }} [opts] Other START / END lines (Memory's Learn)
     */
    async watchCapsule(onFound, { markers } = {}) {
      const ignoreBody = readLatestCapsule(doc, replySelector, null, markers)?.body ?? null;
```
and inside the timer: `const capsule = readLatestCapsule(doc, replySelector, ignoreBody, markers);`

`content/panel-channel.js`, in `servePanel`:
```js
          const stop = await page.watchCapsule((capsule) => send(p, { type: 'CAPSULE', id: m.id, capsule }), ...(m.args || []));
```
in `connectPanel`:
```js
    async watchCapsule(onFound, opts) {
      const id = seq + 1; // call() takes this id
      capsuleCbs.set(id, onFound);
      try { await call('watchCapsule', opts ? [opts] : []); } catch (e) { capsuleCbs.delete(id); throw e; }
```

- [ ] **Step 4: Build and run everything**

Run: `npm run build && npm test && npm run lint && npm run validate`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add content/capsule.js content/page-actions.js content/panel-channel.js content/content-script.js sidepanel/sidepanel.js tests/unit/capsule.test.js tests/unit/panel-channel.test.js
git commit -m "feat: reply watcher takes custom START / END markers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Memory module (secret guard, Learn prompt, parser, inbox, approve-by-key, insert format)

**Files:**
- Create: `content/memory.js`, `tests/unit/memory.test.js`
- Modify: `tests/run-tests.js`, `scripts/build.js` (`PANEL_MODULES`)

**Interfaces:**
- Consumes: `CapsuleStore`, `MEMORY_CATEGORIES`, `normalizeMemoryKey`, `CAPSULE_MAX_SELECTION` from `content/capsule.js`.
- Produces (all exported from `content/memory.js`):
  - `MEMORIES_KEY = 'memories'`, `MEMORY_INBOX_KEY = 'memoryInbox'`, `MEMORY_MARKERS = { start: '=== MEMORY START ===', end: '=== MEMORY END ===' }`, `MEMORY_MAX = 500`
  - `looksSecret(text: string): boolean`
  - `memoryReject(item: { body: string }): string|null`
  - `memoryStore(area): CapsuleStore` (key `memories`, noun `Memory`, plural `Memories`, `reject: memoryReject`)
  - `buildMemoryPrompt(selection?: string, keys?: string[]): string`
  - `parseMemories(body: string): Array<{ category, key: string|null, text }>`
  - `readInbox(area): Promise<Array<{ id, category, key, text, source, at }>>`, `addToInbox(area, facts, source, now?): Promise<number>`, `removeFromInbox(area, ids: string[]): Promise<void>`
  - `approveMemory(store, fact): Promise<{ memory: Object, updated: boolean }>`
  - `formatMemoriesForInsert(memories: Array<{ body }>): string`

- [ ] **Step 1: Write the failing tests** — create `tests/unit/memory.test.js`:

```js
/** Unit Tests for content/memory.js: secret guard, Learn prompt and reply parsing, inbox, approve-by-key, insert format. */

import {
  MEMORIES_KEY, MEMORY_INBOX_KEY, MEMORY_MARKERS, MEMORY_MAX, looksSecret, memoryReject, memoryStore,
  buildMemoryPrompt, parseMemories, readInbox, addToInbox, removeFromInbox, approveMemory, formatMemoriesForInsert
} from '../../content/memory.js';

function fakeArea() {
  const data = {};
  return {
    data,
    async get(key) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(obj) { Object.assign(data, structuredClone(obj)); },
    async remove(key) { delete data[key]; }
  };
}

export async function runMemoryTests() {
  console.log('--- Running Memory Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; } else { console.error(`  ❌ [FAIL] ${name}`); failed++; }
  };

  // Secret guard
  for (const s of ['sk-proj-abcdefghijklmnop1234', 'AKIAABCDEFGHIJKLMNOP', 'ghp_' + 'a'.repeat(36), 'xoxb-1234567890-abc',
    'AIza' + 'b'.repeat(35), '-----BEGIN RSA PRIVATE KEY-----', 'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4',
    'password: hunter2', 'my card 4111 1111 1111 1111']) assert(`Secret caught: ${s.slice(0, 12)}…`, looksSecret(s));
  for (const s of ['Favorite fruit is mango', 'Phone order 1234 5678 9012 3456 is not Luhn', 'Uses React 19 and Node 22', 'Wants passwords never stored'])
    assert(`Not a secret: ${s.slice(0, 20)}…`, !looksSecret(s));
  assert('Reject: secret', memoryReject({ body: 'password=abc' }) === 'Looks like a secret: not saved');
  assert('Reject: too long', memoryReject({ body: 'x'.repeat(MEMORY_MAX + 1) }) === `Memory is too long (${MEMORY_MAX} characters max)`);
  assert('Reject: fine', memoryReject({ body: 'Likes mango' }) === null);

  // Store factory
  const area = fakeArea();
  const store = memoryStore(area);
  assert('Memory store key and names', store.key === MEMORIES_KEY && store.noun === 'Memory' && store.plural === 'Memories');
  let err = null; try { await store.save({ body: 'token sk-abcdefghijklmnopqrst' }); } catch (e) { err = e.message; }
  assert('Memory store refuses secrets', err === 'Looks like a secret: not saved');

  // Prompt
  const p = buildMemoryPrompt();
  assert('Prompt has both markers and the line format', p.includes(MEMORY_MARKERS.start) && p.includes(MEMORY_MARKERS.end) && p.includes('- category | key | fact'));
  assert('Prompt names every category', ['profile', 'preference', 'project', 'instruction', 'skill', 'decision', 'other'].every(c => p.includes(c)));
  assert('Prompt without keys has no reuse line', !p.includes('reuse that key'));
  const pk = buildMemoryPrompt(' only this ', Array.from({ length: 150 }, (_, i) => `profile.k${i}`));
  assert('Prompt with a selection focuses on it', pk.includes('"""\nonly this\n"""'));
  assert('Prompt lists at most 100 keys', pk.includes('profile.k99') && !pk.includes('profile.k100'));

  // Parser
  const facts = parseMemories([
    '- preference | preference.favorite-fruit | Favorite fruit is mango',
    '* project | project.shopeasy-stack | "Building ShopEasy with React"',
    '- food | | Eats spicy food',
    '- category | key | fact',
    '- profile | profile.secret | password: hunter2',
    '- preference | preference.favorite-fruit | Favorite fruit is apple',
    '- none',
    'not a fact line',
    `- other | | ${'y'.repeat(MEMORY_MAX + 1)}`
  ].join('\n'));
  assert('Parser keeps valid facts in order', facts.length === 3 && facts[0].text === 'Favorite fruit is mango' && facts[1].text === 'Building ShopEasy with React');
  assert('Parser: key and category', facts[0].key === 'preference.favorite-fruit' && facts[1].category === 'project');
  assert('Parser: unknown category → other, empty key → null', facts[2].category === 'other' && facts[2].key === null);
  assert('Parser: "- none" and an empty reply give nothing', parseMemories('- none').length === 0 && parseMemories('').length === 0);

  // Inbox
  const ia = fakeArea();
  assert('Empty inbox', (await readInbox(ia)).length === 0);
  assert('Add returns the count', (await addToInbox(ia, facts.slice(0, 2), 'Claude', 1000)) === 2);
  const in1 = await readInbox(ia);
  assert('Inbox entries carry source, time and an id', in1[0].source === 'Claude' && in1[0].at === 1000 && typeof in1[0].id === 'string');
  await addToInbox(ia, [{ category: 'preference', key: 'preference.favorite-fruit', text: 'Favorite fruit is apple' }], 'ChatGPT', 2000);
  const in2 = await readInbox(ia);
  assert('Same key replaces the waiting fact; newest first', in2.length === 2 && in2[0].text === 'Favorite fruit is apple');
  await addToInbox(ia, Array.from({ length: 60 }, (_, i) => ({ category: 'other', key: null, text: `fact ${i}` })), 'Gemini', 3000);
  assert('Inbox keeps at most 50', (await readInbox(ia)).length === 50);
  const firstId = (await readInbox(ia))[0].id;
  await removeFromInbox(ia, [firstId]);
  assert('Remove by id', !(await readInbox(ia)).some(f => f.id === firstId) && ia.data[MEMORY_INBOX_KEY].length === 49);

  // Approve
  const sa = memoryStore(fakeArea());
  const r1 = await approveMemory(sa, { category: 'preference', key: 'preference.favorite-fruit', text: 'Favorite fruit is mango', source: 'Claude' });
  assert('Approve saves a new memory', r1.updated === false && r1.memory.body === 'Favorite fruit is mango' && r1.memory.category === 'preference');
  await sa.setPinned(r1.memory.id, true);
  const r2 = await approveMemory(sa, { category: 'preference', key: 'preference.favorite-fruit', text: 'Favorite fruit is apple', source: 'ChatGPT' });
  const all = await sa.list();
  assert('Same key updates in place (same id, pin kept)', r2.updated === true && all.length === 1 && all[0].id === r1.memory.id && all[0].body === 'Favorite fruit is apple' && all[0].pinned === true);
  const r3 = await approveMemory(sa, { category: 'other', key: null, text: 'Eats spicy food', source: 'Gemini' });
  assert('No key: always a new memory', r3.updated === false && (await sa.list()).length === 2);

  // Insert format
  const text = formatMemoriesForInsert([{ body: 'Likes mango' }, { body: 'Uses React\nand Node' }]);
  assert('Insert format', text === 'About me (saved memory). Use it as background; do not repeat it back.\n- Likes mango\n- Uses React and Node');

  return { passed, failed };
}
```

Register in `tests/run-tests.js`: `import { runMemoryTests } from './unit/memory.test.js';` with the other imports, and `runMemoryTests // Memory: secret guard, Learn parsing, inbox, approve-by-key` as the last `SUITES` entry (add a comma after `runPanelChannelTests // ...`).

- [ ] **Step 2: Run to see it fail**

Run: `npm test 2>&1 | tail -5`
Expected: error `Cannot find module ... content/memory.js`

- [ ] **Step 3: Implement** — create `content/memory.js`:

```js
/**
 * AI Super Powers - Memory
 *
 * Short facts about the user, shared by every AI: added by hand, or learned from a chat (the AI lists
 * facts, the user approves each one in the inbox). Stored by the shared CapsuleStore under MEMORIES_KEY.
 *
 *   looksSecret / memoryReject   never store keys, passwords, tokens or card numbers
 *   buildMemoryPrompt            Learn: text placed in the chat box (the user presses Enter)
 *   parseMemories                facts from the reply between the MEMORY markers
 *   readInbox / addToInbox / …   learned facts waiting for ✅ / ❌
 *   approveMemory                saves a fact; the same key replaces the stored memory
 *   formatMemoriesForInsert      what Inject puts in the chat box
 */

import { CapsuleStore, MEMORY_CATEGORIES, normalizeMemoryKey, CAPSULE_MAX_SELECTION } from './capsule.js';

export const MEMORIES_KEY = 'memories';
export const MEMORY_INBOX_KEY = 'memoryInbox';
export const MEMORY_MARKERS = Object.freeze({ start: '=== MEMORY START ===', end: '=== MEMORY END ===' });
export const MEMORY_MAX = 500;
const INBOX_MAX = 50;
const PROMPT_KEYS_MAX = 100;

const SECRET_PATTERNS = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/, // OpenAI / Stripe-style keys
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}/, // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
  /\b(?:password|passwd|pwd|passcode|pin)\s*[:=]\s*\S+/i
];

/** A 13-19 digit run (spaces / dashes allowed) that passes the Luhn check: a card number. */
function hasCardNumber(text) {
  for (const m of text.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)) {
    const d = m[0].replace(/\D/g, '');
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = Number(d[d.length - 1 - i]);
      if (i % 2) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

/** True when the text holds something that must never be stored (keys, tokens, passwords, cards). */
export function looksSecret(text) {
  const s = String(text || '');
  return SECRET_PATTERNS.some(r => r.test(s)) || hasCardNumber(s);
}

/** CapsuleStore `reject` hook for memories. */
export function memoryReject(item) {
  if (looksSecret(item.body)) return 'Looks like a secret: not saved';
  if (item.body.length > MEMORY_MAX) return `Memory is too long (${MEMORY_MAX} characters max)`;
  return null;
}

/** The memories list in a chrome.storage area. */
export const memoryStore = (area) => new CapsuleStore(area, { key: MEMORIES_KEY, noun: 'Memory', plural: 'Memories', reject: memoryReject });

/**
 * Learn: asks the current AI to list lasting facts about the user, one per line, between the markers.
 * @param {string} [selection] Chat text the user selected: only that part is used
 * @param {string[]} [keys] Keys already stored: the AI reuses one when a fact changed
 */
export function buildMemoryPrompt(selection = '', keys = []) {
  const focus = String(selection || '').trim().slice(0, CAPSULE_MAX_SELECTION);
  const known = (keys || []).slice(0, PROMPT_KEYS_MAX);
  return [
    'From this conversation, list facts about me (the user) that are worth remembering in future chats with any AI.',
    ...(focus ? ['', 'Only from this part of the conversation:', '"""', focus, '"""'] : []),
    '',
    'Rules:',
    '- Only lasting facts: who I am, my preferences, my projects and their tech, how I want answers, my skills, decisions I made.',
    '- Not: one-off task details, things only true today, facts about other people, passwords, keys or other secrets.',
    '- One short sentence per fact, about me ("Prefers short answers", "Building ShopEasy with React").',
    `- category is one of: ${MEMORY_CATEGORIES.join(', ')}.`,
    '- key is category.topic in lowercase with dashes, e.g. preference.favorite-fruit. The same topic always gets the same key.',
    ...(known.length ? [`- If a fact updates one of these existing keys, reuse that key: ${known.join(', ')}`] : []),
    '- If there is nothing worth remembering, write only "- none".',
    '- Reply with only one code block fenced with four backticks (````), in exactly this format:',
    '',
    '````',
    MEMORY_MARKERS.start,
    '- category | key | fact',
    MEMORY_MARKERS.end,
    '````'
  ].join('\n');
}

/**
 * Facts from a Learn reply's body ("- category | key | fact" lines). Unknown categories become 'other',
 * bad keys null; secrets, empty and over-long facts are dropped; a repeated key or text keeps the first.
 * @returns {Array<{ category: string, key: string|null, text: string }>}
 */
export function parseMemories(body) {
  const out = [];
  for (const line of String(body || '').split('\n')) {
    const m = line.match(/^\s*[-*•]\s*(.+?)\s*\|\s*(.*?)\s*\|\s*(.+?)\s*$/);
    if (!m || m[1].toLowerCase() === 'category') continue; // Not a fact, or the format line echoed back
    const category = MEMORY_CATEGORIES.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : 'other';
    const key = normalizeMemoryKey(m[2]);
    const text = m[3].replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!text || text.length > MEMORY_MAX || looksSecret(text)) continue;
    if (out.some(f => (key && f.key === key) || f.text.toLowerCase() === text.toLowerCase())) continue;
    out.push({ category, key, text });
  }
  return out;
}

/** @returns {Promise<Array<{ id: string, category: string, key: string|null, text: string, source: string, at: number }>>} newest first */
export async function readInbox(area) {
  const list = (await area.get(MEMORY_INBOX_KEY))?.[MEMORY_INBOX_KEY];
  return Array.isArray(list) ? list : [];
}

/**
 * Adds learned facts to the inbox, newest first. A waiting fact with the same key or text is replaced;
 * at most 50 are kept. ponytail: read-modify-write of one list, like CapsuleStore.
 * @returns {Promise<number>} facts added
 */
export async function addToInbox(area, facts, source, now = Date.now()) {
  const same = (a, b) => (a.key && a.key === b.key) || a.text.toLowerCase() === b.text.toLowerCase();
  const fresh = (facts || []).map((f, i) => ({ id: `${now.toString(36)}-${i}`, category: f.category, key: f.key, text: f.text, source, at: now }));
  const kept = (await readInbox(area)).filter(old => !fresh.some(f => same(old, f)));
  await area.set({ [MEMORY_INBOX_KEY]: [...fresh, ...kept].slice(0, INBOX_MAX) });
  return fresh.length;
}

/** @param {string[]} ids */
export async function removeFromInbox(area, ids) {
  const drop = new Set(ids);
  await area.set({ [MEMORY_INBOX_KEY]: (await readInbox(area)).filter(f => !drop.has(f.id)) });
}

/**
 * Saves an inbox fact. A stored memory with the same key is replaced (same id; tags, project and pin
 * kept), so a changed fact updates instead of piling up.
 * @param {CapsuleStore} store memoryStore(area)
 * @param {{ category: string, key: string|null, text: string, source?: string }} fact
 */
export async function approveMemory(store, fact) {
  const old = fact.key ? (await store.list()).find(m => m.key === fact.key) : null;
  const memory = await store.save({ id: old?.id, title: fact.text, body: fact.text, category: fact.category, key: fact.key, source: fact.source });
  return { memory, updated: Boolean(old) };
}

/** What Inject (and Insert / Copy on a memory) puts in the chat box. */
export function formatMemoriesForInsert(memories) {
  return `About me (saved memory). Use it as background; do not repeat it back.\n${(memories || []).map(m => `- ${String(m.body).replace(/\s*\n\s*/g, ' ')}`).join('\n')}`;
}
```

`scripts/build.js`, `PANEL_MODULES`: insert `'content/memory.js',` right after `'content/capsule.js',`.

- [ ] **Step 4: Build and run everything**

Run: `npm run build && npm test && npm run lint && npm run validate`
Expected: all pass, `--- Running Memory Tests ---` all ✅

- [ ] **Step 5: Commit**

```bash
git add content/memory.js tests/unit/memory.test.js tests/run-tests.js scripts/build.js sidepanel/sidepanel.js
git commit -m "feat: memory module - secret guard, Learn prompt and parser, inbox, approve-by-key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Memory panel (`CapsulePanel` kind `'memory'`)

**Files:**
- Modify: `ui/capsule-panel.js`
- Test: manual (the panel is DOM UI with no unit harness; its logic was tested in Tasks 2–4) + build / lint

**Interfaces:**
- Consumes: everything from `content/memory.js` (Task 4); `page.watchCapsule(onFound, { markers })` (Task 3); `CapsuleStore.plural` (Task 2).
- Produces: `CapsulePanel(parent, { kind: 'memory', storage, page, toast, reveal })` → `{ view, refresh, setView, capture, stop }` (same shape as today).

- [ ] **Step 1: Imports and kind switches.** Add the import line (one line, column 0):

```js
import { memoryStore, buildMemoryPrompt, parseMemories, readInbox, addToInbox, removeFromInbox, approveMemory, formatMemoriesForInsert, MEMORY_MARKERS, MEMORY_MAX } from '../content/memory.js';
```
Add `MEMORY_CATEGORIES` to the existing `../content/capsule.js` import line. Replace the first lines of `CapsulePanel`:
```js
  const isSkill = ctx.kind === 'skill';
  const isMemory = ctx.kind === 'memory';
  const provider = ctx.page.provider; // Fixed texts only: the side panel's page follows the active tab, so live uses read ctx.page.provider
  const noun = isSkill ? 'Skill' : isMemory ? 'Memory' : 'Capsule';
  const plural = isMemory ? 'Memories' : `${noun}s`;
  // Text that Insert / Copy / the cost use, for one item and for several ticked ones
  const fmt = isSkill ? formatSkillForInsert : isMemory ? (m) => formatMemoriesForInsert([m]) : formatForInsert;
  const fmtMany = (list) => (isMemory ? formatMemoriesForInsert(list) : formatManyForInsert(list, ctx.kind));
  const view = h('div', 'body caps hide', parent);
  const store = !ctx.storage ? null : isMemory ? memoryStore(ctx.storage) : new CapsuleStore(ctx.storage, isSkill ? { key: SKILLS_KEY, noun } : {});
```
Replace every `` `${noun}s` `` / `` ${noun}s `` in user-visible strings with `plural` (search placeholder and aria-label, export / import tips, file input aria-label, the import error compare: ``e?.message === `Not a ${plural} file` ``, and the export toast `` `Exported ${items.length} ${items.length === 1 ? noun : plural}` ``). Replace both `formatManyForInsert(..., ctx.kind)` calls (in `updatePick` and `pickedText`) with `fmtMany(...)`.

- [ ] **Step 2: Memory controls.** After the Skills `newBtn` / `skillHint` lines:
```js
  newBtn.textContent = isMemory ? '＋ New memory' : '＋ New Skill';
  // Memory: learn facts from this chat (the AI lists them, the user approves each one)
  const learnBtn = textButton(view, '🧠 Learn from this chat');
  learnBtn.dataset.tip = 'This AI lists facts about you worth remembering; you approve each one';
  const memoryHint = h('div', 'fine', view, 'Memory is shared by ChatGPT, Claude and Gemini. Select part of the chat first to learn only from that part.');
  const inboxCard = h('div', 'card hide', view);
  inboxCard.setAttribute('role', 'status');
  const inboxHead = h('div', 't', inboxCard);
  const inboxList = h('div', null, inboxCard);
  const inboxBtns = h('div', 'btns', inboxCard);
  const injectRow = h('div', 'card hide', view);
  const injectBtn = textButton(injectRow, '💉 Inject memory', null, 'btn primary');
  injectBtn.dataset.tip = 'Put the memories shown below (search and project apply) in the chat box';
  const injectCost = h('div', 'm', injectRow);
  let inbox = []; // Learned facts waiting for ✅ / ❌
  let injectSeq = 0; // Latest cost count wins
```
In the editor, after `titleIn` is created:
```js
  const categorySel = h('select', 'field', draft);
  categorySel.setAttribute('aria-label', 'Memory category');
  for (const c of MEMORY_CATEGORIES) h('option', null, categorySel, c).value = c;
```
After `bodyIn` placeholder lines:
```js
  if (isMemory) {
    bodyIn.placeholder = 'One fact about you, e.g. "Prefers short answers"';
    bodyIn.maxLength = MEMORY_MAX;
  }
```
`'pointerdown'` selection capture: change the array to `[create, quickBtn, handoffBtn, learnBtn]`.

- [ ] **Step 3: Modes, waiting text, editor.** In `mode`:
```js
    const capture = idle && !isSkill && !isMemory; // AI capture exists only for Capsules
    ...
    show(newBtn, idle && (isSkill || isMemory));
    show(skillHint, idle && isSkill);
    show(learnBtn, idle && isMemory);
    show(memoryHint, idle && isMemory);
    show(inboxCard, idle && isMemory && inbox.length > 0);
    show(titleIn, !isMemory);
    show(categorySel, isMemory);
```
Waiting card texts:
```js
  h('div', 't', wait, isMemory ? 'Waiting for the facts…' : 'Waiting for the Capsule…');
  h('div', 'm', wait, `Press Enter in the chat to send the prompt. ${isMemory ? 'New facts appear here for review' : 'The Capsule opens here'} when ${provider} has written ${isMemory ? 'them' : 'it'}.`);
```
In `openDraft`, after `bodyIn.value = ...`: `categorySel.value = (capsule.id && items.find(c => c.id === capsule.id)?.category) || capsule.category || 'other';` and focus the body for memories: replace `titleIn.focus(...)` with `(isMemory ? bodyIn : titleIn).focus({ preventScroll: true });`.
Save handler, `store.save({...})` argument becomes:
```js
      await store.save({ id: editing?.id, source: editing?.source, title: isMemory ? bodyIn.value : titleIn.value, body: bodyIn.value, tags: tagsIn.value, project: projectIn.value, ...(isMemory ? { category: categorySel.value } : {}) });
```
and its error toast:
```js
      const shown = [`${noun} is empty`, 'Looks like a secret: not saved', `Memory is too long (${MEMORY_MAX} characters max)`];
      return ctx.toast(shown.includes(e?.message) ? e.message : 'Save failed');
```

- [ ] **Step 4: Learn, watcher, inbox.** In `startWaiting`, the watch call becomes:
```js
      stop = await ctx.page.watchCapsule((capsule) => {
        if (watcher !== w) return;
        if (isMemory) { learned(capsule); return; }
        draftFrom(capsule, from);
        ctx.reveal();
        ctx.toast('Capsule ready: review and save');
      }, isMemory ? { markers: MEMORY_MARKERS } : undefined);
```
In the "Use last reply" handler:
```js
    const capsule = parseCapsule(await ctx.page.latestReply(), { loose: true, ...(isMemory ? { markers: MEMORY_MARKERS } : {}) });
    if (watcher !== w) return; // Cancelled, or the reply arrived, meanwhile
    if (!capsule) return ctx.toast('No reply yet');
    if (isMemory) return learned(capsule);
    draftFrom(capsule, w?.from);
```
Add after `promptAndWait`:
```js
  learnBtn.addEventListener('click', onPage(async () => {
    const selection = await takeSelection();
    if (!(await ctx.page.hasConversation())) return ctx.toast('Open a conversation first');
    if (limit) return ctx.toast(`${ctx.page.provider}'s limit is reached: learn later, or add a memory by hand`);
    await promptAndWait(buildMemoryPrompt(selection, items.map(m => m.key).filter(Boolean)));
  }));

  /** A Learn reply arrived: its facts go to the inbox for review. */
  async function learned(capsule) {
    watcher = null;
    mode('idle');
    const facts = parseMemories(capsule.body);
    if (!facts.length) return ctx.toast('Nothing new to remember in this chat');
    try { await addToInbox(ctx.storage, facts, ctx.page.provider); } catch (_) { return ctx.toast('Save failed'); }
    ctx.reveal();
    ctx.toast(`${facts.length} new ${facts.length === 1 ? 'memory' : 'memories'} to review`);
    refresh();
  }

  function renderInbox() {
    if (!isMemory) return;
    setText(inboxHead, `📥 ${inbox.length} new ${inbox.length === 1 ? 'memory' : 'memories'} to review`);
    inboxList.textContent = '';
    for (const f of inbox) {
      const row = h('div', 'card', inboxList);
      h('div', 't', row, f.text);
      const replaces = f.key && items.some(m => m.key === f.key);
      h('div', 'm', row, `${f.category} · from ${f.source}${replaces ? ' · updates a saved memory' : ''}`);
      const b = h('div', 'btns', row);
      textButton(b, '✅ Save', () => approve([f]));
      textButton(b, '❌ Ignore', () => ignore([f]));
    }
    mode(current);
  }

  async function approve(facts) {
    let saved = 0;
    let updated = 0;
    const done = [];
    for (const f of facts) {
      try {
        const r = await approveMemory(store, f);
        done.push(f.id);
        if (r.updated) updated++; else saved++;
      } catch (e) { ctx.toast(e?.message || 'Save failed'); }
    }
    try { await removeFromInbox(ctx.storage, done); } catch (_) {}
    if (done.length) ctx.toast(updated ? `Saved ${saved}, updated ${updated}` : `Saved ${saved}`);
    refresh();
  }

  async function ignore(facts) {
    try { await removeFromInbox(ctx.storage, facts.map(f => f.id)); } catch (_) { return ctx.toast('Ignore failed'); }
    refresh();
  }
  textButton(inboxBtns, 'Save all', () => approve(inbox));
  textButton(inboxBtns, 'Ignore all', () => ignore(inbox));
```
In `refresh()`, after the hand-off block: 
```js
    if (isMemory) { try { inbox = await readInbox(ctx.storage); } catch (_) { inbox = []; } }
```
and after `renderList();` at its end: `renderInbox();`.

- [ ] **Step 5: Cards and Inject.** In `renderItem`:
```js
    h('div', 't', th, isMemory ? capsule.body : capsule.title);
    ...
    h('div', 'm', card, `${isMemory ? `${capsule.category || 'other'} · ` : ''}${capsule.source} · ${date}${capsule.project ? ` · 📁 ${capsule.project}` : ''}`);
```
Insert toast: `ctx.toast(isSkill ? 'Skill added: write your question and send' : isMemory ? 'Memory added: write your question and send' : 'Inserted: add your question and send')`. Update button condition: `if (!isSkill && !isMemory) {`.

At the end of `renderList()` (before `updatePick();`):
```js
    if (isMemory) {
      show(injectRow, shown.length > 0);
      const seq = ++injectSeq;
      countOne(() => formatMemoriesForInsert(shown)).then((tokens) => {
        if (seq !== injectSeq || tokens === null) return;
        const cost = formatCost(tokens, view_.contextLimit, view_.remaining);
        setText(injectCost, `${shown.length} ${shown.length === 1 ? 'memory' : 'memories'} · ${cost.text}${cost.tooBig ? ' · too big for this chat' : ''}`);
        injectCost.classList.toggle('bad', cost.tooBig);
      }).catch(() => {});
    }
```
After the search / project listeners:
```js
  injectBtn.addEventListener('click', onPage(async () => {
    const shown = searchItems(items, query, { project: projectFilter || null });
    if (!shown.length) return ctx.toast('No memories to inject');
    const text = formatMemoriesForInsert(shown);
    if (await ctx.page.fill(text)) ctx.toast(`Injected ${shown.length} ${shown.length === 1 ? 'memory' : 'memories'}: write your question and send`);
    else navigator.clipboard.writeText(text).then(() => ctx.toast('Chat box not found: copied instead'), () => ctx.toast('Copy failed'));
  }));
```
Empty-list text: `const empty = h('div', 'fine', view, isSkill ? '…existing Skill text…' : isMemory ? 'No memories yet. Add one, or 🧠 Learn from a chat; then inject them into any AI.' : '…existing Capsule text…');`

- [ ] **Step 6: Build and run everything**

Run: `npm run build && npm test && npm run lint && npm run validate`
Expected: all pass (the panel is not mounted as `memory` yet; Task 6 does that)

- [ ] **Step 7: Commit**

```bash
git add ui/capsule-panel.js sidepanel/sidepanel.js
git commit -m "feat: Memory panel - learn from chat, inbox, categories, inject with cost

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Side panel Brain section

**Files:**
- Modify: `sidepanel/main.js`, `ui/styles.js`
- Test: `npm test` (bundle-integrity) + manual check below

**Interfaces:**
- Consumes: `CapsulePanel` with `kind: 'memory'` (Task 5); `MEMORIES_KEY`, `MEMORY_INBOX_KEY` (Task 4).
- Produces: `select(id, sub?)` in `main.js`; tabs `context | brain | settings`, Brain sub-tabs `memory | capsules | skills`.

- [ ] **Step 1: Tabs.** In `sidepanel/main.js` add the import line:
```js
import { MEMORIES_KEY, MEMORY_INBOX_KEY } from '../content/memory.js';
```
Replace `TABS` and add `BRAIN_TABS`:
```js
  const TABS = [ // Adding a feature = one entry here (+ a Settings section)
    { id: 'context', label: 'Context' },
    { id: 'brain', label: '🧠 Brain' },
    { id: 'settings', label: '⚙', title: 'Settings' }
  ];
  const BRAIN_TABS = [{ id: 'memory', label: 'Memory' }, { id: 'capsules', label: 'Capsules' }, { id: 'skills', label: 'Skills' }];
```
`let active = 'context';` → add `let brainTab = 'memory';` below it. After the `tabBtns` block:
```js
  const subnav = h('div', 'tabs sub', root);
  subnav.setAttribute('role', 'tablist');
  subnav.setAttribute('aria-label', 'Brain');
  const subBtns = Object.fromEntries(BRAIN_TABS.map(t => {
    const b = textButton(subnav, t.label, () => select('brain', t.id), 'tab');
    b.setAttribute('role', 'tab');
    return [t.id, b];
  }));
```
`saveAsCapsule: () => { select('brain', 'capsules'); caps.capture(); }`. Panels:
```js
  const memory = CapsulePanel(root, { kind: 'memory', storage, page, toast, reveal: () => select('brain', 'memory') });
  const caps = CapsulePanel(root, { kind: 'capsule', storage, page, toast, reveal: () => select('brain', 'capsules') });
  const skills = CapsulePanel(root, { kind: 'skill', storage, page, toast, reveal: () => select('brain', 'skills') });
```
`function select(id, sub) { active = id; if (sub) brainTab = sub; render(); }`

In `render()`:
```js
    show(subnav, active === 'brain');
    show(memory.view, active === 'brain' && brainTab === 'memory');
    show(caps.view, active === 'brain' && brainTab === 'capsules');
    show(skills.view, active === 'brain' && brainTab === 'skills');
    show(settingsView.el, active === 'settings');
    for (const [id, b] of Object.entries(tabBtns)) b.setAttribute('aria-selected', String(id === active));
    for (const [id, b] of Object.entries(subBtns)) b.setAttribute('aria-selected', String(id === brainTab));
```
(replacing the old `caps.view` / `skills.view` lines.)

`endWaits`:
```js
    const stopped = [caps.stop(), memory.stop()].some(Boolean);
    skills.stop();
    if (stopped) toast('Wait stopped: the tab changed');
```
`setState`: add `memory.setView(s);`. `storage.onChanged`: add `if (ch[MEMORIES_KEY] || ch[MEMORY_INBOX_KEY]) memory.refresh();`. Startup: add `memory.refresh();` next to `caps.refresh();`. Update the file header comment's tab list to `Context | Brain (Memory · Capsules · Skills) | Settings`.

- [ ] **Step 2: Style.** `ui/styles.js`, after the `.panelpage > .tabs { … }` rule:
```css
  .panelpage > .tabs.sub { padding: 4px 8px; }
```

- [ ] **Step 3: Build and run everything**

Run: `npm run build && npm test && npm run lint && npm run validate`
Expected: all pass

- [ ] **Step 4: Manual check** (load unpacked from the repo folder at `chrome://extensions`, reload the extension, open the side panel on each site)
1. Tabs read **Context · 🧠 Brain · ⚙**; Brain shows **Memory · Capsules · Skills**, Memory first. Capsules / Skills behave as before; Context → "Save as Capsule" lands on Brain → Capsules.
2. Memory → ＋ New memory → "Prefers short answers", category preference → Save → card shows the fact and `preference · …`.
3. ＋ New memory with `password: abc` → toast `Looks like a secret: not saved`.
4. In a Claude chat say "my favorite fruit is mango", then 🧠 Learn → prompt fills the box → Enter → inbox shows the fact → ✅ Save.
5. In a ChatGPT chat say "I prefer apples now" → 🧠 Learn → inbox row says `updates a saved memory` → ✅ → the same card now says apple (count unchanged).
6. 💉 Inject memory on Gemini → box filled with `About me (saved memory)…`; cost line shows `~N tokens · x% of window`; nothing is sent.
7. Export memories → Import the file again → `0 added, 0 updated, N skipped`.

- [ ] **Step 5: Commit**

```bash
git add sidepanel/main.js sidepanel/sidepanel.js ui/styles.js
git commit -m "feat: side panel Brain section - Memory, Capsules, Skills

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, privacy and version 1.2.0

**Files:**
- Modify: `manifest.json` (`"version": "1.2.0"`), `package.json` + `package-lock.json` top-level `version` → `1.2.0`, `CHANGELOG.md`, `PRIVACY.md`, `CHROMEWEBSTORE.md`, `README.md`

- [ ] **Step 1: CHANGELOG** — new section on top:
```markdown
## [1.2.0] - 2026-10-02

### Changed
- Renamed to **AI Super Powers**.
- Side panel: **Context · 🧠 Brain · ⚙**. Brain holds **Memory**, **Capsules** and **Skills**.

### Added
- **Memory**: short facts about you, shared by ChatGPT, Claude and Gemini. Add by hand, or **🧠 Learn from this chat** (the AI lists facts; you approve each one in the inbox). A fact with the same key updates the saved one. **💉 Inject memory** fills the chat box, with its token cost. `content/memory.js`, `tests/unit/memory.test.js`.
- Secret guard: memories that look like keys, tokens, passwords or card numbers are never saved (also on import and Learn).
```

- [ ] **Step 2: PRIVACY.md** — under "What it does with that data", add:
```markdown
- **Memory:** facts you save (or approve after **Learn from this chat**) are stored in your browser. Learn only puts a prompt in the chat box; you choose whether to send it. Facts that look like passwords, keys, tokens or card numbers are never stored.
```
Under "What it stores", add:
```markdown
- `chrome.storage.local`: Memories (fact, category, topic key, project, tags, site name, dates) and the review inbox of learned facts (at most 50). You can edit or delete each one in Brain → Memory.
```

- [ ] **Step 3: CHROMEWEBSTORE.md and README.md** — add a "Memory" paragraph (same facts as the CHANGELOG entry) next to the Capsules description, and update the side panel tab list to Context · Brain (Memory · Capsules · Skills) · Settings.

- [ ] **Step 4: Run everything, including packaging**

Run: `npm run build && npm test && npm run lint && npm run validate && npm run pack`
Expected: all pass; `dist/ai-super-powers-1.2.0.zip` written

- [ ] **Step 5: Commit**

```bash
git add manifest.json package.json package-lock.json CHANGELOG.md PRIVACY.md CHROMEWEBSTORE.md README.md
git commit -m "release: 1.2.0 - AI Super Powers, Brain section, Memory

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Later plans (not here)
- **Phase 3:** auto-learn (regex pre-filter on the user's own messages + Chrome Prompt API on-device → inbox); import ChatGPT saved memories (`conversation-client.js` `fetchMemories`) into the inbox.
- **Phase 4:** opt-in auto-prefill of memory on a new chat; 🧠 button in the in-page widget; "Continue in another AI".
- **Phase 5:** opt-in `chrome.storage.sync` for memories; MCP companion (separate product).
