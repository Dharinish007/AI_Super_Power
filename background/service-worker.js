/**
 * AI Context Monitor - Background Service Worker
 *
 * Ephemeral Manifest V3 Service Worker, stateless.
 * - Manages the toolbar badge (utilization percentage and alert color) per tab.
 * - The toolbar icon toggles the in-page widget (there is no popup).
 * Content scripts send only the badge numbers; nothing is stored here.
 */

// Colors for action badge based on context utilization
const BADGE_COLORS = {
  NORMAL: '#10a37f', // Green
  WARNING: '#f59e0b', // Amber (65-85%)
  CRITICAL: '#ef4444' // Red (>85%)
};

/**
 * Updates the extension toolbar badge for a specific tab.
 * @param {number|undefined} tabId
 * @param {number|null|undefined} percent Utilization; blank badge when null / undefined
 */
async function updateActionBadge(tabId, percent) {
  if (!chrome.action) return;

  try {
    if (percent === null || percent === undefined) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }

    const badgeText = `${Math.round(percent)}%`;
    await chrome.action.setBadgeText({ tabId, text: badgeText });

    let color = BADGE_COLORS.NORMAL;
    if (percent >= 85) {
      color = BADGE_COLORS.CRITICAL;
    } else if (percent >= 65) {
      color = BADGE_COLORS.WARNING;
    }

    await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch (err) {
    console.error('[AI Context Monitor] Badge update error:', err);
  }
}

// A full page load (refresh, or leaving the site) clears the badge; the new page's content script sets it again
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  if (chrome.action) chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});

// Context updates from content scripts: { percentage, awaitingData }
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'CONTEXT_UPDATED') return false;

  // Blank while the conversation is still loading, never "0%"
  const { percentage, awaitingData } = message.payload || {};
  updateActionBadge(sender.tab?.id, awaitingData ? null : percentage).then(() => sendResponse({ success: true }));
  return true; // Keep channel open for async response
});

// Toolbar icon: there is no popup (the in-page widget is the only context UI); a click shows / hides it
chrome.action?.onClicked.addListener((tab) => {
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' }).catch(() => {});
});
