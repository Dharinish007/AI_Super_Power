# AI Super Powers: Privacy Policy

_Last updated: 2026-10-02_

AI Super Powers is a browser extension that shows how much of the AI model's context window your current conversation uses on ChatGPT, Claude and Gemini. All of its work happens inside your browser.

## What the extension reads

| Site | What it reads | Why |
| :--- | :--- | :--- |
| ChatGPT (chatgpt.com, chat.openai.com) | The open conversation, your saved memories, model and plan, through ChatGPT's own same-origin API. Your session access token (from `/api/auth/session`) and the `oai-did` cookie are read to make those requests. | To count tokens and find the right context window. ChatGPT's API rejects requests without the token. |
| Claude (claude.ai) | The open conversation, model, plan, profile and project settings, and plan usage limits, through claude.ai's own same-origin API and the page's reply stream. The `lastActiveOrg` cookie is read to know which organization to ask. | To count tokens, find the context window, and show your usage limits. |
| Gemini (gemini.google.com) | The open conversation through Gemini's own same-origin read call, and the selected model and plan from the page. The request token the page itself uses (`at`, in the page's HTML) is read to make that request. | To count tokens and find the context window. The page only shows the turns scrolled into view. |

## What it does with that data

- All text is processed locally to count tokens. It never leaves the page, and it is stored only when you save a Capsule, Skill or Memory, or when **Learn from this chat** puts a fact in the review inbox (below).
- **Memory:** facts you save are stored in your browser. **Learn from this chat** only puts a prompt in the chat box; you choose whether to send it. When the AI answers, the extension reads that reply to find the facts and puts them in a review inbox (at most 50), where they wait in your browser until you approve (✅) or reject (❌) each one; only approved facts become Memories. **Inject memory** puts saved facts in the chat box, and only you send them. Facts that look like passwords, keys, tokens or card numbers are never stored, and nothing leaves your browser except what you send to the site yourself.
- **Capsules:** when you click Create Capsule, the extension puts a prompt in the site's chat box; you choose whether to send it. When you click Save, that Capsule's title and text are stored in your browser. Insert puts a saved Capsule in the chat box of the site you are on, and only you send it. **Make in another AI** stores the Capsule prompt with the visible conversation in your browser (and copies it) until you paste it into another AI, save the result or dismiss it; it is deleted after a day.
- Network requests go only to the site you are using, the same requests the site makes itself. Nothing is sent to the developer or any third party.
- The ChatGPT session token and the Gemini request token are kept only in memory while the page is open. They are never saved, logged, or included in diagnostics.

## What it stores

- `chrome.storage.local`: Settings (widget choices, Capsule method, display options), widget positions for each site, and your last Claude usage-limit percentages and reset times.
- `chrome.storage.local`: Capsules you saved (title, text, site name, dates). You can edit or delete each one in the Capsules tab.
- `chrome.storage.local`: Memories (fact, category, topic key, project, tags, site name, dates) and the review inbox of learned facts (at most 50). You can edit or delete each one in Brain → Memory.
- `chrome.storage.local`: Skills (instructions you write, plus three starter Skills you can edit or delete).
- A Capsules or Skills file, only when you click Export: it is downloaded to your device by your browser and goes nowhere else. Import reads a file you pick.
- `chrome.storage.local`: at most one pending hand-off (Capsule prompt plus the conversation you chose to hand off), removed when used, dismissed, or after a day.

- `chrome.storage.local`: for the sidebar badges, the usage percentage of up to 200 recent chats per site, keyed by the site's own chat ID (no titles or text).

Nothing else is stored: no other message text, no ChatGPT saved-memory text, tokens or cookies. The toolbar badge receives only the current percentage.

## What it does not do

- No analytics, tracking, advertising or remote logging.
- No selling or sharing of data with anyone.
- No use of data for any purpose other than showing context usage and the Capsules, Skills and Memory you ask for.

## Removing data

Uninstalling the extension deletes everything it stored. The `unlimitedStorage` permission only lifts the browser's size cap on what you save; everything stays on this device.

## Contact

Questions or concerns: open an issue at https://github.com/Dharinish007/ChatGPT-context-window/issues.
