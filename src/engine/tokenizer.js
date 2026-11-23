/**
 * ChatGPT Context Monitor - Production BPE Tokenizer
 *
 * Exact byte-pair encoding (BPE) counts with OpenAI's o200k_base ranks (the only table bundled; see
 * BUNDLED_ENCODING), plus other providers' tokenizers once loaded (useCounter, e.g. Gemma 4 on Gemini).
 *
 * Features:
 * - 100% offline, local, client-side execution (zero data exfiltration).
 * - Exact BPE for current OpenAI models (o200k_base). Retired cl100k_base models (GPT-4, GPT-3.5) are
 *   counted with o200k_base and reported as approximate (isExact() === false).
 * - Every special token is allowed and counted as one token (never throws on raw prompt text).
 * - Message parts[] support: counts exact BPE tokens for text while keeping non-text content classified.
 * - High-speed 32-bit FNV-1a hash caching with LRU eviction for real-time 60fps streaming.
 */

import o200k_base_module from 'js-tiktoken/ranks/o200k_base';

// In the bundled content script (scripts/build.js) the rank table is defined in the outer scope
/* global o200k_base */
const o200kData = typeof o200k_base !== 'undefined' ? o200k_base : o200k_base_module;

// The one rank table shipped: cl100k_base was ~1 MB of the bundle and served retired models only.
// ponytail: single table; ship another (or load it on demand) if a current model moves to a new encoding.
export const BUNDLED_ENCODING = 'o200k_base';

const clockMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** UTF-8 bytes of a string as a one-char-per-byte string (ASCII is returned as is). */
function utf8ByteString(text) {
  if (!/[^\x00-\x7f]/.test(text)) return text; // eslint-disable-line no-control-regex -- ASCII range check
  const bytes = BpeCounter.textEncoder.encode(text); // Lone surrogates become EF BF BD, as in js-tiktoken
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return out;
}

/**
 * Count-only byte-pair encoding. Returns exactly js-tiktoken's `encode(text, 'all').length`: the same
 * special-token split, the same regex pieces, the same lowest-rank-first (leftmost on ties) merge
 * order. It is faster because:
 *  - ranks are keyed by the raw byte string (atob of the rank file), not comma-joined byte lists,
 *    which also makes the one-off table build several times cheaper;
 *  - after a merge only the two neighbouring pair ranks are recomputed, instead of re-joining every pair;
 *  - each distinct piece is counted once: BPE of a piece never depends on the surrounding text, and
 *    conversations repeat the same words constantly (a streamed reply is re-counted many times).
 * Exactness against js-tiktoken is checked by the tokenizer tests.
 */
export class BpeCounter {
  static textEncoder = new TextEncoder();

