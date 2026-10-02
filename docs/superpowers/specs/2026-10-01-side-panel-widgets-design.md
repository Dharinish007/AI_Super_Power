# Side Panel + Widgets: design

Status: approved 2026-10-01
Builds on: [Capsule v1](2026-10-01-capsule-v1-design.md). Independent of [Brain v1.1](2026-10-01-brain-v1.1-design.md) (the Capsules tab keeps its name here).

## Goal
Move the extension's main UI from the floating in-page widget to a **Chrome Side Panel**, and leave two small **widgets** on the page for quick access. Same features, same purpose. The new layout has to scale: a new feature adds one tab and one settings section, nothing else.

## Principles (unchanged)
- Everything stays local. No server, no API key, no new network requests.
- **Fill, never auto-send.** Every message to the AI is sent by the user pressing Enter.
- Truth-in-measurement labels (EXACT / OBSERVED / ESTIMATED / UNKNOWN) stay on every number.

## Structure
```text
Extension
├── Side Panel                          (opens from the toolbar icon)
│   ├── Context    meter, exchanges left, alerts, usage limits
│   │              ▸ Breakdown           (section, with truth labels)
│   │              ▸ Biggest messages · Growth · Attachments
│   │              ▸ Diagnostics         (collapsed by default)
│   ├── Capsules   create, library, insert, export / import
│   ├── Skills     list, insert, export / import
│   └── ⚙ Settings one section per feature
│
└── Widgets (on the chat page; stay visible when the panel is closed)
    ├── Context    pill → expands to the fields chosen in Settings
    └── Capsule    pill → one-click Capsule using the chosen method
```
Breakdown and Diagnostics are **sections inside Context**, not tabs: they are details of one measurement, and a narrow panel can't hold six tabs.

## What changes for the user
1. **Toolbar icon opens the Side Panel** on the right; the site narrows to make room. Before, the icon showed / hid the floating widget. The badge (`24%`) stays.
2. The floating panel becomes **two small pills** by default stacked in the bottom-right corner. **Each pill is dragged on its own** and remembers its own position per site. Each one can be turned off in Settings; both are **on by default**.
3. **Settings** (gear tab in the panel) holds every option. Changes apply immediately to the panel and the widgets in all tabs.

## Side Panel
- One panel per window. It always shows the **active tab**. Switching tabs switches the content.
- States:
  - **Supported site, live:** full UI.
  - **Supported site, no data yet:** "Reading the conversation…" (the badge is already blank in this state).
  - **Supported site, script missing** (tab opened before install / update): "Reload this page to start".
  - **Any other site:** the Context tab says "Open ChatGPT, Claude or Gemini". Capsules, Skills and Settings stay usable (saved notes are useful anywhere; insert just fails with a toast).
- Tabs are a plain list (`[{ id, label, render }]`). Adding a feature = one entry plus one settings section.
- Width is whatever the user drags it to (Chrome controls it). Layout is single-column and must work from 320 px up.

## Widgets
### Context widget
- **Collapsed:** `5.7K · 2%`, coloured by alert level (green / amber ≥ 65% / red ≥ 85%, same as the badge). A blank dash while awaiting data, never `0`.
- **Click:** expands into a small card showing only the fields ticked in Settings. Click again or press Esc to collapse.
- Fields available: tokens used / window, % of window, model, exchanges left, plan usage limits, alert message. Default: the first four.
- Breakdown and Diagnostics are not widget fields; the card's footer says "More in the side panel".

### Capsule widget
- **Collapsed:** `💊 Capsule`.
- **Click** runs the method chosen in Settings:
  - **Ask this AI** (default): fills the chat box with the Capsule prompt (the selected text, if any, is the focus). The pill shows "Press Enter to send". When the reply arrives it is **saved automatically** with the AI's title, and the pill shows "Saved ✓ · edit in side panel" for a few seconds.
  - **Quick (no AI):** builds the Capsule from the page and saves it at once.
- When the site's limit is already reached, **Ask this AI** cannot work, so the click uses Quick and the pill says so.
- Clicking again while waiting cancels. Editing, inserting and deleting stay in the side panel.

