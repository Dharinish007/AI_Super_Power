# 🧠 AI Context Monitor: Version 1 Features

> A personal overview: what each feature is, and my rating of it.
> Works on **ChatGPT · Claude · Gemini**. Everything runs locally in your browser.

**Ratings:** ⭐⭐⭐⭐⭐ standout · ⭐⭐⭐⭐ strong · ⭐⭐⭐ good · ⭐⭐ basic

---

## 📊 1. Context Tab: the core feature

| Feature | What it is | Rating |
|---|---|---|
| 🎯 **Context meter** | Shows how much of the model's memory (context window) the chat uses, e.g. `61K / 256K · 24%` | ⭐⭐⭐⭐⭐ |
| 🤖 **Model detection** | Detects which model you're on and looks up its real limit | ⭐⭐⭐⭐ |
| 🔢 **Token counting** | Counts tokens locally: `o200k` for ChatGPT and Claude, Gemma 4 for Gemini | ⭐⭐⭐⭐ |
| 🏷️ **Truth labels** | Every row is marked **EXACT / OBSERVED / ESTIMATED / UNKNOWN**, with a "why" tooltip | ⭐⭐⭐⭐⭐ |
| 🧩 **Breakdown** | Splits usage into conversation, files, tools, memory and hidden system prompt | ⭐⭐⭐⭐ |
| 🕵️ **Hidden context estimate** | Estimates the invisible system prompt instead of pretending it's zero | ⭐⭐⭐⭐ |
| 📎 **Attachments list** | Lists the files and images in the chat, with estimated cost | ⭐⭐⭐ |
| 🛠️ **Tool detection** | Shows when web search, code tools or apps were used | ⭐⭐⭐ |
| 🔍 **Confidence engine** | Combines page and network data and resolves conflicts between them | ⭐⭐⭐⭐ |

💬 **Verdict:** this is the heart of the extension, and its honesty about what it can't see is the main thing that sets it apart from other tools.

---

## 🚦 2. Warnings & Insights

| Feature | What it is | Rating |
|---|---|---|
| 🔔 **Usage alerts** | Warns you at **80%** and **95%** | ⭐⭐⭐⭐ |
| ⏳ **"~N exchanges left"** | Predicts how many more back-and-forths fit, based on your last 5 | ⭐⭐⭐⭐⭐ |
| 📈 **Growth sparkline** | A small chart of how the chat has grown | ⭐⭐⭐ |
| 🐘 **Biggest messages** | Shows which messages eat the most tokens | ⭐⭐⭐⭐ |
| 🚫 **Plan / usage limits** | Shows plan tier and message caps, e.g. the Claude 5-hour limit | ⭐⭐⭐⭐ |

💬 **Verdict:** practical. "Exchanges left" is the feature people will actually look at most.

---

## 💊 3. Capsules: carry a chat into a new one

| Feature | What it is | Rating |
|---|---|---|
| ✍️ **Create Capsule** | The AI writes a summary of your chat (or a selected part), and you edit and save it | ⭐⭐⭐⭐⭐ |
| ➡️ **Insert anywhere** | Pastes the Capsule into ChatGPT, Claude or Gemini (it fills the box and never auto-sends) | ⭐⭐⭐⭐⭐ |
| ⚡ **Quick (no AI)** | Builds a Capsule straight from the page when you've hit the limit | ⭐⭐⭐⭐ |
| 🔀 **Make in another AI** | Limit reached? Hands the chat to another AI to write the Capsule | ⭐⭐⭐⭐ |
| 🔄 **Update** | Refreshes an old Capsule with your new progress | ⭐⭐⭐⭐ |
| 💰 **Insert cost** | Each card shows `~1.2K tokens · 0.6% of window`, and turns red if it won't fit | ⭐⭐⭐⭐⭐ |

💬 **Verdict:** the second big selling point. It solves the "chat got too long, start over" problem cleanly.

---

## 📚 4. Library: your saved notes

| Feature | What it is | Rating |
|---|---|---|
| 🔎 **Search** | Every word must match; `#tag` searches tags only | ⭐⭐⭐⭐ |
| 🏷️ **Tags & projects** | Organize notes and filter by project | ⭐⭐⭐⭐ |
| 📌 **Pin** | Keeps favourites on top | ⭐⭐⭐ |
| ☑️ **Multi-insert** | Tick several notes and insert them together, with a total token budget | ⭐⭐⭐⭐⭐ |
| 💾 **Export / Import** | Backs up and restores notes as JSON | ⭐⭐⭐ |

💬 **Verdict:** a solid start toward the "second brain" idea (Brain v1.1).

---

## 🧰 5. Skills: reusable instructions

| Feature | What it is | Rating |
|---|---|---|
| 📜 **Skills** | Saved instructions such as "answer concisely" that you insert into any AI | ⭐⭐⭐⭐ |
| 🎁 **Starter Skills** | 3 ready-made ones to start with | ⭐⭐⭐ |
| 🧷 **Combine** | A Capsule and a Skill go in one message as separate paragraphs | ⭐⭐⭐⭐ |

💬 **Verdict:** handy, and it works the same across all 3 AIs.

---

## 📤 6. Export & Extras

| Feature | What it is | Rating |
|---|---|---|
| 📝 **Chat export** | Saves the whole chat as Markdown, text or JSON | ⭐⭐⭐⭐ |
| 🏁 **Toolbar badge** | Shows the % on the extension icon | ⭐⭐⭐ |
| 📍 **Sidebar badges** | Usage shown next to chats in the sidebar | ⭐⭐⭐ |
| 🪟 **Draggable widget** | A floating panel you can move anywhere | ⭐⭐⭐⭐ |
| 🩺 **Diagnostics** | Shows what was detected and why (for debugging) | ⭐⭐⭐ |

---

## 🔒 7. Privacy & Quality

| Item | Status | Rating |
|---|---|---|
| 🏠 **100% local** | No server, no API key, no tracking | ⭐⭐⭐⭐⭐ |
| ✅ **Tests** | 789 passing, 0 failing | ⭐⭐⭐⭐⭐ |
| 🧹 **Lint + CI** | ESLint is clean and GitHub Actions builds the store zip | ⭐⭐⭐⭐ |
| 📄 **Store ready** | Privacy policy and store listing are written | ⭐⭐⭐⭐ |

---

## 🏆 Overall Verdict

**⭐⭐⭐⭐½ out of 5.** This is a polished, honest, well-tested product.

- 💪 **Strongest:** honest context meter · exchanges left · Capsules with token cost
- ⚠️ **Weakest:** it depends on the ChatGPT, Claude and Gemini page layouts, so a site redesign can break it, and model limits need manual updates
- 🚀 **Missing for v1.1:** rename the tab to "Brain", add the "Save to Brain" card at 65% usage, bump the version, publish to the Chrome Web Store
