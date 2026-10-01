/**
 * ChatGPT Context Monitor - Production BPE Tokenizer
 * 
 * Implements exact, model-aware byte-pair encoding (BPE) using js-tiktoken
 * with OpenAI's o200k_base ranks (the only table bundled; see BUNDLED_ENCODING).
 *
 * Features:
 * - 100% offline, local, client-side execution (zero data exfiltration).
 * - Exact BPE for current OpenAI models (o200k_base). Retired cl100k_base models (GPT-4, GPT-3.5) are
 *   counted with o200k_base and reported as approximate (isExact() === false).
 * - Lazy encoder instantiation for minimal startup latency and optimal memory usage.
 * - Robust handling of special tokens (allowedSpecial: 'all') preventing runtime exceptions.
 * - Message parts[] support: counts exact BPE tokens for text while keeping non-text content classified.
 * - High-speed 32-bit FNV-1a hash caching with LRU eviction for real-time 60fps streaming.
 */

import { Tiktoken as TiktokenModule } from 'js-tiktoken/lite';
import o200k_base_module from 'js-tiktoken/ranks/o200k_base';

// In bundled browser context (scripts/build.js), Tiktoken and rank tables are defined in outer scope
/* global Tiktoken, o200k_base */
const TiktokenClass = typeof Tiktoken !== 'undefined' ? Tiktoken : TiktokenModule;
const o200kData = typeof o200k_base !== 'undefined' ? o200k_base : o200k_base_module;

export const SUPPORTED_ENCODINGS = Object.freeze({
  O200K_BASE: 'o200k_base',
  CL100K_BASE: 'cl100k_base'
});

// The one rank table shipped: cl100k_base was ~1 MB of the bundle and served retired models only.
// ponytail: single table; ship another (or load it on demand) if a current model moves to a new encoding.
export const BUNDLED_ENCODING = SUPPORTED_ENCODINGS.O200K_BASE;

