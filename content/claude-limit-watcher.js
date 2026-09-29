/**
 * Context Monitor - Claude usage-limit watcher (MAIN world, claude.ai only)
 *
 * claude.ai reports plan limits (5-hour session, 7-day weekly) inside each reply's stream as a
 * `message_limit` event, not through /usage on every plan. This passively reads a clone of the
 * completion stream and forwards ONLY that event's object to the extension. Message text, headers
 * and cookies are never read or forwarded; the page's own request is never altered.
 */
(function () {
  'use strict';
  if (window.__CONTEXT_MONITOR_CLAUDE_LIMITS__) return;
  window.__CONTEXT_MONITOR_CLAUDE_LIMITS__ = true;

  const SOURCE = 'CONTEXT_MONITOR_CLAUDE_LIMIT';
  const COMPLETION_RE = /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/(retry_)?completion(\?|$)/;

  const send = (messageLimit) => {
    try { window.postMessage({ source: SOURCE, messageLimit }, window.location.origin); } catch (_) {}
  };

  /** Finds a limits object ({ windows: ... }) in a rejected request's body (nested JSON in error.message). */
  function limitFromError(text) {
    try {
      const body = JSON.parse(text);
      const inner = typeof body?.error?.message === 'string' ? JSON.parse(body.error.message) : body?.error;
      if (inner && inner.windows) send(inner);
    } catch (_) {}
  }

  async function watch(response) {
    if (!response.ok) return limitFromError(await response.text());
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        // Cheap filter first: only the limit event is ever parsed
        if (!line.startsWith('data:') || !line.includes('message_limit')) continue;
        try {
          const evt = JSON.parse(line.slice(5));
          if (evt?.type === 'message_limit' && evt.message_limit) send(evt.message_limit);
        } catch (_) {}
      }
    }
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (COMPLETION_RE.test(url)) {
        promise.then(res => watch(res.clone())).catch(() => {}); // Never affects the page's request
      }
    } catch (_) {}
    return promise;
  };
})();
