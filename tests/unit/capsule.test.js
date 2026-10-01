/**
 * Unit Tests for Capsule (content/capsule.js): prompt, reply parsing, insert format, local store,
 * and putting text in a chat box.
 */

import {
  CAPSULE_START, CAPSULE_END, CAPSULE_MAX_SELECTION, CAPSULES_KEY,
  buildCapsulePrompt, parseCapsule, readLatestCapsule, latestReplyText, formatForInsert, CapsuleStore, insertText
} from '../../content/capsule.js';

/** chrome.storage.local stand-in */
function fakeArea() {
  const data = {};
  return {
    data,
    async get(key) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(obj) { Object.assign(data, structuredClone(obj)); }
  };
}

const fakeDoc = (texts) => ({ querySelectorAll: () => texts.map(t => ({ innerText: t })) });

export async function runCapsuleTests() {
  console.log('--- Running Capsule Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; } else { console.error(`  ❌ [FAIL] ${name}`); failed++; }
  };

  // Prompt
  const p = buildCapsulePrompt();
  assert('Prompt holds both markers and every section', p.includes(CAPSULE_START) && p.includes(CAPSULE_END) &&
    ['## Goal', '## Key decisions', '## Constraints & preferences', '## Current state', '## Open questions / next step', '## Key snippets'].every(s => p.includes(s)));
  assert('Prompt without a selection has no focus block', !p.includes('Focus only'));
  const ps = buildCapsulePrompt('  the auth part  ');
  assert('Selection becomes the focus (trimmed)', ps.includes('Focus only on this part') && ps.includes('\nthe auth part\n'));
  const long = buildCapsulePrompt('x'.repeat(CAPSULE_MAX_SELECTION + 500));
  assert('Long selection is cut to the limit', long.includes('x'.repeat(CAPSULE_MAX_SELECTION) + ' […]') && !long.includes('x'.repeat(CAPSULE_MAX_SELECTION + 1)));

  // Parsing
  const reply = `Here you go:\nmarkdown\n${CAPSULE_START}\nTitle: Auth refactor plan\n## Goal\nMove to JWT\n\n## Key snippets\n\`\`\`js\nsign(x)\n\`\`\`\n${CAPSULE_END}\nAnything else?`;
  const c = parseCapsule(reply);
  assert('Title read from the Title line', c?.title === 'Auth refactor plan');
  assert('Body is the text between the markers, without the Title line', c?.body.startsWith('## Goal\nMove to JWT') && c.body.endsWith('sign(x)\n```') && !c.body.includes('Title:') && !c.body.includes('Anything else'));
  assert('Missing END (still streaming) -> null', parseCapsule(`${CAPSULE_START}\nTitle: x\n## Goal\nhalf`) === null);
  assert('No markers -> null', parseCapsule('just a normal reply') === null);
  assert('Empty Capsule -> null', parseCapsule(`${CAPSULE_START}\nTitle: x\n${CAPSULE_END}`) === null);
  const fenced = parseCapsule(`${CAPSULE_START}\n\`\`\`\`markdown\n**Title:** "Landing copy"\n## Goal\nShip it\n\`\`\`\`\n${CAPSULE_END}`);
  assert('Fence inside the markers and **Title:** handled', fenced?.title === 'Landing copy' && fenced.body === '## Goal\nShip it');
  const untitled = parseCapsule(`${CAPSULE_START}\n## Goal\nShip it\n${CAPSULE_END}`);
  assert('No Title line -> first line becomes the title', untitled?.title === 'Goal');
  assert('CRLF line endings handled', parseCapsule(`${CAPSULE_START}\r\nTitle: A\r\nbody\r\n${CAPSULE_END}`)?.body === 'body');
  const loose = parseCapsule('A plain reply\nwith two lines', { loose: true });
  assert('Loose: a whole reply without markers is a Capsule', loose?.title === 'A plain reply' && loose.body === 'A plain reply\nwith two lines');
  assert('Loose: START without END keeps the rest', parseCapsule(`intro ${CAPSULE_START}\nTitle: T\nrest`, { loose: true })?.body === 'rest');
  assert('Long title is capped', parseCapsule(`${CAPSULE_START}\nTitle: ${'t'.repeat(200)}\nb\n${CAPSULE_END}`).title.length === 80);

  // Reading the page
  const capsuleReply = `${CAPSULE_START}\nTitle: New\n## Goal\nnew goal\n${CAPSULE_END}`;
  assert('Newest Capsule found in the latest replies', readLatestCapsule(fakeDoc(['hello', capsuleReply]), 'x')?.title === 'New');
  assert('Capsule already on the page before asking is ignored', readLatestCapsule(fakeDoc([capsuleReply]), 'x', '## Goal\nnew goal') === null);
  assert('Only the newest replies are scanned', readLatestCapsule(fakeDoc([capsuleReply, 'a', 'b', 'c']), 'x') === null);
  assert('No selector -> null', readLatestCapsule(fakeDoc([capsuleReply]), null) === null);
  assert('latestReplyText returns the newest reply', latestReplyText(fakeDoc(['a', ' b ']), 'x') === 'b' && latestReplyText(fakeDoc([]), 'x') === '');

  // Insert format
  const ins = formatForInsert({ title: 'Auth', body: '## Goal\nJWT' });
  assert('Insert text = one header line + body', ins === 'Context from an earlier AI conversation (Capsule: Auth). Use it as background for what I ask next.\n\n## Goal\nJWT');

  // Store
  const area = fakeArea();
  const store = new CapsuleStore(area);
  assert('Empty store lists nothing', (await store.list()).length === 0);
  const a = await store.save({ title: 'A', body: ' body a ', source: 'Claude' });
  const b = await store.save({ title: '', body: 'body b', source: 'Gemini' });
  let list = await store.list();
  assert('Saved newest first with id, trimmed body and timestamps', list.length === 2 && list[0].id === b.id && list[1].body === 'body a' && a.id && a.createdAt && a.updatedAt);
  assert('Empty title becomes "Untitled Capsule"', list[0].title === 'Untitled Capsule');
  const a2 = await store.save({ id: a.id, title: 'A edited', body: 'body a2' });
  list = await store.list();
  assert('Edit replaces in place, keeps createdAt and source', list.length === 2 && list[1].title === 'A edited' && a2.createdAt === a.createdAt && a2.source === 'Claude');
  let threw = false;
  try { await store.save({ title: 'x', body: '   ' }); } catch (_) { threw = true; }
  assert('Empty body is refused', threw && (await store.list()).length === 2);
  await store.remove(b.id);
  assert('Remove deletes only that Capsule', (await store.list()).map(x => x.id).join() === a.id && Array.isArray(area.data[CAPSULES_KEY]));
  area.data[CAPSULES_KEY] = 'corrupt';
  assert('Corrupt storage reads as empty', (await store.list()).length === 0);

  // Chat box
  const proto = { _v: '', get value() { return this._v; }, set value(v) { this._v = v; } };
  const ta = Object.assign(Object.create(proto), { tagName: 'TEXTAREA', events: [], focus() {}, dispatchEvent(e) { this.events.push(e.type); return true; } });
  ta.value = 'my draft';
  assert('Textarea: appended after the draft with an input event', insertText(ta, 'CAP') && ta.value === 'my draft\n\nCAP' && ta.events.includes('input'));

  const hadDT = 'DataTransfer' in globalThis;
  const hadCE = 'ClipboardEvent' in globalThis;
  globalThis.DataTransfer = class { constructor() { this.d = {}; } setData(k, v) { this.d[k] = v; } };
  globalThis.ClipboardEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
  let pasted = null;
  const rich = { tagName: 'DIV', focus() {}, ownerDocument: null, dispatchEvent(e) { pasted = e.clipboardData.d['text/plain']; return false; } };
  assert('Rich editor: handled paste counts as inserted', insertText(rich, 'CAP') === true && pasted === 'CAP');
  let typed = null;
  const doc = { execCommand: (cmd, _ui, v) => { typed = cmd === 'insertText' ? v : null; return true; } };
  const plain = { tagName: 'DIV', focus() {}, ownerDocument: doc, dispatchEvent() { return true; } };
  assert('Unhandled paste falls back to insertText', insertText(plain, 'CAP') === true && typed === 'CAP');
  const dead = { tagName: 'DIV', focus() {}, ownerDocument: { execCommand: () => false }, dispatchEvent() { return true; } };
  assert('Nothing takes the text -> false (caller copies instead)', insertText(dead, 'CAP') === false);
  assert('No chat box -> false', insertText(null, 'CAP') === false);
  if (!hadDT) delete globalThis.DataTransfer;
  if (!hadCE) delete globalThis.ClipboardEvent;

  return { passed, failed };
}