### Opening the panel from a widget
Chrome only opens a side panel from a user gesture in an extension context (toolbar icon, keyboard shortcut, extension page). A click inside the web page may not qualify. **Decision: the widgets do not open the panel**; the text says "side panel" and the toolbar icon opens it. The spike (does `chrome.sidePanel.open()` from the widget's click message work on Chrome 116+?) was not run; it can be revisited, and "edit in side panel" would then become a link.

## Settings
Stored as one object in `chrome.storage.local` (`settings`), read with defaults filled in so older or missing values never break:
```js
{
  widgets: {
    context: { enabled: true, fields: ['tokens', 'percent', 'model', 'exchangesLeft'] },
    capsule: { enabled: true }
  },
  capsule: { method: 'ask-ai' },            // 'ask-ai' | 'quick'
  context: { alerts: true },                // existing 80% / 95% alerts
  display: { theme: 'auto', compact: false, badges: true }
}
```
Sections in the Settings tab: **Widgets** (two toggles + Context field checkboxes), **Capsules** (method), **Context** (alerts). Existing display options from the old widget move here too.

**Own API key** is not an option in this version. It would send the conversation to a third-party API and break the "no API key, no new network requests" promise in `PRIVACY.md` and the store listing. It needs its own spec and privacy decision.

## How the pieces talk
The engine stays in the **content script**: it needs the page and the tokenizer is large. The side panel is a view only.
```text
content script (engine, widgets)  ──STATE──────▶  side panel (renders)
      one runtime port per tab    ◀──CALL────────  (page actions, refresh, diagnostics)
           both read / write chrome.storage.local: settings, capsules, skills
```
- The panel opens **one runtime port per tab**, named `panel` (`content/panel-channel.js`: `servePanel` on the tab side, `connectPanel` on the panel side). There is no `sendMessage` VIEW_STATE / GET_VIEW_STATE.
- The content script already builds the provider-neutral view state (`content/widget-state.js`). The tab **pushes `STATE`** over the port whenever it changes (throttled to 250 ms). No port / no reply = "Reload this page to start".
- The panel sends **`CALL`** for the whitelisted `Page` methods (fill the chat box, read the newest reply, transcript, token counts, limit check) plus `refresh` and `diagnostics`; the tab answers with `REPLY`. `watchCapsule` streams `CAPSULE` events until `STOP_WATCH`.
- Capsules, Skills and Settings are read directly from `chrome.storage.local` by both sides and kept in sync with `storage.onChanged` (already done for Capsules).

## Units
- `sidepanel/sidepanel.html` + `sidepanel/main.js` (bundled by `npm run build` into `sidepanel/sidepanel.js`): tab list, active-tab tracking, empty states, port handling.
- `content/overlay-ui.js` (removed): split into `ui/{dom,styles,capsule-panel,context-view,settings-view}.js` (views shared with the panel) and `content/widgets.js` (the two pills).
- `content/page-actions.js` (new): `createPage(adapter)`, the in-page implementation of the `Page` interface the views use (the panel's version sends each call over the port). There is no `exportChat` action: the panel builds the export from `page.transcript()`.
- `content/settings.js` (new, small): defaults, `readSettings` (merge with defaults), `writeSettings`.
- `content/capsule.js`: add a widget entry point that runs the chosen method and saves automatically. The prompt, parsing and store are unchanged.
- `background/service-worker.js`: `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`; remove the `TOGGLE_OVERLAY` click handler.
- `manifest.json`: `"side_panel": { "default_path": "sidepanel/sidepanel.html" }`, permission `sidePanel` (no install warning), `"minimum_chrome_version": "116"`, version bump.
- `scripts/package-extension.js`: already reads the file list from the manifest; check that it picks up `sidepanel/`.
- `PRIVACY.md`, `CHROMEWEBSTORE.md`: new permission reason; no change to the data handling.

## Migration
- Saved widget position per site → position of the Context widget; the Capsule widget starts at its default position.
- The old "widget hidden" state → both widgets enabled (new default), shown once.
- Capsules, Skills and display options keep their storage keys.

## Testing
- Unit: settings defaults and merge (missing / old / bad values), Context widget field selection, Capsule widget method choice including the limit-reached fallback, the port protocol (`STATE` push, `CALL` / `REPLY`, non-whitelisted calls rejected).
- DOM: side panel renders each state (live, awaiting, reload, unsupported) from fake view states; tab list switching; Settings changes reach a fake widget through a fake `storage.onChanged`.
- All existing tests keep passing. `npm test`, `npm run lint`, `npm run build`, `npm run pack`.
- Manual on all three sites: panel follows tab switches, page narrows correctly, widgets survive panel close, one-click Capsule both methods, insert from panel lands in the right tab.

## Out of scope
- Own API key / external Capsule methods (needs a privacy decision).
- Widgets other than Context and Capsule; user-created widgets.
- Brain v1.1 changes (rename, projects, etc.): separate spec.
- Any new feature or metric.

## Decisions (were open questions)
1. **Each widget is draggable on its own**, with its own saved position per site.
2. A Capsule written by the AI from the widget is **saved automatically**; edit it later in the side panel.
3. Hiding the widgets is in **Settings only**; no menu on the pill.
