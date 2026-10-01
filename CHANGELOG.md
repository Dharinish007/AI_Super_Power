# Changelog

All notable changes to AI Context Monitor. Versions follow `manifest.json`; bump it (and `package.json`) when releasing.

## [Unreleased]

### Changed
- Renamed to **AI Context Monitor** (was "ChatGPT Context Monitor"): third-party trademarks stay out of the name.
- Only the `o200k_base` tokenizer ships: the bundle shrinks from 3.6 MB to 2.6 MB. Retired GPT-4 / GPT-4 Turbo / GPT-3.5 chats are counted with `o200k_base` and marked "approximate tokenizer".
- The tokenizer table is built in ~8 ms slices instead of one ~100 ms task on every page load.
- The toolbar badge receives only `{ percentage, awaitingData }`. Nothing is written to `chrome.storage.session` any more (the per-tab state was left over from the removed popup and never read).
- The packager reads its file list from `manifest.json`.
- `js-tiktoken` pinned to `1.0.21`; the build finds its chunk file instead of hard-coding the name.

### Fixed
- The release file list missed `content/claude-limit-watcher.js`, so a packaged build would have failed to load on claude.ai.
- Store privacy answers now match the code (session token and cookies read in memory on ChatGPT and Claude), with permission reasons for Claude and Gemini.
- Unparseable ChatGPT API responses are logged in diagnostics (`RESPONSE_PARSE_ERROR`) instead of being dropped silently.

### Added
- **Capsules** (widget → Capsules tab): the current AI writes a Capsule of the conversation (or the selected part), the extension detects the reply, the user edits and saves it locally, and Insert puts it in the chat box of ChatGPT, Claude or Gemini. `content/capsule.js`, `tests/unit/capsule.test.js`; privacy policy and store listing updated (saved Capsules are stored text).
- `PRIVACY.md` (privacy policy for the store listing) and this changelog.
- Tests: bundle up to date with its sources, sliced table build, API parse errors.
- GitHub Actions CI (`.github/workflows/ci.yml`): lint, tests, manifest validation, packaging, and the store zip as a downloadable artifact.
- ESLint (`npm run lint`); the existing findings are fixed, including unused code.
- `npm run pack` writes the store upload `dist/ai-context-monitor-<version>.zip` (no new dependency). Requires Node 22.2+.

### Removed
- Unused `settings` defaults in the service worker.

## [1.0.0] - 2026-09-29

First complete version: context-window monitoring on ChatGPT, Claude and Gemini, with a draggable in-page widget, a toolbar badge, plan usage limits (Claude), hidden-context estimates, and confidence and diagnostics labelled EXACT / OBSERVED / ESTIMATED / UNKNOWN.
