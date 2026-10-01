# Changelog

All notable changes to AI Context Monitor. Versions follow `manifest.json`; bump it (and `package.json`) when releasing.

## [Unreleased]

### Changed
- Renamed to **AI Context Monitor** (was "ChatGPT Context Monitor"): third-party trademarks stay out of the name.
- Only the `o200k_base` tokenizer ships: the bundle shrinks from 3.6 MB to 2.6 MB. Retired GPT-4 / GPT-4 Turbo / GPT-3.5 chats are counted with `o200k_base` and marked "approximate tokenizer".
- The tokenizer table is built in ~8 ms slices instead of one ~100 ms task on every page load.
- The toolbar badge receives only `{ percentage, awaitingData }`. Nothing is written to `chrome.storage.session` any more (the per-tab state was left over from the removed popup and never read).
- The packager reads its file list from `manifest.json`.
- `js-tiktoken` pinned to `1.0.21`; only its `o200k_base` rank table ships (the tests use its encoder as the reference).
- Cleanup, no behaviour change: the bundle no longer inlines the unused js-tiktoken encoder (counting has used the bundled count-only BPE for a while); the ChatGPT interceptor no longer hooks XMLHttpRequest or parses `/backend-api/models` (nothing read either) and sends one completion event per reply; the ChatGPT and Claude / Gemini coordinators share their badge, toggle, diagnostics and limit-provenance code (`content/coordinator-common.js`); unused engine output fields, config (`config/selectors.json`) and scripts were removed.
- Gemini: a message just sent and a reply in progress count at once on long chats (the page renders only the turns in view, so they used to wait up to a minute for the next saved-copy read).
- `unlimitedStorage` permission: saved Capsules and Skills are no longer capped by the 10 MB `chrome.storage.local` quota (no install warning).
- Privacy policy and store listing: Gemini reads the conversation through Gemini's own same-origin read call with the page's request token (memory only), not "the page only".
- "~N exchanges left" now uses the context advisor's current-pace estimate (last 5 exchanges) instead of a second, whole-chat average.

### Fixed
- The release file list missed `content/claude-limit-watcher.js`, so a packaged build would have failed to load on claude.ai.
- Store privacy answers now match the code (session token and cookies read in memory on ChatGPT and Claude), with permission reasons for Claude and Gemini.
- Unparseable ChatGPT API responses are logged in diagnostics (`RESPONSE_PARSE_ERROR`) instead of being dropped silently.
- A Capsule without a `Title:` line no longer loses a `title:` line from its snippets (YAML front matter) to the title.
- **Use last reply** drops code-block button labels ("Copy code") like the other chat readers.

### Added
- **Capsules** (widget → Capsules tab): the current AI writes a Capsule of the conversation (or the selected part), the extension detects the reply, the user edits and saves it locally, and Insert puts it in the chat box of ChatGPT, Claude or Gemini. `content/capsule.js`, `tests/unit/capsule.test.js`; privacy policy and store listing updated (saved Capsules are stored text).
- **Capsules when the limit is reached:** the Capsules tab detects a blocking limit (ChatGPT model at 0, Claude at 100%, Gemini notice) and offers **⚡ Quick (no AI)** (Capsule built from the page) and **🔀 Make in another AI** (hand-off: the prompt plus the conversation, pasted into another AI with **Paste & create**).
- **Skills** (new widget tab): reusable instructions inserted into any AI ("Follow these instructions for the rest of this chat"), with three starter Skills, cost line and Export / Import. Insert now adds a blank line before text already in the chat box, so a Capsule and a Skill go in one message as separate paragraphs. Long lists no longer squeeze the panel's buttons.
- **Better Capsules:** each card shows its estimated insert cost (`~1.2K tokens · 0.6% of window`, red when larger than the room left); **Update** has the current AI refresh a Capsule with new progress; **Export / Import** of all Capsules as JSON (merge by id, newer wins, invalid entries skipped).
- `PRIVACY.md` (privacy policy for the store listing) and this changelog.
- Tests: bundle up to date with its sources, sliced table build, API parse errors.
- GitHub Actions CI (`.github/workflows/ci.yml`): lint, tests, manifest validation, packaging, and the store zip as a downloadable artifact.
- ESLint (`npm run lint`); the existing findings are fixed, including unused code.
- `npm run pack` writes the store upload `dist/ai-context-monitor-<version>.zip` (no new dependency). Requires Node 22.2+.

### Removed
- Unused `settings` defaults in the service worker.

## [1.0.0] - 2026-09-29

First complete version: context-window monitoring on ChatGPT, Claude and Gemini, with a draggable in-page widget, a toolbar badge, plan usage limits (Claude), hidden-context estimates, and confidence and diagnostics labelled EXACT / OBSERVED / ESTIMATED / UNKNOWN.