  /**
   * @param {Object} ranks js-tiktoken rank file
   * @param {{ deferred?: boolean }} [options] deferred: the rank table is filled later by build(), in slices
   */
  constructor(ranks, { deferred = false } = {}) {
    this.ranks = new Map();
    this._source = ranks.bpe_ranks;
    this._lines = null; // Split on the first build() call, so a deferred constructor costs nothing
    this._line = 0;
    this._field = 2;
    this.built = false;
    this.buildMs = 0;
    this.pieceRe = new RegExp(ranks.pat_str, 'ug');
    const specials = Object.keys(ranks.special_tokens || {});
    this.specialRe = specials.length
      ? new RegExp(specials.map(s => s.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&')).join('|'), 'g')
      : null;
    this.pieces = new Map(); // piece -> token count
    this.stats = { pieces: 0, pieceHits: 0 };
    if (!deferred) this.build(Infinity);
  }

  /**
   * Adds ranks until the table is complete or about budgetMs has passed, so the ~0.1 s build can run
   * between the page's own tasks instead of as one long task.
   * @param {number} budgetMs
   * @returns {boolean} true once the table is complete
   */
  build(budgetMs) {
    if (this.built) return true;
    const t0 = clockMs();
    const deadline = t0 + budgetMs;
    // "<marker> <offset> <token> <token> ..." per line; o200k is a single line of 200K tokens
    if (!this._lines) this._lines = this._source.split('\n').filter(Boolean).map(line => line.split(' '));
    for (; this._line < this._lines.length; this._line++, this._field = 2) {
      const fields = this._lines[this._line];
      const offset = Number.parseInt(fields[1], 10);
      while (this._field < fields.length) {
        this.ranks.set(atob(fields[this._field]), offset + this._field - 2);
        // Clock checked every 2048 entries (~0.5 ms), not per entry
        if ((++this._field & 2047) === 0 && clockMs() >= deadline) {
          this.buildMs += clockMs() - t0;
          return false;
        }
      }
    }
    this.buildMs += clockMs() - t0;
    this._lines = this._source = null;
    this.built = true;
    return true;
  }

  /** @param {string} text */
  count(text) {
    let total = 0;
    let start = 0;
    while (true) {
      let next = null;
      if (this.specialRe) {
        this.specialRe.lastIndex = start;
        next = this.specialRe.exec(text);
      }
      const end = next ? next.index : text.length;
      if (end > start) {
        for (const m of text.substring(start, end).matchAll(this.pieceRe)) total += this.countPiece(m[0]);
      }
      if (!next) break;
      total++; // Every special token is allowed and is a single token
      start = next.index + next[0].length;
    }
    return total;
  }

  countPiece(piece) {
    const hit = this.pieces.get(piece);
    if (hit !== undefined) {
      this.stats.pieceHits++;
      return hit;
    }
    const n = this.bpeCount(utf8ByteString(piece));
    if (this.pieces.size >= 200000) this.pieces.clear(); // Bounded; refills with what is in use
    this.pieces.set(piece, n);
    this.stats.pieces++;
    return n;
  }

  /** Number of tokens BPE produces for one piece given as a byte string. */
  bpeCount(s) {
    const n = s.length;
    if (n === 0) return 0;
    if (n === 1 || this.ranks.has(s)) return 1;
    const ranks = this.ranks;
    const bounds = new Array(n + 1);
    for (let i = 0; i <= n; i++) bounds[i] = i;
    const pair = new Array(n - 1); // pair[i]: rank of merging part i with part i + 1
    for (let i = 0; i < n - 1; i++) pair[i] = ranks.get(s.substring(i, i + 2)) ?? Infinity;
    while (pair.length > 0) {
      let min = Infinity;
      let at = -1;
      for (let i = 0; i < pair.length; i++) if (pair[i] < min) { min = pair[i]; at = i; }
      if (at === -1) break;
      bounds.splice(at + 1, 1);
      pair.splice(at, 1);
      if (at > 0) pair[at - 1] = ranks.get(s.substring(bounds[at - 1], bounds[at + 1])) ?? Infinity;
      if (at < pair.length) pair[at] = ranks.get(s.substring(bounds[at], bounds[at + 2])) ?? Infinity;
    }
    // js-tiktoken drops parts without a rank (never happens with byte-level ranks, kept for parity)
    let count = 0;
    for (let i = 0; i < bounds.length - 1; i++) if (ranks.has(s.substring(bounds[i], bounds[i + 1]))) count++;
    return count;
  }
}

export class Tokenizer {
  constructor(options = {}) {
    // Entries are tiny (numbers); room for several long conversations so switching back is instant
    this.maxCacheSize = options.maxCacheSize || 6000;
    // Map: messageId -> { hash: number, tokens: number, textLength: number, encoding: string }
    this.cache = new Map();
    // Work counters for performance diagnostics: BPE runs vs cache reuse
    this.stats = { encoded: 0, encodedChars: 0, cacheHits: 0 };
    // Count-only BPE (what countTokens uses), created by warm() or the first count
    this.counter = null;
    // Other providers' tokenizers, registered once loaded (e.g. 'gemma4' on Gemini): name -> { count(text) }
    this.extraCounters = new Map();
  }

  /** Counts for `name` use this counter from now on (resolveEncoding / isExact report it). */
  useCounter(name, counter) {
    this.extraCounters.set(name, counter);
  }

  /**
   * Count-only BPE over the bundled table. The table build is the one-off startup cost: whatever
   * warm() has not built yet is finished here, synchronously, so counts never depend on timing.
   * The argument is accepted for callers that name an encoding; there is only one table.
   * @returns {BpeCounter}
   */
  getCounter(encodingOrModel) {
    const extra = this.extraCounters.get(encodingOrModel);
    if (extra) return extra;
    if (!this.counter) this.counter = new BpeCounter(o200kData, { deferred: true });
    if (!this.counter.built) {
      this.counter.build(Infinity);
      this.stats.initMs = Math.round(this.counter.buildMs);
    }
    return this.counter;
  }

  /**
   * Starts building the rank table ahead of the first count (e.g. while the network is busy), in
   * ~8 ms slices between the page's own tasks, so page load never sees one ~0.1 s long task.
   */
  warm() {
    if (this.counter) return;
    const counter = this.counter = new BpeCounter(o200kData, { deferred: true });
    const step = () => {
      if (counter.built) return; // A count already finished it (getCounter)
      if (counter.build(8)) this.stats.initMs = Math.round(counter.buildMs);
      else setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  /**
   * True when the model's own tokenizer (its `encoding` in config/model-limits.json) is one counted
   * here, so counts are exact BPE rather than an approximation (retired cl100k_base models such as
   * GPT-4 and GPT-3.5 are approximate). No encoding means the bundled default.
   * @param {string} [encoding]
   * @returns {boolean}
   */
  isExact(encoding) {
    return !encoding || encoding === BUNDLED_ENCODING || this.extraCounters.has(encoding);
  }

  /**
   * The encoding counts are made with: a registered extra counter when one was asked for and has
   * loaded (useCounter), otherwise BUNDLED_ENCODING; isExact() tells whether that matches the model's own tokenizer.
   * @returns {string}
   */
  resolveEncoding(encoding) {
    return this.extraCounters.has(encoding) ? encoding : BUNDLED_ENCODING;
  }

  /**
   * Generates a fast 32-bit FNV-1a hash of a string for cache invalidation.
   * @param {string} str 
   * @returns {number}
   */
  hashString(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  /**
   * Exact BPE token count of raw text (equal to js-tiktoken's encode(text, 'all').length; see the
   * performance tests).
   * @param {string} text
   * @param {string} [encoding]
   * @returns {number}
   */
  countTokens(text, encoding = BUNDLED_ENCODING) {
    if (!text || typeof text !== 'string') return 0;
    return this.getCounter(this.resolveEncoding(encoding)).count(text);
  }

  /**
   * Tokenizes an array of message parts.
   * Exact BPE token counting is applied to text parts.
   * Non-text parts (e.g. images, files, tools) are preserved and classified without fabricating text tokens.
   *
   * @param {string} messageId
   * @param {Array<string|Object>} parts
   * @param {string} [encoding]
   * @returns {{ tokens: number, hasNonTextParts: boolean, nonTextParts: Array<Object> }}
   */
  countMessagePartsTokens(messageId, parts, encoding = BUNDLED_ENCODING) {
    if (!Array.isArray(parts) || parts.length === 0) {
      return { tokens: 0, hasNonTextParts: false, nonTextParts: [] };
    }

    encoding = this.resolveEncoding(encoding);
    let combinedText = '';
    const nonTextParts = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof part === 'string') {
        combinedText += (combinedText ? '\n' : '') + part;
      } else if (part && typeof part === 'object') {
        if (part.type === 'text' || (!part.type && typeof part.text === 'string')) {
          if (part.text) {
            combinedText += (combinedText ? '\n' : '') + part.text;
          }
        } else {
          // Non-text part (image, tool, attachment, vector, etc.)
          nonTextParts.push({ type: part.type || 'unknown', classification: part.classification || 'UNKNOWN' });
        }
      }
    }

    return {
      tokens: combinedText ? this.countMessageTokens(messageId ? `${messageId}_text` : null, combinedText, encoding) : 0,
      hasNonTextParts: nonTextParts.length > 0,
      nonTextParts
    };
  }

  /**
   * Tokenizes a message turn with caching support.
   * If messageId matches and text hash + encoding have not changed, returns cached count in O(1).
   * Also accepts an array of parts[].
   * 
   * @param {string} messageId 
   * @param {string|Array<Object>} textOrParts 
   * @param {string} [encoding]
   * @returns {number}
   */
  countMessageTokens(messageId, textOrParts, encoding = BUNDLED_ENCODING) {
    if (!textOrParts) return 0;
    if (Array.isArray(textOrParts)) return this.countMessagePartsTokens(messageId, textOrParts, encoding).tokens;
    if (typeof textOrParts !== 'string') return 0;

    encoding = this.resolveEncoding(encoding);
    const hash = this.hashString(textOrParts);
    const cacheKey = messageId ? `${messageId}_${encoding}` : null;

    if (cacheKey && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached.hash === hash && cached.textLength === textOrParts.length && cached.encoding === encoding) {
        // Re-insert so eviction drops the least recently USED entry, not the oldest inserted
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, cached);
        this.stats.cacheHits++;
        return cached.tokens;
      }
    }

    const tokens = this.countTokens(textOrParts, encoding);
    this.stats.encoded++;
    this.stats.encodedChars += textOrParts.length;

    if (cacheKey) {
      this.cache.delete(cacheKey);
      if (this.cache.size >= this.maxCacheSize) {
        const oldestKey = this.cache.keys().next().value;
        this.cache.delete(oldestKey);
      }
      this.cache.set(cacheKey, { hash, tokens, textLength: textOrParts.length, encoding });
    }

    return tokens;
  }
}
