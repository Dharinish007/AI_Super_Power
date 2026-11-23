/**
 * Context Monitor - Export Dialog Component
 *
 * Modal dialog for exporting conversations to Markdown, PDF (Print preview), or Excel (.xlsx).
 * Features:
 * - Shadow DOM or direct DOM container mounting with high z-index.
 * - Format selection: Markdown (.md), PDF via print, Excel (.xlsx).
 * - Automatic source indicator ("Authoritative API" vs "Page Text (DOM Fallback)").
 * - Visible warning count for unsupported blocks.
 * - Dynamic disablement of Excel option if 0 tables exist in the chat.
 * - Keyboard accessible (Esc to close, Tab navigation).
 */

import { toMarkdown } from '../../engine/export/markdown-exporter.js';
import { toPrintHtml } from '../../engine/export/print-html-exporter.js';
import { toExcel } from '../../engine/export/excel-writer.js';
import { toTables } from '../../engine/export/table-extractor.js';

/**
 * Triggers browser download of a content payload.
 * @param {string|Uint8Array|Blob} content
 * @param {string} filename
 * @param {string} mimeType
 */
export function downloadFile(content, filename, mimeType) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Generates a clean URL/filesystem-safe slug from a title string.
 * @param {string} title
 * @param {string} [fallback='chat-export']
 * @returns {string}
 */
export function slugifyTitle(title, fallback = 'chat-export') {
  if (!title || typeof title !== 'string') return fallback;
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return slug ? slug.slice(0, 50) : fallback;
}

export class ExportDialog {
  /**
   * @param {Object} options
   * @param {import('../engine/export/types.js').ConversationExportData} options.data
   * @param {Array<{ sheetName: string, headers: string[], rows: any[][] }>} [options.tables]
   * @param {string} [options.defaultFormat='markdown']
   * @param {Function} [options.onClose]
   */
  constructor({ data, tables = null, defaultFormat = 'markdown', onClose = null }) {
    this.data = data || { messages: [] };
    this.tables = Array.isArray(tables) ? tables : toTables(this.data);
    this.selectedFormat = ['markdown', 'pdf', 'excel'].includes(defaultFormat) ? defaultFormat : 'markdown';
    this.onClose = onClose;
    this.container = null;
    this.overlay = null;

    // If default was excel but no tables, fallback to markdown
    if (this.selectedFormat === 'excel' && this.tables.length === 0) {
      this.selectedFormat = 'markdown';
    }

    this._onKeyDown = (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    };
  }

