/**
 * Context Monitor - Print HTML Exporter Test Suite
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { escapeHtml, formatBlockToHtml, toPrintHtml } from '../../engine/export/print-html-exporter.js';
import { PRINT_STYLES } from '../../ui/print-styles.js';
import { ClaudeMessageParser } from '../../content/export/claude-message-parser.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readFixture = file => JSON.parse(fs.readFileSync(path.join(rootDir, 'tests', 'fixtures', 'export', file), 'utf8'));

export function runPrintHtmlExporterTests() {
  console.log('--- Running Print HTML Exporter Tests ---');
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

  // 1. HTML Escaping & Sanitization
  {
    const escaped = escapeHtml('<script>alert("XSS & \'attack\'")</script>');
    assert('escapeHtml sanitizes <, >, &, ", \' completely',
      escaped === '&lt;script&gt;alert(&quot;XSS &amp; &#39;attack&#39;&quot;)&lt;/script&gt;');

    assert('escapeHtml handles null and undefined',
      escapeHtml(null) === '' && escapeHtml(undefined) === '');

    assert('escapeHtml handles numeric and boolean values',
      escapeHtml(1234) === '1234' && escapeHtml(true) === 'true');
  }

  // 2. Print Stylesheet Invariants
  {
    assert('Print stylesheet includes @media print',
      PRINT_STYLES.includes('@media print'));

    assert('Print stylesheet includes @page { margin: 15mm; }',
      PRINT_STYLES.includes('margin: 15mm'));

    assert('Print stylesheet specifies break-inside: avoid',
      PRINT_STYLES.includes('break-inside: avoid') || PRINT_STYLES.includes('page-break-inside: avoid'));

    assert('Print toolbar is explicitly hidden in print media',
      PRINT_STYLES.includes('.print-toolbar') && PRINT_STYLES.includes('display: none !important'));
  }

  // 3. Block HTML Formatting
  {
    const headingHtml = formatBlockToHtml({ type: 'heading', level: 2, text: 'Analysis <Result>' });
    assert('formatBlockToHtml formats and escapes headings',
      headingHtml === '<h2 class="block-heading">Analysis &lt;Result&gt;</h2>');

    const paraHtml = formatBlockToHtml({ type: 'paragraph', text: 'Line 1\nLine 2 & Line 3' });
    assert('formatBlockToHtml converts newlines to <br> in paragraphs',
      paraHtml === '<p class="block-paragraph">Line 1<br>Line 2 &amp; Line 3</p>');

    const codeHtml = formatBlockToHtml({ type: 'code', language: 'python', code: 'def test():\n    return "<xss>"' });
    assert('formatBlockToHtml formats code blocks and escapes inner characters',
      codeHtml.includes('class="language-python"') &&
      codeHtml.includes('&lt;xss&gt;') &&
      !codeHtml.includes('<xss>'));

    const tableHtml = formatBlockToHtml({
      type: 'table',
      headers: ['A', 'B'],
      rows: [['1', '<script>'], ['3']], // Row 2 is jagged
      caption: 'Test <caption>'
    });
    assert('formatBlockToHtml formats tables, pads jagged rows, and escapes captions',
      tableHtml.includes('<th>A</th><th>B</th>') &&
      tableHtml.includes('&lt;script&gt;') &&
      tableHtml.includes('<td>3</td><td></td>') &&
      tableHtml.includes('Test &lt;caption&gt;'));

    const listHtml = formatBlockToHtml({ type: 'list', ordered: true, items: ['Item 1', 'Item <2>'] });
    assert('formatBlockToHtml formats ordered list',
      listHtml === '<ol class="block-list"><li>Item 1</li><li>Item &lt;2&gt;</li></ol>');

    const quoteHtml = formatBlockToHtml({ type: 'blockquote', text: 'Quote line 1\nLine 2' });
    assert('formatBlockToHtml formats blockquotes',
      quoteHtml === '<blockquote class="block-quote">Quote line 1<br>Line 2</blockquote>');

    const attachHtml = formatBlockToHtml({
      type: 'attachment',
      name: 'data.csv',
      mimeType: 'text/csv',
      extractedText: 'col1,col2\n1,<2>'
    });
    assert('formatBlockToHtml formats attachments with extracted text preview',
      attachHtml.includes('<code>data.csv</code>') &&
      attachHtml.includes('&lt;2&gt;'));

    const unknownHtml = formatBlockToHtml({
      type: 'unknown',
      summary: 'Interactive widget <sandbox>'
    });
    assert('formatBlockToHtml preserves unknown blocks as visible warning cards',
      unknownHtml.includes('unknown-block-warning') &&
      unknownHtml.includes('Interactive widget &lt;sandbox&gt;'));
  }

  // 4. Document-Level Invariants & Security
  {
    const emptyDoc = toPrintHtml({ title: 'Empty Doc', messages: [] });
    assert('toPrintHtml handles empty conversation cleanly with DOCTYPE',
      emptyDoc.startsWith('<!DOCTYPE html>') &&
      emptyDoc.includes('<title>Empty Doc</title>') &&
      emptyDoc.includes('No messages in this conversation.'));

    const docNoHeader = toPrintHtml({ title: 'No Header', messages: [] }, { includeHeader: false });
    assert('toPrintHtml honors includeHeader: false',
      !docNoHeader.includes('class="export-header"'));

    // Button & Script check
    assert('toPrintHtml includes Print button with window.print()',
      emptyDoc.includes('onclick="window.print()"'));

    assert('toPrintHtml contains ZERO auto-print script tags',
      !emptyDoc.includes('<script>window.print()</script>') && !emptyDoc.includes('onload='));

    // Strict XSS test across document properties
    const maliciousData = {
      title: '<script>alert("title")</script>',
      provider: '<b onmouseover=alert(1)>Provider</b>',
      model: '<iframe src="evil.com"></iframe>',
      messages: [
        {
          role: 'user',
          createdAt: Date.now(),
          blocks: [
            { type: 'paragraph', text: '"><img src=x onerror=alert("p")>' }
          ]
        }
      ]
    };
    const xssDoc = toPrintHtml(maliciousData);
    assert('toPrintHtml neutralizes nested XSS payloads across all metadata and content',
      !xssDoc.includes('<script>alert("title")</script>') &&
      xssDoc.includes('&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;') &&
      !xssDoc.includes('<b onmouseover') &&
      !xssDoc.includes('<iframe src=') &&
      !xssDoc.includes('<img src=x onerror='));
  }

  // 5. Fixture Snapshots
  {
    // short-chat.json
    const shortChat = ClaudeMessageParser.parseFromApi(readFixture('short-chat.json'));
    const shortHtml = toPrintHtml(shortChat);
    assert('short-chat snapshot formats 2 message turns',
      shortHtml.includes('Quick Greeting') &&
      shortHtml.includes('Hello Claude, can you confirm you are online?') &&
      shortHtml.includes('Hello! Yes, I am fully online and ready to assist you.'));

    // rich-chat.json
    const richChat = ClaudeMessageParser.parseFromApi(readFixture('rich-chat.json'));
    const richHtml = toPrintHtml(richChat);
    assert('rich-chat snapshot includes table, code, attachment, and unknown block',
      richHtml.includes('Performance Review and Benchmark') &&
      richHtml.includes('benchmarks.csv') &&
      richHtml.includes('<th>Metric</th>') &&
      richHtml.includes('<th>Speedup</th>') &&
      richHtml.includes('calculate_speedup') &&
      richHtml.includes('Unsupported Content:') &&
      richHtml.includes('interactive_canvas') &&
      !richHtml.includes('abandoned'));

    // long-chat-50.json
    const t0 = performance.now();
    const longChat = ClaudeMessageParser.parseFromApi(readFixture('long-chat-50.json'));
    const longHtml = toPrintHtml(longChat);
    const dur = performance.now() - t0;
    assert('long-chat snapshot exports all 52 messages and budget table within 100ms',
      longChat.messages.length === 52 &&
      longHtml.includes('Yes, all requirements and architecture decisions are finalized and validated.') &&
      longHtml.includes('ClickHouse Cluster') &&
      dur < 100);
  }

  return { passed, failed };
}
