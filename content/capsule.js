/**
 * Context Monitor - Capsule
 *
 * A Capsule is the useful context of one conversation, written by the AI the user is already in, saved
 * locally and inserted into any supported AI so the user never re-explains it.
 *
 *   buildCapsulePrompt  text placed in the chat box (the user presses Enter; nothing is sent for them)
 *   chatLimitReached    the site's limit blocks chatting: the AI cannot write the Capsule here
 *   buildQuickCapsule   Capsule built from the page without any AI (always works)
 *   saveHandoff / …     hand-off: the prompt plus the conversation, pasted into another AI to write it
 *   parseCapsule        Capsule between the START / END markers of a reply (or a whole reply, loose)
 *   readLatestCapsule   newest Capsule among the latest assistant replies on the page
 *   formatForInsert     what Insert puts in the chat box
 *   CapsuleStore        list / save / remove / importMany in chrome.storage.local (one list shared by all sites)
 *   exportCapsules      export file text; normalizeCapsule checks each imported Capsule
 *   Skills              the same store under SKILLS_KEY: reusable instructions (formatSkillForInsert, STARTER_SKILLS)
 *   Library             tags, project and pin on every item; searchItems, formatManyForInsert (tick several)
 *   insertText          puts text in a site's chat box (rich editor or textarea)
 */

export const CAPSULE_START = '=== CAPSULE START ===';
export const CAPSULE_END = '=== CAPSULE END ===';
export const CAPSULE_MAX_SELECTION = 4000;
export const CAPSULES_KEY = 'capsules';
export const SKILLS_KEY = 'skills';
export const CAPSULE_HANDOFF_KEY = 'capsuleHandoff';
/** Memory categories (content/memory.js); the shared store keeps `category` / `key` only when valid. */
export const MEMORY_CATEGORIES = ['profile', 'preference', 'project', 'instruction', 'skill', 'decision', 'other'];
// Hand-off conversation size: ~15K tokens, fits even Gemini's free 32K window with room for the reply
export const CAPSULE_MAX_TRANSCRIPT = 60000;
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;
// Quick Capsule (no AI): what is kept from the chat
const QUICK_TURNS = 6;
const QUICK_GOAL_CHARS = 600;
const QUICK_TURN_CHARS = 800;
const QUICK_SNIPPETS = 5;
const QUICK_SNIPPET_CHARS = 1500;
const CAPSULE_TITLE_MAX = 80;
const CAPSULE_MAX_BODY = 100000; // Imported Capsules are cut to this
// Only the newest replies can hold the Capsule just asked for
const CAPSULE_REPLIES_SCANNED = 3;

/**
 * Prompt asking the current AI to write the Capsule. Four-backtick fence: the Capsule may contain
 * ``` code, and text inside a code block keeps its headings and line breaks on every site.
 * @param {string} [selection] Chat text the user selected: the Capsule then focuses on it
 * @param {string} [transcript] Hand-off: a conversation from another chat (formatTranscript) to summarize
 * @param {{ title: string, body: string }|null} [previous] Update: an earlier Capsule to bring up to date
 * @returns {string}
 */
export function buildCapsulePrompt(selection = '', transcript = '', previous = null) {
  let focus = String(selection || '').trim();
  if (focus.length > CAPSULE_MAX_SELECTION) focus = `${focus.slice(0, CAPSULE_MAX_SELECTION)} […]`;
  const intro = previous
    ? 'Update the Capsule between the <previous-capsule> tags below with what happened in this conversation since it was written. Keep what is still true, change what changed, drop what is obsolete, and add new decisions and progress. It must stay a compact, self-contained brief that lets a different AI continue this work.'
    : transcript
      ? 'Create a Capsule of the conversation between the <conversation> tags below (it comes from another chat): a compact, self-contained brief that lets a different AI continue that work without seeing the chat.'
      : 'Create a Capsule of this conversation: a compact, self-contained brief that lets a different AI continue this work without seeing our chat.';
  return [
    intro,
    ...(focus ? ['', 'Focus only on this part of the conversation (use the rest only to understand it):', '"""', focus, '"""'] : []),
    '',
    'Rules:',
    '- Keep exact names, numbers, file paths, commands, code and decisions. Do not invent anything.',
    '- Skip small talk and dead ends (unless a dead end is worth avoiding).',
    '- Leave out a section if it would be empty.',
    '- Reply with only one code block fenced with four backticks (````), in exactly this format:',
    '',
    '````',
    CAPSULE_START,
    'Title: <up to 8 words>',
    '## Goal',
    '## Key decisions',
    '## Constraints & preferences',
    '## Current state',
    '## Open questions / next step',
    '## Key snippets',
    CAPSULE_END,
    '````',
    ...(transcript ? ['', '<conversation>', transcript, '</conversation>', '', 'Now write the Capsule in the format above.'] : []),
    ...(previous ? ['', '<previous-capsule>', `Title: ${previous.title}`, previous.body, '</previous-capsule>', '', 'Now write the updated Capsule in the format above (same title unless the goal changed).'] : [])
  ].join('\n');
}

