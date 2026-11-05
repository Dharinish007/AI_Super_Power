# ChatGPT Context Monitor — Engineering Rules & Project Conventions

**Single source of truth for all AI agents modifying this codebase.** All prior docs (GEMINI.md, .agents/rules/chatgpt-context-monitor.md) are archived; refer to this file only.

---

## 1. Authority Hierarchy & Conflict Resolution

**1.** Official Chrome for Developers Documentation (`https://developer.chrome.com/docs/extensions`): Authoritative spec for all Chrome platform APIs, lifecycle behaviors, permissions, and Manifest V3 constraints.

**2.** Google Chrome Chrome Extensions Skill (`GoogleChrome/modern-web-guidance`): Primary engineering skill, architectural patterns, and failure-prevention rules.

**3.** Browser Extension Skills (`quangpl/browser-extension-skills`): Supplementary implementation workflows, scaffolding, testing strategies, and audit checklists.

**Conflict Resolution Rule:** `Official Chrome Documentation > Google Chrome Skill > Third-Party Guidance`

---

## 2. Manifest V3 Core Rules (20 Non-Negotiable)

| # | Rule |
|---|------|
| **1** | Icons: Only reference actual image files on disk with exact pixel dimensions (16×16, 48×48, 128×128). Omit icons entirely rather than referencing nonexistent files. |
| **2** | Side Panel & Action Triggers: `openPanelOnActionClick` (NOT `openPanelOnActionIconClick`). Do NOT define `default_popup` if using `action.onClicked` or `openPanelOnActionClick`. |
| **3** | Code Execution & CSP: `eval()`, `new Function()`, and remote/inline scripts are forbidden. Use manifest `"sandbox": { "pages": ["sandbox.html"] }` + `postMessage` if evaluation is necessary. All HTML must load scripts via `<script src="file.js">`. |
| **4** | Tab URL Access: Accessing `tab.url` requires `"tabs"` permission or an active gesture invoking `activeTab`. Without it, `tab.url` silently returns `undefined`. |
| **5** | Async/Await & Message Responses: For `chrome.runtime.onMessage.addListener`: **always synchronously return `true;`** to keep the message channel open when responding asynchronously. |
| **6** | Content Script Main-Thread Discipline: Never block the main thread. Batch DOM mutations using `requestAnimationFrame` and debounced ticks. |
| **7** | Ephemeral Service Workers: State terminates after ~30s inactivity. **Never** store state in global memory variables. Persist in `chrome.storage.local` or `chrome.storage.session`. |
| **8** | Extension ID Stability: IDs change between dev environments and differ from published IDs. When identity/OAuth is required, pin the public key using `"key"` in `manifest.json`. |
| **9** | Actionable Context Menus: Any background action from a context menu must provide clear user confirmation (badge flash, notification, or injected toast). |
| **10** | `chrome.action` Declaration: Using `chrome.action.setBadgeText`, `setIcon`, or `onClicked` requires `"action": {}` declaration in `manifest.json`. |
| **11** | `activeTab` Limitations: Only grants temporary access upon a direct user gesture. Does **not** grant access from a button inside a side panel or detached popup. |
| **12** | DevTools Panel Resolution: Paths passed to `chrome.devtools.panels.create()` must be relative to the extension root, not the devtools HTML caller. |
| **13** | Offscreen Document Scope: Has access to DOM/audio/canvas/MediaRecorder and `chrome.runtime`, but **no access** to `chrome.action`, `chrome.tabs`, `chrome.downloads`, etc. |
| **14** | Valid Image References: `chrome.notifications.create`, `chrome.action.setIcon`, and context menus require valid, existing image paths or canvas data URLs. Missing paths fail with `"Unable to download all specified images"`. |
| **15** | Capture State Locking: Tab/media capture APIs require explicit state locking machines (`idle` → `starting` → `active` → `stopping`) persisted in `chrome.storage.session`. |
| **16** | Desktop Capture Target Tab: `chooseDesktopMedia()` from a service worker requires passing a target tab with the `url` field populated (requires `"tabs"` permission). |
| **17** | User Scripts Verification: Check `isUserScriptsAvailable()` before calling `chrome.userScripts`. |
| **18** | `chrome.windows` Method Availability: Does NOT have `.query()`. Use `getAll()`, `getCurrent()`, or `getLastFocused()`. |
| **19** | Synchronous User Gestures for Permissions: `chrome.permissions.request()` must be called synchronously inside a user-gesture event handler. A single `await` gap destroys the transient activation token. |
| **20** | Manifest V3 Declarations Only: Use `background.service_worker` (not `background.scripts`). Use `chrome.scripting` (not `chrome.tabs.executeScript`). Keep `host_permissions` separated from `permissions`. |

