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
