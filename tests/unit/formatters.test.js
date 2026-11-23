/**
 * Unit Tests for Context Monitor pure formatters (ui/formatters.js)
 */

import { formatPercent, colorForPercent, levelForPercent, formatLeft, formatMsgs, formatReset, formatTokens, threshold, bandFor, calculateSegmentPercents } from '../../src/ui/shared/formatters.js';

export function runFormattersTests() {
  console.log('--- Running Pure Formatter Unit Tests ---');
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

  // formatPercent
  assert('formatPercent returns null for null/undefined/NaN',
    formatPercent(null) === null &&
    formatPercent(undefined) === null &&
    formatPercent(NaN) === null
  );

  const p0 = formatPercent(0);
  assert('formatPercent(0) -> 0%, good, 🟢', p0.text === '0%' && p0.level === 'good' && p0.emoji === '🟢');

  const p48 = formatPercent(48);
  assert('formatPercent(48) -> 48%, good, 🟢, color green',
    p48.text === '48%' && p48.level === 'good' && p48.emoji === '🟢' && p48.color === '#10a37f'
  );

  const p49 = formatPercent(49.4);
  assert('formatPercent(49.4) rounds to 49%, good', p49.text === '49%' && p49.level === 'good');

  const p50 = formatPercent(50);
  assert('formatPercent(50) -> 50%, warn, 🟡, color amber',
    p50.text === '50%' && p50.level === 'warn' && p50.emoji === '🟡' && p50.color === '#f59e0b'
  );

  const p67 = formatPercent(67);
  assert('formatPercent(67) -> 67%, warn, 🟡', p67.text === '67%' && p67.level === 'warn');

  const p80 = formatPercent(80);
  assert('formatPercent(80) -> 80%, warn, 🟡 (threshold 50-80 inclusive)',
    p80.text === '80%' && p80.level === 'warn' && p80.emoji === '🟡'
  );

  const p81 = formatPercent(80.6);
  assert('formatPercent(80.6) -> 81%, bad, 🔴, color red',
    p81.text === '81%' && p81.level === 'bad' && p81.emoji === '🔴' && p81.color === '#ef4444'
  );

  const p95 = formatPercent(95);
  assert('formatPercent(95) -> 95%, bad, 🔴', p95.text === '95%' && p95.level === 'bad');

  // colorForPercent & levelForPercent
  assert('colorForPercent mirrors thresholds',
    colorForPercent(30) === '#10a37f' &&
    colorForPercent(70) === '#f59e0b' &&
    colorForPercent(85) === '#ef4444' &&
    colorForPercent(null) === null
  );

  assert('levelForPercent mirrors thresholds',
    levelForPercent(30) === 'good' &&
    levelForPercent(70) === 'warn' &&
    levelForPercent(85) === 'bad' &&
    levelForPercent(null) === ''
  );

  // formatLeft
  assert('formatLeft returns null for invalid values',
    formatLeft(null) === null &&
    formatLeft(undefined) === null &&
    formatLeft(-1) === null &&
    formatLeft(NaN) === null
  );

  assert('formatLeft(28) -> ~28 msgs left', formatLeft(28) === '~28 msgs left');
  assert('formatLeft(0) -> ~0 msgs left', formatLeft(0) === '~0 msgs left');
  assert('formatLeft(33.8) rounds to ~34 msgs left', formatLeft(33.8) === '~34 msgs left');

  // formatReset
  const now = 1700000000000;
  assert('formatReset returns null for null/past timestamps',
    formatReset(null, now) === null &&
    formatReset(now - 1000, now) === null &&
    formatReset(undefined, now) === null
  );

  // Within 24 hours: "resets 7:20 PM"
  const within24h = now + 2 * 3600 * 1000; // 2 hours later
  const resetUnder24 = formatReset(within24h, now);
  assert('formatReset within 24 hours starts with "resets "',
    typeof resetUnder24 === 'string' && resetUnder24.startsWith('resets ') && !resetUnder24.includes('in')
  );

  // 24 hours or more: "resets in 1d 8h"
  const over24h = now + (24 + 8) * 3600 * 1000; // 1d 8h later
  assert('formatReset for 32 hours later returns "resets in 1d 8h"',
    formatReset(over24h, now) === 'resets in 1d 8h'
  );

  // ISO string support
  const isoDate = new Date(over24h).toISOString();
  assert('formatReset handles ISO string date',
    formatReset(isoDate, now) === 'resets in 1d 8h'
  );

  // formatTokens
  assert('formatTokens returns null for null/undefined/NaN (never N/A)',
    formatTokens(null) === null &&
    formatTokens(undefined) === null &&
    formatTokens(NaN) === null
  );

  assert('formatTokens formats small numbers without suffix', formatTokens(500) === '500');
  assert('formatTokens formats 96009 to 96K (no false precision)', formatTokens(96009) === '96K');
  assert('formatTokens formats 200000 to 200K', formatTokens(200000) === '200K');
  assert('formatTokens formats 1500000 to 1.5M', formatTokens(1500000) === '1.5M');
  assert('formatTokens with approx option adds ~ prefix', formatTokens(96000, { approx: true }) === '~96K');

  // threshold
  const t30 = threshold(30);
  assert('threshold(30) -> ok, good, #10a37f, 🟢', t30.state === 'ok' && t30.level === 'good' && t30.color === '#10a37f' && t30.emoji === '🟢' && t30.symbol === '');
  const t65 = threshold(65);
  assert('threshold(65) -> warn, warn, #f59e0b, 🟡', t65.state === 'warn' && t65.level === 'warn' && t65.color === '#f59e0b' && t65.emoji === '🟡' && t65.symbol === '');
  const t85 = threshold(85);
  assert('threshold(85) -> danger, bad, #ef4444, 🔴, ⚠', t85.state === 'danger' && t85.level === 'bad' && t85.color === '#ef4444' && t85.emoji === '🔴' && t85.symbol === '⚠');

  // formatMsgs
  assert('formatMsgs with est option', formatMsgs(28, { est: true }) === '~28 msgs left · est.');
  const splitMsgs = formatMsgs(28, { split: true });
  assert('formatMsgs with split option', splitMsgs.top === '~28 msgs' && splitMsgs.bottom === 'left');

  // formatReset relative (Gemini format: resets in 2h 10m)
  const geminiReset = now + (2 * 3600 + 10 * 60) * 1000;
  assert('formatReset relative: "resets in 2h 10m"', formatReset(geminiReset, now, { relative: true }) === 'resets in 2h 10m');

  // bandFor(percent)
  assert('bandFor(< 75) returns "green" (e.g. 0, 50, 74.9)',
    bandFor(0) === 'green' &&
    bandFor(50) === 'green' &&
    bandFor(74.9) === 'green'
  );
  assert('bandFor(75 <= pct <= 90) returns "amber" (75 is amber, 90 is amber)',
    bandFor(75) === 'amber' &&
    bandFor(80) === 'amber' &&
    bandFor(90) === 'amber'
  );
  assert('bandFor(> 90) returns "red" (90.1 is red, 100 is red)',
    bandFor(90.1) === 'red' &&
    bandFor(95) === 'red' &&
    bandFor(100) === 'red'
  );
  assert('bandFor handles null, undefined, non-finite safely returning "green"',
    bandFor(null) === 'green' &&
    bandFor(undefined) === 'green' &&
    bandFor(NaN) === 'green' &&
    bandFor(Infinity) === 'green'
  );

  // calculateSegmentPercents(segments, limit)
  const sampleSegments = [
    { id: 'user', label: 'You', tokens: 4000 },
    { id: 'assistant', label: 'Claude & tools', tokens: 55000 },
    { id: 'system', label: 'System & memory', tokens: 41000 }
  ];
  const pctSegments = calculateSegmentPercents(sampleSegments, 200000);
  assert('calculateSegmentPercents calculates percentage of limit (not sum)',
    pctSegments.length === 3 &&
    pctSegments[0].percent === 2 &&
    pctSegments[1].percent === 28 &&
    pctSegments[2].percent === 21
  );
  const totalSegPct = pctSegments.reduce((sum, s) => sum + s.percent, 0);
  assert('Total segment percentages sum to context utilization percent (51%), NOT 100%',
    totalSegPct === 51 && totalSegPct !== 100
  );

  const zeroSegments = [
    { id: 'user', label: 'You', tokens: 0 },
    { id: 'assistant', label: 'Claude & tools', tokens: 0 },
    { id: 'system', label: 'System & memory', tokens: 0 }
  ];
  const zeroPctSegments = calculateSegmentPercents(zeroSegments, 200000);
  assert('At 0 context tokens, all segments return 0%',
    zeroPctSegments.every(s => s.percent === 0)
  );

  const zeroLimitSegments = calculateSegmentPercents(sampleSegments, 0);
  assert('At limit <= 0, all segments return 0%',
    zeroLimitSegments.every(s => s.percent === 0)
  );

  assert('calculateSegmentPercents handles non-array input safely',
    calculateSegmentPercents(null, 200000).length === 0 &&
    calculateSegmentPercents(undefined, 200000).length === 0
  );

  return { passed, failed };
}