---

## 3. Project Architecture & Layer Structure

```
manifest.json
├── background/service-worker.js          # Toolbar badge + icon click (opens side panel); no popup
├── config/model-limits.json              # ChatGPT model x plan context windows (inlined into bundle)
├── network/request-observer.js           # Isolated-world side of the ChatGPT network bridge
└── content/                              # Site-specific adapters (never engine/)
│   ├── network-interceptor.js            # MAIN world (ChatGPT): passive fetch / SSE observation
│   ├── content-main.js                   # ChatGPT coordinator
│   ├── provider-coordinator.js           # Claude / Gemini coordinator (adapters in providers.js)
│   ├── coordinator-common.js             # Badge, diagnostics, limit evidence shared by both
│   ├── conversation-client.js            # ChatGPT conversation API client
│   ├── message-extractor.js, model-detector.js,
│   ├── plan-detector.js, attachment-detector.js, tool-detector.js
│   ├── chatgpt-dom.js, turn-merger.js    # MutationObserver lifecycle; live turn merging
│   ├── widget-state.js, widgets.js      # View state + Shadow DOM pills (views in ui/, panel in sidepanel/)
│   └── capsule.js                        # Capsules / Skills / library
│   └── content-script.js                 # GENERATED by npm run build: never edit by hand
├── engine/                               # tokenizer (o200k BPE), gemma-tokenizer,
│   ├── calculator.js, classifier.js,
│   ├── evidence-merger.js, confidence-engine.js
│   └── context-advisor.js                # MUST remain DOM-free, headless, platform-agnostic
├── ui/                                    # Side-panel views shared with widgets
│   └── <view-component>.html + <view-component>.js
├── scripts/                              # build, validate, pack, benchmark
│   └── build.js                          # Bundles content/ + sidepanel/ into content-script.js + sidepanel.js
├── sidepanel/                            # Side panel (one runtime port per tab, named `panel`)
│   ├── sidepanel.html
│   └── main.js                           # Built into sidepanel/sidepanel.js
└── tests/                                # npm test (780+ unit + DOM + interceptor suites)
```

---

## 4. Evidence Taxonomy & Truth-in-Measurement

Every measurement must explicitly carry `{ value, source, evidenceType }`. Source disagreements must be recorded in `conflicts: { field, winning, discarded, reason }` rather than silently dropped.

### EvidenceType Classification
| Type | Description |
|------|-------------|
| **EXACT** | Authoritative usage metadata directly exposed by the system or model API |
| **OBSERVED** | Directly verified from the active DOM or network headers |
| **ESTIMATED** | Calculated from observable data using tokenizers and heuristics |
| **UNKNOWN** | Unexposed, server-side, or unmeasurable data |

### Non-Negotiable Accuracy Principles
1. **DOM Tokens ≠ Complete Context Window:** Visible message text is only a fraction of the actual prompt. Actual context includes hidden system instructions, developer prompts, tool definitions, retrieval-augmented memory, search context, and runtime formatting. **Never** claim conversation tokens represent 100% of model input.
2. **Zero Fabrication:** Do **not** fabricate token counts for system prompts, memories, or MCP tool definitions unless exact/verifiable observed values exist. If memory is enabled: `Memory: Enabled (Observed) | Context Contribution: UNKNOWN`. If web search occurred: `Search: Executed (Observed) | Injected Tokens: UNKNOWN`.
3. **No Hardcoded Universal Limits:** Never assume a single default context window (e.g. 128k) for all conversations. Use `config/model-limits.json` mapping verified model names to verified limits, citing official sources and last verified dates. If model unidentified: `Model: UNKNOWN | Context Window: UNKNOWN`.
4. **No Artificial Free-Tier Counters:** Do not display arbitrary counters like `"24 / 50 messages used"` unless ChatGPT explicitly displays this limit in the UI.

---

## 5. Generic vs. Site-Specific Logic Boundaries

### `engine/` — Generic Core (DOM-Free, Headless)
| Rule |
|------|
| Completely DOM-free, headless, and platform-agnostic |
| Operates strictly on normalized JavaScript objects (`messages[]`, `parts[]`, `model`, `attachments`, `tools`, `completeness`) |
| **Never** import DOM utilities or hardcode ChatGPT HTML class names |
| Files: `tokenizer.js`, `g Gemma tokenizer`, `context-calculator.js`, `context-classifier.js`, `confidence-engine.js`, `evidence-merger.js` |

