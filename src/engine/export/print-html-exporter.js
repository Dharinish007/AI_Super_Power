/**
 * Context Monitor - Print HTML Exporter
 *
 * Converts normalized ConversationExportData into standalone, self-contained HTML5
 * formatted for high-quality browser printing and PDF generation.
 *
 * Rules:
 * - Pure, headless, and DOM-free.
 * - Escapes all dynamic text (&, <, >, ", ').
 * - Includes dedicated @media print and @page margin 15mm stylesheet.
 * - Header includes a prominent "Print / Save as PDF" button.
 * - ZERO auto-print scripts (no window.print() in onload or script tags).
 */

import { PRINT_STYLES } from '../../ui/shared/print-styles.js';

/**
 * Escapes HTML characters in untrusted strings.
 * Strictly prevents XSS injection into the exported document.
 * @param {string|number|null|undefined} text
 * @returns {string}
 */
export function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a single Block into an HTML string.
 * @param {import('./types.js').Block} block
 * @returns {string}
 */
export function formatBlockToHtml(block) {
  if (!block || typeof block !== 'object') return '';

  switch (block.type) {
    case 'paragraph': {
      const txt = String(block.text || '').trim();
      if (!txt) return '';
      const safe = escapeHtml(txt).replace(/\n/g, '<br>');
      return `<p class="block-paragraph">${safe}</p>`;
    }

    case 'heading': {
      const lvl = Math.max(1, Math.min(6, block.level || 1));
      const safe = escapeHtml(String(block.text || '').trim());
      return `<h${lvl} class="block-heading">${safe}</h${lvl}>`;
    }

    case 'code': {
      const lang = escapeHtml((block.language || '').trim());
      const code = escapeHtml(block.code || '');
      const cls = lang ? ` class="language-${lang}"` : '';
      return `<pre class="block-code"><code${cls}>${code}</code></pre>`;
    }

    case 'table': {
      const headers = Array.isArray(block.headers) ? block.headers : [];
      const rows = Array.isArray(block.rows) ? block.rows : [];
      if (headers.length === 0 && rows.length === 0) return '';

      const colCount = Math.max(
        headers.length,
        ...rows.map(r => (Array.isArray(r) ? r.length : 0)),
        1
      );

      const normHeaders = [];
      for (let c = 0; c < colCount; c++) {
        normHeaders.push(headers[c] || `Column ${c + 1}`);
      }

      const ths = normHeaders.map(h => `<th>${escapeHtml(h)}</th>`).join('');
      const trs = rows.map(r => {
        const tds = [];
        for (let c = 0; c < colCount; c++) {
          const val = Array.isArray(r) ? r[c] : '';
          tds.push(`<td>${escapeHtml(val)}</td>`);
        }
        return `<tr>${tds.join('')}</tr>`;
      }).join('');

      let out = '<div class="table-wrapper">';
      if (block.caption) {
        out += `<p class="table-caption"><em>${escapeHtml(block.caption)}</em></p>`;
      }
      out += `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
      return out;
    }

    case 'list': {
      const items = Array.isArray(block.items) ? block.items : [];
      if (items.length === 0) return '';
      const tag = block.ordered ? 'ol' : 'ul';
      const lis = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
      return `<${tag} class="block-list">${lis}</${tag}>`;
    }

    case 'blockquote': {
      const txt = String(block.text || '').trim();
      if (!txt) return '';
      const safe = escapeHtml(txt).replace(/\n/g, '<br>');
      return `<blockquote class="block-quote">${safe}</blockquote>`;
    }

    case 'attachment': {
      const name = escapeHtml(block.name || 'Attachment');
      const mime = block.mimeType ? ` <span class="attachment-mime">(${escapeHtml(block.mimeType)})</span>` : '';
      let out = `<div class="attachment-card"><div class="attachment-title">📎 <strong>Attachment:</strong> <code>${name}</code>${mime}</div>`;
      if (block.extractedText && block.extractedText.trim()) {
        const preview = escapeHtml(block.extractedText.trim());
        out += `<pre class="attachment-preview"><code>${preview}</code></pre>`;
      }
      out += '</div>';
      return out;
    }

    case 'unknown': {
      const summary = escapeHtml(block.summary || 'Unrecognized content block preserved');
      return `<div class="unknown-block-warning">⚠️ <strong>Unsupported Content:</strong> ${summary}</div>`;
    }

    default:
      return '';
  }
}

/**
 * Converts a normalized ConversationExportData container into a complete, printable HTML document.
 *
 * @param {import('./types.js').ConversationExportData} data
 * @param {Object} [options={}]
 * @param {boolean} [options.includeHeader=true] Whether to include the metadata banner
 * @param {string} [options.styles] Optional custom CSS overriding default print stylesheet
 * @returns {string} Self-contained HTML5 document string
 */
export function toPrintHtml(data, options = {}) {
  const safeData = data || {};
  const messages = Array.isArray(safeData.messages) ? safeData.messages : [];
  const title = safeData.title || 'Conversation Export';
  const provider = safeData.provider || 'AI Assistant';
  const model = safeData.model || 'Unknown';
  const source = safeData.source === 'dom' ? 'Page Text (DOM Fallback)' : 'Authoritative API';
  const includeHeader = options.includeHeader !== false;
  const styles = options.styles || PRINT_STYLES;

  const exportDate = safeData.exportedAt ? new Date(safeData.exportedAt).toLocaleString() : new Date().toLocaleString();

  let bodyContent = '';

  // 1. On-Screen Toolbar (Hidden in Print)
  bodyContent += `
  <header class="print-toolbar">
    <div class="toolbar-content">
      <div class="toolbar-title">${escapeHtml(title)}</div>
      <div class="toolbar-actions">
        <button type="button" class="print-button" onclick="window.print()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 6px;"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
          Print / Save as PDF
        </button>
      </div>
    </div>
    <div class="toolbar-tip">Tip: In your browser print dialog, choose Destination &rarr; <strong>Save as PDF</strong></div>
  </header>`;

  bodyContent += '\n  <main class="document-container">';

  // 2. Metadata Banner
  if (includeHeader) {
    bodyContent += `
    <section class="export-header">
      <h1 class="export-title">${escapeHtml(title)}</h1>
      <div class="metadata-grid">
        <div class="metadata-item">
          <span class="metadata-label">Provider</span>
          <span class="metadata-value">${escapeHtml(provider)}</span>
        </div>
        <div class="metadata-item">
          <span class="metadata-label">Model</span>
          <span class="metadata-value">${escapeHtml(model)}</span>
        </div>
        <div class="metadata-item">
          <span class="metadata-label">Exported At</span>
          <span class="metadata-value">${escapeHtml(exportDate)}</span>
        </div>
        <div class="metadata-item">
          <span class="metadata-label">Messages</span>
          <span class="metadata-value">${messages.length}</span>
        </div>
        <div class="metadata-item">
          <span class="metadata-label">Source</span>
          <span class="metadata-value">${escapeHtml(source)}</span>
        </div>
      </div>
    </section>`;
  }

  // 3. Messages or Empty State
  if (messages.length === 0) {
    bodyContent += `
    <div class="empty-state">
      <p><em>No messages in this conversation.</em></p>
    </div>`;
  } else {
    for (const msg of messages) {
      const role = (msg && msg.role) || 'assistant';
      const roleLabel = role === 'user' ? 'User' : escapeHtml(provider || 'Assistant');
      const timeStr = msg && msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : '';
      const blocks = Array.isArray(msg && msg.blocks) ? msg.blocks : [];

      bodyContent += `
    <article class="message ${escapeHtml(role)}">
      <header class="message-header">
        <span class="role-badge">${roleLabel}</span>
        ${timeStr ? `<time class="message-time">${escapeHtml(timeStr)}</time>` : ''}
      </header>
      <div class="message-body">`;

      for (const block of blocks) {
        bodyContent += `\n        ${formatBlockToHtml(block)}`;
      }

      bodyContent += `
      </div>
    </article>`;
    }
  }

  bodyContent += '\n  </main>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
${styles}
  </style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}
