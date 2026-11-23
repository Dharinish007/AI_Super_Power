/**
 * Unit Tests for Export Types and Message Parsers (Phase P1)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
  createConversationExportData,
  isConversationExportData,
  summarizeExportData
} from '../../src/engine/export/types.js';
import { DOMBlockParser } from '../../src/providers/claude/dom-block-parser.js';
import { ClaudeMessageParser, parseMarkdownBlocks } from '../../src/providers/claude/claude-message-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, '../fixtures/export');

export async function runExportParserTests() {
  console.log('--- Running Export Types and Parser Tests ---');
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
  // 1. Types & Data Model Tests (engine/export/types.js)
  // =========================================================================
  {
    const p = createParagraphBlock('Hello world');
    assert('createParagraphBlock creates valid paragraph', p.type === 'paragraph' && p.text === 'Hello world');

    const h1 = createHeadingBlock(1, 'Title');
    const h0 = createHeadingBlock(0, 'Min clamped');
    const h9 = createHeadingBlock(9, 'Max clamped');
    assert('createHeadingBlock normalizes levels 1-6', h1.level === 1 && h0.level === 1 && h9.level === 6);

    const code = createCodeBlock('print("hi")', 'PYTHON');
    assert('createCodeBlock normalizes language to lowercase', code.type === 'code' && code.language === 'python' && code.code === 'print("hi")');

    const table = createTableBlock(['A', 'B'], [['1', '2']], 'Sample Table');
    assert('createTableBlock stores headers, rows, and caption', table.type === 'table' && table.headers.length === 2 && table.rows.length === 1 && table.caption === 'Sample Table');

    const listUl = createListBlock(['item 1', 'item 2'], false);
    const listOl = createListBlock(['step 1', 'step 2'], true);
    assert('createListBlock handles ordered and unordered lists', !listUl.ordered && listOl.ordered && listUl.items.length === 2);

    const bq = createBlockquoteBlock('Important quote');
    assert('createBlockquoteBlock creates quote', bq.type === 'blockquote' && bq.text === 'Important quote');

    const att = createAttachmentBlock('doc.pdf', 'extracted content', 'application/pdf');
    assert('createAttachmentBlock creates attachment with mime and text', att.type === 'attachment' && att.name === 'doc.pdf' && att.extractedText === 'extracted content');

    const unk = createUnknownBlock('Chart element', 'canvas_widget', '<canvas width="100"/>');
    assert('createUnknownBlock creates non-dropped placeholder', unk.type === 'unknown' && unk.summary === 'Chart element' && unk.rawType === 'canvas_widget');

    const msg = createMessage({
      id: 'm1',
      role: 'user',
      blocks: [p, code],
      createdAt: 1700000000000
    });
    assert('createMessage attaches blocks and properties', msg.id === 'm1' && msg.role === 'user' && msg.blocks.length === 2 && msg.createdAt === 1700000000000);

    const exportData = createConversationExportData({
      conversationId: 'c123',
      title: 'Test Chat',
      provider: 'Claude',
      source: 'api',
      messages: [msg]
    });
    assert('createConversationExportData creates valid container', isConversationExportData(exportData) && exportData.source === 'api');
    assert('isConversationExportData rejects invalid shapes', !isConversationExportData(null) && !isConversationExportData({}));

    const summary = summarizeExportData(exportData);
    assert('summarizeExportData accurately calculates block counts', summary.totalBlocks === 2 && summary.messageCount === 1 && summary.unknownBlocks === 0 && summary.tableCount === 0);
  }

  // =========================================================================
  // 2. Markdown Block Parser Tests (parseMarkdownBlocks)
  // =========================================================================
  {
    const md = [
      '# Main Heading',
      'This is an introductory paragraph.',
      '',
      '```javascript',
      'const a = 1;',
      '```',
      '',
      '| Header 1 | Header 2 |',
      '|---|---|',
      '| Cell A | Cell B |',
      '',
      '> A notable quote',
      '',
      '- Bullet one',
      '- Bullet two',
      '',
      '1. First item',
      '2. Second item'
    ].join('\n');

    const parsedBlocks = parseMarkdownBlocks(md);
    assert('parseMarkdownBlocks extracts 7 distinct blocks', parsedBlocks.length === 7);
    assert('Heading block extracted correctly', parsedBlocks[0].type === 'heading' && parsedBlocks[0].level === 1);
    assert('Paragraph block extracted correctly', parsedBlocks[1].type === 'paragraph' && parsedBlocks[1].text.includes('introductory'));
    assert('Code block extracted with language', parsedBlocks[2].type === 'code' && parsedBlocks[2].language === 'javascript' && parsedBlocks[2].code === 'const a = 1;');
    assert('Table block extracted with rows and headers', parsedBlocks[3].type === 'table' && parsedBlocks[3].headers[0] === 'Header 1' && parsedBlocks[3].rows[0][1] === 'Cell B');
    assert('Blockquote block extracted', parsedBlocks[4].type === 'blockquote' && parsedBlocks[4].text === 'A notable quote');
    assert('Unordered list block extracted', parsedBlocks[5].type === 'list' && !parsedBlocks[5].ordered && parsedBlocks[5].items.length === 2);
    assert('Ordered list block extracted', parsedBlocks[6].type === 'list' && parsedBlocks[6].ordered && parsedBlocks[6].items[0] === 'First item');
  }

  // =========================================================================
  // 3. Fixture Testing: Claude API Active Branch & Parser
  // =========================================================================
  {
    // A. Short Chat Fixture
    const shortRaw = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'short-chat.json'), 'utf8'));
    const shortExport = ClaudeMessageParser.parseFromApi(shortRaw);
    assert('short-chat.json parses exactly 2 messages', shortExport.messages.length === 2);
    assert('short-chat user message role is user', shortExport.messages[0].role === 'user');
    assert('short-chat assistant message role is assistant', shortExport.messages[1].role === 'assistant');
    assert('short-chat source is api', shortExport.source === 'api');

    // B. Rich Chat Fixture
    const richRaw = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'rich-chat.json'), 'utf8'));
    const richExport = ClaudeMessageParser.parseFromApi(richRaw);
    assert('rich-chat.json parses active branch of 4 messages (excluding abandoned regeneration)', richExport.messages.length === 4);

    // Verify abandoned message is excluded
    const allTexts = richExport.messages.map(m => JSON.stringify(m.blocks));
    assert('Abandoned regeneration branch is completely omitted', !allTexts.some(t => t.includes('abandoned regeneration')));

    // Verify Turn 1 attachment
    const t1 = richExport.messages[0];
    assert('Turn 1 user includes benchmarks.csv attachment block', t1.blocks.some(b => b.type === 'attachment' && b.name === 'benchmarks.csv'));

    // Verify Turn 2 rich blocks
    const t2 = richExport.messages[1];
    const hasHeading = t2.blocks.some(b => b.type === 'heading' && b.text === 'Performance Analysis');
    const hasTable = t2.blocks.some(b => b.type === 'table' && b.headers.includes('Speedup') && b.rows.length === 3);
    const hasCode = t2.blocks.some(b => b.type === 'code' && b.language === 'python');
    const hasQuote = t2.blocks.some(b => b.type === 'blockquote');
    assert('Turn 2 assistant contains heading, table, code block, and blockquote', hasHeading && hasTable && hasCode && hasQuote);

    // Verify Zero Silent Drops (interactive_canvas mapped to UnknownBlock)
    const hasUnknown = t2.blocks.some(b => b.type === 'unknown' && b.rawType === 'interactive_canvas');
    assert('Turn 2 interactive_canvas is preserved as UnknownBlock without dropping', hasUnknown);

    const summary = summarizeExportData(richExport);
    assert('Summary correctly records 1 table and 1 unknown block', summary.tableCount === 1 && summary.unknownBlocks === 1);

    // C. Long Chat Fixture (50+ Messages)
    const longRaw = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'long-chat-50.json'), 'utf8'));
    const tStart = performance.now();
    const longExport = ClaudeMessageParser.parseFromApi(longRaw);
    const tDuration = performance.now() - tStart;
    assert('long-chat-50.json parses 52 messages in active chain', longExport.messages.length === 52);
    assert('long-chat-50.json extracts exactly 5 tables across conversation', summarizeExportData(longExport).tableCount === 5);
    assert(`long-chat-50.json parses in < 50ms (took ${tDuration.toFixed(2)}ms)`, tDuration < 50);
  }

  // =========================================================================
  // 4. DOM Fallback Parser Tests (DOMBlockParser & ClaudeMessageParser.parseFromDom)
  // =========================================================================
  {
    // Mock DOM elements for unit tests
    function makeEl(tag, text = '', attrs = {}, children = []) {
      const node = {
        tagName: tag.toUpperCase(),
        textContent: text,
        children: [...children],
        attributes: attrs,
        getAttribute(k) { return attrs[k] || null; },
        className: attrs['class'] || '',
        classList: {
          contains(c) { return (attrs['class'] || '').split(/\s+/).includes(c); }
        },
        cloneNode() {
          const clonedChildren = children.map(c => (c.cloneNode ? c.cloneNode() : c));
          const clone = makeEl(tag, text, attrs, clonedChildren);
          return clone;
        },
        querySelector(sel) {
          return children.find(c => c.tagName.toLowerCase() === sel.toLowerCase()) || null;
        },
        querySelectorAll(sel) {
          const results = [];
          const targets = sel.split(',').map(s => s.trim().toLowerCase());
          const check = (node) => {
            for (const child of node.children || []) {
              const tag = (child.tagName || '').toLowerCase();
              if (targets.includes(tag) || (targets.some(t => t.startsWith('.') && child.classList.contains(t.slice(1))))) {
                results.push(child);
              }
              check(child);
            }
          };
          check(this);
          return results;
        },
        remove() {
          // noop in mock
        },
        matches(sel) {
          if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
          if (sel.includes('data-testid="user-message"')) return attrs['data-testid'] === 'user-message';
          return this.tagName.toLowerCase() === sel.toLowerCase();
        },
        closest(sel) {
          return this.matches(sel) ? this : null;
        }
      };
      return node;
    }

    const headingEl = makeEl('h2', 'DOM Section Title');
    const pEl = makeEl('p', 'This is content from DOM.');
    const codeEl = makeEl('code', 'console.log("hello")', { class: 'language-javascript' });
    const preEl = makeEl('pre', '', {}, [codeEl]);

    // Table elements
    const th1 = makeEl('th', 'Col A');
    const th2 = makeEl('th', 'Col B');
    const trHead = makeEl('tr', '', {}, [th1, th2]);
    const thead = makeEl('thead', '', {}, [trHead]);
    const td1 = makeEl('td', 'Val 1');
    const td2 = makeEl('td', 'Val 2');
    const trBody = makeEl('tr', '', {}, [td1, td2]);
    const tbody = makeEl('tbody', '', {}, [trBody]);
    const tableEl = makeEl('table', '', {}, [thead, tbody]);

    // Unsupported element
    const unkEl = makeEl('canvas', '', { 'data-testid': 'custom-canvas' });

    const containerEl = makeEl('div', '', {}, [headingEl, pEl, preEl, tableEl, unkEl]);

    const domBlocks = DOMBlockParser.parseElement(containerEl);
    assert('DOMBlockParser parses heading block', domBlocks.some(b => b.type === 'heading' && b.text === 'DOM Section Title'));
    assert('DOMBlockParser parses paragraph block', domBlocks.some(b => b.type === 'paragraph' && b.text === 'This is content from DOM.'));
    assert('DOMBlockParser parses pre/code with language', domBlocks.some(b => b.type === 'code' && b.language === 'javascript'));
    assert('DOMBlockParser parses table with headers and rows', domBlocks.some(b => b.type === 'table' && b.headers[0] === 'Col A' && b.rows[0][1] === 'Val 2'));
    assert('DOMBlockParser preserves unsupported canvas as UnknownBlock', domBlocks.some(b => b.type === 'unknown'));

    // Test parseFromDom
    const userTurn = makeEl('div', 'User prompt text', { 'data-testid': 'user-message' });
    const asstTurn = makeEl('div', '', { class: 'font-claude-response' }, [pEl, tableEl]);
    const mockDoc = {
      title: 'Mock Page Title',
      querySelectorAll(sel) {
        if (sel.includes('user-message')) return [userTurn, asstTurn];
        return [];
      }
    };

    const domExport = ClaudeMessageParser.parseFromDom(mockDoc, { title: 'Mock Page Title' });
    assert('parseFromDom marks source as dom', domExport.source === 'dom');
    assert('parseFromDom extracts user and assistant turns', domExport.messages.length === 2 && domExport.messages[0].role === 'user' && domExport.messages[1].role === 'assistant');
  }

  return { passed, failed };
}
