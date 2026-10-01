# AI Context Monitor

> A production-grade Chrome Extension (Manifest V3) for ChatGPT, Claude and Gemini that calculates and displays the **most accurate possible context-window utilization** for the current conversation without fabricating unobservable server-side data.

---

## 1. Product Overview

None of these sites expose an exact, authoritative context-token counter in the DOM. Many third-party tools falsely claim that summing DOM message tokens represents 100% of the model's context window.

**AI Context Monitor** solves this by adhering to the **Truth-in-Measurement Standard**:
- Calculates local, high-precision BPE token estimates from observable conversation text.
- Resolves context limits against a versioned, verified OpenAI model database (`config/model-limits.json`).
- Explicitly labels every metric with its epistemic classification:
  * **`EXACT`**: Authoritative usage metadata directly exposed by the system.
  * **`OBSERVED`**: Directly detected from DOM/network state (model name, file attachments).
  * **`ESTIMATED`**: Calculated from observable content using local tokenization.
  * **`UNKNOWN`**: Hidden server-side context (system prompts, developer instructions, memory vectors, tool schemas).

---

## 2. Architecture & Data Flow

```text
ChatGPT Web Page
     │
     ├── MutationObserver (chatgpt-dom.js) ──> [Throttled & Debounced ~120ms]
     │                                               │
     ├── Message Extractor (message-extractor.js) ───┤
     │   └── Extracts User & Assistant Turns         │
     │                                               ▼
     ├── Model Detector (model-detector.js) ───> [Context Engine]
     │   └── Matches config/model-limits.json        ├── Local BPE Tokenizer (tokenizer.js)
     │                                               │   └── LRU Hash Cache (O(1) Streaming)
     ├── Attachment Detector (attachment-detector.js)├── Context Classifier (context-classifier.js)
     │   └── Image / Doc token estimation            ├── Confidence Engine (confidence-engine.js)
     │                                               └── Context Calculator (context-calculator.js)
     └── Tool Detector (tool-detector.js)            │
         └── Web Search / Python / Memory            ▼
                                             ┌─────────────────────────────────┐
                                             │ Floating HUD (overlay-ui.js)    │
                                             │ Toolbar icon: show / hide HUD   │
                                             │ Toolbar Badge (service-worker)  │
                                             └─────────────────────────────────┘
```

---

## 3. Feature Status & Accuracy

| Feature | Implementation | Accuracy Classification | Notes |
| :--- | :---: | :---: | :--- |
| **Conversation Tokens** | ✅ Completed | `ESTIMATED` | High-precision local BPE tokenizer with LRU caching |
| **Model Detection** | ✅ Completed | `OBSERVED` | Scans header, dropdowns, and message metadata |
| **Context Window Limits** | ✅ Completed | `OBSERVED` | Per model + plan in `model-limits.json`; current GPT-5.x/6 slugs matched to Instant / Thinking families from chatgpt.com/pricing |
| **Streaming Responses** | ✅ Completed | `ESTIMATED` | Throttled re-tokenization of only active streaming turn |
| **Image Attachments** | ✅ Completed | `ESTIMATED` | Calibrated vision token heuristic (~300 tokens/image) |
| **Document Uploads** | ✅ Completed | `UNKNOWN` | Flagged as present; exact internal tokens marked unknown |
| **Web Search Activity** | ✅ Completed | `OBSERVED` / `UNKNOWN` | Search execution observed; injected tokens marked UNKNOWN |
| **Python Interpreter** | ✅ Completed | `OBSERVED` / `UNKNOWN` | Executions observed; raw runtime state marked UNKNOWN |
| **Memory Updates** | ✅ Completed | `OBSERVED` / `UNKNOWN` | Memory references observed; vector tokens marked UNKNOWN |
| **System / Dev Prompts**| ✅ Completed | `UNKNOWN` | Explicitly marked unexposed; never fabricated |
| **In-Page Floating HUD**| ✅ Completed | `ESTIMATED` | Non-intrusive Shadow DOM overlay with mini popover |
| **Refresh Button** | ✅ Completed | `OBSERVED` | Re-reads the current conversation on demand; the toolbar icon shows / hides the widget (there is no popup) |
| **Toolbar Badge** | ✅ Completed | `ESTIMATED` | Displays percentage utilization (`24%`) with alert colors |
| **Capsules** | ✅ Completed | n/a | Save a conversation's context and insert it into another AI (see below) |

---

## 3b. Where Each Value Comes From (highest priority first)

| Value | Sources |
| :--- | :--- |
| **Conversation turns** | `GET /backend-api/conversation/{id}` with the session bearer token → the same JSON captured from the page's own request → page DOM (`[data-message-author-role]`, turn containers) |
| **Model** | Latest assistant `metadata.model_slug` from the API → live stream metadata → `data-message-model-slug` in the DOM → header text (only if it looks like a model name) |
| **Plan** | `account.planType` from `/api/auth/session` → `accounts/check` response → sidebar/profile text |
| **Context window** | `config/model-limits.json` (model family × plan) |

**Claude (claude.ai):** conversation, model and plan from claude.ai's own same-origin, cookie-authenticated API (`/api/organizations/{org}/chat_conversations/{id}`, the organization, `/api/account`, `/api/account_profile`, project and `/usage` endpoints; the org id comes from the `lastActiveOrg` cookie), with the page DOM as fallback. Plan usage limits (5-hour session, weekly) are also read from the `message_limit` event in each reply stream (`content/claude-limit-watcher.js`, which forwards only that event). Context window: 200K on paid plans (1M for listed models); unknown on Free, which is not published.

**Gemini (gemini.google.com):** page DOM only, no network requests. Context window comes from the plan (Google publishes it per plan, not per model).

