/**
 * Count-only Gemma 4 tokenizer: the tokenizer Gemini counts with (Google's SDK maps gemini-3.5-flash,
 * gemini-3.1-pro and later to Gemma 4). Data: assets/gemma4-tokenizer.bin, built from Gemma 4's
 * tokenizer.json by scripts/build-gemma-tokenizer.js.
 *
 * Same pipeline as Hugging Face tokenizers for that file: added tokens split out first; spaces become
 * "▁"; byte-fallback BPE where the lowest-rank adjacent pair merges first (leftmost on ties).
 * Exactness against the reference implementation is checked by tests/unit/gemma-tokenizer.test.js.
 *
 * Speed: the whole text is one BPE word in Gemma (no pre-split), but no vocab token spans a newline
 * next to another character, and "▁" only starts tokens (one exception, ">▁</"). So the text is cut
 * at those points into words that BPE alone gives the same result for, and each word is counted once.
 */

const VOCAB_BITS = 262144; // 2^18 ids: pair key = left * 2^18 + right
const POS_BITS = 67108864; // 2^26: heap key = rank * 2^26 + position

export class GemmaCounter {
  /** @param {ArrayBuffer} buffer contents of gemma4-tokenizer.bin */
  constructor(buffer) {
    const view = new DataView(buffer);
    if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'GEM4') throw new Error('Not a Gemma 4 tokenizer file');
    const count = view.getUint32(4, true);
    // A copy keeps the arrays aligned whatever the buffer's offset
    this.merges = new Uint32Array(buffer.slice(8, 8 + count * 12));
    this.byteIds = new Uint32Array(buffer.slice(8 + count * 12, 8 + count * 12 + 1024));
    const jsonAt = 8 + count * 12 + 1024;
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, jsonAt + 4, view.getUint32(jsonAt, true))));
    this.chars = new Map(Object.entries(meta.chars));
    this.ranks = new Map();
    this._next = 0; // Next merge to add to `ranks` (see build)
    this.built = false;
    // Longest first, so "<|tool_call>" wins over a shorter added token at the same place
    const added = meta.added.slice().sort((a, b) => b.length - a.length).map(s => s.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&'));
    this.addedRe = added.length ? new RegExp(added.join('|'), 'g') : null;
    this.words = new Map(); // word -> token count
    this.encoder = new TextEncoder();
  }

  /**
   * Adds merges to the lookup until it is complete or about budgetMs has passed (the full build is
   * ~0.8 s), so it can run in slices between the page's own tasks.
   * @returns {boolean} true once complete
   */
  build(budgetMs) {
    const total = this.merges.length / 3;
    const deadline = Date.now() + budgetMs;
    while (this._next < total) {
      const r = this._next++;
      this.ranks.set(this.merges[r * 3] * VOCAB_BITS + this.merges[r * 3 + 1], r);
      if ((r & 4095) === 0 && Date.now() >= deadline) return false;
    }
    this.built = true;
    return true;
  }

  /** @param {string} text */
  count(text) {
    if (!this.built) this.build(Infinity);
    if (!text) return 0;
    let total = 0;
    let start = 0;
    if (this.addedRe) {
      this.addedRe.lastIndex = 0;
      for (const m of text.matchAll(this.addedRe)) {
        total += this.countPlain(text.slice(start, m.index)) + 1;
        start = m.index + m[0].length;
      }
    }
    return total + this.countPlain(text.slice(start));
  }

  countPlain(text) {
    if (!text) return 0;
    const s = text.replace(/ /g, '▁');
    let total = 0;
    let from = 0;
    for (let i = 1; i < s.length; i++) {
      const c = s[i];
      const p = s[i - 1];
      const cut = (c === '\n') !== (p === '\n') || (c === '▁' && p !== '▁' && p !== '>');
      if (cut) {
        total += this.countWord(s.slice(from, i));
        from = i;
      }
    }
    return total + this.countWord(s.slice(from));
  }

  countWord(word) {
    const hit = this.words.get(word);
    if (hit !== undefined) return hit;
    const n = this.bpe(word);
    if (this.words.size >= 200000) this.words.clear(); // Bounded; refills with what is in use
    this.words.set(word, n);
    return n;
  }

  /** Token count of one word: byte-fallback BPE, lowest rank first, leftmost on ties. */
  bpe(word) {
    const ids = [];
    for (const ch of word) {
      const id = this.chars.get(ch);
      if (id !== undefined) ids.push(id);
      else for (const b of this.encoder.encode(ch)) ids.push(this.byteIds[b]);
    }
    const n = ids.length;
    if (n < 2) return n;
    const next = new Int32Array(n);
    const prev = new Int32Array(n);
    for (let i = 0; i < n; i++) { next[i] = i + 1 < n ? i + 1 : -1; prev[i] = i - 1; }
    const heap = [];
    const push = (pos) => {
      const r = next[pos] === -1 ? undefined : this.ranks.get(ids[pos] * VOCAB_BITS + ids[next[pos]]);
      if (r !== undefined) heapPush(heap, r * POS_BITS + pos);
    };
    for (let i = 0; i < n - 1; i++) push(i);
    let symbols = n;
    while (heap.length) {
      const key = heapPop(heap);
      const pos = key % POS_BITS;
      const rank = (key - pos) / POS_BITS;
      const right = next[pos];
      // Stale entry: the left symbol was merged away or its right neighbour changed
      if (ids[pos] === -1 || right === -1 || this.ranks.get(ids[pos] * VOCAB_BITS + ids[right]) !== rank) continue;
      ids[pos] = this.merges[rank * 3 + 2];
      ids[right] = -1;
      next[pos] = next[right];
      if (next[right] !== -1) prev[next[right]] = pos;
      symbols--;
      if (prev[pos] !== -1) push(prev[pos]);
      push(pos);
    }
    return symbols;
  }
}

function heapPush(h, v) {
  let i = h.push(v) - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p] <= v) break;
    h[i] = h[p];
    i = p;
  }
  h[i] = v;
}

function heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= h.length) break;
      const c = l + 1 < h.length && h[l + 1] < h[l] ? l + 1 : l;
      if (h[c] >= last) break;
      h[i] = h[c];
      i = c;
    }
    h[i] = last;
  }
  return top;
}
