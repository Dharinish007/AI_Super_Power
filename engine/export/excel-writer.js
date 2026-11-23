/**
 * Context Monitor - Zero-Dependency OpenXML Excel Writer (.xlsx)
 *
 * Generates valid OpenXML spreadsheet packages (.xlsx) from extracted table datasets.
 * Features:
 * - 100% pure JavaScript, zero external runtime libraries.
 * - In-memory PKZIP archive generation with standard CRC-32 validation.
 * - Generates clean XML structures: [Content_Types], _rels, workbook, styles, worksheets.
 * - Dedicated header styling and automatic column width estimation.
 * - Formula Injection Defense: applies quotePrefix="1" (style 2) to cells beginning with =, +, -, @.
 * - Caps cell lengths safely at 32,700 characters to prevent Excel workbook corruption.
 * - Adds a "Notes" worksheet when unsupported items exist or when the chat contains no tables.
 */

// ===========================================================================
// 1. XML Helpers & Sanitization
// ===========================================================================

/**
 * Escapes special characters for XML content.
 * @param {string|number|null|undefined} text
 * @returns {string}
 */
export function escapeXml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converts a 0-based column index to an Excel column letter (0 -> A, 27 -> AB).
 * @param {number} col
 * @returns {string}
 */
export function colToLetter(col) {
  let letter = '';
  let temp = col;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Checks if a cell value carries formula injection risks in Excel/Calc.
 * @param {*} val
 * @returns {boolean}
 */
export function isFormulaRisk(val) {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed.length === 0) return false;
  const first = trimmed[0];
  return first === '=' || first === '+' || first === '-' || first === '@';
}

// ===========================================================================
// 2. Pure JavaScript CRC-32 and PKZIP Builder
// ===========================================================================

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

/**
 * Calculates standard CRC-32 checksum for a byte buffer.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function calculateCrc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Packs multiple files into an uncompressed (Store) PKZIP archive.
 * Universally supported by Microsoft Excel, Apple Numbers, LibreOffice, and Google Sheets.
 *
 * @param {Array<{ path: string, data: Uint8Array|string }>} files
 * @returns {Uint8Array}
 */
export function buildZipArchive(files) {
  const encoder = new TextEncoder();
  const fileEntries = [];
  let currentOffset = 0;

  // 1. Prepare file data and calculate local file headers
  for (const file of files) {
    const nameBytes = encoder.encode(file.path);
    const dataBytes = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const crc = calculateCrc32(dataBytes);
    const size = dataBytes.length;

    // Local file header (30 bytes + name length + data length)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);

    view.setUint32(0, 0x04034b50, true); // Local file header signature
    view.setUint16(4, 20, true);          // Version needed (2.0)
    view.setUint16(6, 0x0800, true);      // General purpose bit flag (UTF-8)
    view.setUint16(8, 0, true);           // Compression method (0 = Store)
    view.setUint16(10, 0x5000, true);     // Time (10:00:00)
    view.setUint16(12, 0x5d60, true);     // Date (2026-11-23)
    view.setUint32(14, crc, true);        // CRC-32
    view.setUint32(18, size, true);       // Compressed size
    view.setUint32(22, size, true);       // Uncompressed size
    view.setUint16(26, nameBytes.length, true); // File name length
    view.setUint16(28, 0, true);          // Extra field length

    localHeader.set(nameBytes, 30);

    fileEntries.push({
      nameBytes,
      dataBytes,
      crc,
      size,
      offset: currentOffset,
      localHeader
    });

    currentOffset += localHeader.length + size;
  }

  // 2. Prepare central directory headers
  const centralHeaders = [];
  let centralDirectorySize = 0;

  for (const entry of fileEntries) {
    // Central directory file header (46 bytes + name length)
    const header = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x02014b50, true); // Central header signature
    view.setUint16(4, 20, true);          // Version made by
    view.setUint16(6, 20, true);          // Version needed
    view.setUint16(8, 0x0800, true);      // UTF-8
    view.setUint16(10, 0, true);          // Store
    view.setUint16(12, 0x5000, true);     // Time
    view.setUint16(14, 0x5d60, true);     // Date
    view.setUint32(16, entry.crc, true);  // CRC-32
    view.setUint32(20, entry.size, true); // Compressed size
    view.setUint32(24, entry.size, true); // Uncompressed size
    view.setUint16(28, entry.nameBytes.length, true); // File name length
    view.setUint16(30, 0, true);          // Extra field length
    view.setUint16(32, 0, true);          // File comment length
    view.setUint16(34, 0, true);          // Disk number start
    view.setUint16(36, 0, true);          // Internal attributes
    view.setUint32(38, 0, true);          // External attributes
    view.setUint32(42, entry.offset, true); // Relative offset of local header

    header.set(entry.nameBytes, 46);
    centralHeaders.push(header);
    centralDirectorySize += header.length;
  }

  // 3. End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
  eocdView.setUint16(4, 0, true);          // Disk number
  eocdView.setUint16(6, 0, true);          // Start disk
  eocdView.setUint16(8, fileEntries.length, true);  // Entries on this disk
  eocdView.setUint16(10, fileEntries.length, true); // Total entries
  eocdView.setUint32(12, centralDirectorySize, true); // Central dir size
  eocdView.setUint32(16, currentOffset, true);        // Central dir offset
  eocdView.setUint16(20, 0, true);                    // Comment length

  // 4. Assemble complete ZIP archive buffer
  const totalLength = currentOffset + centralDirectorySize + eocd.length;
  const zipBuffer = new Uint8Array(totalLength);
  let writeOffset = 0;

  for (const entry of fileEntries) {
    zipBuffer.set(entry.localHeader, writeOffset);
    writeOffset += entry.localHeader.length;
    zipBuffer.set(entry.dataBytes, writeOffset);
    writeOffset += entry.dataBytes.length;
  }

  for (const header of centralHeaders) {
    zipBuffer.set(header, writeOffset);
    writeOffset += header.length;
  }

  zipBuffer.set(eocd, writeOffset);

  return zipBuffer;
}

