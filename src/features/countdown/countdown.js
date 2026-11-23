/**
 * Context Monitor - Reset Countdown Engine
 *
 * Computes remaining time from `resetsAt` timestamp.
 * - Updates every 60s via interval timer.
 * - Recalculates immediately on tab focus or visibilitychange.
 * - Cleans up intervals and event listeners on destroy().
 */

import { formatReset } from '../../ui/shared/formatters.js';

export class ResetCountdown {
  /**
   * @param {{
   *   resetsAt?: number|string|null,
   *   onTick?: (formatted: string|null) => void,
   *   nowFn?: () => number
   * }} options
   */
  constructor(options = {}) {
    this.resetsAt = options.resetsAt || null;
    this.onTick = options.onTick || (() => {});
    this.nowFn = options.nowFn || (() => Date.now());
    this._interval = null;
    this._onFocus = () => this.tick();
    this._onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        this.tick();
      }
    };
    this.currentText = null;
    this._attached = false;
  }

  start(resetsAt) {
    if (resetsAt !== undefined) this.resetsAt = resetsAt;
    this.stop();
    this.tick();

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', this._onFocus);
      this._attached = true;
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this._onVisibility);
      this._attached = true;
    }

    this._interval = setInterval(() => this.tick(), 60000);
  }

  tick() {
    if (!this.resetsAt) {
      this.currentText = null;
      this.onTick(null);
      return null;
    }
    const formatted = formatReset(this.resetsAt, this.nowFn(), { relative: true });
    this.currentText = formatted;
    this.onTick(formatted);
    return formatted;
  }

  update(resetsAt) {
    this.resetsAt = resetsAt || null;
    return this.tick();
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    if (this._attached) {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('focus', this._onFocus);
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', this._onVisibility);
      }
      this._attached = false;
    }
  }

  destroy() {
    this.stop();
    this.onTick = () => {};
  }
}
