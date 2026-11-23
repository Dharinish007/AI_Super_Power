/**
 * Context Monitor - Table Extractor for Excel Export
 *
 * Pure, headless module that extracts and normalizes all tabular data
 * from ConversationExportData into structured worksheet datasets.
 *
 * Rules:
 * - Pure JavaScript, DOM-free.
 * - Extracts all TableBlocks across conversation messages in chronological order.
 * - Sheet name resolution:
 *   1. Nearest prior heading in the same message or table caption.
 *   2. Default: "Table 1", "Table 2", etc.
 * - Sheet name sanitization:
 *   - Max 31 characters.
 *   - Strips Excel-forbidden characters: \\ / ? * [ ] :
 *   - Strips leading and trailing single quotes and spaces.
 *   - Deduplicates case-insensitively with suffix " 2", " 3", etc.
 */

/**
 * Strips forbidden characters and normalizes candidate sheet names for Excel.
 * @param {string} raw
 * @param {number} fallbackIndex
 * @returns {string}
 */
export function sanitizeSheetName(raw, fallbackIndex = 1) {
  if (!raw || typeof raw !== 'string') {
    return `Table ${fallbackIndex}`;
  }

  // Remove forbidden Excel characters: \ / ? * [ ] :
  let cleaned = raw.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim();

  // Excel disallows sheet names starting or ending with single quote (')
  cleaned = cleaned.replace(/^'+|'+$/g, '').trim();

  if (!cleaned) {
    return `Table ${fallbackIndex}`;
  }

  // Max 31 characters
  if (cleaned.length > 31) {
    cleaned = cleaned.slice(0, 31).trim();
  }

  return cleaned || `Table ${fallbackIndex}`;
}

/**
 * Deduplicates sheet names against an existing set, respecting the 31-char limit.
 * @param {string} baseName
 * @param {Set<string>} usedNamesLower
 * @returns {string}
 */
export function deduplicateSheetName(baseName, usedNamesLower) {
  let candidate = baseName;
  if (!usedNamesLower.has(candidate.toLowerCase())) {
    usedNamesLower.add(candidate.toLowerCase());
    return candidate;
  }

  let counter = 2;
  while (true) {
    const suffix = ` ${counter}`;
    const maxBaseLen = 31 - suffix.length;
    const truncatedBase = baseName.length > maxBaseLen ? baseName.slice(0, maxBaseLen).trim() : baseName;
    candidate = `${truncatedBase}${suffix}`;

    if (!usedNamesLower.has(candidate.toLowerCase())) {
      usedNamesLower.add(candidate.toLowerCase());
      return candidate;
    }
    counter++;
  }
}

/**
 * Extracts all tables from a conversation export dataset.
 *
 * @param {import('./types.js').ConversationExportData} data
 * @returns {Array<{ sheetName: string, headers: string[], rows: (string|number)[][], sourceMessageIndex: number, caption: string|null }>}
 */
export function toTables(data) {
  const safeData = data || {};
  const messages = Array.isArray(safeData.messages) ? safeData.messages : [];
  const extracted = [];
  const usedNamesLower = new Set();
  let tableCount = 0;

  messages.forEach((msg, msgIdx) => {
    if (!msg || !Array.isArray(msg.blocks)) return;

    let nearestHeading = null;

    msg.blocks.forEach((block) => {
      if (!block || typeof block !== 'object') return;

      if (block.type === 'heading' && block.text) {
        nearestHeading = block.text.trim();
      } else if (block.type === 'table') {
        tableCount++;
        const headers = Array.isArray(block.headers) ? [...block.headers] : [];
        const rawRows = Array.isArray(block.rows) ? block.rows : [];

        // Determine column count
        const colCount = Math.max(
          headers.length,
          ...rawRows.map(r => (Array.isArray(r) ? r.length : 0)),
          1
        );

        // Normalize headers
        const normHeaders = [];
        for (let c = 0; c < colCount; c++) {
          normHeaders.push(headers[c] !== undefined && headers[c] !== null ? String(headers[c]).trim() : `Column ${c + 1}`);
        }

        // Normalize rows (pad jagged rows to match colCount)
        const normRows = rawRows.map(r => {
          const cells = [];
          for (let c = 0; c < colCount; c++) {
            const val = Array.isArray(r) ? r[c] : '';
            cells.push(val !== undefined && val !== null ? val : '');
          }
          return cells;
        });

        // Resolve sheet name
        const rawName = block.caption || nearestHeading || `Table ${tableCount}`;
        const sanitized = sanitizeSheetName(rawName, tableCount);
        const sheetName = deduplicateSheetName(sanitized, usedNamesLower);

        extracted.push({
          sheetName,
          headers: normHeaders,
          rows: normRows,
          sourceMessageIndex: msgIdx,
          caption: block.caption || null
        });
      }
    });
  });

  return extracted;
}
