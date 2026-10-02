/**
 * Unit Tests for the provider-neutral widget view state (content/widget-state.js)
 * The UI must display engine values unchanged: only formatting, never recalculation.
 */

import { ClaudeProvider } from '../../content/providers.js';
import { toWidgetState, formatModelName, alertLevel, biggestMessages, formatChatExport, growthSeries, normalizeAttachments, chatIdFromHref, recordUsage } from '../../content/widget-state.js';

export function runWidgetStateTests() {
  console.log('--- Running Widget View-State Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; } else { console.error(`  ❌ [FAIL] ${name}`); failed++; }
  };

  const engine = {
    model: { id: 'chatgpt-instant', displayName: 'gpt-5-6 (Instant)', contextWindow: 54000, limitStatus: 'VERIFIED' },
    plan: { tier: 'go' },
    tokens: { totalMeasurable: 7060, user: 3132, assistant: 3928, attachments: 0 },
    utilization: { percentage: 13.1 },
    confidence: { level: 'HIGH', percentage: 100, factors: [
      { type: 'positive', text: 'Exact tokenizer' }, { type: 'negative', text: 'Tool internal overhead unknown' }] },
    observables: { dataSource: 'authoritative', messagesCount: 17, attachmentsCount: 0 },
    completeness: { domIsPartial: true },
    diagnostics: { session: { ok: true } }
  };
  const vm = toWidgetState(engine, { provider: 'ChatGPT' });

  assert('Percentage passed through unchanged', vm.percentage === 13.1);
  assert('Used / limit / remaining taken from engine', vm.usedTokens === 7060 && vm.contextLimit === 54000 && vm.remainingTokens === 46940);
  assert('Confidence score and level passed through unchanged', vm.confidence === 100 && vm.confidenceLevel === 'HIGH');
  assert('Evidence mirrors engine factors (no invented reasons)', vm.evidence.length === 2 && vm.evidence[0].ok && !vm.evidence[1].ok && vm.evidence[0].text === 'Exact tokenizer');
  assert('Model and family split for display', vm.model === 'GPT-5.6' && vm.modelFamily === 'Instant');
  assert('Plan formatted', vm.plan === 'Go');
  assert('Provider name comes from the adapter', vm.provider === 'ChatGPT' && vm.breakdown[1].label === 'ChatGPT + tools');
  assert('No "count may be low" warning when the full conversation came from the API', vm.warning === null);
  assert('Diagnostics carried through for the copy button', vm.diagnostics?.session?.ok === true);
  const vsFull = toWidgetState(engine, { provider: 'ChatGPT' });
  assert('View state is plain data (survives the panel port)', JSON.stringify(structuredClone(vsFull)) === JSON.stringify(vsFull));

  const domOnly = toWidgetState({ ...engine, observables: { dataSource: 'dom_fallback', messagesCount: 4 }, model: { id: 'unknown' } });
  assert('Unknown model -> no limit, no percentage', domOnly.contextLimit === null && domOnly.percentage === null && domOnly.model === 'Model unknown');
  assert('Partial page-text count still warns', /Count may be low/.test(domOnly.warning || ''));
  assert('Not-ready state before first engine pass', toWidgetState(null).ready === false);

  // Set 2: every breakdown row says how it was learned, from the engine's own classification
  const tagOf = (v, label) => v.breakdown.find(b => b.label === label)?.tag;
  const classed = { ...engine, tokenizerExact: true, accuracy: { conversation: 'EXACT', attachments: 'OBSERVED' } };
  const vmExact = toWidgetState(classed, { provider: 'ChatGPT' });
  assert('Conversation rows carry the engine class', tagOf(vmExact, 'You') === 'EXACT' && tagOf(vmExact, 'ChatGPT + tools') === 'EXACT');
  assert('Attachments row carries the engine class', tagOf(vmExact, 'Attachments') === 'OBSERVED');
  const vmApprox = toWidgetState({ ...classed, tokenizerExact: false }, { provider: 'Claude' });
  assert('Approximate tokenizer downgrades conversation rows to ESTIMATED', tagOf(vmApprox, 'You') === 'ESTIMATED');
  assert('Every tagged row explains itself', vmExact.breakdown.filter(b => b.tag).every(b => b.why && b.why.length > 10));
  assert('Without engine classes, rows stay untagged (nothing invented)', tagOf(vm, 'You') === undefined);

  // Set 3: biggest messages and chat export
  const ctxMsgs = [
    { id: 'a', role: 'user', tokens: 40, preview: 'hello' },
    { id: 'b', role: 'assistant', tokens: 900, preview: 'long answer' },
    { id: 'c', role: 'user', tokens: 300, preview: 'big paste' },
    { id: 'd', role: 'assistant', tokens: 0, preview: '' }
  ];
  const big = biggestMessages(ctxMsgs, 2);
  assert('biggestMessages: largest first, capped, numbered by turn', big.length === 2 && big[0].tokens === 900 && big[0].turn === 2 && big[1].turn === 3);
  assert('biggestMessages: empty-token turns are left out', biggestMessages(ctxMsgs, 9).length === 3);
  assert('biggestMessages: nothing in, nothing out', biggestMessages(undefined).length === 0);
  const vmBig = toWidgetState({ ...engine, tokens: { ...engine.tokens, contextMessages: ctxMsgs } }, { provider: 'ChatGPT' });
  assert('View state carries the biggest messages with a preview', vmBig.biggest[0].preview === 'long answer' && vmBig.biggest[0].role === 'assistant');

  const chat = [{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Hello!\n\n```js\nx\n```' }];
  const md = formatChatExport(chat, 'md', { provider: 'ChatGPT', title: 'My chat' });
  assert('export md: title, roles, text kept', md.startsWith('# My chat') && md.includes('**You**') && md.includes('**ChatGPT**') && md.includes('```js'));
  const txt = formatChatExport(chat, 'txt', { provider: 'ChatGPT' });
  assert('export txt: role-prefixed turns', txt.startsWith('You: Hi') && txt.includes('ChatGPT: Hello!'));
  const js = JSON.parse(formatChatExport(chat, 'json', { provider: 'ChatGPT' }));
  assert('export json: provider and ordered messages', js.provider === 'ChatGPT' && js.messages.length === 2 && js.messages[1].role === 'assistant');
  assert('export: unknown format is refused', (() => { try { formatChatExport(chat, 'pdf'); return false; } catch (_) { return true; } })());

  // Set 4: growth, attachments, sidebar badges
  const g = growthSeries(ctxMsgs);
  assert('growthSeries: cumulative tokens per turn', g.points.join() === '40,940,1240,1240' && g.total === 1240 && g.turns === 4);
  const longChat = Array.from({ length: 500 }, () => ({ role: 'user', tokens: 10 }));
  const gl = growthSeries(longChat, 48);
  assert('growthSeries: long chats are thinned but keep the true total', gl.points.length <= 48 && gl.points[gl.points.length - 1] === 5000 && gl.turns === 500);
  assert('growthSeries: nothing in, nothing out', growthSeries(undefined).points.length === 0);
  assert('View state carries the growth curve', vmBig.growth.total === 1240);

  const files = normalizeAttachments([
    { name: 'a.png', type: 'image', estimatedTokens: 300, isUnknown: false },
    { name: 'b.pdf', type: 'document', size: '2 MB', estimatedTokens: 0, isUnknown: true },
    { name: 'c.txt', type: 'file', tokens: 120 },
    null
  ]);
  assert('normalizeAttachments: known cost, unknown cost, plain tokens', files.length === 3 && files[0].tokens === 300 && files[1].tokens === null && files[1].size === '2 MB' && files[2].tokens === 120);
  assert('normalizeAttachments: text already counted in the message is flagged', normalizeAttachments([{ name: 'n.md', type: 'document', inText: true }])[0].inText === true);
  const claudeFiles = ClaudeProvider.normalizeConversation({
    uuid: 'c1',
    chat_messages: [{ uuid: 'm1', sender: 'human', text: 'hi', index: 0,
      attachments: [{ file_name: 'notes.md', extracted_content: 'abc' }, { file_name: 'scan.pdf' }],
      files: [{ file_name: 'pic.png', file_kind: 'image' }] }]
  }).attachments;
  assert('Claude lists every file; extracted text is flagged as already counted',
    claudeFiles.count === 3 && claudeFiles.files.length === 3 && claudeFiles.files[0].inText === true && !claudeFiles.files[1].inText && claudeFiles.files[2].name === 'pic.png');
  assert('normalizeAttachments: not a list -> empty', normalizeAttachments(undefined).length === 0);
  const vmFiles = toWidgetState({ ...engine, observables: { ...engine.observables, attachmentFiles: [{ name: 'a.png', type: 'image', tokens: 300 }] } }, { provider: 'ChatGPT' });
  assert('View state carries the attachment list', vmFiles.attachmentFiles.length === 1 && vmFiles.attachmentFiles[0].name === 'a.png');

  assert('chatIdFromHref: ChatGPT, Claude, Gemini links',
    chatIdFromHref('/c/68f1a2b3-1111-2222-3333-444455556666') === '68f1a2b3-1111-2222-3333-444455556666'
    && chatIdFromHref('https://claude.ai/chat/0a1b2c3d-aaaa-bbbb-cccc-ddddeeeeffff?x=1') === '0a1b2c3d-aaaa-bbbb-cccc-ddddeeeeffff'
    && chatIdFromHref('/app/1234abcd5678ef90') === '1234abcd5678ef90');
  assert('chatIdFromHref: other links give null', chatIdFromHref('/gpts') === null && chatIdFromHref('/c/new') === null && chatIdFromHref(null) === null);
  let usage = recordUsage({}, 'a'.repeat(12), 41.6, 1000);
  assert('recordUsage: stores a rounded percentage', usage['a'.repeat(12)].pct === 42 && usage['a'.repeat(12)].at === 1000);
  for (let i = 0; i < 5; i++) usage = recordUsage(usage, 'id' + String(i).repeat(10), 10, 2000 + i, 3);
  assert('recordUsage: keeps only the newest N chats', Object.keys(usage).length === 3 && !usage['a'.repeat(12)] && Boolean(usage['id' + '4'.repeat(10)]));
  assert('recordUsage: unknown percentage is ignored', Object.keys(recordUsage({}, 'x'.repeat(12), null, 1)).length === 0);

  assert('alertLevel: below 80% is quiet', alertLevel(79.9) === 0 && alertLevel(null) === 0);
  assert('alertLevel: 80 and 95 are the steps', alertLevel(80) === 80 && alertLevel(94.9) === 80 && alertLevel(95) === 95 && alertLevel(120) === 95);

  // Exchanges left come from the context advisor (current pace), never recomputed here
  assert('View state carries the advisor estimate', toWidgetState({ ...engine, intelligence: { growth: { exchangesLeft: 56 } } }).exchangesLeft === 56);
  assert('No advisor estimate: none shown', vm.exchangesLeft === null);

  assert('formatModelName: gpt-5-5-thinking', formatModelName('gpt-5-5-thinking') === 'GPT-5.5 Thinking');
  assert('formatModelName: gpt-4o-mini', formatModelName('gpt-4o-mini') === 'GPT-4o Mini');
  assert('formatModelName: non-GPT names pass through', formatModelName('claude-sonnet-4') === 'claude-sonnet-4');

  return { passed, failed };
}