/**
 * The limit that stops chatting on this site right now, or null: Gemini's "limit reached" notice,
 * a ChatGPT model with no messages left, or a Claude usage window at 100%. Feature allowances (image
 * generation, deep research…) do not stop the chat and are ignored.
 * @param {Array<{ key: string, blocked?: boolean, percent?: number|null }>} [limits] Widget view-state limits
 */
export function chatLimitReached(limits = []) {
  return (limits || []).find(l => l && (
    ((l.key === 'limit' || String(l.key).startsWith('model:')) && l.blocked) ||
    (typeof l.percent === 'number' && l.percent >= 100)
  )) || null;
}

/** Live page text without the button labels of the sites' code blocks and message toolbars. */
export function cleanPageText(s) {
  return String(s || '').split('\n')
    .filter(l => !/^\s*(Copy|Copy code|Copied!|Edit|Retry|Share)\s*$/i.test(l))
    .map(l => l.replace(/\s*\b(Copy code|Copied!)\s*$/i, '')) // "bash Copy code" header -> "bash"
    .join('\n').trim();
}

/**
 * The visible conversation, read live (line breaks kept), in page order. Code blocks are also kept
 * apart for the Quick Capsule's snippets.
 * @param {Document} doc
 * @param {string} userSelector Matches the user's messages
 * @param {string} replySelector Matches assistant replies
 * @returns {Array<{ role: 'user'|'assistant', text: string, code: string[] }>}
 */
export function readTranscript(doc, userSelector, replySelector) {
  if (!doc || !userSelector || !replySelector) return [];
  const nodes = [...doc.querySelectorAll(`${userSelector}, ${replySelector}`)];
  const matched = new Set(nodes);
  const inner = (el) => String(el?.innerText || el?.textContent || '').trim();
  return nodes
    .filter(n => { for (let p = n.parentElement; p; p = p.parentElement) if (matched.has(p)) return false; return true; })
    .map(n => ({
      role: n.matches(replySelector) ? 'assistant' : 'user',
      text: cleanPageText(inner(n)),
      code: [...n.querySelectorAll('pre')].map(pre => inner(pre.querySelector('code') || pre)).filter(Boolean)
    }))
    .filter(m => m.text);
}

/**
 * Conversation as plain text for a hand-off prompt, at most `max` characters: the first message
 * (usually the goal) plus as many of the latest as fit.
 * @param {Array<{ role: string, text: string }>} messages
 */