  /**
   * Builds and opens the dialog in the DOM.
   * @param {HTMLElement} [parent=document.body]
   */
  open(parent = document.body) {
    if (this.container) return;

    this.container = document.createElement('div');
    this.container.className = 'asp-export-dialog-host';
    this.container.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.6);backdrop-filter:blur(2px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1e293b;';

    const card = document.createElement('div');
    card.className = 'asp-export-dialog-card';
    card.style.cssText = 'background:#ffffff;border-radius:12px;width:90%;max-width:480px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.1),0 10px 10px -5px rgba(0,0,0,0.04);border:1px solid #e2e8f0;overflow:hidden;animation:aspFadeIn .15s ease-out;';

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e2e8f0;';
    const title = document.createElement('h3');
    title.style.cssText = 'margin:0;font-size:16px;font-weight:600;color:#0f172a;';
    title.textContent = 'Export Chat';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'asp-export-close-btn';
    closeBtn.style.cssText = 'background:none;border:none;font-size:18px;cursor:pointer;color:#64748b;padding:4px;border-radius:4px;line-height:1;';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close dialog');
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(title);
    header.appendChild(closeBtn);
    card.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding:20px;';

    // Summary Box
    const summary = document.createElement('div');
    summary.style.cssText = 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:18px;font-size:13px;';
    const chatTitle = document.createElement('div');
    chatTitle.style.cssText = 'font-weight:600;color:#0f172a;margin-bottom:6px;word-break:break-all;';
    chatTitle.textContent = this.data.title || 'Untitled Conversation';
    summary.appendChild(chatTitle);

    const badgesBox = document.createElement('div');
    badgesBox.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;font-size:11.5px;';
    const msgCount = (this.data.messages || []).length;
    badgesBox.innerHTML = `
      <span style="background:#e2e8f0;padding:2px 8px;border-radius:4px;color:#334155;">${msgCount} messages</span>
      <span style="background:#e2e8f0;padding:2px 8px;border-radius:4px;color:#334155;">${this.data.provider || 'AI'} · ${this.data.model || 'Unknown'}</span>
      <span style="background:${this.data.source === 'dom' ? '#fef3c7' : '#e0f2fe'};color:${this.data.source === 'dom' ? '#92400e' : '#0369a1'};padding:2px 8px;border-radius:4px;font-weight:500;">${this.data.source === 'dom' ? 'Page Text (DOM Fallback)' : 'Authoritative API'}</span>
    `;
    summary.appendChild(badgesBox);

    // Unsupported count warning if any
    let unkCount = 0;
    (this.data.messages || []).forEach(m => {
      (m?.blocks || []).forEach(b => {
        if (b?.type === 'unknown') unkCount++;
      });
    });
    if (unkCount > 0) {
      const unkNotice = document.createElement('div');
      unkNotice.className = 'asp-unsupported-notice';
      unkNotice.style.cssText = 'margin-top:8px;font-size:12px;color:#b45309;';
      unkNotice.textContent = `⚠️ ${unkCount} unsupported item(s) preserved as visible notes`;
      summary.appendChild(unkNotice);
    }
    body.appendChild(summary);

    // Format Selector
    const formatLabel = document.createElement('div');
    formatLabel.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:10px;color:#334155;';
    formatLabel.textContent = 'Select Export Format:';
    body.appendChild(formatLabel);

    const formatList = document.createElement('div');
    formatList.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-bottom:24px;';

    const formats = [
      {
        id: 'markdown',
        title: 'Markdown (.md)',
        desc: 'Full conversation formatted in GitHub Flavored Markdown',
        disabled: false
      },
      {
        id: 'pdf',
        title: 'PDF (Print Preview)',
        desc: 'Opens printable layout with clean page breaks and print button',
        disabled: false
      },
      {
        id: 'excel',
        title: `Excel (.xlsx) — ${this.tables.length} table(s)`,
        desc: this.tables.length > 0 ? 'One worksheet per table, formula-safe' : 'Disabled: No tables detected in this conversation',
        disabled: this.tables.length === 0
      }
    ];

    formats.forEach(f => {
      const opt = document.createElement('label');
      opt.className = `asp-format-option asp-format-${f.id}`;
      opt.style.cssText = `display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid ${this.selectedFormat === f.id ? '#2563eb' : '#e2e8f0'};border-radius:8px;cursor:${f.disabled ? 'not-allowed' : 'pointer'};background:${this.selectedFormat === f.id ? '#eff6ff' : f.disabled ? '#f8fafc' : '#ffffff'};opacity:${f.disabled ? '0.6' : '1'};transition:all .15s ease;`;

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'asp-export-format';
      radio.value = f.id;
      radio.checked = this.selectedFormat === f.id;
      radio.disabled = f.disabled;
      radio.style.cssText = 'margin-top:3px;accent-color:#2563eb;cursor:inherit;';

      radio.addEventListener('change', () => {
        if (!f.disabled) {
          this.selectedFormat = f.id;
          formatList.querySelectorAll('.asp-format-option').forEach(el => {
            el.style.borderColor = '#e2e8f0';
            el.style.background = '#ffffff';
          });
          opt.style.borderColor = '#2563eb';
          opt.style.background = '#eff6ff';
        }
      });

      const textWrap = document.createElement('div');
      const optTitle = document.createElement('div');
      optTitle.style.cssText = 'font-size:13.5px;font-weight:600;color:#0f172a;';
      optTitle.textContent = f.title;
      const optDesc = document.createElement('div');
      optDesc.style.cssText = 'font-size:12px;color:#64748b;margin-top:2px;';
      optDesc.textContent = f.desc;

      textWrap.appendChild(optTitle);
      textWrap.appendChild(optDesc);
      opt.appendChild(radio);
      opt.appendChild(textWrap);
      formatList.appendChild(opt);
    });
    body.appendChild(formatList);

    // Footer Actions
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #e2e8f0;padding-top:16px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'asp-btn-cancel';
    cancelBtn.style.cssText = 'background:#ffffff;border:1px solid #cbd5e1;color:#475569;border-radius:6px;padding:8px 16px;font-size:13.5px;font-weight:500;cursor:pointer;';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.close());

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'asp-btn-export-submit';
    exportBtn.style.cssText = 'background:#2563eb;border:none;color:#ffffff;border-radius:6px;padding:8px 18px;font-size:13.5px;font-weight:500;cursor:pointer;';
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', () => this.executeExport());

    footer.appendChild(cancelBtn);
    footer.appendChild(exportBtn);
    body.appendChild(footer);
    card.appendChild(body);
    this.container.appendChild(card);

    parent.appendChild(this.container);
    window.addEventListener('keydown', this._onKeyDown);
  }

  /**
   * Performs the file export according to the selected format and triggers download.
   */
  executeExport() {
    const slug = slugifyTitle(this.data.title || 'chat-export');

    if (this.selectedFormat === 'markdown') {
      const md = toMarkdown(this.data);
      downloadFile(md, `${slug}.md`, 'text/markdown;charset=utf-8');
    } else if (this.selectedFormat === 'pdf') {
      const html = toPrintHtml(this.data);
      const win = window.open('', '_blank');
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
      } else {
        downloadFile(html, `${slug}.html`, 'text/html;charset=utf-8');
      }
    } else if (this.selectedFormat === 'excel') {
      const xlsx = toExcel(this.data, this.tables);
      downloadFile(xlsx, `${slug}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }

    this.close();
  }

  /**
   * Closes the dialog and cleans up event listeners.
   */
  close() {
    window.removeEventListener('keydown', this._onKeyDown);
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    if (this.onClose) {
      this.onClose();
    }
  }
}
