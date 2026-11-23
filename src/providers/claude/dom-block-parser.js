/**
 * Context Monitor - DOM Block Parser
 *
 * Traverses on-page DOM elements to produce normalized Block[] structures.
 * Strips UI chrome and maps semantic tags (headings, code, tables, lists, quotes)
 * while preserving unrecognized elements as UnknownBlock.
 */

import { createParagraphBlock, createHeadingBlock, createCodeBlock, createTableBlock, createListBlock, createBlockquoteBlock, createAttachmentBlock, createUnknownBlock } from '../../engine/export/types.js';

/**
 * Selectors for UI chrome that should be ignored during parsing.
 */
const UI_CHROME_SELECTORS = [
  'button',
  '.sr-only',
  '[aria-hidden="true"]',
  '[data-testid*="copy"]',
  '[data-testid*="edit"]',
  '[data-testid*="thumbs"]',
  '.text-xs',
  'div[class*="toolbar"]',
  'div[class*="feedback"]'
];

export class DOMBlockParser {
  /**
   * Cleans a cloned node by removing UI chrome.
   * @param {Element} element
   * @returns {Element} Cloned and cleaned element
   */
  static cleanElement(element) {
    if (!element || typeof element.cloneNode !== 'function') return element;
    const clone = element.cloneNode(true);
    for (const sel of UI_CHROME_SELECTORS) {
      if (typeof clone.querySelectorAll === 'function') {
        const matches = clone.querySelectorAll(sel);
        for (const m of matches) {
          // Keep button text if it represents an attachment link, otherwise remove
          if (m.tagName.toLowerCase() === 'button' && m.getAttribute('data-testid')?.includes('attachment')) {
            continue;
          }
          m.remove();
        }
      }
    }
    return clone;
  }

  /**
   * Extracts language from pre/code class (e.g. "language-python" -> "python").
   * @param {Element} pre
   * @param {Element|null} code
   * @returns {string}
   */
  static extractLanguage(pre, code) {
    const cls = `${pre?.className || ''} ${code?.className || ''}`;
    const m = cls.match(/\b(?:language|lang)-([a-zA-Z0-9_-]+)\b/i);
    if (m) return m[1].toLowerCase();
    const dataLang = code?.getAttribute?.('data-language') || pre?.getAttribute?.('data-language');
    if (dataLang) return String(dataLang).toLowerCase();
    return '';
  }

  /**
   * Parses an HTML table element into TableBlock.
   * @param {Element} tableEl
   * @param {string} [caption]
   * @returns {import('../../engine/export/types.js').TableBlock}
   */
  static parseTable(tableEl, caption = '') {
    const headers = [];
    const rows = [];

    const trs = tableEl.querySelectorAll ? Array.from(tableEl.querySelectorAll('tr')) : [];

    for (let idx = 0; idx < trs.length; idx++) {
      const tr = trs[idx];
      const ths = tr.querySelectorAll ? Array.from(tr.querySelectorAll('th')) : [];
      const tds = tr.querySelectorAll ? Array.from(tr.querySelectorAll('td')) : [];

      if (ths.length > 0 && headers.length === 0) {
        headers.push(...ths.map(th => (th.textContent || '').trim()));
      } else {
        const cells = (tds.length > 0 ? tds : ths).map(td => (td.textContent || '').trim());
        if (cells.length > 0) {
          rows.push(cells);
        }
      }
    }

    // If still no headers but rows exist, promote first row to headers
    if (headers.length === 0 && rows.length > 0) {
      headers.push(...rows.shift());
    }

    const tableCaption = caption || (tableEl.querySelector && tableEl.querySelector('caption')?.textContent?.trim()) || '';
    return createTableBlock(headers, rows, tableCaption);
  }

  /**
   * Parses an HTML list element into ListBlock.
   * @param {Element} listEl
   * @returns {import('../../engine/export/types.js').ListBlock}
   */
  static parseList(listEl) {
    const isOrdered = listEl.tagName.toLowerCase() === 'ol';
    const items = [];
    const lis = listEl.querySelectorAll(':scope > li, li');
    for (const li of lis) {
      const txt = (li.textContent || '').trim();
      if (txt) items.push(txt);
    }
    return createListBlock(items, isOrdered);
  }

  /**
   * Parses an element into an array of structured Block objects.
   * @param {Element} rootElement
   * @returns {import('../../engine/export/types.js').Block[]}
   */
  static parseElement(rootElement) {
    if (!rootElement) return [];
    const cleaned = this.cleanElement(rootElement);
    const blocks = [];
    let lastHeading = '';

    // Walk direct or meaningful child nodes
    const children = cleaned.children && cleaned.children.length > 0
      ? Array.from(cleaned.children)
      : [cleaned];

    for (const child of children) {
      const tag = child.tagName ? child.tagName.toLowerCase() : '';

      // 1. Headings (H1 to H6)
      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1], 10);
        const text = (child.textContent || '').trim();
        if (text) {
          lastHeading = text;
          blocks.push(createHeadingBlock(level, text));
        }
        continue;
      }

      // 2. Code blocks (<pre>)
      if (tag === 'pre') {
        const codeEl = child.querySelector('code');
        const lang = this.extractLanguage(child, codeEl);
        const codeText = (codeEl || child).textContent || '';
        blocks.push(createCodeBlock(codeText, lang));
        continue;
      }

      // 3. Tables (<table>)
      if (tag === 'table' || child.querySelector('table')) {
        const tableEl = tag === 'table' ? child : child.querySelector('table');
        if (tableEl) {
          blocks.push(this.parseTable(tableEl, lastHeading));
          continue;
        }
      }

      // 4. Lists (<ol>, <ul>)
      if (tag === 'ol' || tag === 'ul') {
        blocks.push(this.parseList(child));
        continue;
      }

      // 5. Blockquotes (<blockquote>)
      if (tag === 'blockquote') {
        const text = (child.textContent || '').trim();
        if (text) blocks.push(createBlockquoteBlock(text));
        continue;
      }

      // 6. Attachments & Files
      if (child.getAttribute('data-testid')?.includes('attachment') || child.classList?.contains('attachment')) {
        const name = (child.textContent || '').trim() || 'Attachment';
        blocks.push(createAttachmentBlock(name));
        continue;
      }

      // 7. Unknown / Unsupported Custom Widgets (Canvas, SVG chart, Artifact embed, iframe)
      if (
        tag === 'canvas' ||
        tag === 'iframe' ||
        child.querySelector('canvas, iframe') ||
        child.getAttribute('data-testid')?.includes('artifact') ||
        child.className?.includes?.('artifact') ||
        child.className?.includes?.('unsupported')
      ) {
        const summary = child.getAttribute('data-testid') || child.className || tag || 'Interactive widget';
        blocks.push(createUnknownBlock(`Interactive widget: ${summary}`, tag, (child.textContent || '').slice(0, 200)));
        continue;
      }

      // 8. Paragraphs (<p>) or generic text wrappers
      if (tag === 'p' || tag === 'div' || tag === 'span') {
        // If it contains nested blocks, inspect them
        if (child.querySelector('pre, table, ol, ul, blockquote, h1, h2, h3, h4, h5, h6')) {
          blocks.push(...this.parseElement(child));
        } else {
          const text = (child.textContent || '').trim();
          if (text) blocks.push(createParagraphBlock(text));
        }
        continue;
      }

      // Fallback for any other node with text
      const fallbackText = (child.textContent || '').trim();
      if (fallbackText) {
        blocks.push(createParagraphBlock(fallbackText));
      }
    }

    return blocks;
  }
}
