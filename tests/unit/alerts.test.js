/**
 * Unit Tests for Threshold Alerts & Hysteresis Engine (content/alerts.js)
 */

import { AlertManager, shouldShowNewChatSuggestion } from '../../content/alerts.js';

export function runAlertsTests() {
  console.log('--- Running Threshold Alerts & Hysteresis Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; }
    else { console.error(`  ❌ [FAIL] ${name}`); failed++; }
  };

  const toasts = [];
  const manager = new AlertManager({ toastFn: (msg) => toasts.push(msg) });

  // 1. Alert at 80% measured context
  let res = manager.evaluate({ chatId: 'c1', contextPct: 80, contextSource: 'measured' });
  assert('Alerts at 80% measured context', res.fired === true && res.type === 'context');
  assert('Toast copy is exact for measured: "Context usage reached 80%"', toasts[toasts.length - 1] === 'Context usage reached 80%');

  // 2. Alert fires once per threshold per chat (not on repeat 82%)
  res = manager.evaluate({ chatId: 'c1', contextPct: 82, contextSource: 'measured' });
  assert('Does not re-fire at 82% in the same chat', res.fired === false && toasts.length === 1);

  // 3. Re-arming hysteresis rule: dropping to 72% does NOT re-arm
  manager.evaluate({ chatId: 'c1', contextPct: 72, contextSource: 'measured' });
  res = manager.evaluate({ chatId: 'c1', contextPct: 81, contextSource: 'measured' });
  assert('Does NOT re-arm if only dropped to 72% (>= 70%)', res.fired === false && toasts.length === 1);

  // 4. Dropping strictly below 70% re-arms
  manager.evaluate({ chatId: 'c1', contextPct: 69, contextSource: 'measured' });
  res = manager.evaluate({ chatId: 'c1', contextPct: 80, contextSource: 'measured' });
  assert('Re-arms after dropping below 70% (69%) and fires again at 80%', res.fired === true && toasts.length === 2);

  // 5. Softer wording for estimated values ("est. ~80%")
  res = manager.evaluate({ chatId: 'c2', contextPct: 80.2, contextSource: 'estimated' });
  assert('Estimated alert fires with soft wording', res.fired === true && toasts[toasts.length - 1] === 'Context usage is est. ~80%');

  // 6. Session threshold alert at 80%
  res = manager.evaluate({ chatId: 'c3', sessionPct: 85, sessionSource: 'measured' });
  assert('Session alert fires at 85%', res.fired === true && res.type === 'session' && toasts[toasts.length - 1] === 'Session usage reached 85%');

  // 7. Disabled setting suppresses alerts
  res = manager.evaluate({ chatId: 'c4', contextPct: 90, enabled: false });
  assert('Disabled alerts do not fire', res.fired === false);

  // 8. "Consider a new chat" line in drawer
  assert('shouldShowNewChatSuggestion false under 80% measured', shouldShowNewChatSuggestion(79, 'measured') === false);
  assert('shouldShowNewChatSuggestion true at 80% measured', shouldShowNewChatSuggestion(80, 'measured') === true);
  assert('shouldShowNewChatSuggestion false for estimated at 80%', shouldShowNewChatSuggestion(80, 'estimated') === false);
  assert('shouldShowNewChatSuggestion false for estimated at 84%', shouldShowNewChatSuggestion(84, 'estimated') === false);
  assert('shouldShowNewChatSuggestion true for estimated at 85%', shouldShowNewChatSuggestion(85, 'estimated') === true);
  assert('shouldShowNewChatSuggestion false when disabled', shouldShowNewChatSuggestion(90, 'measured', false) === false);
  assert('shouldShowNewChatSuggestion false for null/undefined', shouldShowNewChatSuggestion(null) === false);

  return { passed, failed };
}
