/**
 * Context Monitor - Pre-Send Token Estimator
 *
 * Privacy & Safety Guarantees:
 * - Measures token count of user's active draft in the composer.
 * - Debounced by 300ms.
 * - Shows the draft's own size only: "draft ≈ N tokens".
 * - Never shows prediction of total context.
 * - NEVER stores, logs, or transmits draft text.
 * - Text is discarded immediately after token count calculation.
 */

export class PreSendEstimator {
  /**
   * @param {{
   *   tokenizer?: (text: string) => number,
   *   onEstimate?: (tokens: number|null) => void,
   *   debounceMs?: number
   * }} options
   */
  constructor(options = {}) {
    this.tokenizer = options.tokenizer || ((text) => Math.ceil((text || '').length / 4));
    this.onEstimate = options.onEstimate || (() => {});
    this.debounceMs = options.debounceMs ?? 300;
    this._timer = null;
    this._inputElement = null;
    this._listener = () => this._onInput();
  }

  attach(inputElement) {
    this.detach();
    if (!inputElement) return;
    this._inputElement = inputElement;
    inputElement.addEventListener('input', this._listener);
    inputElement.addEventListener('keyup', this._listener);
  }

  detach() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._inputElement) {
      this._inputElement.removeEventListener('input', this._listener);
      this._inputElement.removeEventListener('keyup', this._listener);
      this._inputElement = null;
    }
  }

  _onInput() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this.estimateNow();
    }, this.debounceMs);
  }

  /**
   * Computes token count immediately without storing text.
   * @param {string} [overrideText]
   * @returns {number|null}
   */
  estimateNow(overrideText) {
    let text = '';
    if (typeof overrideText === 'string') {
      text = overrideText;
    } else if (this._inputElement) {
      text = this._inputElement.value || this._inputElement.innerText || this._inputElement.textContent || '';
    }

    const trimmed = text.trim();
    if (!trimmed) {
      this.onEstimate(null);
      return null;
    }

    // Measure tokens in memory - do NOT log, store, or serialize text
    let tokens;
    try {
      tokens = this.tokenizer(trimmed);
    } catch (_) {
      tokens = Math.ceil(trimmed.length / 4);
    }

    this.onEstimate(tokens);
    return tokens;
  }

  destroy() {
    this.detach();
    this.onEstimate = () => {};
  }
}

/**
 * Formats pre-send estimate string.
 * @param {number|null} tokens
 * @param {Function} [formatTokensFn]
 * @returns {string|null}
 */
export function formatPreSendEstimate(tokens, formatTokensFn) {
  if (tokens === null || tokens === undefined || !Number.isFinite(tokens) || tokens <= 0) {
    return null;
  }
  const tStr = formatTokensFn ? formatTokensFn(tokens) : String(Math.round(tokens));
  return `draft ≈ ${tStr} tokens`;
}
