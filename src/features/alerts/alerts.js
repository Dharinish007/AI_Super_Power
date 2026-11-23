/**
 * Context Monitor - Threshold Alerts & Hysteresis Engine
 *
 * Manages threshold alerts with hysteresis:
 * - Triggers toast alert when context or session usage reaches 80%+.
 * - Fires once per threshold per chat.
 * - Re-arms only after dropping strictly below 70%.
 * - Uses softer phrasing for estimated values ("est. ~80%").
 * - Disabled via settings.features.alerts (or settings.context.alerts).
 */

export class AlertManager {
  constructor(options = {}) {
    this.toastFn = options.toastFn || (() => {});
    // Track state per chat: Map<chatId, { contextAlerted: boolean, sessionAlerted: boolean }>
    this.chatState = new Map();
  }

  /**
   * Resets alert history for a specific chat or all chats.
   * @param {string} [chatId]
   */
  reset(chatId) {
    if (chatId) this.chatState.delete(chatId);
    else this.chatState.clear();
  }

  /**
   * Evaluates current state and triggers toast if threshold crossed.
   * @param {{
   *   chatId?: string,
   *   contextPct?: number|null,
   *   contextSource?: 'measured'|'estimated',
   *   sessionPct?: number|null,
   *   sessionSource?: 'measured'|'estimated',
   *   enabled?: boolean
   * }} params
   * @returns {{ fired: boolean, type?: 'context'|'session', message?: string }}
   */
  evaluate({ chatId = 'global', contextPct = null, contextSource = 'measured', sessionPct = null, sessionSource = 'measured', enabled = true } = {}) {
    if (!enabled) return { fired: false };

    let state = this.chatState.get(chatId);
    if (!state) {
      state = { contextAlerted: false, sessionAlerted: false };
      this.chatState.set(chatId, state);
    }

    // 1. Context alert check
    if (typeof contextPct === 'number' && Number.isFinite(contextPct)) {
      if (contextPct >= 80 && !state.contextAlerted) {
        state.contextAlerted = true;
        const isEst = contextSource === 'estimated';
        const msg = isEst
          ? `Context usage is est. ~${Math.round(contextPct)}%`
          : `Context usage reached ${Math.round(contextPct)}%`;
        this.toastFn(msg);
        return { fired: true, type: 'context', message: msg };
      } else if (contextPct < 70) {
        // Re-arm when dropping below 70%
        state.contextAlerted = false;
      }
    }

    // 2. Session alert check
    if (typeof sessionPct === 'number' && Number.isFinite(sessionPct)) {
      if (sessionPct >= 80 && !state.sessionAlerted) {
        state.sessionAlerted = true;
        const isEst = sessionSource === 'estimated';
        const msg = isEst
          ? `Session usage is est. ~${Math.round(sessionPct)}%`
          : `Session usage reached ${Math.round(sessionPct)}%`;
        this.toastFn(msg);
        return { fired: true, type: 'session', message: msg };
      } else if (sessionPct < 70) {
        // Re-arm when dropping below 70%
        state.sessionAlerted = false;
      }
    }

    return { fired: false };
  }
}

/**
 * Checks whether the "Consider a new chat" line should be displayed in the drawer.
 * Rules:
 * - Never in the strip.
 * - At 80% context for measured values.
 * - Don't show for estimated values below 85% (only at 85%+).
 * @param {number|null|undefined} pct
 * @param {'measured'|'estimated'} [source]
 * @param {boolean} [enabled]
 * @returns {boolean}
 */
export function shouldShowNewChatSuggestion(pct, source = 'measured', enabled = true) {
  if (!enabled || pct === null || pct === undefined || !Number.isFinite(pct)) return false;
  const rounded = Math.round(pct);
  if (source === 'estimated') {
    return rounded >= 85;
  }
  return rounded >= 80;
}