**Session token (ChatGPT):** `/backend-api` rejects cookie-only requests, so the content script reads `accessToken` from same-origin `/api/auth/session` (exactly what ChatGPT's own page does). It lives only in a private in-memory field, is sent only to `chatgpt.com`, and is never logged, stored, or included in extension state or diagnostics.

**Widget:** a small draggable pill in the top-right corner (`39.3K • Medium`). Click it for the full panel (usage bar, model, plan, breakdown, hidden context, usage limits); the toolbar icon shows or hides it. **Copy diagnostics** copies a structure-only JSON snapshot (source statuses, selector counts, candidates; no message text, no token) for troubleshooting.

**Capsules** (widget → **Capsules** tab, `content/capsule.js`): a portable summary of one conversation for use in another AI.
1. **Create Capsule** fills the chat box with a prompt asking the current AI to write the Capsule (select chat text first to focus on that part). You press Enter; nothing is sent for you.
2. When the reply's `=== CAPSULE END ===` marker appears, the Capsule opens in an editor. A MutationObserver runs only while waiting. **Use last reply** saves the newest reply as-is if the markers are missing.
3. **Save** stores it in `chrome.storage.local`, one list shared by ChatGPT, Claude and Gemini.
4. **Insert** puts it in the chat box of any of the three sites (copied to the clipboard if the box is not found); **Copy**, **Edit** and **Delete** (click twice) manage it.
5. Each card shows what inserting it costs here (`~1.2K tokens · 0.6% of window`, estimated with the bundled tokenizer, scaled for Claude), in red when it is bigger than the room left in this chat.
6. **Update** asks the current AI to rewrite the Capsule with the chat's new progress; saving replaces it (same id, original site kept).
7. **📤 Export** downloads every Capsule as `capsules-YYYY-MM-DD.json`; **📥 Import** merges such a file (unknown ids added, newer copies replace older ones, invalid entries skipped; ids, lengths and dates are checked).

When the site's limit is reached (ChatGPT model with no messages left, Claude usage at 100%, Gemini's limit notice), the tab says so and offers two ways that need no messages on this site:
- **⚡ Quick (no AI)** builds the Capsule from the page: the goal (first message), the last 6 turns and the latest code blocks, or just the selected text.
- **🔀 Make in another AI** stores the Capsule prompt plus this conversation (up to 60K characters: the first message and the newest that fit) in `chrome.storage.local`, and copies it. On another AI, the Capsules tab shows **Paste & create**; that AI writes the Capsule, which keeps its original site. A hand-off expires after a day.

**Skills** (widget → **Skills** tab): reusable instructions for how the AI should answer ("Code reviewer", "Explain simply"). **＋ New Skill** opens the editor; three starter Skills appear the first time (deleting them is remembered). Insert adds `Follow these instructions for the rest of this chat (Skill: …)` plus the text. Insert always appends to the chat box, so a Capsule then a Skill go in one message. Same list, cost line and Export / Import (`skills-YYYY-MM-DD.json`) as Capsules, stored under `skills`.

---

## 4. Known Limitations

In compliance with project requirements, the following constraints are explicitly documented:
1. **DOM Tokens ≠ Total Model Prompt:** The visible conversation represents only part of the prompt submitted to the model. Hidden system instructions, safety wrappers, tool schemas, and runtime formatting are unobservable on the client.
2. **Document Previews:** Large PDFs, spreadsheets, and Word documents ingested by Advanced Data Analysis are processed server-side. The extension marks their exact token cost as `UNKNOWN`.
3. **Memory Retrieval:** When ChatGPT accesses long-term memory, only the UI badge is observable. The exact vector retrieval text and token cost are not exposed to the browser.
4. **Free Tier Turn Caps:** OpenAI adjusts ChatGPT Free message limits server-side on dynamic load-balancing rules. The extension does not display fabricated message countdown timers.

---

## 5. Getting Started & Development

### Prerequisites
- Node.js v22.2+ (tested on Node v24)
- Google Chrome or any Chromium browser

### Quick Commands
```bash
# 1. Install & build content script bundle and icons
npm run build

# 2. Run the automated test suite (unit, DOM, network-interceptor and bundle tests)
npm test

# 3. Run Manifest V3 pre-flight validation
npm run validate

# 4. Package extension for Chrome Web Store
npm run pack
```

---

## 6. How to Load in Chrome

1. Open Google Chrome and navigate to:
   ```text
   chrome://extensions
   ```
2. Enable **Developer mode** using the toggle switch in the top-right corner.
3. Click the **Load unpacked** button in the top-left corner.
4. Select this repository folder (the one containing `manifest.json`). Run `npm install && npm run build` first if you changed any source file.
5. Open [chatgpt.com](https://chatgpt.com) and start or open any conversation.
6. The context widget appears in the top-right corner (drag it anywhere; it snaps to the nearest side). Click it for the full breakdown. Clicking the toolbar icon shows or hides the widget. The same works on [claude.ai](https://claude.ai) and [gemini.google.com](https://gemini.google.com).

---

## 7. Repository Layout

| Path | What it is |
| :--- | :--- |
| `manifest.json`, `background/`, `content/`, `engine/`, `network/`, `config/`, `assets/` | The extension. `content/content-script.js` is generated by `npm run build`: edit the source modules, then rebuild (a test fails if you forget). |
| `scripts/` | Build, icon generation, validation, packaging and benchmarks |
| `tests/` | `npm test` (unit, DOM, interceptor and bundle tests) |
| `docs/` | Project plan and Chrome extension engineering reference |
| `CHROMEWEBSTORE.md`, `PRIVACY.md` | Store listing, permission reasons and privacy policy |
| `CHANGELOG.md` | Release notes |
| `GEMINI.md`, `.agents/` | Instructions for AI coding agents (kept at the root, where the tools load them) |