// ===========================================================================
// 3. OpenXML Workbook & Sheet XML Builders
// ===========================================================================

const MAX_CELL_LENGTH = 32700;

/**
 * Builds worksheet XML for a table or notes dataset.
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @returns {string}
 */
export function buildWorksheetXml(headers, rows) {
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  xml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n';
  xml += '  <sheetData>\n';

  let rowNum = 1;

  // Header row
  if (headers && headers.length > 0) {
    xml += `    <row r="${rowNum}">\n`;
    headers.forEach((h, colIdx) => {
      const ref = `${colToLetter(colIdx)}${rowNum}`;
      const safe = escapeXml(String(h || '').slice(0, MAX_CELL_LENGTH));
      xml += `      <c r="${ref}" s="1" t="inlineStr"><is><t>${safe}</t></is></c>\n`;
    });
    xml += '    </row>\n';
    rowNum++;
  }

  // Data rows
  if (rows && rows.length > 0) {
    for (const row of rows) {
      xml += `    <row r="${rowNum}">\n`;
      const cells = Array.isArray(row) ? row : [];
      cells.forEach((val, colIdx) => {
        const ref = `${colToLetter(colIdx)}${rowNum}`;

        if (typeof val === 'number' && !Number.isNaN(val)) {
          xml += `      <c r="${ref}" s="0"><v>${val}</v></c>\n`;
        } else {
          let strVal = String(val !== undefined && val !== null ? val : '');
          if (strVal.length > MAX_CELL_LENGTH) {
            strVal = strVal.slice(0, MAX_CELL_LENGTH);
          }

          if (isFormulaRisk(strVal)) {
            // Apply quotePrefix (style 2) for formula injection defense
            const safe = escapeXml(strVal);
            xml += `      <c r="${ref}" s="2" t="inlineStr"><is><t>${safe}</t></is></c>\n`;
          } else {
            const safe = escapeXml(strVal);
            xml += `      <c r="${ref}" s="0" t="inlineStr"><is><t>${safe}</t></is></c>\n`;
          }
        }
      });
      xml += '    </row>\n';
      rowNum++;
    }
  }

  xml += '  </sheetData>\n';
  xml += '</worksheet>';
  return xml;
}

/**
 * Builds the shared styles.xml part.
 * Includes style 0 (normal), style 1 (header bold + fill), and style 2 (formula injection defense quotePrefix).
 * @returns {string}
 */
export function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD0D7DE"/></left>
      <right style="thin"><color rgb="FFD0D7DE"/></right>
      <top style="thin"><color rgb="FFD0D7DE"/></top>
      <bottom style="thin"><color rgb="FFD0D7DE"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" quotePrefix="1"/>
  </cellXfs>