export function formatTranscript(messages, max = CAPSULE_MAX_TRANSCRIPT) {
  const turns = (messages || []).map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text}`);
  if (!turns.length) return '';
  const first = turns[0].slice(0, Math.floor(max / 4));
  const kept = [];
  let size = first.length;
  for (let i = turns.length - 1; i > 0; i--) {
    if (size + turns[i].length + 2 > max) {
      const room = max - size - 10;
      if (!kept.length && room > 0) kept.unshift(`[…] ${turns[i].slice(-room)}`); // Newest message alone is too long: keep its end
      break;
    }
    kept.unshift(turns[i]);
    size += turns[i].length + 2;
  }
  const skipped = turns.length - 1 - kept.length;
  return [first, ...(skipped > 0 ? [`[… ${skipped} earlier messages left out …]`] : []), ...kept].join('\n\n');
}

/**
 * A Capsule built without any AI (for when the site's limit is reached): the goal (first message),
 * the latest turns and the latest code blocks, each cut to size. The user trims it in the editor.
 * @param {Array<{ role: string, text: string, code?: string[] }>} messages From readTranscript
 * @returns {{ title: string, body: string }|null}
 */
export function buildQuickCapsule(messages) {
  if (!messages?.length) return null;
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n)} […]` : s);
  const firstUser = messages.find(m => m.role === 'user');
  const recent = messages.slice(-QUICK_TURNS).map(m => `${m.role === 'user' ? '**You:**' : '**AI:**'} ${cut(m.text, QUICK_TURN_CHARS)}`);
  const code = messages.filter(m => m.role === 'assistant').flatMap(m => m.code || []).slice(-QUICK_SNIPPETS)
    .map(c => `\`\`\`\n${cut(c, QUICK_SNIPPET_CHARS)}\n\`\`\``);
  const body = [
    firstUser && `## Goal\n${cut(firstUser.text, QUICK_GOAL_CHARS)}`,
    `## Recent conversation\n${recent.join('\n\n')}`,
    code.length && `## Key snippets\n${code.join('\n\n')}`
  ].filter(Boolean).join('\n\n');
  const title = (firstUser?.text.split('\n').find(l => l.trim()) || 'Quick Capsule').trim();
  return { title: title.slice(0, 60), body };
}

/**
 * The no-AI Capsule: a selection is used as-is (first line is the title); otherwise it is built from
 * the page's conversation. The transcript is only read when there is no selection.
 * @param {string} selection
 * @param {() => Promise<Array<{ role: string, text: string, code?: string[] }>>} getTranscript
 * @returns {Promise<{ title: string, body: string }|null>}
 */
export async function quickCapsule(selection, getTranscript) {
  return selection
    ? { title: selection.split('\n').find(l => l.trim()).trim().slice(0, 60), body: selection }
    : buildQuickCapsule(await getTranscript());
}

/**
 * Hand-off: a Capsule prompt (with the conversation) waiting in storage until the user opens another
 * AI and clicks Paste & create there. One at a time; a new one replaces the old. Expires after a day.
 */
export async function saveHandoff(area, { prompt, source }) {
  await area.set({ [CAPSULE_HANDOFF_KEY]: { prompt, source, at: Date.now() } });
}

/** @returns {Promise<{ prompt: string, source: string, at: number }|null>} */
export async function readHandoff(area, now = Date.now()) {
  const h = (await area.get(CAPSULE_HANDOFF_KEY))?.[CAPSULE_HANDOFF_KEY];
  return h && typeof h.prompt === 'string' && typeof h.at === 'number' && now - h.at < HANDOFF_TTL_MS ? h : null;
}

export async function clearHandoff(area) {
  await area.remove(CAPSULE_HANDOFF_KEY);
}

/**
 * @param {string} text Reply text
 * @param {{ loose?: boolean }} [opts] loose: no markers needed (the whole reply is the Capsule)
 * @returns {{ title: string, body: string }|null} null when there is no complete Capsule
 */
