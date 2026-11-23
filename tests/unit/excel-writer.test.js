/**
 * Context Monitor - Excel Writer Test Suite (.xlsx & OpenXML)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  escapeXml,
  colToLetter,
  isFormulaRisk,
  calculateCrc32,
  buildZipArchive,
  buildWorksheetXml,
  toExcel
} from '../../engine/export/excel-writer.js';
import { toTables } from '../../engine/export/table-extractor.js';
import { ClaudeMessageParser } from '../../content/export/claude-message-parser.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readFixture = file => JSON.parse(fs.readFileSync(path.join(rootDir, 'tests', 'fixtures', 'export', file), 'utf8'));

export function runExcelWriterTests() {
  console.log('--- Running Excel Writer Tests ---');
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

  // 1. XML Helpers
  {
    assert('escapeXml escapes &, <, >, ", \'',
      escapeXml('<test attr="val" & \'quote\'>') === '&lt;test attr=&quot;val&quot; &amp; &apos;quote&apos;&gt;');

    assert('colToLetter translates 0-based column indices correctly',
      colToLetter(0) === 'A' &&
      colToLetter(25) === 'Z' &&
      colToLetter(26) === 'AA' &&
      colToLetter(27) === 'AB');
  }

  // 2. Formula Injection Risk Detection
  {
    assert('isFormulaRisk detects =, +, -, @ prefixes',
      isFormulaRisk('=cmd|') &&
      isFormulaRisk('+SUM(A1)') &&
      isFormulaRisk('-10+20') &&
      isFormulaRisk('@SUM(A1:A5)') &&
      isFormulaRisk('  =TRIMMED'));

    assert('isFormulaRisk permits safe plain strings and numbers',
      !isFormulaRisk('Normal text') &&
      !isFormulaRisk('12345') &&
      !isFormulaRisk(456) &&
      !isFormulaRisk(null));
  }

  // 3. CRC-32 & ZIP Builder
  {
    const encoder = new TextEncoder();
    const testBytes = encoder.encode('123456789');
    const crc = calculateCrc32(testBytes);
    // Standard test vector: CRC-32 of ASCII '123456789' is 0xCBF43926
    assert('calculateCrc32 matches standard test vector for 123456789 (0xCBF43926)',
      crc === 0xcbf43926);

    const testFiles = [
      { path: 'hello.txt', data: 'Hello World' },
      { path: 'data.xml', data: '<xml>Test</xml>' }
    ];
    const zipBytes = buildZipArchive(testFiles);

    // Verify PKZIP local file header signature 0x04034b50 (little endian: [0x50, 0x4b, 0x03, 0x04])
    assert('buildZipArchive produces valid PKZIP local file header signature (PK 03 04)',
      zipBytes[0] === 0x50 && zipBytes[1] === 0x4b && zipBytes[2] === 0x03 && zipBytes[3] === 0x04);

    // Convert to text to check file names present in central directory
    const text = new TextDecoder('latin1').decode(zipBytes);
    assert('buildZipArchive includes all file paths in archive and central directory',
      text.includes('hello.txt') && text.includes('data.xml'));

    // Check EOCD signature 0x06054b50
    const hasEocd = text.includes('PK\x05\x06');
    assert('buildZipArchive terminates with standard EOCD record', hasEocd);
  }

  // 4. Worksheet XML Generation & Formula Protection
  {
    const headers = ['Metric', 'Formula Risk', 'Number'];
    const rows = [
      ['Page Load', '=cmd| /c calc', 100],
      ['Latency', '+cmd|evil', 50]
    ];
    const sheetXml = buildWorksheetXml(headers, rows);

    assert('buildWorksheetXml includes worksheet and sheetData tags',
      sheetXml.includes('<worksheet') && sheetXml.includes('<sheetData>'));

    assert('buildWorksheetXml applies header style s="1"',
      sheetXml.includes('s="1"'));

    assert('buildWorksheetXml applies quotePrefix style s="2" to formula risk cells',
      sheetXml.includes('s="2" t="inlineStr"><is><t>=cmd| /c calc</t></is></c>') &&
      sheetXml.includes('s="2" t="inlineStr"><is><t>+cmd|evil</t></is></c>'));

    assert('buildWorksheetXml preserves numeric values with <v>',
      sheetXml.includes('<c r="C2" s="0"><v>100</v></c>'));

    // Character capping test
    const longCell = 'A'.repeat(35000);
    const cappedXml = buildWorksheetXml(['Long'], [[longCell]]);
    assert('buildWorksheetXml caps cell strings safely at 32,700 chars',
      !cappedXml.includes('A'.repeat(32701)) && cappedXml.includes('A'.repeat(32700)));
  }

  // 5. Complete toExcel Package Generation & Fixtures
  {
    // short-chat.json (0 tables -> generates Notes worksheet)
    const shortChat = ClaudeMessageParser.parseFromApi(readFixture('short-chat.json'));
    const shortTables = toTables(shortChat);
    const shortXlsx = toExcel(shortChat, shortTables);

    assert('short-chat generates valid .xlsx buffer',
      shortXlsx instanceof Uint8Array && shortXlsx.length > 500);

    const shortArchiveText = new TextDecoder('latin1').decode(shortXlsx);
    assert('short-chat includes Notes worksheet when no tables exist',
      shortArchiveText.includes('sheet name="Notes"') &&
      shortArchiveText.includes('[Content_Types].xml') &&
      shortArchiveText.includes('xl/workbook.xml') &&
      shortArchiveText.includes('xl/styles.xml'));

    // rich-chat.json (1 table + 1 unsupported block -> Table sheet + Notes sheet)
    const richChat = ClaudeMessageParser.parseFromApi(readFixture('rich-chat.json'));
    const richTables = toTables(richChat);
    const richXlsx = toExcel(richChat, richTables);
    const richArchiveText = new TextDecoder('latin1').decode(richXlsx);

    assert('rich-chat exports table sheet AND Notes sheet for unsupported canvas',
      richArchiveText.includes('sheet name="Notes"') &&
      richArchiveText.includes('sheet name="Performance Analysis"'));

    // long-chat-50.json (5 tables)
    const t0 = performance.now();
    const longChat = ClaudeMessageParser.parseFromApi(readFixture('long-chat-50.json'));
    const longTables = toTables(longChat);
    const longXlsx = toExcel(longChat, longTables);
    const dur = performance.now() - t0;
    const longArchiveText = new TextDecoder('latin1').decode(longXlsx);

    assert('long-chat exports all 5 table worksheets',
      longArchiveText.includes('worksheets/sheet1.xml') &&
      longArchiveText.includes('worksheets/sheet2.xml') &&
      longArchiveText.includes('worksheets/sheet3.xml') &&
      longArchiveText.includes('worksheets/sheet4.xml') &&
      longArchiveText.includes('worksheets/sheet5.xml'));

    assert('long-chat 52-message 5-table export runs in < 50ms',
      dur < 50);

    // 100-row table stress test
    const stressHeaders = ['ID', 'Name', 'Score', 'Status', 'Formula Attack'];
    const stressRows = [];
    for (let i = 1; i <= 100; i++) {
      stressRows.push([i, `Item ${i}`, Math.round(Math.random() * 100), 'Active', `=HYPERLINK("evil.com/${i}")`]);
    }
    const stressTables = [{ sheetName: 'Stress Test', headers: stressHeaders, rows: stressRows }];
    const t1 = performance.now();
    const stressXlsx = toExcel({ title: 'Stress Chat', messages: [] }, stressTables);
    const stressDur = performance.now() - t1;

    assert('100-row stress table exports in < 50ms',
      stressDur < 50 && stressXlsx.length > 2000);
  }

  return { passed, failed };
}
