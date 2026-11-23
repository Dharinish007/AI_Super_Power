/**
 * Context Monitor - Print & PDF Stylesheet
 *
 * Dedicated stylesheet for print preview and PDF export.
 * Invariants:
 * - Includes @page { margin: 15mm; }
 * - Uses break-inside: avoid / page-break-inside: avoid on code blocks, tables, message headers, and cards.
 * - Hides the on-screen print toolbar during printing.
 * - Preserves high-contrast readability in black-and-white and grayscale printing.
 */

export const PRINT_STYLES = `
/* ==========================================================================
   AI Context Monitor - Print & Screen Export Stylesheet
   ========================================================================== */

:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  --color-bg: #f8fafc;
  --color-card-bg: #ffffff;
  --color-text: #1e293b;
  --color-text-muted: #64748b;
  --color-border: #e2e8f0;
  --color-user-border: #3b82f6;
  --color-assistant-border: #8b5cf6;
  --color-code-bg: #f1f5f9;
  --color-table-header-bg: #f8fafc;
  --color-warning-bg: #fefce8;
  --color-warning-border: #ca8a04;
  --color-warning-text: #854d0e;
}

*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  font-family: var(--font-sans);
  color: var(--color-text);
  background-color: var(--color-bg);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

/* --------------------------------------------------------------------------
   On-Screen Toolbar (Hidden in Print)
   -------------------------------------------------------------------------- */
.print-toolbar {
  position: sticky;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  background-color: #0f172a;
  color: #f8fafc;
  padding: 12px 24px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
}

.toolbar-content {
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.toolbar-title {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.print-button {
  background-color: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  transition: background-color 0.15s ease-in-out;
}

.print-button:hover {
  background-color: #1d4ed8;
}

.toolbar-tip {
  max-width: 960px;
  margin: 6px auto 0 auto;
  font-size: 12px;
  color: #94a3b8;
}

/* --------------------------------------------------------------------------
   Document Container & Metadata Banner
   -------------------------------------------------------------------------- */
.document-container {
  max-width: 860px;
  margin: 24px auto 48px auto;
  padding: 0 20px;
}

.export-header {
  background-color: var(--color-card-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
}

.export-title {
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 12px 0;
  color: #0f172a;
  line-height: 1.3;
}

.metadata-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border);
  font-size: 13px;
}

.metadata-item {
  display: flex;
  flex-direction: column;
}

.metadata-label {
  color: var(--color-text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
}

.metadata-value {
  font-weight: 500;
  color: var(--color-text);
}

/* --------------------------------------------------------------------------
   Messages & Content Blocks
   -------------------------------------------------------------------------- */
.message {
  background-color: var(--color-card-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 20px 24px;
  margin-bottom: 20px;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.04);
}

.message.user {
  border-left: 4px solid var(--color-user-border);
}

.message.assistant {
  border-left: 4px solid var(--color-assistant-border);
}

.message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
}

.role-badge {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 3px 10px;
  border-radius: 4px;
}

.message.user .role-badge {
  background-color: #eff6ff;
  color: #1d4ed8;
}

.message.assistant .role-badge {
  background-color: #f5f3ff;
  color: #6d28d9;
}

.message-time {
  font-size: 12px;
  color: var(--color-text-muted);
}

.block-paragraph {
  margin: 0 0 14px 0;
}

.block-paragraph:last-child {
  margin-bottom: 0;
}

.block-heading {
  margin: 20px 0 10px 0;
  color: #0f172a;
  line-height: 1.3;
}

.block-heading:first-child {
  margin-top: 0;
}

h1.block-heading { font-size: 20px; font-weight: 700; border-bottom: 1px solid var(--color-border); padding-bottom: 6px; }
h2.block-heading { font-size: 18px; font-weight: 600; }
h3.block-heading { font-size: 16px; font-weight: 600; }
h4.block-heading, h5.block-heading, h6.block-heading { font-size: 14px; font-weight: 600; }

.block-code {
  background-color: var(--color-code-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 12px 16px;
  margin: 14px 0;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.block-code code {
  font-family: inherit;
}

.block-list {
  margin: 12px 0;
  padding-left: 24px;
}

.block-list li {
  margin-bottom: 6px;
}

.block-quote {
  margin: 14px 0;
  padding: 8px 16px;
  border-left: 4px solid var(--color-border);
  background-color: #f8fafc;
  color: #334155;
  font-style: italic;
}

.table-wrapper {
  margin: 16px 0;
  overflow-x: auto;
}

.table-caption {
  font-size: 13px;
  color: var(--color-text-muted);
  margin-bottom: 6px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  text-align: left;
}

table, th, td {
  border: 1px solid var(--color-border);
}

th {
  background-color: var(--color-table-header-bg);
  padding: 8px 12px;
  font-weight: 600;
  color: #0f172a;
}

td {
  padding: 8px 12px;
  vertical-align: top;
}

.attachment-card {
  background-color: #f8fafc;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 12px 16px;
  margin: 14px 0;
}

.attachment-title {
  font-size: 13px;
  font-weight: 500;
}

.attachment-preview {
  margin-top: 8px;
  background-color: #ffffff;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 8px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
}

.unknown-block-warning {
  background-color: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  border-radius: 6px;
  padding: 10px 14px;
  margin: 14px 0;
  color: var(--color-warning-text);
  font-size: 13px;
}

.empty-state {
  text-align: center;
  padding: 48px 24px;
  background-color: var(--color-card-bg);
  border: 1px dashed var(--color-border);
  border-radius: 8px;
  color: var(--color-text-muted);
}

/* ==========================================================================
   Print Stylesheet (@media print)
   ========================================================================== */
@media print {
  @page {
    margin: 15mm;
    size: auto;
  }

  body {
    background-color: #ffffff !important;
    color: #000000 !important;
    font-size: 11pt;
    line-height: 1.5;
  }

  .print-toolbar {
    display: none !important;
  }

  .document-container {
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  .export-header {
    box-shadow: none !important;
    border: 1px solid #cbd5e1 !important;
    padding: 16px !important;
    margin-bottom: 20px !important;
  }

  .message {
    box-shadow: none !important;
    border: 1px solid #cbd5e1 !important;
    break-inside: auto;
    page-break-inside: auto;
    margin-bottom: 16px !important;
    padding: 14px 18px !important;
  }

  .message.user {
    border-left: 3.5pt solid #2563eb !important;
  }

  .message.assistant {
    border-left: 3.5pt solid #7c3aed !important;
  }

  .message-header {
    break-after: avoid;
    page-break-after: avoid;
  }

  .block-code,
  .table-wrapper,
  table,
  .block-quote,
  .attachment-card,
  .unknown-block-warning {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .block-code {
    border: 1px solid #cbd5e1 !important;
    background-color: #f8fafc !important;
    font-size: 9.5pt !important;
    white-space: pre-wrap !important;
    word-break: break-all !important;
  }

  table, th, td {
    border-color: #cbd5e1 !important;
  }

  th {
    background-color: #f1f5f9 !important;
    color: #000000 !important;
  }

  a {
    color: #000000 !important;
    text-decoration: underline !important;
  }
}
`;
