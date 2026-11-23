/**
 * Unit & Snapshot Tests for Markdown Exporter (Phase P2)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  toMarkdown,
  formatBlockToMarkdown,
  calculateCodeFence,
  escapeTableCell
} from '../../engine/export/markdown-exporter.js';
import {
  createParagraphBlock,
  createHeadingBlock,
  createCodeBlock,
  createTableBlock,
  createListBlock,
  createBlockquoteBlock,
  createAttachmentBlock,
  createUnknownBlock,
  createMessage,
  createConversationExportData
} from '../../engine/export/types.js';
import { ClaudeMessageParser } from '../../content/export/claude-message-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, '../fixtures/export');

export async function runMarkdownExporterTests() {
  console.log('--- Running Markdown Exporter Tests ---');
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

  // =========================================================================
  // 1. Helper Functions (escapeTableCell & calculateCodeFence)
  // =========================================================================
  {
    assert('escapeTableCell escapes pipes and newlines',
      escapeTableCell('Hello | World\nNext line') === 'Hello \\| World<br>Next line');
    assert('escapeTableCell handles null and numbers',
      escapeTableCell(null) === '' && escapeTableCell(123) === '123');

    assert('calculateCodeFence defaults to 3 backticks for plain code',
      calculateCodeFence('const x = 1;') === '```');
    assert('calculateCodeFence expands to 4 backticks if code contains 3 backticks',
      calculateCodeFence('Here is a fence:\n```\nfoo\n```') === '````');
    assert('calculateCodeFence expands to 5 backticks if code contains 4 backticks',
      calculateCodeFence('````markdown\nsome code\n````') === '`````');
  }

  // =========================================================================
  // 2. Block Formatting Tests
  // =========================================================================
  {
    // Heading
    const h2 = createHeadingBlock(2, 'Subheading');
    assert('formatBlockToMarkdown formats heading', formatBlockToMarkdown(h2) === '## Subheading\n\n');

    // Code with dynamic fence
    const codeWithBackticks = createCodeBlock('```\ninner code\n```', 'markdown');
    const mdCode = formatBlockToMarkdown(codeWithBackticks);
    assert('formatBlockToMarkdown applies dynamic fence for nested backticks',
      mdCode.startsWith('````markdown\n') && mdCode.endsWith('````\n\n'));

    // Table with pipes, newlines, and jagged rows
    const table = createTableBlock(
      ['Header 1', 'Header 2', 'Header 3'],
      [
        ['Val A', 'Val | B', 'Val C\nMulti'],
        ['Short row'] // jagged row with 1 cell instead of 3
      ],
      'Test Table'
    );
    const mdTable = formatBlockToMarkdown(table);
    assert('formatBlockToMarkdown escapes pipes and <br> in tables',
      mdTable.includes('Val \\| B') && mdTable.includes('Val C<br>Multi'));
    assert('formatBlockToMarkdown pads jagged table rows to match header count',
      mdTable.includes('| Short row |  |  |'));
    assert('formatBlockToMarkdown includes table caption',
      mdTable.includes('*Table: Test Table*'));

    // List
    const ul = createListBlock(['Alpha', 'Beta'], false);
    const ol = createListBlock(['First', 'Second'], true);
    assert('formatBlockToMarkdown formats unordered list with dashes',
      formatBlockToMarkdown(ul) === '- Alpha\n- Beta\n\n');
    assert('formatBlockToMarkdown formats ordered list with numbers',
      formatBlockToMarkdown(ol) === '1. First\n2. Second\n\n');

    // Blockquote
    const bq = createBlockquoteBlock('Line 1\nLine 2');
    assert('formatBlockToMarkdown prefixes each blockquote line with >',
      formatBlockToMarkdown(bq) === '> Line 1\n> Line 2\n\n');

    // Attachment
    const att = createAttachmentBlock('data.json', '{"key": "value"}');
    const mdAtt = formatBlockToMarkdown(att);
    assert('formatBlockToMarkdown formats attachment with extracted content',
      mdAtt.includes('📎 **Attachment:** `data.json`') && mdAtt.includes('> {"key": "value"}'));

    // Unknown block
    const unk = createUnknownBlock('Interactive Canvas Graph', 'canvas', '<canvas/>');
    const mdUnk = formatBlockToMarkdown(unk);
    assert('formatBlockToMarkdown produces visible warning blockquote for unknown blocks',
      mdUnk.includes('> ⚠️ **[Unsupported block: Interactive Canvas Graph]**') && mdUnk.includes('<canvas/>'));
  }

  // =========================================================================
  // 3. Document-Level Tests (toMarkdown)
  // =========================================================================
  {
    // Empty conversation
    const emptyData = createConversationExportData({
      title: 'Empty Chat',
      provider: 'Claude',
      messages: []
    });
    const emptyMd = toMarkdown(emptyData);
    assert('toMarkdown with 0 messages displays header and no-messages note',
      emptyMd.includes('# Chat Export: Empty Chat') && emptyMd.includes('*(No messages in this conversation)*'));

    // Options: omit header
    const sampleMsg = createMessage({
      id: 'm1',
      role: 'user',
      blocks: [createParagraphBlock('Just text')],
      createdAt: 1700000000000
    });
    const sampleData = createConversationExportData({
      title: 'Single Message',
      messages: [sampleMsg]
    });
    const noHeaderMd = toMarkdown(sampleData, { includeHeader: false });
    assert('toMarkdown with includeHeader: false omits conversation title banner',
      !noHeaderMd.includes('# Chat Export:') && noHeaderMd.includes('### 👤 User'));
  }

  // =========================================================================
  // 4. Snapshot Tests on All Fixtures
  // =========================================================================
  {
    // A. Short Chat Snapshot
    const shortRaw = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'short-chat.json'), 'utf8'));
    const shortExport = ClaudeMessageParser.parseFromApi(shortRaw);
    const shortMd = toMarkdown(shortExport, { includeTimestamps: false });

    assert('short-chat snapshot contains title and 2 turns',
      shortMd.includes('# Chat Export: Quick Greeting') &&
      shortMd.includes('### 👤 User') &&
      shortMd.includes('Hello Claude, can you confirm you are online?') &&
      shortMd.includes('### 🤖 Assistant') &&
      shortMd.includes('Hello! Yes, I am fully online and ready to assist you.'));

    // B. Rich Chat Snapshot
    const richRaw = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'rich-chat.json'), 'utf8'));
    const richExport = ClaudeMessageParser.parseFromApi(richRaw);
    const richMd = toMarkdown(richExport, { includeTimestamps: false });

    assert('rich-chat snapshot includes header with model',
      richMd.includes('# Chat Export: Performance Review and Benchmark') &&
      richMd.includes('- **Model:** claude-3-5-sonnet-20241022') &&
      richMd.includes('- **Messages:** 4'));

    assert('rich-chat snapshot includes attachment block in turn 1',
      richMd.includes('📎 **Attachment:** `benchmarks.csv`') &&
      richMd.includes('> metric,baseline,optimized'));

    assert('rich-chat snapshot formats GFM table with speedup column',
      richMd.includes('| Metric | Baseline | Optimized | Speedup |') &&
      richMd.includes('| Page Load | 2.4s | 0.8s | 3.0x |'));

    assert('rich-chat snapshot formats python code block',
      richMd.includes('```python\ndef calculate_speedup(baseline, current):\n    return baseline / current\n```'));

    assert('rich-chat snapshot includes visible placeholder for interactive_canvas',
      richMd.includes('> ⚠️ **[Unsupported block: Unsupported block type: interactive_canvas]**'));

    assert('rich-chat snapshot excludes abandoned message text',
      !richMd.includes('abandoned regeneration'));

    assert('rich-chat snapshot includes ordered next-steps list in turn 4',
      richMd.includes('1. Enable asset preloading') &&
      richMd.includes('2. Compress bundle chunks'));

    // C. Long Chat Snapshot (52 messages)
    const longRaw = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'long-chat-50.json'), 'utf8'));
    const longExport = ClaudeMessageParser.parseFromApi(longRaw);
    const longMd = toMarkdown(longExport, { includeTimestamps: false });

    assert('long-chat snapshot exports all 52 turns',
      (longMd.match(/### (?:👤 User|🤖 Assistant)/g) || []).length === 52);
    assert('long-chat snapshot exports all 5 tables',
      (longMd.match(/\| Option \| Read Latency \|/g) || []).length === 1 &&
      (longMd.match(/\| Broker \| Language \|/g) || []).length === 1 &&
      (longMd.match(/\| Strategy \| Storage \|/g) || []).length === 1 &&
      (longMd.match(/\| Partition Key \| Ordering \|/g) || []).length === 1 &&
      (longMd.match(/\| Component \| Count \|/g) || []).length === 1);
  }

  return { passed, failed };
}
