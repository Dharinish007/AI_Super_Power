# Chrome Web Store Listing & Compliance

## 1. Extension Metadata

- **Name:** AI Context Monitor
- **Short Name:** Context Monitor
- **Version:** 1.0.0
- **Primary Category:** Productivity
- **Secondary Category:** Developer Tools
- **Default Language:** English
- **Single-Purpose Statement:** Shows how much of the AI model's context window the current conversation uses on ChatGPT, Claude and Gemini, computed locally in the browser.

> Naming: "ChatGPT", "Claude" and "Gemini" are trademarks of their owners and are used only to describe compatibility. They must not appear in the extension name, icon or as the leading word of the listing title.

---

## 2. Store Listing Copy

### Summary (132 characters max)
See how much of the context window your ChatGPT, Claude or Gemini chat uses. Computed locally; hidden context is marked unknown.

### Detailed Description
AI Context Monitor shows a compact meter on ChatGPT, Claude and Gemini with how much of the model's context window the current conversation uses.

Key Features:
- Context meter: estimated conversation tokens against the context window of the detected model and plan. Limits come from a dated table bundled with the extension, sourced from each provider's public pricing and help pages.
- Truth-in-measurement: every value is labelled EXACT, OBSERVED, ESTIMATED or UNKNOWN. Hidden system instructions, tool schemas and retrieved memory text are never guessed.
- Plan usage limits (Claude): session and weekly usage percentages as claude.ai reports them.
- Itemized breakdown: user messages, assistant replies, attachments, tool activity and hidden context the page exposes.
- Non-intrusive widget: a draggable in-page meter that updates during streaming without slowing the page. The toolbar icon shows or hides it.
- Local and private: all reading, tokenizing and calculating happens in your browser. Nothing is sent to the developer or any third party, and there is no analytics.

---

## 3. Permissions Justifications

Every declared permission serves a single necessary purpose.

### `storage`
- **Justification:** Saves widget preferences (position, expanded state and theme, per site) and the last plan-usage percentages in `chrome.storage.local`. Nothing else is stored: no message text and no conversation IDs.

### Host Permission: `https://chatgpt.com/*` and `https://chat.openai.com/*`
- **Justification:** Runs the content script on ChatGPT to read the open conversation, detect the model and plan, and draw the context meter. It reads the conversation through ChatGPT's own same-origin endpoints (`/api/auth/session`, `/backend-api/conversation/{id}`, `/backend-api/memories`). Those are the same requests the page itself makes, sent only to ChatGPT.

### Host Permission: `https://claude.ai/*`
- **Justification:** Runs the content script on Claude to read the open conversation, the active model and plan, and the plan usage limits, and to draw the context meter. It reads them through claude.ai's own same-origin, cookie-authenticated endpoints (`/api/organizations/...`, `/api/account`, `/api/account_profile`, project and usage endpoints) and from usage events in the page's own reply stream. Requests go only to claude.ai.

### Host Permission: `https://gemini.google.com/*`
- **Justification:** Runs the content script on Gemini to read the visible conversation and the selected model from the page and draw the context meter. No network requests are made on Gemini.

---

## 4. Privacy & Data Handling Disclosures

- **Does the extension collect personally identifiable information (PII)?** No. Nothing is collected by the developer.
- **Does the extension read authentication cookies or tokens?** **Yes, in memory only, and only to call the site's own API.**
  - ChatGPT: reads the session access token from the same-origin `/api/auth/session` response and the `oai-did` device-id cookie, and attaches them to requests sent only to chatgpt.com (ChatGPT's `/backend-api` rejects cookie-only requests). The token is held in a private in-memory field. It is never stored, logged, sent elsewhere, or included in extension state or diagnostics.
  - Claude: reads the `lastActiveOrg` cookie to know which organization's conversation to load. Requests use the browser's normal cookies and go only to claude.ai.
  - Gemini: none.
- **Does the extension read personal communications or user content?** Yes, locally. It reads the open conversation, and on ChatGPT the saved memories and on Claude the profile and project instructions, only to count tokens. The text never leaves the page: only the utilization percentage reaches the background worker (for the toolbar badge).
- **Does the extension transmit user messages or files to any external server?** No. The only network requests go to the site the user is on.
- **Does the extension use analytics or tracking beacons?** No.
- **Is user data sold or transferred to third parties?** No.

### Data Usage form (Chrome Web Store dashboard)
- Data types to tick: **Authentication information** (session token, handled in memory as above) and **Personal communications** (conversation text, processed locally).
- Certify: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.
- A privacy policy URL is required once these boxes are ticked.

---

## 5. Visual Asset Checklist

- [x] Extension Icon (16x16 px) — `assets/icons/icon-16.png`
- [x] Extension Icon (48x48 px) — `assets/icons/icon-48.png`
- [x] Extension Icon (128x128 px) — `assets/icons/icon-128.png`
- [ ] Promotional Tile (440x280 px)
- [ ] Screenshot 1 (1280x800 px) — collapsed status bar on a ChatGPT conversation
- [ ] Screenshot 2 (1280x800 px) — widget expanded with the full context breakdown
- [ ] Screenshot 3 (1280x800 px) — widget on Claude showing plan usage limits
- [ ] Privacy policy URL: publish `PRIVACY.md` (e.g. https://github.com/Dharinish007/ChatGPT-context-window/blob/main/PRIVACY.md once merged)
