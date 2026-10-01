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
 *   CapsuleStore        list / save / remove in chrome.storage.local (one list shared by all sites)
 *   insertText          puts text in a site's chat box (rich editor or textarea)
 */

export const CAPSULE_START = '=== CAPSULE START ===';
export const CAPSULE_END = '=== CAPSULE END ===';
export const CAPSULE_MAX_SELECTION = 4000;
export const CAPSULES_KEY = 'capsules';
export const CAPSULE_HANDOFF_KEY = 'capsuleHandoff';
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
// Only the newest replies can hold the Capsule just asked for
const CAPSULE_REPLIES_SCANNED = 3;

/**
 * Prompt asking the current AI to write the Capsule. Four-backtick fence: the Capsule may contain
 * ``` code, and text inside a code block keeps its headings and line breaks on every site.
 * @param {string} [selection] Chat text the user selected: the Capsule then focuses on it
 * @param {string} [transcript] Hand-off: a conversation from another chat (formatTranscript) to summarize
 * @returns {string}
 */
export function buildCapsulePrompt(selection = '', transcript = '') {
  let focus = String(selection || '').trim();
  if (focus.length > CAPSULE_MAX_SELECTION) focus = `${focus.slice(0, CAPSULE_MAX_SELECTION)} […]`;
  const intro = transcript
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
    ...(transcript ? ['', '<conversation>', transcript, '</conversation>', '', 'Now write the Capsule in the format above.'] : [])
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
  // Live text includes button labels of the sites' code blocks and message toolbars
  const clean = (s) => s.split('\n')
    .filter(l => !/^\s*(Copy|Copy code|Copied!|Edit|Retry|Share)\s*$/i.test(l))
    .map(l => l.replace(/\s*\b(Copy code|Copied!)\s*$/i, '')) // "bash Copy code" header -> "bash"
    .join('\n').trim();
  return nodes
    .filter(n => { for (let p = n.parentElement; p; p = p.parentElement) if (matched.has(p)) return false; return true; })
    .map(n => ({
      role: n.matches(replySelector) ? 'assistant' : 'user',
      text: clean(inner(n)),
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

  let title = '';
  const m = body.match(/^[ \t]*\**title\**:\**[ \t]*(.+)$/im); // "Title: x", "**Title:** x"
  if (m) {
    title = m[1];
    body = (body.slice(0, m.index) + body.slice(m.index + m[0].length)).replace(/^\n+/, '').trim();
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
  return last ? String(last.innerText || last.textContent || '').trim() : '';
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

/** @param {{ title: string, body: string }} capsule */
export function formatForInsert(capsule) {
  return `Context from an earlier AI conversation (Capsule: ${capsule.title}). Use it as background for what I ask next.\n\n${capsule.body}`;
}

const newCapsuleId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/**
 * Capsules in a chrome.storage area, newest first: { id, title, body, source, createdAt, updatedAt }.
 * ponytail: read-modify-write of one list; two tabs saving in the same instant can drop one save.
 * Per-capsule keys if that ever shows up.
 */
export class CapsuleStore {
  /** @param {{ get: Function, set: Function }} area chrome.storage.local (or a fake with the same API) */
  constructor(area) {
    this.area = area;
  }

  async list() {
    const r = await this.area.get(CAPSULES_KEY);
    const list = r?.[CAPSULES_KEY];
    return Array.isArray(list) ? list : [];
  }

  /** New when `capsule.id` is not stored yet; otherwise replaces it (keeps createdAt). */
  async save(capsule) {
    const body = String(capsule.body || '').trim();
    if (!body) throw new Error('Capsule is empty');
    const list = await this.list();
    const now = Date.now();
    const i = capsule.id ? list.findIndex(c => c.id === capsule.id) : -1;
    const item = {
      id: i >= 0 ? list[i].id : newCapsuleId(),
      title: String(capsule.title || '').trim().slice(0, CAPSULE_TITLE_MAX) || 'Untitled Capsule',
      body,
      source: capsule.source || (i >= 0 ? list[i].source : null) || 'AI',
      createdAt: i >= 0 ? list[i].createdAt : now,
      updatedAt: now
    };
    if (i >= 0) list[i] = item; else list.unshift(item);
    await this.area.set({ [CAPSULES_KEY]: list });
    return item;
  }

  async remove(id) {
    const list = await this.list();
    await this.area.set({ [CAPSULES_KEY]: list.filter(c => c.id !== id) });
  }
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
