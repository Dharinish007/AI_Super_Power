/**
 * Unit Tests for Production BPE Tokenizer
 * 
 * Verifies exact BPE tokenization, model-aware encoding resolution,
 * message parts extraction, special token safety, caching, and edge cases.
 */

import { Tokenizer, BpeCounter, BUNDLED_ENCODING } from '../../src/engine/tokenizer.js';
import o200k_base from 'js-tiktoken/ranks/o200k_base';

export function runTokenizerTests() {
  console.log('--- Running Tokenizer Tests ---');
  let passed = 0;
  let failed = 0;

  function assert(name, condition) {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name}`);
      failed++;
    }
  }

  const tokenizer = new Tokenizer();

  // 1. Empty & Null text edge cases
  assert('Empty string returns 0 tokens', tokenizer.countTokens('') === 0);
  assert('Null input returns 0 tokens', tokenizer.countTokens(null) === 0);
  assert('Undefined input returns 0 tokens', tokenizer.countTokens(undefined) === 0);
  assert('Whitespace only input tokenized accurately', tokenizer.countTokens('   \n\t  ') === 2);

  // 2. Normal text
  const normalText = 'Hello world! How are you today?';
  const normalCountO2 = tokenizer.countTokens(normalText, 'o200k_base');
  const normalCountCl = tokenizer.countTokens(normalText, 'cl100k_base');
  assert('Normal text returns exact 8 tokens on o200k_base', normalCountO2 === 8);
  assert('cl100k_base is not bundled: counted with o200k_base', normalCountCl === normalCountO2);

  // 3. Punctuation & Symbols
  const punctText = 'Hello, world! (How are you? [Fine; thanks/okay] - "yes"... -- \'really\')';
  const punctCount = tokenizer.countTokens(punctText, 'o200k_base');
  assert('Punctuation string returns exact 24 tokens on o200k_base', punctCount === 24);

  // 4. Numbers & Currency
  const numText = 'Invoice #982348 dated 2026-09-21: total $4,582.50 USD across 1,000 items.';
  const numCount = tokenizer.countTokens(numText, 'o200k_base');
  assert('Numbers and currency return exact 28 tokens on o200k_base', numCount === 28);

  // 5. Unicode / Emoji / Multilingual
  const unicodeText = '👨‍👩‍👧‍👦 🎉 ✨ こんにちは世界！ Bonjour le monde! éàüñç';
  const unicodeCountO2 = tokenizer.countTokens(unicodeText, 'o200k_base');
  const unicodeCountCl = tokenizer.countTokens(unicodeText, 'cl100k_base');
  assert('Unicode/Emoji returns exact 28 tokens on o200k_base', unicodeCountO2 === 28);
  assert('Unicode/Emoji on cl100k_base request: counted with o200k_base', unicodeCountCl === unicodeCountO2);

  // 6. Code blocks
  const pythonCode = '```python\ndef calculate_sum(a: int, b: int) -> int:\n    # Returns the sum of a and b\n    return a + b\n```';
  const pyCount = tokenizer.countTokens(pythonCode, 'o200k_base');
  assert('Python code block returns exact 34 tokens on o200k_base', pyCount === 34);

  const jsCode = 'const fn = async (req, res) => { const { id } = req.params; return res.json({ id, ok: true }); };';
  const jsCount = tokenizer.countTokens(jsCode, 'o200k_base');
  assert('JavaScript code block returns exact 30 tokens on o200k_base', jsCount === 30);

  // 7. Long messages
  const longSentence = 'The quick brown fox jumps over the lazy dog. ';
  const longText = longSentence.repeat(500); // 500 repetitions = 5001 tokens
  const t0 = performance.now();
  const longCount = tokenizer.countTokens(longText, 'o200k_base');
  const t1 = performance.now();
  const durationMs = t1 - t0;
  assert(`Long message (5K tokens) encoded in ${durationMs.toFixed(2)}ms (< 100ms)`, durationMs < 100);
  assert('Long message returns exact 5001 tokens', longCount === 5001);

  // 8. Multiple messages & LRU caching
  const msg1Id = 'msg-user-1';
  const msg1Text = 'What is the speed of light in vacuum?';
  const c1 = tokenizer.countMessageTokens(msg1Id, msg1Text, 'gpt-4o');
  const c1Cached = tokenizer.countMessageTokens(msg1Id, msg1Text, 'gpt-4o');
  assert('Message 1 token count is exact (9 tokens)', c1 === 9);
  assert('Message 1 subsequent count hits LRU cache', c1 === c1Cached);

  const msg2Id = 'msg-assistant-1';
  const msg2Text = 'The speed of light in vacuum is approximately 299,792,458 meters per second.';
  const c2 = tokenizer.countMessageTokens(msg2Id, msg2Text, 'gpt-4o');
  assert('Message 2 token count is exact (18 tokens)', c2 === 18);

  // Multiple messages with same text but different IDs have independent cached entries
  const msg3Id = 'msg-user-2';
  const c3 = tokenizer.countMessageTokens(msg3Id, msg1Text, 'gpt-4o');
  assert('Multiple distinct messages cached independently', c3 === 9);

  // Modifying text for existing message ID invalidates and updates cache
  const c1Modified = tokenizer.countMessageTokens(msg1Id, msg1Text + ' Please explain in km/h.', 'gpt-4o');
  assert('Modified text invalidates cache and returns higher count', c1Modified > c1);


  // Contraction difference across encodings
  const contraction = "It's we'll they'd shouldn't couldn't won't I'm you're";
  const contO2 = tokenizer.countTokens(contraction, 'o200k_base');
  const contCl = tokenizer.countTokens(contraction, 'cl100k_base');
  assert('o200k_base encodes contractions into single subwords (8 tokens)', contO2 === 8);
  assert('cl100k_base request counts contractions with o200k_base', contCl === contO2);

  // Exactness: only o200k ranks are bundled, so models on another tokenizer are approximate
  // The model's encoding comes from config/model-limits.json (`encoding` per model)
  assert('o200k models are counted exactly', tokenizer.isExact('o200k_base'));
  assert('Missing encoding defaults to exact o200k', tokenizer.isExact(undefined) && tokenizer.isExact(null));
  assert('Retired cl100k models (GPT-4, GPT-3.5) are approximate', !tokenizer.isExact('cl100k_base'));
  assert('Counting always uses the bundled o200k_base table', tokenizer.resolveEncoding('cl100k_base') === BUNDLED_ENCODING);

  // 10. Special tokens safety (never crash on raw prompt tokens)
  const specialTokenText = 'This is an end-of-text marker: <|endoftext|> and im_start: <|im_start|>';
  const specialCount = tokenizer.countTokens(specialTokenText, 'o200k_base');
  assert('Special tokens like <|endoftext|> encoded safely without throwing', specialCount > 0);

  // 11. Message parts[] tokenization and non-text classification
  const messageWithParts = [
    { type: 'text', text: 'Please analyze this diagram:' },
    { type: 'image', url: 'https://example.com/diagram.png', classification: 'ESTIMATED' },
    { type: 'text', text: 'Does it look correct?' },
    { type: 'file', filename: 'data.csv', classification: 'UNKNOWN' }
  ];

  const partsResult = tokenizer.countMessagePartsTokens('msg-parts-1', messageWithParts, 'gpt-4o');
  assert('Parts tokenization counts only text tokens (10 tokens)', partsResult.tokens === 10);
  assert('Parts tokenization identifies non-text parts present', partsResult.hasNonTextParts === true);
  assert('Parts tokenization preserves non-text parts without fabricating text tokens', partsResult.nonTextParts.length === 2);
  assert('First non-text part is image with ESTIMATED classification', partsResult.nonTextParts[0].type === 'image' && partsResult.nonTextParts[0].classification === 'ESTIMATED');
  assert('Second non-text part is file with UNKNOWN classification', partsResult.nonTextParts[1].type === 'file' && partsResult.nonTextParts[1].classification === 'UNKNOWN');

  // countMessageTokens delegates to parts handling when array is passed
  const delegatedPartsCount = tokenizer.countMessageTokens('msg-parts-2', messageWithParts, 'gpt-4o');
  assert('countMessageTokens seamlessly delegates parts array to exact parts tokenizer', delegatedPartsCount === 10);

  // 12. Rank table built in slices (no long main-thread task) gives the same counts as one build
  const full = new BpeCounter(o200k_base);
  const sliced = new BpeCounter(o200k_base, { deferred: true });
  assert('Deferred counter starts unbuilt', sliced.built === false);
  let slices = 0;
  while (!sliced.build(1)) slices++;
  assert('Deferred build runs in several slices (' + (slices + 1) + ')', slices > 1 && sliced.built === true);
  assert('Sliced table has every rank', sliced.ranks.size === full.ranks.size);
  const sample = unicodeText + ' ' + pythonCode + ' ' + specialTokenText;
  assert('Sliced table counts identically', sliced.count(sample) === full.count(sample));
  assert('build() after completion is a no-op returning true', sliced.build(0) === true && sliced.ranks.size === full.ranks.size);

  // warm() starts the build without blocking; a count needed right away finishes it synchronously
  const warmTk = new Tokenizer();
  warmTk.warm();
  assert('warm() returns before the table is complete', warmTk.counter && warmTk.counter.built === false);
  assert('Count right after warm() is still exact', warmTk.countTokens(normalText) === 8 && warmTk.counter.built === true);
  assert('Table build time is recorded once complete', typeof warmTk.stats.initMs === 'number');

  return { passed, failed };
}
