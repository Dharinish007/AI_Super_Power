/**
 * Unit Tests for Pre-Send Estimator (content/pre-send.js)
 */

import { PreSendEstimator, formatPreSendEstimate } from '../../src/features/pre-send/pre-send.js';

export function runPreSendTests() {
  console.log('--- Running Pre-Send Token Estimator Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; }
    else { console.error(`  ❌ [FAIL] ${name}`); failed++; }
  };

  let estimated = null;
  const estimator = new PreSendEstimator({
    tokenizer: (text) => text.split(/\s+/).length * 2, // Simple test tokenizer
    onEstimate: (tokens) => { estimated = tokens; },
    debounceMs: 50
  });

  // 1. Direct estimateNow
  const tokens = estimator.estimateNow('Hello world test prompt');
  assert('Estimates tokens in memory', tokens === 8 && estimated === 8);

  // 2. Empty text returns null
  const emptyTokens = estimator.estimateNow('   ');
  assert('Empty string returns null estimate', emptyTokens === null && estimated === null);

  // 3. Format pre-send string
  assert('formatPreSendEstimate formats draft ≈ N tokens', formatPreSendEstimate(42) === 'draft ≈ 42 tokens');
  assert('formatPreSendEstimate handles custom token formatter',
    formatPreSendEstimate(1500, (n) => `${(n / 1000).toFixed(1)}K`) === 'draft ≈ 1.5K tokens');
  assert('formatPreSendEstimate returns null for 0 or negative', formatPreSendEstimate(0) === null && formatPreSendEstimate(-5) === null);

  // 4. Attach and simulate mock input element
  const listeners = {};
  const mockInput = {
    value: 'A new draft question',
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; }
  };

  estimator.attach(mockInput);
  assert('Attaches input listener', typeof listeners['input'] === 'function');

  estimator.detach();
  assert('Detaches listeners on detach()', listeners['input'] === undefined);

  return { passed, failed };
}
