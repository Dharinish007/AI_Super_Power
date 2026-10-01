/**
 * Gemma 4 counter (Gemini's tokenizer) against the reference implementation: every count must equal what
 * Hugging Face tokenizers gives for Gemma 4's tokenizer.json (tests/fixtures/gemma4-reference.json,
 * 404 texts: scripts, whitespace runs, HTML, added tokens, emoji, random mixes).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Tokenizer } from '../../engine/tokenizer.js';
import { GeminiProvider } from '../../content/providers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function runGemmaTokenizerTests() {
  console.log('--- Running Gemma 4 Tokenizer (Gemini) Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; } else { console.error(`  ❌ [FAIL] ${name}`); failed++; }
  };

  const file = fs.readFileSync(path.join(root, GeminiProvider.tokenizer.file));
  const counter = GeminiProvider.tokenizer.create(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));
  let steps = 0;
  while (!counter.build(1)) steps++;
  assert('Built in slices (never one long task)', steps > 0 && counter.built);

  const { cases } = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/gemma4-reference.json'), 'utf8'));
  const wrong = cases.filter(([text, want]) => counter.count(text) !== want);
  for (const [text, want] of wrong.slice(0, 5)) console.error(`     ${JSON.stringify(text.slice(0, 60))}: reference ${want}, counted ${counter.count(text)}`);
  assert(`Matches the reference tokenizer on all ${cases.length} texts`, wrong.length === 0);
  assert('Cached words give the same count on a second pass', cases.every(([text, want]) => counter.count(text) === want));
  assert('Empty text is 0 tokens', counter.count('') === 0);

  const tk = new Tokenizer();
  assert('Before loading, gemma4 requests count with o200k', tk.resolveEncoding('gemma4') === 'o200k_base');
  tk.useCounter('gemma4', counter);
  assert('Once registered, gemma4 counts are exact and use the Gemma counter',
    tk.isExact('gemma4') && tk.countMessageTokens('m1', 'Reply with one word: hello', 'gemma4') === counter.count('Reply with one word: hello'));
  assert('Other sites keep o200k', tk.resolveEncoding('o200k_base') === 'o200k_base');

  const exactFor = GeminiProvider.tokenizer.exactFor;
  assert('Exact for Gemini 3.1+ (Gemma 4 per Google SDK) and the current app model; not for 3 / 2.5 (Gemma 3)',
    exactFor('3.6 Flash') && exactFor('3.1 Pro') && exactFor('Flash') && exactFor(null) && !exactFor('3 Pro') && !exactFor('2.5 Flash'));

  return { passed, failed };
}
