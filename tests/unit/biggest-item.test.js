/**
 * Unit Tests for Countdown & Biggest Item (content/countdown.js, content/biggest-item.js)
 */

import { ResetCountdown } from '../../content/countdown.js';
import { extractBiggestItem, formatBiggestItemDisplay, scrollToItem } from '../../content/biggest-item.js';

export function runBiggestItemAndCountdownTests() {
  console.log('--- Running Countdown & Biggest Item Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; }
    else { console.error(`  ❌ [FAIL] ${name}`); failed++; }
  };

  // 1. Countdown Tests
  const now = 1700000000000;
  let ticks = [];
  const countdown = new ResetCountdown({
    resetsAt: now + 3600000 * 2 + 60000 * 10, // 2h 10m later
    onTick: (text) => ticks.push(text),
    nowFn: () => now
  });

  countdown.start();
  assert('Countdown starts and ticks relative reset', ticks[0] === 'resets in 2h 10m');

  // Recalculate on focus/tick with new time
  let updatedTime = now + 3600000 * 1 + 60000 * 5; // 1h 5m later
  countdown.nowFn = () => updatedTime;
  countdown.tick();
  assert('Countdown tick recomputes with updated time', ticks[ticks.length - 1] === 'resets in 1h 5m');

  countdown.stop();
  countdown.destroy();

  // 2. Biggest Item Extraction Tests
  const conv = {
    messages: [
      { role: 'user', turn: 1, tokens: 120, text: 'Hello' },
      { role: 'assistant', turn: 2, tokens: 4500, text: 'Big response...' },
      { role: 'user', turn: 3, tokens: 800, text: 'Question' }
    ],
    attachments: [
      { name: 'dataset.csv', tokens: 12000 }
    ],
    tools: [
      { name: 'web_search', tokens: 3500 }
    ],
    isDomPartial: false
  };

  const biggest = extractBiggestItem(conv);
  assert('Extracts attachment as biggest item when it has highest tokens (12000)',
    biggest && biggest.type === 'attachment' && biggest.name === 'dataset.csv' && biggest.tokens === 12000);

  // If no attachments, assistant turn #2 wins
  const convNoAtt = {
    messages: [
      { role: 'user', turn: 1, tokens: 120 },
      { role: 'assistant', turn: 2, tokens: 4500 },
      { role: 'user', turn: 3, tokens: 800 }
    ],
    tools: [
      { name: 'python_code', tokens: 3200 }
    ],
    isDomPartial: true
  };

  const biggestMsg = extractBiggestItem(convNoAtt);
  assert('Extracts assistant turn #2 as biggest item',
    biggestMsg && biggestMsg.type === 'message' && biggestMsg.turn === 2 && biggestMsg.tokens === 4500);
  assert('Marks visibleOnly when isDomPartial is true', biggestMsg.visibleOnly === true);

  // Formatting display
  const disp = formatBiggestItemDisplay(biggestMsg);
  assert('Formats biggest item display label and token approximation',
    disp && disp.text.startsWith('Assistant (#2) · ~') && disp.sub === 'visible messages only');

  // Scroll to item
  let scrolled = false;
  const mockEl = { scrollIntoView: () => { scrolled = true; } };
  const scrollRes = scrollToItem(mockEl);
  assert('scrollToItem calls scrollIntoView on target element', scrollRes === true && scrolled === true);
  assert('scrollToItem safely handles null element', scrollToItem(null) === false);

  return { passed, failed };
}