### `content/` / `network/` — Site-Specific Adapters
| Rule |
|------|
| Handles ChatGPT SPA mutations, selectors, and API endpoints (`/backend-api/conversation/*`) |
| Normalize all extracted site data into generic structures before passing to `engine/` |
| Files: `chatgpt-dom.js`, `message-extractor.js`, `model-detector.js`, `attachment-detector.js`, `tool-detector.js`, `conversation-client.js`, `request-observer.js` |

---

## 6. Detection Methodologies

### Automatic Detection
- **Model Resolution:** Reconciles authoritative API slug → network payload → DOM header switcher button → `config/model-limits.json`. Fallback is `unknown` (with `null` context window), never arbitrary hardcoded 128K.
- **Tools & MCP:** Automatically captures both network tool calls (`web_search`, python code interpreter) and DOM tool execution chips.
- **Streaming:** Debounced with timers (not `requestAnimationFrame`, which is paused in background tabs) to prevent UI thrashing during assistant generation.

### Manual Interaction
- The side panel's Refresh button re-reads the conversation now (bypassing the short cache and failure back-off) without clearing in-flight streaming turns.

---

## 7. Initial Extraction vs. Collect More / Pagination / Virtualization

### Initial Navigation / Switch
- Extracts visible DOM turns as immediate baseline.
- Resolves active conversation ID from URL query/path and triggers `ConversationClient.fetchConversation(id)`.

### Authoritative Ground Truth Reconciliation
- If API succeeds: reconstructs the active branch from `root` to `current_node` (excluding abandoned edit branches).
- If `authoritativeTurnCount > renderedTurnCount`: flags `domIsPartial = true`, records `virtualizationGap`.

### API Offline / DOM Fallback
- If existing conversation API is unreachable: marks `domIsPartial = true`, sets `completenessSource = 'dom_partial'`.
- Flags context as **Lower Bound** (`completeness.isLowerBound = true`), triggering the widget's warning line and the partial-conversation confidence penalty.

---

## 8. Debugging & Root-Cause Methodology (Iron Law)

1. **Identify the Execution Context:** Content Script (active page console), Network Interceptor (page console with `[ChatGPT Network Interceptor]` prefix), Service Worker (`chrome://extensions` → "Inspect views: service worker"), Side Panel (**Copy diagnostics** button copies structure-only snapshot).

2. **Trace the Real Execution Flow:**
   ```
   Network/DOM Event → Extractor/Interceptor → EvidenceMerger → ContextCalculator → Widgets / Side Panel
   ```
   Validate real runtime payloads against expected shapes rather than guessing.

3. **Avoid Heuristic Hacks:**
   - Never modify `engine/` calculation math to fix an upstream extraction or timing issue.
   - Never use a site-specific workaround in generic engine modules unless proven to be a universal engine bug.

---

## 9. Testing & Regression Verification

| Rule |
|------|
| **Test Architecture:** Node.js test runner (`npm test`, `tests/run-tests.js`). Fast, isolated execution without external framework bloat. Node-based DOM mocks for `document`, `MutationObserver`, `CustomEvent`. In-memory mocks for `chrome.runtime`, `chrome.storage.local`, `chrome.storage.session`. |
| **Core Test Suites:** Tokenizer (exact against `js-tiktoken`), Gemma tokenizer, model/plan limits, context engine, conversation client, network observer + interceptor, completeness, evidence & confidence, providers (Claude, Gemini), widget state, capsules, reliability, performance equivalence, and bundle integrity (committed `content/content-script.js` must equal a fresh build). |
| **Real Browser:** `node scripts/benchmark.js` runs the built bundle in headless Chrome against a mock ChatGPT page. |
| **Regression Protocol:** Run `npm test` after any change (baseline: 780+ tests passing). Verify both the reported failure case and existing baseline workflows. Always write a targeted test case reproducing the issue before implementing a fix. Run `npm run validate` (Manifest V3 pre-flight checks) and `npm run lint`. |

---

## 10. Safe Change & Modification Rules (10 Core Agent Behaviors)

