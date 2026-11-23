/**
 * ChatGPT Context Monitor - Tool Detector
 *
 * Observes client-side indicators of Web Search, Python / Advanced Data Analysis,
 * Memory updates, and Connected Apps / MCP invocations.
 *
 * In strict adherence to project accuracy rules:
 * Tool executions are classified as OBSERVED, while their underlying context
 * token impact (retrieved search snippets, memory vectors, tool schemas)
 * remains classified as UNKNOWN.
 */

// One entry per tool type: selectors, and the label (with a count where the page shows one per call)
const TOOLS = [
  { type: 'web_search', selector: "button[aria-label*='Searched'], div[class*='search-pill'], [data-testid='web-search-citations']",
    label: (n) => `Web Search (${n} action${n > 1 ? 's' : ''})` },
  { type: 'code_interpreter', selector: "div[data-testid='code-execution'], button[aria-label*='Ran Python'], button[aria-label*='Finished analyzing']",
    label: (n) => `Python Code Interpreter (${n} execution${n > 1 ? 's' : ''})` },
  { type: 'memory', selector: "div[data-testid='memory-updated'], button[aria-label*='Memory updated'], button[aria-label*='Memory accessed']",
    label: () => 'Memory Reference / Update' },
  { type: 'canvas', selector: "[data-testid='canvas-container'], button[aria-label*='Open canvas']",
    label: () => 'Canvas Editor / Artifact' },
  { type: 'apps_mcp', selector: "[data-testid='mcp-tool-pill'], [data-testid='connected-app-pill'], button[aria-label*='Used tool']",
    label: (n) => `Apps / MCP Tools (${n} call${n > 1 ? 's' : ''})` }
];

/**
 * Elements matching each selector group, in document order, from ONE page traversal instead of one per
 * group (an element matching several groups is listed in each, exactly as separate queries did).
 * @param {Document|Element} root
 * @param {string[]} groups
 * @returns {Element[][]}
 */
export function queryGroups(root, groups) {
  const all = Array.from(root.querySelectorAll(groups.join(', ')) || []);
  if (all.length === 0) return groups.map(() => []);
  if (typeof all[0].matches !== 'function') return groups.map(g => Array.from(root.querySelectorAll(g) || []));
  return groups.map(g => all.filter(el => el.matches(g)));
}

export class ToolDetector {
  /**
   * Scans DOM for tool indicators.
   * @param {Document|HTMLElement} root
   * @returns {{ observed: boolean, list: Array<{ type: string, label: string, status: string, tokenStatus: string }> }}
   */
  detect(root = document) {
    const found = queryGroups(root, TOOLS.map(t => t.selector));
    const list = TOOLS
      .map((t, i) => (found[i].length ? { type: t.type, label: t.label(found[i].length), status: 'OBSERVED', tokenStatus: 'UNKNOWN' } : null))
      .filter(Boolean);
    return { observed: list.length > 0, list };
  }
}
