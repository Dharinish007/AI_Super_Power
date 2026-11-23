/**
 * Context Monitor - Checkpoint Export Engine
 *
 * Exports user's selected message range (default last 20 user messages) as Markdown:
 * - Version 1 uses NO AI.
 * - Exports ONLY user's own visible messages.
 * - Preserves code fences (```) verbatim.
 * - Includes a "carry-over" summary header.
 */

/**
 * Builds checkpoint Markdown text.
 * @param {Array<{ role: string, text: string, turn?: number, tokens?: number }>} messages
 * @param {{
 *   title?: string,
 *   model?: string,
 *   usedTokens?: number|null,
 *   contextLimit?: number|null,
 *   percentage?: number|null,
 *   range?: number,
 *   timestamp?: number
 * }} [options]
 * @returns {string} Markdown text
 */
export function buildCheckpointMarkdown(messages = [], options = {}) {
  const {
    title = 'Conversation Checkpoint',
    model = 'Unknown Model',
    usedTokens = null,
    contextLimit = null,
    percentage = null,
    range = 20,
    timestamp = Date.now()
  } = options;

  // Filter ONLY user's own messages
  const userMessages = (messages || []).filter(m => m && m.role === 'user' && typeof m.text === 'string' && m.text.trim().length > 0);

  // Take the last `range` messages (default 20)
  const sliceStart = Math.max(0, userMessages.length - range);
  const selected = userMessages.slice(sliceStart);

  const dateStr = new Date(timestamp).toLocaleString();
  const pctStr = percentage !== null && percentage !== undefined ? `${Math.round(percentage)}%` : 'Unknown %';
  const usedStr = usedTokens ? `${Math.round(usedTokens).toLocaleString()} tokens` : 'Unknown';
  const limitStr = contextLimit ? `${Math.round(contextLimit).toLocaleString()} tokens` : 'Unknown limit';

  let md = `# Checkpoint Export: ${title}\n`;
  md += `*Generated on ${dateStr} by AI Context Monitor (Local Checkpoint)*\n\n`;

  // Carry-over section
  md += `## Carry-over Summary\n`;
  md += `- **Model**: ${model}\n`;
  md += `- **Context Utilization**: ${usedStr} / ${limitStr} (${pctStr})\n`;
  md += `- **Exported Messages**: ${selected.length} user message(s) (last ${Math.min(range, selected.length)})\n\n`;
  md += `---\n\n`;

  // Selected Messages
  md += `## Selected Messages\n\n`;

  if (selected.length === 0) {
    md += `*(No visible user messages found in selected range)*\n`;
  } else {
    for (let i = 0; i < selected.length; i++) {
      const msg = selected[i];
      const num = i + 1;
      const turnLabel = msg.turn ? ` (Turn #${msg.turn})` : '';
      md += `### ${num}. You${turnLabel}\n\n`;
      md += `${msg.text.trim()}\n\n`;
    }
  }

  return md;
}

/**
 * Triggers a file download in the browser for the markdown content.
 * @param {string} markdown
 * @param {string} [filename]
 * @returns {boolean}
 */
export function downloadMarkdownFile(markdown, filename = 'context-checkpoint.md') {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
  try {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (_) {
    return false;
  }
}
