/** Unit Tests for content/page-actions.js: the in-page Page used by CapsulePanel and the widgets. */

import { createPage } from '../../src/core/page-actions.js';
import { CAPSULE_START, CAPSULE_END } from '../../src/core/capsule.js';

/** A message node as readTranscript / latestReplyText / readLatestCapsule read it. */
const node = (role, text) => ({ innerText: text, parentElement: null, matches: (s) => s === role, querySelectorAll: () => [] });

/** Minimal document: replies 'R' / user turns 'U' by selector, and a selection. */
function fakeDoc({ replies = [], users = [] } = {}) {
  const nodes = { R: replies.map(t => node('R', t)), U: users.map(t => node('U', t)) };
  return {
    nodes, body: {},
    querySelector: (s) => (s === 'R' ? nodes.R[0] || null : null),
    querySelectorAll: (s) => (s === 'R' ? nodes.R : s === 'U' ? nodes.U : s === 'U, R' ? [...nodes.U, ...nodes.R] : []),
    getSelection: () => ({ toString: () => '  picked  ' })
  };
}
const capsuleText = (t) => `${CAPSULE_START}\nTitle: ${t}\n## Goal\n${t} goal\n${CAPSULE_END}`; // Bodies differ: the old one is ignored by body

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
  assert('No limits -> limit not reached', (await empty.limitReached()) === false);

  const box = { tagName: 'TEXTAREA', value: '', focus() {}, dispatchEvent() {} };
  const doc = fakeDoc({ replies: ['hello'], users: ['hi there'] });
  const page = createPage({
    provider: 'X', replySelector: 'R', userSelector: 'U', findInput: () => box, countTokens: (t) => t.length,
    getLimits: () => [{ key: 'limit', blocked: true }]
  }, doc);
  assert('Reply -> conversation', (await page.hasConversation()) === true);
  assert('Selection trimmed', (await page.takeSelection()) === 'picked');
  assert('Fill puts text in the chat box', (await page.fill('capsule')) === true && box.value === 'capsule');
  assert('Latest reply text', (await page.latestReply()) === 'hello');
  const t = await page.transcript();
  assert('Transcript in page order', t.length === 2 && t[0].role === 'user' && t[0].text === 'hi there' && t[1].role === 'assistant');
  assert('countTokens maps each text', JSON.stringify(await page.countTokens(['ab', 'abc'])) === '[2,3]');
  assert('A throwing counter -> null', JSON.stringify(await createPage({ findInput: () => null, countTokens: () => { throw new Error('x'); } }, doc).countTokens(['a'])) === '[null]');
  assert('Blocked limit -> limit reached', (await page.limitReached()) === true);
  assert('Provider passed through', page.provider === 'X');

  // watchCapsule ignores the Capsule already on the page, reports the new one once, and stops
  doc.nodes.R.push(node('R', capsuleText('Old')));
  let observerCb = null;
  const observed = [];
  // Fake observer and timers: the 500 ms read runs when flush() says so
  const { MutationObserver: realObserver, setTimeout: realSetTimeout } = globalThis;
  const timers = [];
  const flush = () => timers.splice(0).forEach(f => f());
  globalThis.setTimeout = (f) => timers.push(f);
  globalThis.MutationObserver = class { constructor(cb) { observerCb = cb; } observe() { observed.push(1); } disconnect() { observerCb = null; } };
  const found = [];
  const stop = await page.watchCapsule((c) => found.push(c.title));
  observerCb?.(); flush();
  assert('Old Capsule ignored', found.length === 0 && observed.length === 1);
  doc.nodes.R.push(node('R', capsuleText('New')));
  observerCb?.(); flush();
  assert('New Capsule reported once, then watching stops', JSON.stringify(found) === '["New"]' && observerCb === null);
  stop();
  globalThis.MutationObserver = realObserver;
  globalThis.setTimeout = realSetTimeout;

  return { passed, failed };
}
