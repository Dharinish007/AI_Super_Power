/**
 * Unit Tests for Checkpoint Export (content/checkpoint-export.js)
 */

import { buildCheckpointMarkdown } from '../../src/features/checkpoint/checkpoint-export.js';

export function runCheckpointExportTests() {
  console.log('--- Running Checkpoint Export Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; }
    else { console.error(`  ❌ [FAIL] ${name}`); failed++; }
  };

  const sampleMessages = [
    { role: 'user', turn: 1, text: 'First user question with `code`.' },
    { role: 'assistant', turn: 2, text: 'Assistant reply.' },
    { role: 'user', turn: 3, text: 'Second user message with code fence:\n```javascript\nconst a = 1;\nconsole.log(a);\n```' },
    { role: 'assistant', turn: 4, text: 'Another assistant reply.' },
    { role: 'user', turn: 5, text: 'Third user prompt.' }
  ];

  const md = buildCheckpointMarkdown(sampleMessages, {
    title: 'Test Conversation',
    model: 'Claude 3.5 Sonnet',
    usedTokens: 45000,
    contextLimit: 200000,
    percentage: 22.5,
    range: 20
  });

  // 1. Header and Carry-over section
  assert('Includes title in header', md.includes('# Checkpoint Export: Test Conversation'));
  assert('Includes Carry-over Summary section', md.includes('## Carry-over Summary'));
  assert('Includes Model in summary', md.includes('Claude 3.5 Sonnet'));
  assert('Includes context percentage in summary', md.includes('23%'));

  // 2. Filters ONLY user messages
  assert('Exports only user messages (3 user messages)', md.includes('3 user message(s)'));
  assert('Does NOT include assistant replies in Selected Messages', !md.includes('Assistant reply.') && !md.includes('Another assistant reply.'));

  // 3. Preserves code fences verbatim
  assert('Preserves code fences verbatim', md.includes('```javascript\nconst a = 1;\nconsole.log(a);\n```'));

  // 4. Default range slicing
  // Generate 25 user messages
  const manyMessages = [];
  for (let i = 1; i <= 25; i++) {
    manyMessages.push({ role: 'user', turn: i, text: `User message number ${i}` });
  }
  const slicedMd = buildCheckpointMarkdown(manyMessages, { range: 20 });
  assert('Default range selects the last 20 messages', slicedMd.includes('20 user message(s)'));
  assert('Does NOT include user message #1 when range is 20', !slicedMd.includes('User message number 1\n'));
  assert('Includes user message #25', slicedMd.includes('User message number 25'));

  return { passed, failed };
}