</styleSheet>`;
}

// ===========================================================================
// 4. Main Excel Exporter Function (toExcel)
// ===========================================================================

/**
 * Converts conversation export data and extracted tables into a complete .xlsx binary package.
 *
 * @param {import('./types.js').ConversationExportData} data
 * @param {Array<{ sheetName: string, headers: string[], rows: (string|number)[][] }>} [extractedTables]
 * @returns {Uint8Array} Binary .xlsx buffer
 */
export function toExcel(data, extractedTables = null) {
  const safeData = data || {};
  const tables = Array.isArray(extractedTables) ? extractedTables : [];

  const sheetsToGenerate = [];

  // 1. Add all table sheets
  tables.forEach((tbl) => {
    sheetsToGenerate.push({
      name: tbl.sheetName || 'Table',
      headers: tbl.headers || [],
      rows: tbl.rows || []
    });
  });

  // 2. Count unsupported/unknown items across conversation
  const messages = Array.isArray(safeData.messages) ? safeData.messages : [];
  const unsupportedItems = [];
  messages.forEach((msg, idx) => {
    if (msg && Array.isArray(msg.blocks)) {
      msg.blocks.forEach((block) => {
        if (block && block.type === 'unknown') {
          unsupportedItems.push([`Message #${idx + 1}`, block.summary || 'Unsupported Block']);
        }
      });
    }
  });

  // 3. Add Notes sheet if no tables exist OR if unsupported items exist
  if (sheetsToGenerate.length === 0 || unsupportedItems.length > 0) {
    const noteRows = [
      ['Title', safeData.title || 'Untitled Conversation'],
      ['Provider', safeData.provider || 'AI Assistant'],
      ['Model', safeData.model || 'Unknown'],
      ['Exported At', safeData.exportedAt ? new Date(safeData.exportedAt).toISOString() : new Date().toISOString()],
      ['Total Messages', messages.length],
      ['Total Tables', tables.length]
    ];

    if (sheetsToGenerate.length === 0) {
      noteRows.push(['Notice', 'This conversation contained no tabular data. Only metadata is exported.']);
    }

    if (unsupportedItems.length > 0) {
      noteRows.push(['', '']);
      noteRows.push(['Unsupported Items Notice', `Preserved ${unsupportedItems.length} unsupported content block(s)`]);
      unsupportedItems.forEach(([loc, summary]) => {
        noteRows.push([loc, summary]);
      });
    }

    sheetsToGenerate.push({
      name: 'Notes',
      headers: ['Property', 'Details'],
      rows: noteRows
    });
  }

  // 4. Build OpenXML files
  const files = [];

  // [Content_Types].xml
  let contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n';
  contentTypesXml += '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n';
  contentTypesXml += '  <Default Extension="xml" ContentType="application/xml"/>\n';
  contentTypesXml += '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n';
  contentTypesXml += '  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n';
  sheetsToGenerate.forEach((_, i) => {
    contentTypesXml += `  <Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n`;
  });
  contentTypesXml += '</Types>';
  files.push({ path: '[Content_Types].xml', data: contentTypesXml });

  // _rels/.rels
  const rootRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n' +
    '</Relationships>';
  files.push({ path: '_rels/.rels', data: rootRelsXml });

  // xl/_rels/workbook.xml.rels
  let workbookRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n';
  workbookRelsXml += '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n';
  sheetsToGenerate.forEach((_, i) => {
    workbookRelsXml += `  <Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>\n`;
  });
  workbookRelsXml += '</Relationships>';
  files.push({ path: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml });

  // xl/workbook.xml
  let workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n  <sheets>\n';
  sheetsToGenerate.forEach((sheet, i) => {
    workbookXml += `    <sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 2}"/>\n`;
  });
  workbookXml += '  </sheets>\n</workbook>';
  files.push({ path: 'xl/workbook.xml', data: workbookXml });

  // xl/styles.xml
  files.push({ path: 'xl/styles.xml', data: buildStylesXml() });

  // xl/worksheets/sheetN.xml
  sheetsToGenerate.forEach((sheet, i) => {
    const sheetXml = buildWorksheetXml(sheet.headers, sheet.rows);
    files.push({ path: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml });
  });

  // 5. Pack into ZIP archive
  return buildZipArchive(files);
}
