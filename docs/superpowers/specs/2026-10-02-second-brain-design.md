# AI Super Powers: Second Brain design

Status: draft, awaiting approval (2026-10-02)
Supersedes: [Brain v1.1](2026-10-01-brain-v1.1-design.md) (most of it shipped in 1.1.0 as the Library: search, tags, projects, pin, multi-insert, export / import, cost lines)
Builds on: [Side panel + widgets](2026-10-01-side-panel-widgets-design.md), [Capsule v1](2026-10-01-capsule-v1-design.md)

## Goal
One **Second Brain** shared by ChatGPT, Claude and Gemini: what the user tells one AI ("my favorite fruit is mango", "ShopEasy uses React") is remembered as a short fact and can be injected into any other AI, so the user never re-explains themselves.

## Where we are (1.1.0)
| Have | Missing |
|---|---|
| Side panel: Context, Capsules, Skills, ⚙ | A Brain section that groups them |
| Capsules (whole-chat summaries), Skills (instructions), Library (search, tags, projects, pin, multi-insert, import / export) | **Memory**: short facts about the user |
| Fill-never-send insert with token cost | "Learn from this chat", a review inbox, updating a fact that changed |
| `chrome.storage.local`, shared by every site | A secret guard (no keys / passwords / card numbers saved) |
| Product name "AI Context Monitor" | **"AI Super Powers"** |

## Principles (unchanged)
- Local only: `chrome.storage.local`. No server, no API key, no new host permission.
- Fill, never send: every message is sent by the user.
- Truth-in-measurement: token costs are `~` estimates from the local tokenizer.
- Approve before remembering: nothing learned from a chat becomes memory until the user approves it (auto-approve is a later, opt-in phase).

## How "sync" works
- **Across AIs, same browser:** automatic. Memory lives in `chrome.storage.local`, read by the side panel on every site; `storage.onChanged` refreshes open panels. Learned in Claude → visible in ChatGPT immediately.
- **Getting it into an AI:** **💉 Inject memory** fills the chat box (manual, this phase). Auto-prefill on a new chat is phase 4.
- **Across devices:** later (phase 5), opt-in `chrome.storage.sync` for memories only (small facts fit its 100 KB / 512-item limits), signed-in Chrome does the rest. No server of ours.

## Side panel layout
```
⚡ AI Super Powers
[ Context ] [ 🧠 Brain ] [ ⚙ ]
            └─ [ Memory ] [ Capsules ] [ Skills ]
```
- **Brain** replaces the top-level Capsules and Skills tabs. A second tab row selects Memory / Capsules / Skills (default Memory).
- **Projects** stay a filter inside each list (already built), not a tab: a separate tab would duplicate the filter.
- Context tab's "Save as Capsule" opens Brain → Capsules (same as today).

## Memory
A memory is one short fact about the user, stored like a Capsule (same `CapsuleStore`, key `memories`, noun `Memory`) with two extra fields:

```js
{ id, title, body,            // body = the fact, ≤ 500 chars; title = first 80 chars of it
  category,                   // 'profile'|'preference'|'project'|'instruction'|'skill'|'decision'|'other'
  key,                        // 'preference.favorite-fruit' or null (manual memories)
  source, tags, project, pinned, createdAt, updatedAt }
```

- **Add by hand:** ＋ New memory → editor with the fact, a category select, project and tags. No title input (title comes from the fact).
- **Learn from this chat:** 🧠 Learn → the chat box is filled with a prompt asking the current AI to list durable facts about the user between `=== MEMORY START ===` / `=== MEMORY END ===`, one per line: `- category | key | fact`. The prompt lists existing keys so the AI reuses a key when a fact changed. The user presses Enter; the reply is watched (same watcher as Capsules, with memory markers); found facts go to the **inbox**.
- **Inbox** (`memoryInbox`, at most 50, newest kept): cards at the top of Memory with ✅ Save / ❌ Ignore, plus Save all. Saving a fact whose `key` matches a stored memory **replaces** that memory (same id), so "I moved to Vue" updates "uses React". Toast: `Updated: …` or `Saved: …`.
- **Secret guard:** a fact that looks like a secret (API keys, private keys, JWTs, `password: …`, card numbers passing Luhn) is never stored: dropped from Learn results, refused on save and on import (`Looks like a secret: not saved`).
- **💉 Inject memory:** inserts every memory currently shown (search and project filter apply), as:
  ```text
  About me (saved memory). Use it as background; do not repeat it back.
  - Favorite fruit is mango
  - Building ShopEasy, a React shop app
  ```
  The cost line (`~120 tokens · 0.1% of window`) shows next to the button. Ticking a few still works (existing multi-insert), with the same format.
- Card shows the fact (not a separate title), category chip, source, date; Insert / Copy / Edit / Delete / Pin as today. No "Update" (that is for Capsules).

## Rename: AI Super Powers
User-visible names only: `manifest.json` name / short_name (`Super Powers`) / action title, side panel `<title>`, the sidebar badge tooltip, export file `app` id (`ai-super-powers`; import does not check it, so old files still import), package name and store zip name, README / PRIVACY / CHROMEWEBSTORE / CHANGELOG headings. Internal comment headers and log prefixes stay (not user-visible; churn without value).

## Phases
| Phase | What | This plan? |
|---|---|---|
| 1 | Rename, Brain section, Memory (manual + inject + secret guard) | ✅ |
| 2 | Learn from this chat + inbox + update-by-key | ✅ |
| 3 | Auto-learn: regex pre-filter on the user's own messages + Chrome built-in AI (Prompt API, on-device) → inbox; falls back to the Learn button. Import ChatGPT saved memories (already fetched by `conversation-client.js`) into the inbox | later plan |
| 4 | Auto-inject (opt-in): prefill memory on a new chat; 🧠 button in the in-page widget; "Continue in another AI" (Capsule + memory in one go) | later plan |
| 5 | Cross-device: opt-in `chrome.storage.sync` for memories. Optional MCP companion for desktop apps / IDEs (separate product) | later |

## Privacy and store
- PRIVACY.md: stored data adds memories (fact, category, key, dates) and the inbox; Learn only fills the chat box, the user sends it; the secret guard.
- No new permissions in phases 1–2.

## Testing
- `tests/unit/memory.test.js`: `looksSecret`, `buildMemoryPrompt`, `parseMemories`, inbox add / cap / remove, `formatMemoriesForInsert`, `approveMemory` (new vs update-by-key).
- `tests/unit/capsule.test.js`: store keeps `category` / `key`, the `reject` hook on save and import, `parseCapsule` / `readLatestCapsule` with custom markers.
- `tests/unit/panel-channel.test.js`: `watchCapsule` options reach the tab.
- `npm run build`, `npm test`, `npm run lint`, `npm run validate`; manual check on all three sites: add, learn, approve, update-by-key, inject with cost, secret refused.

## Out of scope
Auto-learn, auto-inject, sync, MCP (later phases); memory history / undo of a replaced fact; semantic search; a Projects tab.
