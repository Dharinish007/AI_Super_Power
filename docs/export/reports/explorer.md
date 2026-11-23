# Explorer Subagent Report

**Phase:** P0 Baseline  
**Scope:** Repository codebase mapping for Chat Export feature integration.

---

## 1. Core Modules & Key File Paths

### Row & Context Types
- **`content/strip-adapters.js`**: Defines the standardized data contract for the strip component:
  - `Row`: `{ label, state, percent?, resetsAt?, source, note? }`
  - `Context`: `{ used?, limit?, source }`
  - `Adapter`: `() => { rows: Row[], context?: Context, msgsLeft?: number }`
  - Provides `claudeAdapter`, `geminiAdapter`, `chatgptAdapter`, and `getAdapterForProvider(providerName)`.
  - Adapters follow strict never-throw discipline.

### Provider Adapters & Message Reading
- **`content/providers.js`**: Contains `ClaudeProvider` and `GeminiProvider`:
  - `ClaudeProvider.inputSelector`: `div.ProseMirror[contenteditable="true"], [data-testid="chat-input"]`
  - `ClaudeProvider.replySelector`: `.font-claude-response, .font-claude-message`
  - `ClaudeProvider.userSelector`: `[data-testid="user-message"]`
  - `ClaudeProvider.conversationId(url)`: regex matches `/chat/([0-9a-f-]{36})`
  - `ClaudeProvider.extractMessages(doc)`: extracts visible DOM turns using `cleanText()`, returning `{ id, role, text, parts, isStreaming }`.
  - `ClaudeProvider.fetchConversation(id, fetchJson)`: calls authoritative endpoint `/api/organizations/{org}/chat_conversations/{id}?tree=True...`.
  - `ClaudeProvider.normalizeConversation(conv)`: traverses active branch from `current_leaf_message_uuid` back to root via `parent_message_uuid`.
- **`content/provider-coordinator.js`**: Orchestrates `ClaudeProvider` and `GeminiProvider` with tokenizers, DOM observer, and strip UI.

### UI Formatters & Thresholds
- **`ui/formatters.js`**: Pure formatting functions:
  - `threshold(pct)`: under 50% `ok` (green), 50–80% `warn` (amber), >80% `danger` (red ⚠).
  - `formatPercent(pct)`: display strings pairing color, emoji, and symbol.
  - `formatTokens(tokens, options)`: compact representations (e.g. `96K`, `1.5M`, `~`).
  - `formatReset(timestamp, now)`: relative reset timestamps.
  - `formatMsgs(count, options)`: formatted message counters.
- **`ui/dom.js`**: Zero-dependency hyperscript helper `h()`, SVG icon generator `iconButton()`, `icon()`, and text manipulation utils.

### Settings & Storage
- **`content/settings.js`**:
  - `SETTINGS_KEY = 'settings'`
  - `DEFAULT_SETTINGS`: holds `widgets`, `capsule`, `context`, `display`.
  - `normalizeSettings(raw)`: validates structure and provides fallbacks for corrupted/missing settings.
  - `readSettings(area)`, `writeSettings(area, patch)`: reads/writes to `chrome.storage.local`.

### Glance Strip & Detail Drawer
- **`ui/strip-component.js`**:
  - Single shared UI component mounted above the chat input.
  - Constructs `strip-box` (left usage rows, right circular context ring).
  - Constructs `detail-drawer` containing `drawer-header` (`dTitle`, `dModel`, `dGear`), stacked context distribution bar, legend, and usage details.
  - Only entry point needed for export: adding an Export icon button in `drawer-header`.

### Build & Test Systems
- **`scripts/build.js`**: Concatenates ES modules into `content/content-script.js` and `sidepanel/sidepanel.js`.
- **`tests/run-tests.js`**: Custom Node.js test runner executing 31 test suites using in-memory DOM mocks.
- **`scripts/validate-extension.js`**: Verifies Manifest V3 compliance, icons, permissions, and structure.

---

## 2. Claude Adapter Capabilities & Extraction Gap Analysis

| Capability | Current State | Missing for Export |
|---|---|---|
| **Conversation ID** | Read from URL `/chat/<uuid>` | None |
| **Active Branch** | Traversed from `current_leaf_message_uuid` back to root | None |
| **Message Structure** | Flattens all blocks into `text` string | Need structured `Block[]` (Headings, Code with lang, Tables) |
| **Tables** | Flattened to raw text / unformatted innerText | Structured 2D table matrices (`headers[]`, `rows[][]`) |
| **Code Fences** | Flattened without language metadata | Code block object with language tag and code string |
| **Unsupported Elements** | Dropped or stringified | Formal `UnknownBlock` placeholder with human-readable summary |
