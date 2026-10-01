# Capsule v1: design

Status: approved 2026-10-01

## Goal
Save the useful context of one AI conversation as a portable **Capsule** and insert it into another AI (ChatGPT, Claude, Gemini) so the user never re-explains it.

## Flow
1. Widget → **Capsules** tab → **Create Capsule** (uses the selected chat text, if any, as the focus).
2. The extension fills the site's chat box with the Capsule prompt. The user presses Enter (nothing is sent automatically).
3. The AI replies with the Capsule between `=== CAPSULE START ===` and `=== CAPSULE END ===`. A watcher (running only while waiting) reads the newest assistant reply's live text and detects the end marker.
4. A draft editor opens (title + body). The user edits and saves to `chrome.storage.local` (`capsules`, shared by all three sites).
5. **Insert** places `Context from an earlier AI conversation (Capsule: <title>) …` + body in the chat box of any site; if the box is not found, it is copied to the clipboard.

Fallback while waiting: **Use last reply** saves the newest assistant reply as-is. **Cancel** stops waiting.

## Decisions
- Summary is written by the AI the user is already in: no API key, no new server, nothing leaves the browser except the message the user sends.
- Fill, not auto-send: no per-site Send-button selectors, user consents to every message.
- UI is a tab in the existing widget: no popup, no side panel, no new permissions.

## Units
- `content/capsule.js`: `buildCapsulePrompt`, `parseCapsule`, `formatForInsert`, `CapsuleStore` (list / save / remove), `insertText` (paste event → `execCommand('insertText')` → textarea value), `readLatestCapsule`.
- `content/overlay-ui.js`: header tabs **Context | Capsules**, `CapsulePanel` component (create, waiting, draft editor, saved list with Insert / Copy / Edit / Delete).
- Coordinators pass `findInput` and `replySelector` (newest assistant reply) to the widget.

## Out of scope (v1)
Tags, search, Skills, sync, drag-and-drop, auto-send, version history.

## Testing
`tests/unit/capsule.test.js`: prompt, parsing (clean, fenced, missing end, loose, title fallback), insert format, store CRUD on a fake storage area, text insertion paths on fake elements. `npm test`, `npm run lint`, `npm run build`.
