/**
 * Unit Tests for Platform Strip Adapters (content/strip-adapters.js)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { claudeAdapter, geminiAdapter, chatgptAdapter, getAdapterForProvider } from '../../src/ui/widget/strip-adapters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, '../fixtures');

export async function runStripAdaptersTests() {
  console.log('--- Running Platform Strip Adapters Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; }
    else { console.error(`  ❌ [FAIL] ${name}`); failed++; }
  };

  // 1. Fixture file existence checks
  const claudeHtml = fs.readFileSync(path.join(fixturesDir, 'claude.html'), 'utf8');
  const geminiHtml = fs.readFileSync(path.join(fixturesDir, 'gemini.html'), 'utf8');
  const chatgptHtml = fs.readFileSync(path.join(fixturesDir, 'chatgpt.html'), 'utf8');

  assert('Claude HTML fixture exists and contains ProseMirror input', claudeHtml.includes('ProseMirror'));
  assert('Gemini HTML fixture exists and contains rich-textarea input', geminiHtml.includes('rich-textarea'));
  assert('ChatGPT HTML fixture exists and contains prompt-textarea', chatgptHtml.includes('prompt-textarea'));

  // 2. Claude Adapter Tests
  const claudeState = {
    provider: 'Claude',
    usedTokens: 96000,
    contextLimit: 200000,
    exchangesLeft: 28,
    limits: [
      { key: 'session', label: 'Session (5h)', percent: 67, resetsAt: Date.now() + 3600000, estimated: false },
      { key: 'weekly', label: 'Weekly', percent: 7, resetsAt: Date.now() + 100000000, estimated: false }
    ],
    stats: { user: 4000, assistant: 55000, hidden: 41000 }
  };

  const cRes = claudeAdapter(claudeState);
  assert('Claude adapter returns 2 rows (5h and Weekly)', cRes.rows.length === 2 && cRes.rows[0].label === '5h' && cRes.rows[1].label === 'Weekly');
  assert('Claude 5h row is 67% warn and measured', cRes.rows[0].percent === 67 && cRes.rows[0].state === 'warn' && cRes.rows[0].source === 'measured');
  assert('Claude context has 96K used and 200K limit', cRes.context.used === 96000 && cRes.context.limit === 200000);
  assert('Claude shows msgsLeft = 28', cRes.msgsLeft === 28);
  assert('Claude adapter never throws on malformed state', claudeAdapter(null).rows.length === 0);

  // 3. Gemini Adapter Tests
  const geminiState = {
    provider: 'Gemini',
    usedTokens: 30000,
    contextLimit: 128000,
    exchangesLeft: 14, // Should be ignored!
    limits: [
      { key: 'session', label: 'Session (5h)', percent: 50, resetsAt: Date.now() + 7200000, estimated: false },
      { key: 'weekly', label: 'Weekly', percent: 20, resetsAt: Date.now() + 86400000, estimated: false }
    ],
    stats: { user: 2000, assistant: 20000, hidden: 8000 }
  };

  const gRes = geminiAdapter(geminiState);
  assert('Gemini adapter returns 2 rows', gRes.rows.length === 2 && gRes.rows[0].label === '5h' && gRes.rows[1].label === 'Weekly');
  assert('Gemini 5h row includes note "Heavy tasks use more"', gRes.rows[0].note === 'Heavy tasks use more');
  assert('Gemini shows NO message count (msgsLeft is undefined)', gRes.msgsLeft === undefined);
  assert('Gemini rightNote has reset string (resets in ...)', typeof gRes.rightNote === 'string' && gRes.rightNote.startsWith('resets in'));
  assert('Gemini adapter never throws on malformed state', geminiAdapter(null).rows.length === 0);

  // Gemini empty limits (initial new chat / consumer account)
  const gEmptyRes = geminiAdapter({ provider: 'Gemini' });
  assert('Gemini with empty limits still produces 2 rows (5h and Weekly)', gEmptyRes.rows.length === 2 && gEmptyRes.rows[0].label === '5h' && gEmptyRes.rows[1].label === 'Weekly');
  assert('Gemini empty 5h row has note "Heavy tasks use more"', gEmptyRes.rows[0].note === 'Heavy tasks use more');

  // 4. ChatGPT Adapter Tests
  const chatgptState = {
    provider: 'ChatGPT',
    usedTokens: 12000,
    contextLimit: null, // No published limit
    limits: [
      { key: 'uploads', label: 'Uploads', percent: 15, resetsAt: Date.now() + 3600000, estimated: false }
    ],
    stats: { user: 1000, assistant: 9000, hidden: 2000 }
  };

  const cgRes = chatgptAdapter(chatgptState);
  assert('ChatGPT includes Text row with "No limit · subject to safeguards"', cgRes.rows[0].label === 'Text' && cgRes.rows[0].state === 'unlimited');
  assert('ChatGPT includes tracked tool rows (Uploads)', cgRes.rows.length === 2 && cgRes.rows[1].label === 'Uploads');
  assert('ChatGPT default State C: limit is undefined (count only)', cgRes.context.limit === undefined && cgRes.context.refLimit === undefined);
  assert('ChatGPT shows NO message count', cgRes.msgsLeft === undefined);

  // ChatGPT with user reference setting -> State B
  const cgResUserRef = chatgptAdapter(chatgptState, { context: { userReference: 128000 } });
  assert('ChatGPT with user reference has refLimit 128K and refType user', cgResUserRef.context.refLimit === 128000 && cgResUserRef.context.refType === 'user');
  assert('ChatGPT adapter never throws on malformed state', chatgptAdapter(null).rows.length === 0);

  // 5. Router lookup
  assert('getAdapterForProvider resolves correct adapter for each host',
    getAdapterForProvider('Claude') === claudeAdapter &&
    getAdapterForProvider('Gemini') === geminiAdapter &&
    getAdapterForProvider('ChatGPT') === chatgptAdapter
  );

  return { passed, failed };
}
