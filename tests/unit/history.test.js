/**
 * Unit Tests for Usage History & Sparkline Generation (content/history.js)
 */

import { downsampleHistory, addSample, generateSparklinePath } from '../../content/history.js';

export function runHistoryTests() {
  console.log('--- Running Usage History Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) { console.log(`  ✅ [PASS] ${name}`); passed++; }
    else { console.error(`  ❌ [FAIL] ${name}`); failed++; }
  };

  const now = 1700000000000;
  const H = 3600 * 1000;
  const D = 24 * H;

  // 1. Discard points older than 7 days
  const oldPoints = [
    { t: now - 8 * D, pct: 50 }, // >7 days old, drop
    { t: now - 2 * D, pct: 40 }, // <7 days, keep
    { t: now - 1 * H, pct: 60 }  // recent, keep
  ];
  const pruned = downsampleHistory(oldPoints, now);
  assert('Points older than 7 days are discarded', pruned.length === 2 && pruned[0].pct === 40);

  // 2. Downsamples points older than 24 hours to hourly buckets
  const denseOldPoints = [
    { t: now - 2 * D, pct: 20 },
    { t: now - 2 * D + 300000, pct: 30 },
    { t: now - 2 * D + 600000, pct: 40 }
  ];
  const downsampled = downsampleHistory(denseOldPoints, now);
  assert('Multiple points in same hour (>24h old) downsampled to single average', downsampled.length === 1 && downsampled[0].pct === 30);

  // 3. Gaps (>15 min) are tagged with gap: true, never zeroed
  const gapPoints = [
    { t: now - 30 * 60000, pct: 45 },
    { t: now - 10 * 60000, pct: 55 } // 20 min difference > 15 min
  ];
  const withGaps = downsampleHistory(gapPoints, now);
  assert('Intervals > 15 min are tagged with gap: true', withGaps.length === 2 && withGaps[1].gap === true);
  assert('Values are preserved, never zeroed', withGaps[0].pct === 45 && withGaps[1].pct === 55);

  // 4. Sparkline path generator renders breaks (M command), never drops to zero
  const pathWithGap = generateSparklinePath(withGaps, 120, 24);
  const mCommands = pathWithGap.match(/M/g);
  assert('Sparkline has discontinuous M segments for gaps', mCommands && mCommands.length === 2);

  // 5. addSample appends and downsamples cleanly
  const empty = [];
  const after1 = addSample(empty, 35, now);
  assert('addSample adds single point', after1.length === 1 && after1[0].pct === 35);
  const after2 = addSample(after1, 40, now + 5 * 60000);
  assert('addSample appends second point', after2.length === 2 && after2[1].pct === 40);

  return { passed, failed };
}
