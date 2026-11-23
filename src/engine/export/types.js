/**
 * Context Monitor - Chat Export Types and Contracts
 *
 * Defines the canonical normalized data model for conversation exports.
 * Completely headless, DOM-free, and platform-agnostic.
 *
 * @typedef {'user'|'assistant'|'system'|'tool'} MessageRole
 *
 * @typedef {'paragraph'|'heading'|'code'|'table'|'list'|'blockquote'|'attachment'|'unknown'} BlockType
 *
 * @typedef {Object} ParagraphBlock
 * @property {'paragraph'} type
 * @property {string} text
 *
 * @typedef {Object} HeadingBlock
 * @property {'heading'} type
 * @property {1|2|3|4|5|6} level
 * @property {string} text
 *
 * @typedef {Object} CodeBlock
 * @property {'code'} type
 * @property {string} code
 * @property {string} [language]
 * @property {string} [filename]
 *
 * @typedef {Object} TableBlock
 * @property {'table'} type
 * @property {string[]} headers
 * @property {string[][]} rows
 * @property {string} [caption]
 *
 * @typedef {Object} ListBlock
 * @property {'list'} type
 * @property {boolean} ordered
 * @property {string[]} items
 *
 * @typedef {Object} BlockquoteBlock
 * @property {'blockquote'} type
 * @property {string} text
 *
 * @typedef {Object} AttachmentBlock
 * @property {'attachment'} type
 * @property {string} name
 * @property {string} [mimeType]
 * @property {string} [extractedText]
 * @property {boolean} [hasUnknownContent]
 *
 * @typedef {Object} UnknownBlock
 * @property {'unknown'} type
 * @property {string} [rawType]
 * @property {string} summary
 * @property {string} [rawSnippet]
 *
 * @typedef {ParagraphBlock|HeadingBlock|CodeBlock|TableBlock|ListBlock|BlockquoteBlock|AttachmentBlock|UnknownBlock} Block
 *
 * @typedef {Object} Message
 * @property {string} id
 * @property {MessageRole} role
 * @property {number|null} createdAt
 * @property {string|null} [model]
 * @property {Block[]} blocks
 * @property {boolean} [isStreaming]
 *
 * @typedef {Object} ConversationExportData
 * @property {string|null} conversationId
 * @property {string} title
 * @property {'Claude'|'Gemini'|'ChatGPT'} provider
 * @property {string|null} model
 * @property {'api'|'dom'} source
 * @property {number} exportedAt
 * @property {Message[]} messages
 */

/**
 * Creates a ParagraphBlock.
 * @param {string} text
 * @returns {ParagraphBlock}
 */
export function createParagraphBlock(text) {
  return {
    type: 'paragraph',
    text: String(text || '')
  };
}

/**
 * Creates a HeadingBlock.
 * @param {number} level
 * @param {string} text
 * @returns {HeadingBlock}
 */
export function createHeadingBlock(level, text) {
  const lvl = Math.max(1, Math.min(6, Math.round(Number(level) || 1)));
  return {
    type: 'heading',
    level: /** @type {1|2|3|4|5|6} */ (lvl),
    text: String(text || '').trim()
  };
}

/**
 * Creates a CodeBlock.
 * @param {string} code
 * @param {string} [language]
 * @param {string} [filename]
 * @returns {CodeBlock}
 */
export function createCodeBlock(code, language = '', filename = '') {
  return {
    type: 'code',
    code: String(code || ''),
    language: language ? String(language).toLowerCase().trim() : undefined,
    filename: filename ? String(filename).trim() : undefined
  };
}

/**
 * Creates a TableBlock.
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {string} [caption]
 * @returns {TableBlock}
 */
export function createTableBlock(headers = [], rows = [], caption = '') {
  const normHeaders = Array.isArray(headers) ? headers.map(h => String(h || '').trim()) : [];
  const normRows = Array.isArray(rows)
    ? rows.map(r => (Array.isArray(r) ? r.map(c => String(c || '').trim()) : []))
    : [];
  return {
    type: 'table',
    headers: normHeaders,
    rows: normRows,
    caption: caption ? String(caption).trim() : undefined
  };
}

/**
 * Creates a ListBlock.
 * @param {string[]} items
 * @param {boolean} [ordered=false]
 * @returns {ListBlock}
 */
export function createListBlock(items = [], ordered = false) {
  const normItems = Array.isArray(items) ? items.map(i => String(i || '').trim()) : [];
  return {
    type: 'list',
    ordered: Boolean(ordered),
    items: normItems
  };
}

