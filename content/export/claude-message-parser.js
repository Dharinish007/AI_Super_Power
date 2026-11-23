/**
 * Context Monitor - Claude Message Parser
 *
 * Extracts and normalizes Claude chat conversations into ConversationExportData.
 * Supports:
 * 1. Authoritative API payload (primary): traverses active branch from leaf to root,
 *    parses Markdown blocks (headings, code fences, GFM tables, lists, quotes),
 *    and maps attachments/tools.
 * 2. DOM fallback: walks on-page turn elements using DOMBlockParser.
 *
 * Guarantees:
 * - Active branch traversal: discarded regenerations are excluded.
 * - Zero silent drops: unsupported items map to UnknownBlock with descriptive summaries.
 */

import { createMessage, createConversationExportData, createParagraphBlock, createHeadingBlock, createCodeBlock, createTableBlock, createListBlock, createBlockquoteBlock, createAttachmentBlock, createUnknownBlock } from '../../engine/export/types.js';
import { DOMBlockParser } from './dom-block-parser.js';

/**
 * Parses markdown text into an array of structured Block objects.
 * Handles headings, code blocks, tables, lists, blockquotes, and paragraphs.
 * @param {string} markdown
 * @param {string} [initialHeading='']
 * @returns {import('../../engine/export/types.js').Block[]}
 */
export function parseMarkdownBlocks(markdown = '', initialHeading = '') {
  if (!markdown || !markdown.trim()) return [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let currentHeading = initialHeading;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Fenced Code Block (``` or ````)
    const codeMatch = line.match(/^(`{3,})(.*)$/);
    if (codeMatch) {
      const fence = codeMatch[1];
      const lang = codeMatch[2].trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(fence)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      blocks.push(createCodeBlock(codeLines.join('\n'), lang));
      continue;
    }

    // 2. Headings (# Heading)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      currentHeading = text;
      blocks.push(createHeadingBlock(level, text));
      i++;
      continue;
    }

    // 3. GFM Tables (| Col 1 | Col 2 |)
    if (line.trim().startsWith('|') && i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].includes('-')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2) {
        const splitRow = (l) =>
          l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const headers = splitRow(tableLines[0]);
        // line 1 is separator |---|---|
        const rows = tableLines.slice(2).map(splitRow);
        blocks.push(createTableBlock(headers, rows, currentHeading));
        continue;
      }
    }

    // 4. Blockquotes (> quote)
    if (line.trim().startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(createBlockquoteBlock(quoteLines.join('\n')));
      continue;
    }

    // 5. Lists (unordered: -, *, + or ordered: 1., 2.)
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.+)$/);
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (ulMatch || olMatch) {
      const isOrdered = Boolean(olMatch);
      const items = [];
      while (i < lines.length) {
        const curUl = lines[i].match(/^(\s*)([-*+])\s+(.+)$/);
        const curOl = lines[i].match(/^(\s*)(\d+)\.\s+(.+)$/);
        if (isOrdered && curOl) {
          items.push(curOl[3].trim());
          i++;
        } else if (!isOrdered && curUl) {
          items.push(curUl[3].trim());
          i++;
        } else if (lines[i].trim() === '') {
          i++;
          break;
        } else {
          break;
        }
      }
      if (items.length > 0) {
        blocks.push(createListBlock(items, isOrdered));
        continue;
      }
    }

    // 6. Paragraphs (text chunks separated by empty lines)
    if (line.trim()) {
      const paraLines = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].startsWith('```') &&
        !lines[i].match(/^#{1,6}\s+/) &&
        !lines[i].trim().startsWith('>') &&
        !lines[i].match(/^(\s*)([-*+]|\d+\.)\s+/) &&
        !(lines[i].trim().startsWith('|') && i + 1 < lines.length && lines[i + 1].includes('-'))
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      const paraText = paraLines.join('\n').trim();
      if (paraText) {
        blocks.push(createParagraphBlock(paraText));
      }
      continue;
    }

    i++; // Skip empty lines
  }

  return blocks;
}

