/**
 * Context Monitor - Capsule
 *
 * A Capsule is the useful context of one conversation, written by the AI the user is already in, saved
 * locally and inserted into any supported AI so the user never re-explains it.
 *
 *   buildCapsulePrompt  text placed in the chat box (the user presses Enter; nothing is sent for them)
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
const CAPSULE_TITLE_MAX = 80;
// Only the newest replies can hold the Capsule just asked for
const CAPSULE_REPLIES_SCANNED = 3;

/**
 * Prompt asking the current AI to write the Capsule. Four-backtick fence: the Capsule may contain
 * ``` code, and text inside a code block keeps its headings and line breaks on every site.
 * @param {string} [selection] Chat text the user selected: the Capsule then focuses on it
 * @returns {string}
 */
export function buildCapsulePrompt(selection = '') {
  let focus = String(selection || '').trim();
  if (focus.length > CAPSULE_MAX_SELECTION) focus = `${focus.slice(0, CAPSULE_MAX_SELECTION)} […]`;
  return [
    'Create a Capsule of this conversation: a compact, self-contained brief that lets a different AI continue this work without seeing our chat.',
    ...(focus ? ['', 'Focus only on this part of our conversation (use the rest only to understand it):', '"""', focus, '"""'] : []),
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
    '````'
  ].join('\n');
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
