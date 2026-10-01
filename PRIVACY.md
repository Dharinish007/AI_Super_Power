# AI Context Monitor: Privacy Policy

_Last updated: 2026-10-01_

AI Context Monitor is a browser extension that shows how much of the AI model's context window your current conversation uses on ChatGPT, Claude and Gemini. All of its work happens inside your browser.

## What the extension reads

| Site | What it reads | Why |
| :--- | :--- | :--- |
| ChatGPT (chatgpt.com, chat.openai.com) | The open conversation, your saved memories, model and plan, through ChatGPT's own same-origin API. Your session access token (from `/api/auth/session`) and the `oai-did` cookie are read to make those requests. | To count tokens and find the right context window. ChatGPT's API rejects requests without the token. |
| Claude (claude.ai) | The open conversation, model, plan, profile and project settings, and plan usage limits, through claude.ai's own same-origin API and the page's reply stream. The `lastActiveOrg` cookie is read to know which organization to ask. | To count tokens, find the context window, and show your usage limits. |
| Gemini (gemini.google.com) | The visible conversation and selected model, from the page only. | To count tokens and find the context window. |

## What it does with that data

- All text is processed locally to count tokens. It never leaves the page, and it is stored only when you save a Capsule (below).
- **Capsules:** when you click Create Capsule, the extension puts a prompt in the site's chat box; you choose whether to send it. When you click Save, that Capsule's title and text are stored in your browser. Insert puts a saved Capsule in the chat box of the site you are on, and only you send it. **Make in another AI** stores the Capsule prompt with the visible conversation in your browser (and copies it) until you paste it into another AI, save the result or dismiss it; it is deleted after a day.
- Network requests go only to the site you are using, the same requests the site makes itself. Nothing is sent to the developer or any third party.
- The ChatGPT session token is kept only in memory while the page is open. It is never saved, logged, or included in diagnostics.

## What it stores

- `chrome.storage.local`: widget position, expanded state, theme and open tab for each site, and your last Claude usage-limit percentages and reset times.
- `chrome.storage.local`: Capsules you saved (title, text, site name, dates). You can edit or delete each one in the Capsules tab.
- A Capsules file, only when you click Export: it is downloaded to your device by your browser and goes nowhere else. Import reads a file you pick.
- `chrome.storage.local`: at most one pending hand-off (Capsule prompt plus the conversation you chose to hand off), removed when used, dismissed, or after a day.

Nothing else is stored: no other message text, no memory text, conversation IDs, tokens or cookies. The toolbar badge receives only the current percentage.

## What it does not do

- No analytics, tracking, advertising or remote logging.
- No selling or sharing of data with anyone.
- No use of data for any purpose other than showing context usage.

## Removing data

Uninstalling the extension deletes everything it stored.

## Contact

Questions or concerns: open an issue at https://github.com/Dharinish007/ChatGPT-context-window/issues.