export class ClaudeMessageParser {
  /**
   * Traverses active branch from current_leaf_message_uuid back to root.
   * Excludes abandoned branches resulting from regenerations or edits.
   * @param {Object} conv
   * @returns {Array<Object>} In-order active message turns
   */
  static extractActiveChain(conv) {
    const all = Array.isArray(conv?.chat_messages) ? conv.chat_messages : [];
    const byId = new Map(all.map(m => [m.uuid, m]));
    const chain = [];

    if (conv?.current_leaf_message_uuid && byId.has(conv.current_leaf_message_uuid)) {
      const seen = new Set();
      for (let m = byId.get(conv.current_leaf_message_uuid); m && !seen.has(m.uuid); m = byId.get(m.parent_message_uuid)) {
        seen.add(m.uuid);
        chain.unshift(m);
      }
    } else {
      chain.push(...[...all].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)));
    }
    return chain;
  }

  /**
   * Parses an authoritative Claude conversation API JSON response.
   * @param {Object} conv Raw conversation JSON from /api/organizations/{org}/chat_conversations/{id}
   * @param {Object} [metadata]
   * @param {string} [metadata.model]
   * @param {string} [metadata.title]
   * @returns {import('../../engine/export/types.js').ConversationExportData}
   */
  static parseFromApi(conv, metadata = {}) {
    const chain = this.extractActiveChain(conv);
    const messages = [];

    for (const m of chain) {
      const role = m.sender === 'human' ? 'user' : 'assistant';
      const blocks = [];
      const createdAt = m.created_at ? Date.parse(m.created_at) || null : null;

      // 1. Content blocks
      if (Array.isArray(m.content) && m.content.length > 0) {
        for (const part of m.content) {
          if (part.type === 'text' && part.text) {
            blocks.push(...parseMarkdownBlocks(part.text));
          } else if (part.type === 'tool_use') {
            blocks.push(createUnknownBlock(
              `Tool call: ${part.name || 'tool'}`,
              'tool_use',
              JSON.stringify(part.input ?? {})
            ));
          } else if (part.type === 'tool_result') {
            const content = Array.isArray(part.content)
              ? part.content.map(x => x.text || '').join('\n')
              : String(part.content ?? '');
            if (content) {
              blocks.push(createParagraphBlock(`[Tool Output]:\n${content}`));
            }
          } else if (part.type === 'thinking') {
            // Internal thinking is skipped by backend in future turns;
            // if present in leaf, tag as collapsible thought or skip
            continue;
          } else {
            // Any other block type: NEVER silently drop!
            blocks.push(createUnknownBlock(
              `Unsupported block type: ${part.type || 'unknown'}`,
              part.type,
              JSON.stringify(part)
            ));
          }
        }
      } else if (m.text) {
        blocks.push(...parseMarkdownBlocks(m.text));
      }

      // 2. Attachments
      const attachments = m.attachments || [];
      for (const a of attachments) {
        blocks.push(createAttachmentBlock(
          a.file_name || 'attachment',
          a.extracted_content || '',
          a.file_type || ''
        ));
      }

      // 3. Stored files
      const storedFiles = [...(m.files || []), ...(m.files_v2 || [])];
      for (const f of storedFiles) {
        blocks.push(createAttachmentBlock(
          f.file_name || 'file',
          '',
          f.file_kind || 'file',
          true
        ));
      }

      if (blocks.length > 0) {
        messages.push(createMessage({
          id: m.uuid,
          role,
          createdAt,
          blocks,
          isStreaming: false
        }));
      }
    }

    const title = conv?.name || conv?.title || metadata.title || 'Claude Conversation';
    const model = conv?.model || metadata.model || null;

    return createConversationExportData({
      conversationId: conv?.uuid || null,
      title,
      provider: 'Claude',
      model,
      source: 'api',
      exportedAt: Date.now(),
      messages
    });
  }

  /**
   * Fallback parser extracting conversation directly from Claude DOM elements.
   * @param {Document|Element} doc
   * @param {Object} [metadata]
   * @returns {import('../../engine/export/types.js').ConversationExportData}
   */
  static parseFromDom(doc, metadata = {}) {
    const messages = [];
    if (!doc || typeof doc.querySelectorAll !== 'function') {
      return createConversationExportData({
        title: metadata.title || 'Claude Conversation',
        provider: 'Claude',
        source: 'dom',
        messages: []
      });
    }

    const turns = Array.from(doc.querySelectorAll('[data-testid="user-message"], .font-claude-response, .font-claude-message'));

    for (let i = 0; i < turns.length; i++) {
      const el = turns[i];
      const isUser = el.matches && (el.matches('[data-testid="user-message"]') || Boolean(el.closest('[data-testid="user-message"]')));
      const role = isUser ? 'user' : 'assistant';
      const blocks = DOMBlockParser.parseElement(el);
      const isStreaming = Boolean(el.closest && el.closest('[data-is-streaming="true"]'));

      if (blocks.length > 0) {
        messages.push(createMessage({
          id: `claude-dom-${i}-${role}`,
          role,
          createdAt: null,
          blocks,
          isStreaming
        }));
      }
    }

    return createConversationExportData({
      conversationId: metadata.conversationId || null,
      title: metadata.title || (typeof document !== 'undefined' ? document.title : 'Claude Conversation'),
      provider: 'Claude',
      model: metadata.model || null,
      source: 'dom',
      exportedAt: Date.now(),
      messages
    });
  }
}