export function parseCapsule(text, { loose = false } = {}) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  const start = src.indexOf(CAPSULE_START);
  const end = start < 0 ? -1 : src.indexOf(CAPSULE_END, start + CAPSULE_START.length);
  if (!loose && end < 0) return null; // No START, or the reply is still streaming
  let body = src.slice(start < 0 ? 0 : start + CAPSULE_START.length, end < 0 ? undefined : end).trim();
  // A fence the AI put inside the markers (opening and closing pair); fences in Key snippets stay
  const fence = body.match(/^(`{3,})[\w-]*\n/);
  if (fence && body.endsWith(`\n${fence[1]}`)) body = body.slice(fence[0].length, -fence[1].length - 1).trim();

  // Title line: only the first line ("Title: x", "**Title:** x"); a "title:" further down (YAML in a
  // snippet) is content and stays
  let title = '';
  const m = body.match(/^\**title\**:\**[ \t]*(.+)/i);
  if (m) {
    title = m[1];
    body = body.slice(m[0].length).trim();
  }
  if (!body) return null;
  title = (title || body.split('\n').find(l => l.trim()) || '').replace(/^[#\s*"'`]+|[*"'`\s]+$/g, '');
  return { title: title.slice(0, CAPSULE_TITLE_MAX) || 'Untitled Capsule', body };
}

/** Text of the newest assistant reply ('' when none). */
export function latestReplyText(doc, replySelector) {
  if (!doc || !replySelector) return '';
  const replies = doc.querySelectorAll(replySelector);
  const last = replies[replies.length - 1];
  return last ? cleanPageText(last.innerText || last.textContent) : '';
}

/**
 * Newest Capsule in the latest assistant replies. Live innerText (not a detached clone) keeps the
 * reply's line breaks.
 * @param {Document} doc
 * @param {string} replySelector Matches assistant replies (never the user's prompt, which holds the markers too)
 * @param {string|null} [ignoreBody] Body of a Capsule already on the page before this one was asked for
 */
export function readLatestCapsule(doc, replySelector, ignoreBody = null) {
  if (!doc || !replySelector) return null;
  const replies = doc.querySelectorAll(replySelector);
  for (let i = replies.length - 1; i >= Math.max(0, replies.length - CAPSULE_REPLIES_SCANNED); i--) {
    const capsule = parseCapsule(replies[i].innerText || replies[i].textContent);
    if (capsule) return capsule.body === ignoreBody ? null : capsule;
  }
  return null;
}

/**
 * What inserting a Capsule costs here: "~1.2K tokens · 0.8% of window". Tokens are an estimate
 * (local tokenizer), so always "~". tooBig: more than the room left in this chat.
 * @param {number} tokens
 * @param {number|null} [contextLimit] This chat's context window
 * @param {number|null} [remaining] Tokens left in this chat
 */
export function formatCost(tokens, contextLimit = null, remaining = null) {
  const n = Math.max(0, Math.round(tokens || 0));
  let text = `~${n < 1000 ? n : `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`} tokens`;
  if (contextLimit > 0) {
    const p = (n / contextLimit) * 100;
    text += ` · ${p < 0.1 ? '<0.1' : p < 10 ? p.toFixed(1) : Math.round(p)}% of window`;
  }
  return { text, tooBig: Number.isFinite(remaining) && n > remaining };
}

/** @param {{ title: string, body: string }} capsule */
export function formatForInsert(capsule) {
  return `Context from an earlier AI conversation (Capsule: ${capsule.title}). Use it as background for what I ask next.\n\n${capsule.body}`;
}

/** A Skill is an instruction for how the AI should answer; it applies to the rest of the chat. */
export function formatSkillForInsert(skill) {
  return `Follow these instructions for the rest of this chat (Skill: ${skill.title}):\n\n${skill.body}`;
}

/** Shown the first time the Skills tab opens; the user can edit or delete them. */
export const STARTER_SKILLS = [
  {
    id: 'starter-code-review',
    title: 'Code reviewer',
    body: 'Review my code like a senior developer.\n- List real bugs first, with the line and a fix.\n- Then security and performance problems.\n- Then up to 3 improvements that matter.\nBe short. Do not rewrite the whole file unless I ask.'
  },
  {
    id: 'starter-explain-simply',
    title: 'Explain simply',
    body: 'Explain like I am new to this topic.\n- Short sentences, everyday words, no jargon (or explain it in one line).\n- Start with the main idea, then one small example.\n- End with a one-line summary.'
  },
  {
    id: 'starter-step-by-step',
    title: 'Step-by-step answers',
    body: 'Answer as numbered steps I can follow one by one.\n- One action per step.\n- Put commands and code in code blocks.\n- Say what I should see after each important step.\n- Keep it as short as possible.'
  }
].map(s => ({ ...s, source: 'Starter' }));

const newCapsuleId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** Memory key "category.topic-with-dashes" (topic <= 40 characters), or null. */
export function normalizeMemoryKey(input) {
  if (typeof input !== 'string') return null;
  const [cat, ...rest] = input.trim().toLowerCase().split('.');
  const topic = rest.join('-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return MEMORY_CATEGORIES.includes(cat) && topic ? `${cat}.${topic}` : null;
}

/** Memory-only fields: given ones replace, missing ones are kept; absent when never set (Capsules, Skills). */
function memoryFields(c, old = null) {
  const category = MEMORY_CATEGORIES.includes(c?.category) ? c.category : old?.category;
  const key = c?.key !== undefined ? normalizeMemoryKey(c.key) : old?.key;
  return { ...(category ? { category } : {}), ...(key ? { key } : {}) };
}

/**
 * Capsules (or Skills) in a chrome.storage area, newest first: { id, title, body, source, createdAt, updatedAt }.
 * ponytail: read-modify-write of one list; two tabs saving in the same instant can drop one save.
 * Per-item keys if that ever shows up.
 */
export class CapsuleStore {
  /**
   * @param {{ get: Function, set: Function }} area chrome.storage.local (or a fake with the same API)
   * @param {{ key?: string, noun?: string, plural?: string, reject?: ((item: Object) => string|null)|null }} [opts]
   *   Storage key, item name ('Capsule' / 'Skill' / 'Memory') and its plural for defaults, errors and the
   *   export file; `reject` refuses an item (save throws its message, import skips it)
   */
  constructor(area, { key = CAPSULES_KEY, noun = 'Capsule', plural = `${noun}s`, reject = null } = {}) {
    this.area = area;
    this.key = key;
    this.noun = noun;
    this.plural = plural;
    this.reject = reject;
  }

  async list() {
    const r = await this.area.get(this.key);
    const list = r?.[this.key];
    return Array.isArray(list) ? list : [];
  }

  /** Stores `defaults` only if this list was never written (a list the user emptied stays empty). */
  async seed(defaults, now = Date.now()) {
    const r = await this.area.get(this.key);
    if (r && this.key in r) return false;
    await this.area.set({ [this.key]: defaults.map(d => ({ ...d, createdAt: now, updatedAt: now })) });
    return true;
  }

  /** New when `capsule.id` is not stored yet; otherwise replaces it (keeps createdAt). */
  async save(capsule) {
    const body = String(capsule.body || '').trim();
    if (!body) throw new Error(`${this.noun} is empty`);
    const list = await this.list();
    const now = Date.now();
    const i = capsule.id ? list.findIndex(c => c.id === capsule.id) : -1;
    const old = i >= 0 ? list[i] : null;
    const item = {
      id: old ? old.id : newCapsuleId(),
      title: String(capsule.title || '').trim().slice(0, CAPSULE_TITLE_MAX) || `Untitled ${this.noun}`,
      body,
      source: capsule.source || old?.source || 'AI',
      // Library fields: given ones replace, missing ones are kept (Update and Edit keep tags and pin)
      tags: normalizeTags(capsule.tags ?? old?.tags),
      project: normalizeProject(capsule.project !== undefined ? capsule.project : old?.project),
      pinned: Boolean(capsule.pinned ?? old?.pinned),
      ...memoryFields(capsule, old),
      createdAt: old ? old.createdAt : now,
      updatedAt: now
    };
    const why = this.reject?.(item);
    if (why) throw new Error(why);
    if (i >= 0) list[i] = item; else list.unshift(item);
    await this.area.set({ [this.key]: list });
    return item;
  }

  /** Pin or unpin; not an edit, so updatedAt (which import merges by) is unchanged. */
  async setPinned(id, pinned) {
    const list = await this.list();
    const item = list.find(c => c.id === id);
    if (!item) return;
    item.pinned = Boolean(pinned);
    await this.area.set({ [this.key]: list });
  }

  async remove(id) {
    const list = await this.list();
    await this.area.set({ [this.key]: list.filter(c => c.id !== id) });
  }

  /**
   * Merges an export file: unknown ids are added, a known id is replaced only by a newer copy
   * (updatedAt). Invalid entries are skipped, never partially saved. One write for the whole file.
   * @param {string} json Text of a file from exportCapsules (or a bare array of Capsules)
   * @returns {Promise<{ added: number, updated: number, skipped: number }>}
   * @throws {Error} 'Not a Capsules file' (or Skills) when the text is not JSON or holds no such list
   */
  async importMany(json, now = Date.now()) {
    let data;
    const wrong = `Not a ${this.plural} file`;
    try { data = JSON.parse(json); } catch (e) { throw new Error(wrong, { cause: e }); }
    const items = Array.isArray(data) ? data : data?.[this.key];
    if (!Array.isArray(items)) throw new Error(wrong);
    const list = await this.list();
    const byId = new Map(list.map((c, i) => [c.id, i]));
    const counts = { added: 0, updated: 0, skipped: 0 };
    for (const raw of items) {
      const c = normalizeCapsule(raw, now, this.noun);
      const i = c ? byId.get(c.id) : undefined;
      if (!c || this.reject?.(c) || (i !== undefined && !(c.updatedAt > list[i].updatedAt))) { counts.skipped++; continue; }
      if (i !== undefined) { list[i] = c; counts.updated++; } else { byId.set(c.id, list.length); list.push(c); counts.added++; }
    }
    list.sort((a, b) => b.createdAt - a.createdAt);
    if (counts.added || counts.updated) await this.area.set({ [this.key]: list });
    return counts;
  }
}

/** Export file text: every Capsule (or Skill: key 'skills'), newest first. */
export function exportCapsules(list, key = CAPSULES_KEY) {
  return JSON.stringify({ app: 'ai-super-powers', version: 1, exportedAt: Date.now(), [key]: list }, null, 2);
}

/**
 * A Capsule from an untrusted source (an import file), or null when unusable. Strings are capped,
 * a missing or odd id gets a new one, missing dates become `now`.
 */
export function normalizeCapsule(raw, now = Date.now(), noun = 'Capsule') {
  if (!raw || typeof raw !== 'object' || typeof raw.body !== 'string' || !raw.body.trim()) return null;
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const time = (v) => (Number.isFinite(v) && v > 0 ? v : now);
  const createdAt = time(raw.createdAt);
  return {
    id: typeof raw.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : newCapsuleId(),
    title: str(raw.title, CAPSULE_TITLE_MAX) || `Untitled ${noun}`,
    body: raw.body.trim().slice(0, CAPSULE_MAX_BODY),
    source: str(raw.source, 20) || 'Import',
    tags: normalizeTags(raw.tags),
    project: normalizeProject(raw.project),
    pinned: raw.pinned === true,
    ...memoryFields(raw),
    createdAt,
    updatedAt: Math.max(createdAt, time(raw.updatedAt))
  };
}

const TAGS_MAX = 10;
const TAG_CHARS = 30;
const PROJECT_CHARS = 40;

/**
 * Tags from the editor ("work, #Auth") or a stored / imported array: lowercase, no '#' or ',',
 * at most 30 characters each, at most 10, no duplicates. Anything else gives [].
 * @param {string|string[]|undefined} input
 * @returns {string[]}
 */
export function normalizeTags(input) {
  const raw = typeof input === 'string' ? input.split(',') : Array.isArray(input) ? input : [];
  const out = [];
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const tag = t.replace(/[#,]/g, '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, TAG_CHARS);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length === TAGS_MAX) break;
  }
  return out;
}

/** Project name (≤ 40 characters), or null for none. */
export function normalizeProject(input) {
  return typeof input === 'string' && input.trim() ? input.trim().slice(0, PROJECT_CHARS) : null;
}

/** Projects in use, A-Z (for the filter and the editor's suggestions). */
export function projectsOf(items) {
  return [...new Set((items || []).map(c => c.project).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * Library search. Every term must match (title, tags, project or text); `#tag` matches tags only.
 * Order: pinned first, then best match (title 3, tag or project 2, text 1 per term), then newest.
 * An empty query lists everything, pinned first, newest first.
 * @param {Array} items Saved Capsules or Skills
 * @param {string} [query]
 * @param {{ project?: string|null }} [opts] Only this project
 */
export function searchItems(items, query = '', { project = null } = {}) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];
  for (const c of items || []) {
    if (project && c.project !== project) continue;
    const tags = c.tags || [];
    let score = 0;
    let all = true;
    for (const term of terms) {
      if (term.startsWith('#') && term.length > 1) {
        const t = term.slice(1);
        if (tags.some(tag => tag.startsWith(t))) score += 2; else { all = false; break; }
        continue;
      }
      const s = (String(c.title || '').toLowerCase().includes(term) ? 3 : 0) +
        (tags.some(tag => tag.includes(term)) || String(c.project || '').toLowerCase().includes(term) ? 2 : 0) +
        (String(c.body || '').toLowerCase().includes(term) ? 1 : 0);
      if (!s) { all = false; break; }
      score += s;
    }
    if (all) scored.push({ c, score });
  }
  return scored
    .sort((a, b) => (b.c.pinned ? 1 : 0) - (a.c.pinned ? 1 : 0) || b.score - a.score || (b.c.updatedAt || 0) - (a.c.updatedAt || 0))
    .map(x => x.c);
}

/**
 * One insert for several ticked items: a header line, then each as "### title" + text. A single item
 * keeps its usual wording.
 * @param {Array<{ title: string, body: string }>} items
 * @param {'capsule'|'skill'} [kind]
 */
export function formatManyForInsert(items, kind = 'capsule') {
  const list = items || [];
  if (list.length === 1) return kind === 'skill' ? formatSkillForInsert(list[0]) : formatForInsert(list[0]);
  const parts = list.map(c => `### ${c.title}\n${c.body}`).join('\n\n');
  return kind === 'skill'
    ? `Follow these instructions for the rest of this chat (Skills: ${list.map(c => c.title).join(', ')}):\n\n${parts}`
    : `Context from earlier AI conversations (${list.length} Capsules). Use it as background for what I ask next.\n\n${parts}`;
}

/**
 * Appends text to a chat box. Rich editors (ProseMirror on ChatGPT / Claude, Quill on Gemini) take a
 * plain-text paste as typed paragraphs and cancel the event when they handle it; otherwise
 * execCommand('insertText'); a <textarea> gets its value set the way React notices.
 * @param {HTMLElement|null} el
 * @param {string} text
 * @returns {boolean} false when nothing took the text (the caller copies it instead)
 */
export function insertText(el, text) {
  if (!el) return false;
  el.focus?.();
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'INPUT') {
    const next = el.value ? `${el.value}\n\n${text}` : text;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    if (setter) setter.call(el, next); else el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
  // Text already in the box (a draft, or a Capsule inserted before a Skill) stays a separate paragraph
  if (String(el.textContent || '').trim()) text = `\n\n${text}`;
  // Caret to the end, so a draft the user already typed stays first
  try {
    const sel = doc?.defaultView?.getSelection?.();
    if (sel && doc.createRange) {
      const range = doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch (_) {}
  try {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    if (!el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))) return true;
  } catch (_) {}
  try { return Boolean(doc?.execCommand?.('insertText', false, text)); } catch (_) { return false; }
}

/**
 * The Capsule widget's one click. 'ask-ai' fills the chat box with the Capsule prompt (the user sends
 * it) and saves the Capsule found in the reply; 'quick' builds it from the page and saves at once.
 * When the site's limit is reached, 'ask-ai' cannot work and Quick is used instead.
 * @param {{ method: 'ask-ai'|'quick', page: Object, store: CapsuleStore, onStatus: (s: Object) => void }} o
 * @returns {Promise<{ cancel: () => void }>}
 */
export async function captureCapsule({ method, page, store, onStatus }) {
  const none = { cancel() {} };
  if (!(await page.hasConversation())) { onStatus({ state: 'error', text: 'Open a conversation first' }); return none; }
  const selection = await page.takeSelection();
  const limit = await page.limitReached();
  const save = async (capsule, quick, reason) => {
    try {
      const saved = await store.save({ ...capsule, source: page.provider });
      onStatus({ state: 'saved', title: saved.title, quick, ...(reason ? { reason } : {}) });
    } catch (_) { onStatus({ state: 'error', text: 'Save failed' }); }
  };
  if (method === 'quick' || limit) {
    const capsule = await quickCapsule(selection, () => page.transcript());
    if (!capsule) { onStatus({ state: 'error', text: 'Open a conversation first' }); return none; }
    await save(capsule, true, limit && method !== 'quick' ? 'limit' : undefined);
    return none;
  }
  if (!(await page.fill(buildCapsulePrompt(selection)))) { onStatus({ state: 'error', text: 'Chat box not found' }); return none; }
  const stop = await page.watchCapsule((capsule) => save(capsule, false));
  onStatus({ state: 'waiting' });
  return { cancel() { stop(); onStatus({ state: 'cancelled' }); } };
}
