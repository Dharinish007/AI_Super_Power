/**
 * Context Monitor - Markdown Exporter
 *
 * Converts normalized ConversationExportData into GitHub Flavored Markdown (GFM).
 * Features:
 * - Dynamic code fence scaling for code blocks containing backticks.
 * - Table normalization: escapes pipe characters, replaces newlines with <br>, and pads jagged rows.
 * - Visible warning blockquotes for unsupported blocks (never dropped).
 * - Comprehensive conversation header with title, provider, model, timestamp, and message count.
 * - 100% pure, headless, and DOM-free.
 */

/**
 * Escapes table cell contents for Markdown compatibility.
 * Replaces newlines with <br> and escapes pipe characters.
 * @param {string} text
 * @returns {string}
 */
export function escapeTableCell(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/\r\n|\r|\n/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}

/**
 * Calculates a fence string (``` or ```` etc.) that cannot collide with backticks in code.
 * @param {string} code
 * @returns {string}
 */
export function calculateCodeFence(code) {
  const matches = String(code || '').match(/`+/g);
  if (!matches) return '```';
  const maxLen = matches.reduce((max, m) => Math.max(max, m.length), 0);
  return '`'.repeat(Math.max(3, maxLen + 1));
}

/**
 * Formats a single Block into Markdown.
 * @param {import('./types.js').Block} block
 * @returns {string}
 */
export function formatBlockToMarkdown(block) {
  if (!block || typeof block !== 'object') return '';

  switch (block.type) {
    case 'paragraph': {
      const txt = String(block.text || '').trim();
      return txt ? `${txt}\n\n` : '';
    }

    case 'heading': {
      const lvl = Math.max(1, Math.min(6, block.level || 1));
      const hashes = '#'.repeat(lvl);
      const txt = String(block.text || '').trim();
      return `${hashes} ${txt}\n\n`;
    }

    case 'code': {
      const code = String(block.code || '');
      const fence = calculateCodeFence(code);
      const lang = (block.language || '').trim();
      return `${fence}${lang}\n${code}\n${fence}\n\n`;
    }

    case 'table': {
      const headers = Array.isArray(block.headers) ? block.headers : [];
      const rows = Array.isArray(block.rows) ? block.rows : [];
      if (headers.length === 0 && rows.length === 0) return '';

      // Determine total columns
      const colCount = Math.max(
        headers.length,
        ...rows.map(r => (Array.isArray(r) ? r.length : 0)),
        1
      );

      // Normalize headers
      const normHeaders = [];
      for (let c = 0; c < colCount; c++) {
        normHeaders.push(escapeTableCell(headers[c] || `Column ${c + 1}`));
      }

      const out = [];
      if (block.caption) {
        out.push(`*Table: ${escapeTableCell(block.caption)}*\n`);
      }

      // Header row
      out.push(`| ${normHeaders.join(' | ')} |`);
      // Separator row
      out.push(`| ${normHeaders.map(() => '---').join(' | ')} |`);

      // Data rows
      for (const row of rows) {
        const rowCells = [];
        for (let c = 0; c < colCount; c++) {
          rowCells.push(escapeTableCell(Array.isArray(row) ? row[c] : ''));
        }
        out.push(`| ${rowCells.join(' | ')} |`);
      }

      return `${out.join('\n')}\n\n`;
    }

    case 'list': {
      const items = Array.isArray(block.items) ? block.items : [];
      if (items.length === 0) return '';
      const isOrdered = Boolean(block.ordered);
      const lines = items.map((item, idx) => {
        const prefix = isOrdered ? `${idx + 1}.` : '-';
        return `${prefix} ${String(item || '').trim()}`;
      });
      return `${lines.join('\n')}\n\n`;
    }

    case 'blockquote': {
      const txt = String(block.text || '').trim();
      if (!txt) return '';
      const lines = txt.split('\n').map(l => `> ${l}`);
      return `${lines.join('\n')}\n\n`;
    }

    case 'attachment': {
      const name = String(block.name || 'Attachment').trim();
      let res = `📎 **Attachment:** \`${name}\`\n`;
      if (block.extractedText && block.extractedText.trim()) {
        const quoteLines = block.extractedText.trim().split('\n').map(l => `> ${l}`);
        res += `> *Extracted Content:*\n${quoteLines.join('\n')}\n`;
      }
      return `${res}\n`;
    }

    case 'unknown': {
      const summary = block.summary || block.rawType || 'Unsupported content block';
      const snippet = block.rawSnippet ? `\n> \`\`\`\n> ${block.rawSnippet.replace(/\n/g, '\n> ')}\n> \`\`\`` : '';
      return `> ⚠️ **[Unsupported block: ${summary}]**${snippet}\n\n`;
    }

    default:
      return '';
  }
}

/**
 * Converts a normalized ConversationExportData container into a Markdown string.
 * @param {import('./types.js').ConversationExportData} data
 * @param {Object} [options]
 * @param {boolean} [options.includeHeader=true] Whether to include the conversation metadata header
 * @param {boolean} [options.includeTimestamps=true] Whether to show turn timestamps if present
 * @returns {string} GitHub Flavored Markdown document
 */
export function toMarkdown(data, options = {}) {
  const includeHeader = options.includeHeader !== false;
  const includeTimestamps = options.includeTimestamps !== false;

  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const parts = [];

  // 1. Conversation Header
  if (includeHeader) {
    const title = data?.title || 'Conversation Export';
    const provider = data?.provider || 'Claude';
    const model = data?.model || 'Unknown';
    const dateStr = data?.exportedAt
      ? new Date(data.exportedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
      : new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const sourceLabel = data?.source === 'dom' ? 'Page DOM (Fallback)' : 'Authoritative API';

    parts.push(`# Chat Export: ${title}`);
    parts.push(`- **Provider:** ${provider}`);
    parts.push(`- **Model:** ${model}`);
    parts.push(`- **Exported:** ${dateStr}`);
    parts.push(`- **Messages:** ${messages.length}`);
    parts.push(`- **Source:** ${sourceLabel}`);
    parts.push('\n---\n');
  }

  // 2. Empty Chat Check
  if (messages.length === 0) {
    parts.push('*(No messages in this conversation)*\n');
    return parts.join('\n');
  }

  // 3. Messages Sequence
  for (let idx = 0; idx < messages.length; idx++) {
    const msg = messages[idx];
    const role = msg.role || 'assistant';
    let roleLabel = '🤖 Assistant';
    if (role === 'user') roleLabel = '👤 User';
    else if (role === 'system') roleLabel = '⚙️ System';
    else if (role === 'tool') roleLabel = '🔧 Tool Output';

    let timeLabel = '';
    if (includeTimestamps && typeof msg.createdAt === 'number') {
      timeLabel = ` · *${new Date(msg.createdAt).toISOString().replace('T', ' ').slice(0, 19)} UTC*`;
    }

    parts.push(`### ${roleLabel}${timeLabel}\n`);

    const blocks = Array.isArray(msg.blocks) ? msg.blocks : [];
    for (const block of blocks) {
      parts.push(formatBlockToMarkdown(block));
    }

    // Divider between messages (except the last one)
    if (idx < messages.length - 1) {
      parts.push('---\n');
    }
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
