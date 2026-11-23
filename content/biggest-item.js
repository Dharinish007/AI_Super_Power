/**
 * Context Monitor - Biggest Item Extractor & Ranker
 *
 * Identifies and ranks messages/attachments/tools in the current chat:
 * - Ranks items by token count descending.
 * - Distinguishes between:
 *   - 'message': user or assistant turns
 *   - 'attachment': uploaded files/images
 *   - 'tool': tool executions (e.g. web search, code interpreter, artifacts)
 * - Flags if derived from visible DOM only ("visible messages only").
 * - Returns target DOM element (or selector/turn index) so clicking can scroll to it.
 */

export function extractBiggestItem(conversationData = {}) {
  const { messages = [], attachments = [], tools = [], isDomPartial = false, domTurns = [] } = conversationData;
  const candidates = [];

  // 1. Evaluate messages
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    const tokens = typeof m.tokens === 'number' ? m.tokens : 0;
    if (tokens <= 0) continue;
    const role = m.role === 'user' ? 'You' : (m.role === 'assistant' ? (m.provider || 'Assistant') : 'System');
    const turnNum = m.turn ?? (i + 1);
    candidates.push({
      type: 'message',
      label: `${role} (#${turnNum})`,
      tokens,
      role: m.role,
      turn: turnNum,
      id: m.id || null,
      element: m.element || null,
      visibleOnly: Boolean(isDomPartial)
    });
  }

  // 2. Evaluate attachments
  for (const a of attachments) {
    if (!a) continue;
    const tokens = typeof a.tokens === 'number' ? a.tokens : 0;
    if (tokens <= 0) continue;
    candidates.push({
      type: 'attachment',
      label: `Attachment: ${a.name || 'file'}`,
      name: a.name || 'file',
      tokens,
      element: a.element || null,
      visibleOnly: Boolean(isDomPartial)
    });
  }

  // 3. Evaluate tools
  for (const t of tools) {
    if (!t) continue;
    const tokens = typeof t.tokens === 'number' ? t.tokens : 0;
    if (tokens <= 0) continue;
    candidates.push({
      type: 'tool',
      label: `Tool: ${t.name || 'output'}`,
      name: t.name || 'output',
      tokens,
      element: t.element || null,
      visibleOnly: Boolean(isDomPartial)
    });
  }

  // Fallback: If no structured messages, scan domTurns
  if (candidates.length === 0 && Array.isArray(domTurns)) {
    for (let i = 0; i < domTurns.length; i++) {
      const dt = domTurns[i];
      if (!dt || !dt.tokens) continue;
      candidates.push({
        type: 'message',
        label: `${dt.role === 'user' ? 'You' : 'Assistant'} (#${i + 1})`,
        tokens: dt.tokens,
        role: dt.role,
        turn: i + 1,
        element: dt.element || null,
        visibleOnly: true
      });
    }
  }

  if (candidates.length === 0) return null;

  // Sort descending by tokens
  candidates.sort((a, b) => b.tokens - a.tokens);
  return candidates[0];
}

/**
 * Formats biggest item for display in the drawer.
 * @param {Object|null} item
 * @param {Function} [formatTokensFn]
 * @returns {{ text: string, sub: string, item: Object }|null}
 */
export function formatBiggestItemDisplay(item, formatTokensFn) {
  if (!item || !item.tokens) return null;
  const label = item.label || `${item.role === 'user' ? 'You' : (item.role === 'assistant' ? 'Assistant' : 'Item')} (#${item.turn || 1})`;
  const tokenStr = formatTokensFn ? formatTokensFn(item.tokens) : `${Math.round(item.tokens / 100) / 10}K`;
  const text = `${label} · ~${tokenStr}`;
  const sub = item.visibleOnly ? 'visible messages only' : '';
  return {
    text,
    sub,
    item
  };
}

/**
 * Scrolls the DOM element into view smoothly when clicked.
 * @param {Element|null} element
 */
export function scrollToItem(element) {
  if (!element || typeof element.scrollIntoView !== 'function') return false;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}
