/**
 * Context Monitor - pieces shared by the ChatGPT coordinator (content-main.js) and the Claude / Gemini
 * coordinator (provider-coordinator.js): toolbar badge, diagnostics envelope,
 * limit provenance and context intelligence.
 */

import { EvidenceType } from '../../engine/evidence-merger.js';
import { analyzeContext } from '../../engine/context-advisor.js';

/**
 * Toolbar badge sender. Only the badge's two values ({ percentage, awaitingData }) go to the service
 * worker, never conversation data. Throttled: the first update goes out at once, then at most one per
 * `ms` carrying the latest values (streaming runs ~20 passes a second).
 * @param {{ syncsSent?: number, syncsCoalesced?: number }} [counters] Work counters for diagnostics
 * @returns {(state: Object) => void}
 */
export function badgeSender(counters = {}, ms = 250) {
  let pending = null;
  let timer = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    chrome.runtime.sendMessage({ type: 'CONTEXT_UPDATED', payload: pending }).catch(() => {}); // Worker may be asleep
    pending = null;
    counters.syncsSent = (counters.syncsSent || 0) + 1;
    timer = setTimeout(flush, ms); // Window stays open: a burst collapses into one trailing send
  };
  return (state) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    pending = { percentage: state.utilization?.percentage ?? null, awaitingData: Boolean(state.observables?.awaitingData) };
    if (timer) counters.syncsCoalesced = (counters.syncsCoalesced || 0) + 1;
    else flush();
  };
}

/** Short hash identifying a conversation in diagnostics without exposing its id. */
export function conversationRef(tokenizer, conversationId) {
  return conversationId ? tokenizer.hashString(conversationId).toString(16) : null;
}

/**
 * "Copy diagnostics": the last snapshot, only when it belongs to the conversation on screen now; state
 * left over from the previous conversation (the new one is still loading) is withheld.
 * @param {Object|null} latestState
 * @param {string|null} currentRef conversationRef of the conversation on screen
 * @param {Object} [base] Fields every answer carries (e.g. the provider name)
 * @param {() => Object} [extra] Fields read at copy time (page structure, performance)
 */
export function diagnosticsSnapshot(latestState, currentRef, base = {}, extra = () => ({})) {
  const copiedAt = new Date().toISOString();
  const d = latestState?.diagnostics;
  if (!d) return { note: 'Nothing read yet in this tab', ...base, currentConversationRef: currentRef, copiedAt };
  if (d.conversation?.ref !== currentRef) {
    return { note: 'The conversation on screen is still loading; data from the previous conversation is withheld', ...base, currentConversationRef: currentRef, loading: true, version: d.version, copiedAt };
  }
  return { ...d, ...extra(), copiedAt, stateAgeMs: Date.now() - latestState.timestamp };
}

/**
 * Provenance of the context window: from the curated limits table (OBSERVED + VERIFIED/UNVERIFIED),
 * never EXACT; UNKNOWN when no window is known.
 */
export function limitEvidence(state, reference) {
  const known = Boolean(state.model.contextWindow);
  return {
    value: state.model.contextWindow,
    status: known ? state.model.limitStatus : 'UNKNOWN',
    source: known ? 'model_db' : 'unknown',
    reference: known ? (reference || null) : null,
    evidenceType: known ? EvidenceType.OBSERVED : EvidenceType.UNKNOWN
  };
}

/**
 * Context intelligence (health, consumers, growth, advice) from the measured values only. The first
 * measurement of each conversation on this page is remembered in `sessionStart` for session growth.
 */
export function addIntelligence(state, { conversationId, awaitingData, attachments, isLowerBound, sessionStart }) {
  if (!awaitingData && conversationId && !sessionStart.has(conversationId)) sessionStart.set(conversationId, state.tokens.totalMeasurable);
  state.intelligence = analyzeContext({
    percentage: state.utilization.percentage,
    usedTokens: state.tokens.totalMeasurable,
    contextLimit: state.model.contextWindow,
    remainingTokens: state.tokens.remaining,
    messages: state.tokens.contextMessages,
    attachments,
    isLowerBound,
    hiddenTokens: state.tokens.hidden,
    sessionStartTokens: conversationId ? (sessionStart.get(conversationId) ?? null) : null
  });
}
