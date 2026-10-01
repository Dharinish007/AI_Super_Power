/**
 * Master Test Runner for ChatGPT Context Monitor
 */

import { runTokenizerTests } from './unit/tokenizer.test.js';
import { runContextEngineTests } from './unit/context-engine.test.js';
import { runConversationClientTests } from './unit/conversation-client.test.js';
import { runNetworkObserverTests } from './unit/network-observer.test.js';
import { runCompletenessTests } from './unit/completeness.test.js';
import { runDomExtractorTests } from './dom/extractor.test.js';
import { runEvidenceConfidenceTests } from './unit/evidence-confidence.test.js';
import { runModelPlanLimitsTests } from './unit/model-plan-limits.test.js';
import { runBundleIntegrityTests } from './unit/bundle-integrity.test.js';
import { runInterceptorTests } from './unit/interceptor.test.js';
import { runLiveSourcesTests } from './unit/live-sources.test.js';
import { runWidgetStateTests } from './unit/widget-state.test.js';
import { runReliabilityTests } from './unit/reliability.test.js';
import { runAccuracyTests } from './unit/accuracy.test.js';
import { runFinalFixesTests } from './unit/final-fixes.test.js';
import { runConfidenceDiagnosticsTests } from './unit/confidence-diagnostics.test.js';
import { runProvidersTests } from './unit/providers.test.js';
import { runPerformanceTests } from './unit/performance.test.js';
import { runCapsuleTests } from './unit/capsule.test.js';
import { runGemmaTokenizerTests } from './unit/gemma-tokenizer.test.js';
import { runSettingsTests } from './unit/settings.test.js';
import { runPageActionsTests } from './unit/page-actions.test.js';

const SUITES = [
  runTokenizerTests,
  runContextEngineTests,
  runConversationClientTests, // Group B
  runNetworkObserverTests, // Group C
  runCompletenessTests, // Group D: completeness & virtualization
  runDomExtractorTests,
  runEvidenceConfidenceTests, // Group E
  runModelPlanLimitsTests, // Group F
  runBundleIntegrityTests,
  runInterceptorTests, // MAIN-world network interceptor
  runLiveSourcesTests, // Session bearer, capture fallback, backoff
  runWidgetStateTests,
  runReliabilityTests,
  runAccuracyTests, // Context accuracy + model/plan intelligence
  runFinalFixesTests, // Load delay, loading state, refresh, triggers, popup removal
  runConfidenceDiagnosticsTests, // Confidence, evidence provenance, diagnostics
  runProvidersTests, // Claude + Gemini adapters
  runPerformanceTests, // Fast paths are exactly equivalent to the slow ones
  runCapsuleTests, // Prompt, reply parsing, local store, chat-box insertion
  runGemmaTokenizerTests, // Gemma 4 tokenizer (Gemini) == reference implementation
  runSettingsTests, // Settings defaults, normalize, read/write with repair
  runPageActionsTests // The in-page Page: read the chat, fill the box, wait for a Capsule
];

console.log('========================================================');
console.log('  ChatGPT Context Monitor - Production Test Suite');
console.log('========================================================\n');

let totalPassed = 0;
let totalFailed = 0;
const t0 = performance.now();
for (const suite of SUITES) {
  const r = await suite();
  totalPassed += r.passed;
  totalFailed += r.failed;
  console.log('');
}
const elapsed = (performance.now() - t0).toFixed(2);

console.log('========================================================');
console.log(`  Tests Completed in ${elapsed}ms`);
console.log(`  Total Passed: ${totalPassed}`);
console.log(`  Total Failed: ${totalFailed}`);
console.log('========================================================\n');

if (totalFailed > 0) {
  console.error(`💥 Test run failed with ${totalFailed} failure(s).`);
  process.exit(1);
} else {
  console.log('🎉 All test suites passed successfully!');
  process.exit(0);
}