/**
 * Creates a BlockquoteBlock.
 * @param {string} text
 * @returns {BlockquoteBlock}
 */
export function createBlockquoteBlock(text) {
  return {
    type: 'blockquote',
    text: String(text || '').trim()
  };
}

/**
 * Creates an AttachmentBlock.
 * @param {string} name
 * @param {string} [extractedText]
 * @param {string} [mimeType]
 * @param {boolean} [hasUnknownContent=false]
 * @returns {AttachmentBlock}
 */
export function createAttachmentBlock(name, extractedText = '', mimeType = '', hasUnknownContent = false) {
  return {
    type: 'attachment',
    name: String(name || 'attachment'),
    mimeType: mimeType ? String(mimeType) : undefined,
    extractedText: extractedText ? String(extractedText) : undefined,
    hasUnknownContent: Boolean(hasUnknownContent)
  };
}

/**
 * Creates an UnknownBlock. Ensures content is NEVER silently dropped.
 * @param {string} summary Human-readable description
 * @param {string} [rawType] Original raw tag or discriminator
 * @param {string} [rawSnippet] Truncated sample text/code
 * @returns {UnknownBlock}
 */
export function createUnknownBlock(summary, rawType = 'unknown', rawSnippet = '') {
  return {
    type: 'unknown',
    summary: String(summary || 'Unsupported content block'),
    rawType: rawType ? String(rawType) : 'unknown',
    rawSnippet: rawSnippet ? String(rawSnippet).slice(0, 500) : undefined
  };
}

/**
 * Creates a normalized Message.
 * @param {Object} options
 * @param {string} options.id
 * @param {MessageRole} options.role
 * @param {Block[]} [options.blocks]
 * @param {number|null} [options.createdAt]
 * @param {string|null} [options.model]
 * @param {boolean} [options.isStreaming]
 * @returns {Message}
 */
export function createMessage(options) {
  return {
    id: String(options?.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    role: options?.role || 'assistant',
    createdAt: typeof options?.createdAt === 'number' ? options.createdAt : null,
    model: options?.model || null,
    blocks: Array.isArray(options?.blocks) ? options.blocks : [],
    isStreaming: Boolean(options?.isStreaming)
  };
}

/**
 * Creates a normalized ConversationExportData container.
 * @param {Object} options
 * @param {string|null} [options.conversationId]
 * @param {string} [options.title]
 * @param {'Claude'|'Gemini'|'ChatGPT'} [options.provider]
 * @param {string|null} [options.model]
 * @param {'api'|'dom'} [options.source]
 * @param {number} [options.exportedAt]
 * @param {Message[]} [options.messages]
 * @returns {ConversationExportData}
 */
export function createConversationExportData(options = {}) {
  return {
    conversationId: options.conversationId || null,
    title: String(options.title || 'Conversation Export').trim(),
    provider: options.provider || 'Claude',
    model: options.model || null,
    source: options.source === 'dom' ? 'dom' : 'api',
    exportedAt: typeof options.exportedAt === 'number' ? options.exportedAt : Date.now(),
    messages: Array.isArray(options.messages) ? options.messages : []
  };
}

/**
 * Validates that an object conforms to ConversationExportData shape.
 * @param {unknown} data
 * @returns {boolean}
 */
export function isConversationExportData(data) {
  if (!data || typeof data !== 'object') return false;
  const d = /** @type {ConversationExportData} */ (data);
  return (
    typeof d.title === 'string' &&
    typeof d.provider === 'string' &&
    (d.source === 'api' || d.source === 'dom') &&
    typeof d.exportedAt === 'number' &&
    Array.isArray(d.messages)
  );
}

/**
 * Counts total blocks and unsupported blocks in export data.
 * @param {ConversationExportData} data
 * @returns {{ totalBlocks: number, unknownBlocks: number, tableCount: number, messageCount: number }}
 */
export function summarizeExportData(data) {
  let totalBlocks = 0;
  let unknownBlocks = 0;
  let tableCount = 0;
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  for (const m of messages) {
    const blocks = Array.isArray(m?.blocks) ? m.blocks : [];
    totalBlocks += blocks.length;
    for (const b of blocks) {
      if (b.type === 'unknown') unknownBlocks++;
      if (b.type === 'table') tableCount++;
    }
  }
  return {
    totalBlocks,
    unknownBlocks,
    tableCount,
    messageCount: messages.length
  };
}
