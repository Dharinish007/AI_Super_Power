/**
 * Context Monitor - Page actions
 *
 * The one place the UI touches the AI site's page: read the chat, fill the chat box, wait for a
 * Capsule. CapsulePanel and the widgets call these through the Page interface (all async), so the
 * side panel can make the same calls over the panel channel.
 */

import { readLatestCapsule, latestReplyText, readTranscript, insertText, chatLimitReached } from './capsule.js';

/**
 * @param {{ provider: string, findInput: () => Element|null, replySelector: string|null, userSelector?: string|null,
 *   countTokens?: ((t: string) => number)|null, getLimits?: () => Array<Object> }} adapter
 *   `getLimits` returns the latest view-state limits (for limitReached)
 * @param {Document} [doc]
 */
export function createPage(adapter, doc = globalThis.document) {
  const { replySelector, userSelector } = adapter;
  return {
    provider: adapter.provider,
    async hasConversation() { return Boolean(replySelector && doc.querySelector(replySelector)); },
    async takeSelection() { return String(doc.getSelection?.() || '').trim(); },
    async fill(text) { const input = adapter.findInput(); return Boolean(input && insertText(input, text)); },
    async latestReply() { return latestReplyText(doc, replySelector); },
    async transcript() { return readTranscript(doc, userSelector, replySelector); },
    async countTokens(texts) {
      return texts.map((t) => { try { return adapter.countTokens ? adapter.countTokens(t) : null; } catch (_) { return null; } });
    },
    async limitReached() { return Boolean(chatLimitReached(adapter.getLimits?.() || [])); },
    /**
     * Waits for a Capsule in a new reply (at most one read per 500 ms while it streams); reports it once.
     * @param {{ markers?: { start: string, end: string } }} [opts] Other START / END lines (Memory's Learn)
     */
    async watchCapsule(onFound, { markers } = {}) {
      const ignoreBody = readLatestCapsule(doc, replySelector, null, markers)?.body ?? null;
      let timer = null;
      const observer = new MutationObserver(() => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          const capsule = readLatestCapsule(doc, replySelector, ignoreBody, markers);
          if (!capsule) return;
          stop();
          onFound(capsule);
        }, 500);
      });
      const stop = () => { clearTimeout(timer); observer.disconnect(); };
      observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
      return stop;
    }
  };
}
