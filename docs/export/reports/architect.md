# Architect Subagent Report

**Phase:** P0 Baseline  
**Scope:** Architecture specification and interface freeze for Chat Export.

---

## 1. File Layout

```
engine/
└── export/
    ├── types.js                # [P1] JSDoc types & contracts (Pure, frozen after P1)
    ├── markdown-exporter.js    # [P2] toMarkdown(data, options) (Pure)
    ├── print-html-exporter.js  # [P4] toPrintHtml(data, options) (Pure)
    ├── table-extractor.js      # [P5] toTables(data) (Pure)
    └── excel-writer.js         # [P5] Pure OpenXML ZIP/.xlsx binary builder (Pure)
content/
└── export/
    ├── dom-block-parser.js      # [P1] DOM node to Block[] walker (Touches DOM)
    └── claude-message-parser.js # [P1] Claude API & DOM extractor (Mixed)
ui/
├── export-dialog.js            # [P3] Shadow DOM Export Modal (Touches DOM)
└── print-styles.js             # [P4] Dedicated @media print stylesheet (Pure string)
tests/
├── fixtures/export/            # [P1] Test chat fixtures (.json & .html)
└── unit/                       # [P1-P5] Unit test suites
```

---

## 2. Core Interface Contracts (To be implemented in P1 `engine/export/types.js`)

```javascript
/**
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
```

---

## 3. Boundary Invariants
1. **Decoupling:** `engine/export/` is 100% DOM-free, zero-dependency, and headless.
2. **Safety:** No content is ever silently dropped; unsupported blocks map to `UnknownBlock`.
3. **No Side-Effects:** The export pipeline does not mutate existing view states, token calculators, or strip UI.
