/**
 * Unit Tests for Capsule (content/capsule.js): prompt, reply parsing, insert format, local store,
 * and putting text in a chat box.
 */

import {
  CAPSULE_START, CAPSULE_END, CAPSULE_MAX_SELECTION, CAPSULES_KEY, CAPSULE_HANDOFF_KEY,
  buildCapsulePrompt, parseCapsule, readLatestCapsule, latestReplyText, formatForInsert, CapsuleStore, insertText,
  chatLimitReached, readTranscript, buildQuickCapsule, formatTranscript, saveHandoff, readHandoff, clearHandoff,
  formatCost, exportCapsules, normalizeCapsule, SKILLS_KEY, STARTER_SKILLS, formatSkillForInsert
} from '../../content/capsule.js';

/** chrome.storage.local stand-in */
function fakeArea() {
  const data = {};
  return {
    data,
    async get(key) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(obj) { Object.assign(data, structuredClone(obj)); },
    async remove(key) { delete data[key]; }
  };
}

/** Message element stand-in: role via its selector, optional nesting and <pre> blocks. */
function fakeMsg(role, text, { code = [], parent = null } = {}) {
  return {
    role, innerText: text, parentElement: parent,
    matches: (sel) => sel === (role === 'user' ? 'U' : 'R'),
    querySelectorAll: () => code.map(c => ({ querySelector: () => ({ innerText: c }) }))
  };
}
const fakeChat = (nodes) => ({ querySelectorAll: () => nodes });

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
  const filled = { tagName: 'DIV', textContent: 'Capsule text', focus() {}, ownerDocument: doc, dispatchEvent() { return true; } };
  assert('Rich editor with text already in it: a blank line before the new text', insertText(filled, 'SKILL') && typed === '\n\nSKILL');
  const dead = { tagName: 'DIV', focus() {}, ownerDocument: { execCommand: () => false }, dispatchEvent() { return true; } };
  assert('Nothing takes the text -> false (caller copies instead)', insertText(dead, 'CAP') === false);
  assert('No chat box -> false', insertText(null, 'CAP') === false);
  if (!hadDT) delete globalThis.DataTransfer;
  if (!hadCE) delete globalThis.ClipboardEvent;

  // Step 1: limit that blocks chatting
  assert('Gemini "limit reached" notice blocks', chatLimitReached([{ key: 'limit', blocked: true }])?.key === 'limit');
  assert('ChatGPT model with no messages left blocks', chatLimitReached([{ key: 'model:gpt-5', blocked: true }])?.key === 'model:gpt-5');
  assert('Claude usage window at 100% blocks', chatLimitReached([{ key: 'session', percent: 100 }])?.key === 'session');
  assert('Claude at 99%, a used-up feature (image gen) or nothing: not blocked',
    chatLimitReached([{ key: 'session', percent: 99 }, { key: 'image_gen', blocked: true }, { key: 'model:gpt-5', blocked: false }]) === null &&
    chatLimitReached() === null && chatLimitReached(null) === null);

  // Step 2: reading the chat + Quick Capsule (no AI)
  const wrap = fakeMsg('assistant', 'outer');
  const chat = [
    fakeMsg('user', 'Build a todo app in React\nwith local storage'),
    fakeMsg('assistant', 'Sure, here is the plan', { code: ['npm create vite@latest'] }),
    wrap, fakeMsg('assistant', 'inner copy', { parent: wrap }),
    fakeMsg('user', '   '),
    fakeMsg('user', 'Add dark mode')
  ];
  const labels = readTranscript(fakeChat([fakeMsg('assistant', 'Run this:\nbash Copy code\nnpm i\nCopy\nEdit\nDone, copy code below.')]), 'U', 'R');
  assert('Transcript: button labels removed, words in sentences kept', labels[0].text === 'Run this:\nbash\nnpm i\nDone, copy code below.');
  const msgs = readTranscript(fakeChat(chat), 'U', 'R');
  assert('Transcript: page order, roles, nested match and empty messages dropped', msgs.map(m => `${m.role}:${m.text}`).join('|') ===
    'user:Build a todo app in React\nwith local storage|assistant:Sure, here is the plan|assistant:outer|user:Add dark mode');
  assert('Transcript: code blocks kept apart', msgs[1].code[0] === 'npm create vite@latest');
  assert('Transcript: missing selector -> empty', readTranscript(fakeChat(chat), null, 'R').length === 0);

  const quick = buildQuickCapsule(msgs);
  assert('Quick Capsule: title from the first message line', quick.title === 'Build a todo app in React');
  assert('Quick Capsule: goal, recent turns and snippets', quick.body.startsWith('## Goal\nBuild a todo app') &&
    quick.body.includes('## Recent conversation\n**You:** Build') && quick.body.includes('**AI:** Sure') &&
    quick.body.includes('## Key snippets\n```\nnpm create vite@latest\n```'));
  const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `turn ${i} ${'x'.repeat(i === 19 ? 2000 : 0)}`, code: [] }));
  const q2 = buildQuickCapsule(many);
  assert('Quick Capsule: only the last 6 turns, long ones cut, no empty snippets section',
    !q2.body.includes('turn 13 ') && q2.body.includes('turn 14') && q2.body.includes('x […]') && !q2.body.includes('Key snippets'));
  assert('Quick Capsule: no messages -> null', buildQuickCapsule([]) === null);

  // Step 3: hand-off
  const tr = formatTranscript([{ role: 'user', text: 'goal' }, { role: 'assistant', text: 'reply' }]);
  assert('Transcript text labels each turn', tr === 'User: goal\n\nAI: reply');
  const big = formatTranscript([{ role: 'user', text: 'G' }, ...Array.from({ length: 50 }, (_, i) => ({ role: 'assistant', text: `m${i} ${'y'.repeat(100)}` }))], 1000);
  assert('Long chat: first message + newest that fit, gap marked', big.startsWith('User: G\n\n[… ') && big.includes('m49') && !big.includes('m0 ') && big.length <= 1100);
  const huge = formatTranscript([{ role: 'user', text: 'G' }, { role: 'assistant', text: 'z'.repeat(5000) + 'END' }], 1000);
  assert('Newest message alone too long: its end is kept', huge.includes('[…] ') && huge.endsWith('END') && huge.length < 1100);
  assert('No messages -> empty transcript', formatTranscript([]) === '');

  const hp = buildCapsulePrompt('', 'User: goal');
  assert('Hand-off prompt: names the conversation, format, then the conversation last',
    hp.includes('<conversation> tags') && hp.indexOf(CAPSULE_END) < hp.indexOf('<conversation>\nUser: goal\n</conversation>') && hp.endsWith('Now write the Capsule in the format above.'));
  assert('Normal prompt has no conversation block', !buildCapsulePrompt().includes('<conversation>'));

  const harea = fakeArea();
  assert('No hand-off waiting', (await readHandoff(harea)) === null);
  await saveHandoff(harea, { prompt: 'P', source: 'ChatGPT' });
  const ho = await readHandoff(harea);
  assert('Hand-off saved and read back', ho?.prompt === 'P' && ho.source === 'ChatGPT' && typeof ho.at === 'number');
  assert('Hand-off expires after a day', (await readHandoff(harea, Date.now() + 25 * 3600 * 1000)) === null);
  await clearHandoff(harea);
  assert('Hand-off cleared', (await readHandoff(harea)) === null && !(CAPSULE_HANDOFF_KEY in harea.data));
  harea.data[CAPSULE_HANDOFF_KEY] = { prompt: 42 };
  assert('Corrupt hand-off ignored', (await readHandoff(harea)) === null);

  // Milestone 2: cost
  assert('Cost: small count, no window', formatCost(850).text === '~850 tokens' && formatCost(850).tooBig === false);
  assert('Cost: K format and % of window', formatCost(1234, 200000).text === '~1.2K tokens · 0.6% of window');
  assert('Cost: tiny share and round K', formatCost(1000, 2000000).text === '~1K tokens · <0.1% of window');
  assert('Cost: big share rounded', formatCost(16000, 32000).text === '~16K tokens · 50% of window');
  assert('Cost: too big for the room left', formatCost(5000, 32000, 4000).tooBig && !formatCost(5000, 32000, 6000).tooBig && !formatCost(5000, null, null).tooBig);

  // Milestone 2: update prompt
  const up = buildCapsulePrompt('', '', { title: 'Auth plan', body: '## Goal\nJWT' });
  assert('Update prompt: asks to update, carries the old Capsule after the format',
    up.startsWith('Update the Capsule') && up.indexOf(CAPSULE_END) < up.indexOf('<previous-capsule>\nTitle: Auth plan\n## Goal\nJWT\n</previous-capsule>') && !up.includes('<conversation>'));

  // Milestone 2: export / import
  const xarea = fakeArea();
  const xs = new CapsuleStore(xarea);
  const one = await xs.save({ title: 'One', body: 'b1', source: 'Claude' });
  const file = exportCapsules(await xs.list());
  const parsed = JSON.parse(file);
  assert('Export: versioned file with every Capsule', parsed.version === 1 && parsed.capsules.length === 1 && parsed.capsules[0].id === one.id);
  assert('Import of the same file: nothing changes', JSON.stringify(await xs.importMany(file)) === '{"added":0,"updated":0,"skipped":1}');
  const incoming = JSON.stringify({ capsules: [
    { ...one, title: 'One v2', updatedAt: one.updatedAt + 10 },
    { id: 'new-1', title: 'Two', body: 'b2', source: 'Gemini', createdAt: 5, updatedAt: 6 },
    { id: '../evil', title: 'x'.repeat(500), body: '  b3  ', source: 7 },
    { title: 'no body' }, null, 'text', { body: '   ' }
  ] });
  const res = await xs.importMany(incoming, 1000);
  const after = await xs.list();
  assert('Import: newer copy replaces, new ids added, invalid skipped', res.added === 2 && res.updated === 1 && res.skipped === 4 && after.length === 3);
  const evil = after.find(c => c.body === 'b3');
  assert('Import: unsafe id replaced, long title capped, bad source -> Import, missing dates -> now',
    evil && evil.id !== '../evil' && evil.title.length === 80 && evil.source === 'Import' && evil.createdAt === 1000 && evil.updatedAt === 1000);
  assert('Import: kept fields of a valid Capsule', after.find(c => c.id === 'new-1')?.source === 'Gemini' && after.find(c => c.id === one.id)?.title === 'One v2');
  let bad = 0;
  for (const t of ['not json', '{"nope":1}', '42']) { try { await xs.importMany(t); } catch (e) { if (e.message === 'Not a Capsules file') bad++; } }
  assert('Import: non-Capsule files rejected', bad === 3);
  assert('Import: a bare array also works', (await new CapsuleStore(fakeArea()).importMany('[{"body":"x"}]')).added === 1);
  assert('normalizeCapsule: huge body cut to 100K', normalizeCapsule({ body: 'z'.repeat(150000) }).body.length === 100000);

  // Milestone 4: Skills (same store under its own key)
  const sarea = fakeArea();
  const skills = new CapsuleStore(sarea, { key: SKILLS_KEY, noun: 'Skill' });
  assert('Skills: first open seeds the starters with dates', (await skills.seed(STARTER_SKILLS, 500)) === true &&
    (await skills.list()).length === 3 && (await skills.list()).every(s => s.source === 'Starter' && s.createdAt === 500 && s.title && s.body));
  for (const s of await skills.list()) await skills.remove(s.id);
  assert('Skills: a list the user emptied is not re-seeded', (await skills.seed(STARTER_SKILLS)) === false && (await skills.list()).length === 0);
  const sk = await skills.save({ title: '', body: 'Answer in Tamil', source: 'You' });
  assert('Skills: own key, own default title, Capsules untouched', sk.title === 'Untitled Skill' && Array.isArray(sarea.data[SKILLS_KEY]) && !(CAPSULES_KEY in sarea.data));
  let emptyMsg = '';
  try { await skills.save({ body: ' ' }); } catch (e) { emptyMsg = e.message; }
  assert('Skills: empty error names a Skill', emptyMsg === 'Skill is empty');
  const sfile = exportCapsules(await skills.list(), SKILLS_KEY);
  assert('Skills: export file uses the "skills" field', Array.isArray(JSON.parse(sfile).skills) && !('capsules' in JSON.parse(sfile)));
  let wrongMsg = '';
  try { await skills.importMany(file); } catch (e) { wrongMsg = e.message; }
  assert('Skills: a Capsules file is not a Skills file', wrongMsg === 'Not a Skills file');
  const fresh = new CapsuleStore(fakeArea(), { key: SKILLS_KEY, noun: 'Skill' });
  assert('Skills: import a Skills file', (await fresh.importMany(sfile)).added === 1 && (await fresh.list())[0].body === 'Answer in Tamil');
  assert('Skills: insert text names the Skill and applies to the chat',
    formatSkillForInsert({ title: 'Tamil', body: 'Answer in Tamil' }) === 'Follow these instructions for the rest of this chat (Skill: Tamil):\n\nAnswer in Tamil');
  assert('Skills: starter ids are fixed (two tabs seeding write the same list)', STARTER_SKILLS.every(s => s.id.startsWith('starter-')));

  return { passed, failed };
}