| # | Behavior |
|---|----------|
| **1** | Follow relevant project skills before working: `high-performance-agent`, `chrome-extension-engineering`, `chrome-extensions`. |
| **2** | Inspect existing implementations before creating new ones: Check existing modules (`EvidenceMerger`, `ContextClassifier`, `ConversationClient`, etc.) before adding new files or structures. |
| **3** | Trace the real execution flow before changing code: Verify call graphs, event dispatching, and message payload structures across MAIN, ISOLATED, and BACKGROUND worlds. |
| **4** | Find and verify the root cause before fixing: Adhere to the Iron Law of debugging. Formulate and verify hypotheses with evidence before making edits. |
| **5** | Prefer the smallest correct change: Avoid wide refactoring, unnecessary dependencies, or style rewrites. |
| **6** | Never use a site-specific workaround to alter generic logic: Keep `engine/` pure and generic; confine ChatGPT-specific DOM or payload quirks to `content/` and `network/` adapters. |
| **7** | Preserve existing working behavior: Maintain all established invariants from Groups A–E (epistemic honesty, BPE calibration, tree traversal, streaming assembly, confidence scoring). |
| **8** | Verify both the reported failure and related working cases: Confirm the fix addresses the bug while leaving all adjacent paths healthy. |
| **9** | Review the final diff for unintended changes: Run `git diff` prior to completion to catch accidental edits, leftover logging, or unintended line ending modifications. |
| **10** | Never claim a fix without verification: Provide command outputs, test run counts, and concrete validation evidence in the final report. |

---

## 11. Known Failure Patterns & Preventions

| Failure Pattern | Consequence | Prevention Rule |
|-----------------|-------------|-----------------|
| **Stale Build Bundle** | Browser extension runs old code despite file edits | Run `node scripts/build.js` after touching `engine/`, `content/`, or `network/`. |
| **Async Port Disconnect** | `sendResponse` throws "The message port closed before a response was received" | Synchronously `return true;` from `chrome.runtime.onMessage` when responding asynchronously. |
| **Service Worker State Evaporation** | Counters/state reset after 30s of inactivity | Store state in `chrome.storage.session` or `chrome.storage.local`; never use global variables in worker. |
| **Main-Thread UI Freeze** | ChatGPT chat lag or stutter during streaming | Debounce DOM observer callbacks; tokenize only the streaming turn incrementally using LRU cache. |
| **Arbitrary Confidence** | Misleading 95%+ confidence on unknown/partial data | Never hardcode confidence; evaluate evidence completeness and penalize unknown tools, files, or partial DOM. |
| **Fabricated Hidden Tokens** | Inaccurate token counts for server prompts | Classify system prompt, MCP tool schemas, and vector memory context contribution as `UNKNOWN`. |

---

## 12. Definition of Done (DoD)

A task or bug fix is complete **only** when ALL of the following conditions are met:

1. **Code Quality:** Clean, modular Manifest V3 code adhering to security, privacy, and architectural boundaries.
2. **Bundle Rebuilt:** `npm run build` executes cleanly and updates `content/content-script.js`.
3. **Unit & Integration Tests:** `npm test` passes 100% of test suites (780+ tests, 0 failures); `npm run lint` is clean.
4. **Manifest V3 Pre-Flight Check:** `npm run validate` passes every check.
5. **Release Packaging:** `npm run pack` verifies bundle contents.
6. **Adversarial Review:** Code has been reviewed against regressions, edge cases, and unexpected side effects.
7. **Proof Provided:** Test run evidence and exact results are documented in the final report.

---

## 13. Archived (Original Docs Referenced)

| File | Status | Note |
|------|--------|------|
| `GEMINI.md` | Archived | Superseded by this AGENTS.md |
| `.agents/rules/chatgpt-context-monitor.md` | Archived | Superseded by this AGENTS.md |
| `.agents/skills/high-performance-agent/SKILL.md` | Referenced | Skill: `high-performance-agent` |
| `.agents/skills/chrome-extension-engineering/SKILL.md` | Referenced | Skill: `chrome-extension-engineering` |
| User `CLAUDE.md` (global) | Retained separately | User-private global rules; not project-specific |
| `RTK.md` (global) | Unrelated | Token optimizer CLI; not part of this project |

---

## 14. Quick-Start for New Agents

1. Read this file entirely.
2. Run `npm test` to verify baseline (780+ tests).
3. Run `npm run validate` and `npm run lint` to confirm Manifest V3 compliance.
4. Run `npm run build` after any edit to `engine/`, `content/`, `network/`, or `ui/`.
5. Follow the operating loop: **UNDERSTAND → PLAN → EXECUTE → VERIFY → ATTACK → FIX → VERIFY AGAIN**.

---

*Generated on 2026-11-05. Archive: GEMINI.md → `.archived/GEMINI-20261105.md`, `.agents/rules/chatgpt-context-monitor.md` → `.archived/chatgpt-context-monitor-20261105.md`.*