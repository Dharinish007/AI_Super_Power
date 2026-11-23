/**
 * Context Monitor - Table Extractor Test Suite
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { sanitizeSheetName, deduplicateSheetName, toTables } from '../../src/engine/export/table-extractor.js';
import { ClaudeMessageParser } from '../../src/providers/claude/claude-message-parser.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readFixture = file => JSON.parse(fs.readFileSync(path.join(rootDir, 'tests', 'fixtures', 'export', file), 'utf8'));

export function runTableExtractorTests() {
  console.log('--- Running Table Extractor Tests ---');
  let passed = 0;
  let failed = 0;
  const assert = (name, cond) => {
    if (cond) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name}`);
      failed++;
    }
  };

  // 1. Sheet Name Sanitization
  {
    assert('sanitizeSheetName strips forbidden characters \\ / ? * [ ] :',
      sanitizeSheetName('Sales / Q1 [Draft]*?') === 'Sales Q1 Draft');

    assert('sanitizeSheetName strips leading and trailing single quotes',
      sanitizeSheetName("'Quarterly Report'") === 'Quarterly Report');

    assert('sanitizeSheetName truncates to 31 characters',
      sanitizeSheetName('This is a very long heading that exceeds thirty-one chars').length === 31);

    assert('sanitizeSheetName falls back to Table N on empty or invalid input',
      sanitizeSheetName('???***', 3) === 'Table 3' &&
      sanitizeSheetName('', 5) === 'Table 5' &&
      sanitizeSheetName(null, 1) === 'Table 1');
  }

  // 2. Sheet Name Deduplication
  {
    const used = new Set();
    const s1 = deduplicateSheetName('Benchmarks', used);
    const s2 = deduplicateSheetName('Benchmarks', used);
    const s3 = deduplicateSheetName('benchmarks', used); // Case-insensitive collision

    assert('deduplicateSheetName adds suffix for duplicates',
      s1 === 'Benchmarks' && s2 === 'Benchmarks 2' && s3 === 'benchmarks 3');

    // Deduplication near 31 character boundary
    const longName = 'A'.repeat(31);
    const usedLong = new Set();
    const l1 = deduplicateSheetName(longName, usedLong);
    const l2 = deduplicateSheetName(longName, usedLong);

    assert('deduplicateSheetName respects 31 char limit when adding suffix',
      l1.length === 31 && l2.length === 31 && l2.endsWith(' 2'));
  }

  // 3. toTables on Fixtures
  {
    // short-chat.json (0 tables)
    const shortChat = ClaudeMessageParser.parseFromApi(readFixture('short-chat.json'));
    const shortTables = toTables(shortChat);
    assert('short-chat returns 0 tables', shortTables.length === 0);

    // rich-chat.json (1 table)
    const richChat = ClaudeMessageParser.parseFromApi(readFixture('rich-chat.json'));
    const richTables = toTables(richChat);
    assert('rich-chat extracts exactly 1 table', richTables.length === 1);
    assert('rich-chat sheet name derived from caption or nearest heading',
      richTables[0].sheetName === 'Performance Analysis');
    assert('rich-chat table has 4 columns and 3 data rows',
      richTables[0].headers.length === 4 && richTables[0].rows.length === 3);
    assert('rich-chat table headers match Metric, Baseline, Optimized, Speedup',
      richTables[0].headers[0] === 'Metric' && richTables[0].headers[3] === 'Speedup');

    // long-chat-50.json (5 tables)
    const longChat = ClaudeMessageParser.parseFromApi(readFixture('long-chat-50.json'));
    const longTables = toTables(longChat);
    assert('long-chat extracts exactly 5 tables across conversation',
      longTables.length === 5);

    // Check all 5 table names are unique
    const names = new Set(longTables.map(t => t.sheetName.toLowerCase()));
    assert('all 5 extracted sheets have unique sheet names', names.size === 5);
  }

  return { passed, failed };
}
