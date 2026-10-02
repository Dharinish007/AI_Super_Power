/**
 * AI Super Powers - Memory
 *
 * Short facts about the user, shared by every AI: added by hand, or learned from a chat (the AI lists
 * facts, the user approves each one in the inbox). Stored by the shared CapsuleStore under MEMORIES_KEY.
 *
 *   looksSecret / memoryReject   never store keys, passwords, tokens or card numbers
 *   buildMemoryPrompt            Learn: text placed in the chat box (the user presses Enter)
 *   parseMemories                facts from the reply between the MEMORY markers
 *   readInbox / addToInbox / …   learned facts waiting for ✅ / ❌
 *   approveMemory                saves a fact; the same key replaces the stored memory
 *   formatMemoriesForInsert      what Inject puts in the chat box
 */

import { CapsuleStore, MEMORY_CATEGORIES, normalizeMemoryKey, CAPSULE_MAX_SELECTION } from './capsule.js';

export const MEMORIES_KEY = 'memories';
export const MEMORY_INBOX_KEY = 'memoryInbox';
export const MEMORY_MARKERS = Object.freeze({ start: '=== MEMORY START ===', end: '=== MEMORY END ===' });
export const MEMORY_MAX = 500;
const INBOX_MAX = 50;
const PROMPT_KEYS_MAX = 100;

const SECRET_PATTERNS = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/, // OpenAI / Stripe-style keys
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}/, // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
  /\b(?:password|passwd|pwd|passcode|pin)\s*[:=]\s*\S+/i
];

/** A 13-19 digit run (spaces / dashes allowed) that passes the Luhn check: a card number. */
function hasCardNumber(text) {
  for (const m of text.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)) {
    const d = m[0].replace(/\D/g, '');
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = Number(d[d.length - 1 - i]);
      if (i % 2) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

/** True when the text holds something that must never be stored (keys, tokens, passwords, cards). */
export function looksSecret(text) {
  const s = String(text || '');
  return SECRET_PATTERNS.some(r => r.test(s)) || hasCardNumber(s);
}

/** CapsuleStore `reject` hook for memories. */
export function memoryReject(item) {
  if (looksSecret(item.body)) return 'Looks like a secret: not saved';
  if (item.body.length > MEMORY_MAX) return `Memory is too long (${MEMORY_MAX} characters max)`;
  return null;
}

/** The memories list in a chrome.storage area. */
export const memoryStore = (area) => new CapsuleStore(area, { key: MEMORIES_KEY, noun: 'Memory', plural: 'Memories', reject: memoryReject });

/**
 * Learn: asks the current AI to list lasting facts about the user, one per line, between the markers.
 * @param {string} [selection] Chat text the user selected: only that part is used
 * @param {string[]} [keys] Keys already stored: the AI reuses one when a fact changed
 */
export function buildMemoryPrompt(selection = '', keys = []) {
  const focus = String(selection || '').trim().slice(0, CAPSULE_MAX_SELECTION);
  const known = (keys || []).slice(0, PROMPT_KEYS_MAX);
  return [
    'From this conversation, list facts about me (the user) that are worth remembering in future chats with any AI.',
    ...(focus ? ['', 'Only from this part of the conversation:', '"""', focus, '"""'] : []),
    '',
    'Rules:',
    '- Only lasting facts: who I am, my preferences, my projects and their tech, how I want answers, my skills, decisions I made.',
    '- Not: one-off task details, things only true today, facts about other people, passwords, keys or other secrets.',
    '- One short sentence per fact, about me ("Prefers short answers", "Building ShopEasy with React").',
    `- category is one of: ${MEMORY_CATEGORIES.join(', ')}.`,
    '- key is category.topic in lowercase with dashes, e.g. preference.favorite-fruit. The same topic always gets the same key.',
    ...(known.length ? [`- If a fact updates one of these existing keys, reuse that key: ${known.join(', ')}`] : []),
    '- If there is nothing worth remembering, write only "- none".',
    '- Reply with only one code block fenced with four backticks (````), in exactly this format:',
    '',
    '````',
    MEMORY_MARKERS.start,
    '- category | key | fact',
    MEMORY_MARKERS.end,
    '````'
  ].join('\n');
}

/**
 * Facts from a Learn reply's body ("- category | key | fact" lines). Unknown categories become 'other',
 * bad keys null; secrets, empty and over-long facts are dropped; a repeated key or text keeps the first.
 * @returns {Array<{ category: string, key: string|null, text: string }>}
 */
export function parseMemories(body) {
  const out = [];
  for (const line of String(body || '').split('\n')) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])?\s*(.+?)\s*\|\s*(.*?)\s*\|\s*(.+?)\s*$/);
    if (!m || m[1].toLowerCase() === 'category') continue; // Not a fact, or the format line echoed back
    const category = MEMORY_CATEGORIES.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : 'other';
    const key = normalizeMemoryKey(m[2]);
    const text = m[3].replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!text || text.length > MEMORY_MAX || looksSecret(text)) continue;
    if (out.some(f => (key && f.key === key) || f.text.toLowerCase() === text.toLowerCase())) continue;
    out.push({ category, key, text });
  }
  return out;
}

/** @returns {Promise<Array<{ id: string, category: string, key: string|null, text: string, source: string, at: number }>>} newest first */
export async function readInbox(area) {
  const list = (await area.get(MEMORY_INBOX_KEY))?.[MEMORY_INBOX_KEY];
  return Array.isArray(list) ? list : [];
}

/**
 * Adds learned facts to the inbox, newest first. A waiting fact with the same key or text is replaced;
 * at most 50 are kept. ponytail: read-modify-write of one list, like CapsuleStore.
 * @returns {Promise<number>} facts added
 */
export async function addToInbox(area, facts, source, now = Date.now()) {
  const same = (a, b) => (a.key && a.key === b.key) || a.text.toLowerCase() === b.text.toLowerCase();
  const fresh = (facts || []).map((f, i) => ({ id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${now.toString(36)}-${i}`, category: f.category, key: f.key, text: f.text, source, at: now }));
  const kept = (await readInbox(area)).filter(old => !fresh.some(f => same(old, f)));
  await area.set({ [MEMORY_INBOX_KEY]: [...fresh, ...kept].slice(0, INBOX_MAX) });
  return fresh.length;
}

/** @param {string[]} ids */
export async function removeFromInbox(area, ids) {
  const drop = new Set(ids);
  await area.set({ [MEMORY_INBOX_KEY]: (await readInbox(area)).filter(f => !drop.has(f.id)) });
}

/**
 * Saves an inbox fact. A stored memory with the same key (or, without a key match, the same text) is replaced (same id; tags, project and pin
 * kept), so a changed fact updates instead of piling up.
 * @param {CapsuleStore} store memoryStore(area)
 * @param {{ category: string, key: string|null, text: string, source?: string }} fact
 */
export async function approveMemory(store, fact) {
  const list = await store.list();
  const old = (fact.key && list.find(m => m.key === fact.key)) || list.find(m => m.body.trim().toLowerCase() === fact.text.trim().toLowerCase());
  const memory = await store.save({ id: old?.id, title: fact.text, body: fact.text, category: fact.category, key: fact.key, source: fact.source });
  return { memory, updated: Boolean(old) };
}

/** What Inject (and Insert / Copy on a memory) puts in the chat box. */
export function formatMemoriesForInsert(memories) {
  return `About me (saved memory). Use it as background; do not repeat it back.\n${(memories || []).map(m => `- ${String(m.body).replace(/\s*\n\s*/g, ' ')}`).join('\n')}`;
}