export const MODEL_TO_ENCODING = Object.freeze({
  'gpt-4o': SUPPORTED_ENCODINGS.O200K_BASE,
  'gpt-4o-mini': SUPPORTED_ENCODINGS.O200K_BASE,
  'gpt-4.5': SUPPORTED_ENCODINGS.O200K_BASE,
  'o1': SUPPORTED_ENCODINGS.O200K_BASE,
  'o1-mini': SUPPORTED_ENCODINGS.O200K_BASE,
  'o1-preview': SUPPORTED_ENCODINGS.O200K_BASE,
  'o3-mini': SUPPORTED_ENCODINGS.O200K_BASE,
  'gpt-4-turbo': SUPPORTED_ENCODINGS.CL100K_BASE,
  'gpt-4': SUPPORTED_ENCODINGS.CL100K_BASE,
  'gpt-3.5-turbo': SUPPORTED_ENCODINGS.CL100K_BASE
});

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
    this.defaultEncoding = options.defaultEncoding || SUPPORTED_ENCODINGS.O200K_BASE;
    // Map: messageId -> { hash: number, tokens: number, textLength: number, encoding: string }
    this.cache = new Map();
    // Work counters for performance diagnostics: BPE runs vs cache reuse
    this.stats = { encoded: 0, encodedChars: 0, cacheHits: 0 };
    // Lazy instance cache: encodingName -> Tiktoken instance
    this.encoders = new Map();
    // Count-only BPE (what countTokens uses), created by warm() or the first count
    this.counter = null;
  }

  /**
   * Count-only BPE over the bundled table. The table build is the one-off startup cost: whatever
   * warm() has not built yet is finished here, synchronously, so counts never depend on timing.
   * The argument is accepted for callers that name an encoding; there is only one table.
   * @returns {BpeCounter}
   */
  getCounter() {
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
   * True when the model's own tokenizer is the bundled one, so counts are exact BPE rather than an
   * approximation (retired cl100k_base models such as GPT-4 and GPT-3.5 are approximate).
   * @param {string} [encodingOrModel]
   * @returns {boolean}
   */
  isExact(encodingOrModel) {
    return this.getEncodingForModel(encodingOrModel) === BUNDLED_ENCODING;
  }

  /**
   * The encoding counts are made with. Only BUNDLED_ENCODING ships, so this is always o200k_base;
   * isExact() tells whether that matches the model's own tokenizer.
   * @returns {string}
   */
  resolveEncoding() {
    return BUNDLED_ENCODING;
  }

  /**
   * The tokenizer a model (or encoding name) actually uses, whether or not it is bundled.
   * @param {string} [encodingOrModel]
   * @returns {string} 'o200k_base' | 'cl100k_base'
   */
  getEncodingForModel(encodingOrModel) {
    if (!encodingOrModel) return this.defaultEncoding;
    const lower = String(encodingOrModel).toLowerCase().trim();

    if (lower === SUPPORTED_ENCODINGS.O200K_BASE || lower === 'o200k') {
      return SUPPORTED_ENCODINGS.O200K_BASE;
    }
    if (lower === SUPPORTED_ENCODINGS.CL100K_BASE || lower === 'cl100k') {
      return SUPPORTED_ENCODINGS.CL100K_BASE;
    }

    if (MODEL_TO_ENCODING[lower]) {
      return MODEL_TO_ENCODING[lower];
    }

    // Substring / fuzzy detection for model family
    if (lower.includes('4o') || lower.includes('o1') || lower.includes('o3') || lower.includes('4.5') || lower.includes('omni')) {
      return SUPPORTED_ENCODINGS.O200K_BASE;
    }
    if (lower.includes('gpt-4') || lower.includes('3.5') || lower.includes('turbo')) {
      return SUPPORTED_ENCODINGS.CL100K_BASE;
    }

    return this.defaultEncoding;
  }

  /**
   * Lazily instantiates or retrieves the Tiktoken encoder for the specified encoding.
   * @param {string} [encoding] 
   * @returns {Tiktoken}
   */
  getEncoder(encoding = this.defaultEncoding) {
    const encName = this.resolveEncoding(encoding);
    if (!this.encoders.has(encName)) this.encoders.set(encName, new TiktokenClass(o200kData));
    return this.encoders.get(encName);
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
   * Safely encodes text without throwing on special tokens.
   * @param {Tiktoken} encoder 
   * @param {string} text 
   * @returns {Array<number>}
   */
  encodeSafely(encoder, text) {
    try {
      return encoder.encode(text, 'all');
    } catch (_) {
      try {
        return encoder.encode(text);
      } catch (err) {
        // Fallback: character-based estimate if encoder encounters an unexpected syntax failure
        console.warn('[ChatGPT Context Monitor] Tokenizer encode exception, using fallback:', err);
        return new Array(Math.max(1, Math.ceil(text.length / 4)));
      }
    }
  }

  /**
   * Tokenizes raw text and returns the exact BPE token count.
   * @param {string} text 
   * @param {string} [encodingOrModel] 
   * @returns {number}
   */
  countTokens(text, encodingOrModel = this.defaultEncoding) {
    if (!text || typeof text !== 'string' || text.length === 0) {
      return 0;
    }
    try {
      return this.getCounter(encodingOrModel).count(text);
    } catch (_) {
      // Unexpected input for the fast path: fall back to the reference encoder
      const tokens = this.encodeSafely(this.getEncoder(encodingOrModel), text);
      return tokens ? tokens.length : 0;
    }
  }

  /**
   * Tokenizes an array of message parts.
   * Exact BPE token counting is applied to text parts.
   * Non-text parts (e.g. images, files, tools) are preserved and classified without fabricating text tokens.
   * 
   * @param {string} messageId 
   * @param {Array<string|Object>} parts 
   * @param {string} [encodingOrModel] 
   * @returns {{ tokens: number, textTokens: number, hasNonTextParts: boolean, nonTextParts: Array<Object>, isExactText: boolean }}
   */
  countMessagePartsTokens(messageId, parts, encodingOrModel = this.defaultEncoding) {
    if (!parts || !Array.isArray(parts) || parts.length === 0) {
      return {
        tokens: 0,
        textTokens: 0,
        hasNonTextParts: false,
        nonTextParts: [],
        isExactText: true
      };
    }

    const encoding = this.resolveEncoding(encodingOrModel);
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
          nonTextParts.push({
            type: part.type || 'unknown',
            classification: part.classification || 'UNKNOWN',
            details: part.details || null
          });
        }
      }
    }

    let textTokens = 0;
    if (combinedText.length > 0) {
      textTokens = this.countMessageTokens(messageId ? `${messageId}_text` : null, combinedText, encoding);
    }

    return {
      tokens: textTokens,
      textTokens,
      hasNonTextParts: nonTextParts.length > 0,
      nonTextParts,
      isExactText: true
    };
  }

  /**
   * Tokenizes a message turn with caching support.
   * If messageId matches and text hash + encoding have not changed, returns cached count in O(1).
   * Also accepts an array of parts[].
   * 
   * @param {string} messageId 
   * @param {string|Array<Object>} textOrParts 
   * @param {string} [encodingOrModel] 
   * @returns {number}
   */
  countMessageTokens(messageId, textOrParts, encodingOrModel = this.defaultEncoding) {
    if (!textOrParts) return 0;

    // Handle parts array delegation
    if (Array.isArray(textOrParts)) {
      const result = this.countMessagePartsTokens(messageId, textOrParts, encodingOrModel);
      return result.tokens;
    }

    if (typeof textOrParts !== 'string') return 0;
    if (textOrParts.length === 0) return 0;

    const encoding = this.resolveEncoding(encodingOrModel);
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

  /**
   * Clears the tokenizer cache.
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Returns current cache and encoder diagnostics.
   * @returns {{ size: number, maxCacheSize: number, activeEncoders: Array<string> }}
   */
  getDiagnostics() {
    return {
      size: this.cache.size,
      maxCacheSize: this.maxCacheSize,
      activeEncoders: Array.from(this.encoders.keys())
    };
  }
}
