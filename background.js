/**
 * @fileoverview WEBXRAY Service Worker
 * Intercepts all HTTP/HTTPS requests, classifies target domains,
 * and forwards classified metadata to the Side Panel via messaging.
 *
 * CRITICAL: This Service Worker is NOT persistent (MV3). Chrome can kill it
 * after 30s of inactivity. Never store accumulated state here.
 * Each request is processed and forwarded independently.
 */

import { init as initClassifier, classify } from './classifier.js';

// Initialize classifier on every SW startup — re-fetches domains.json
// First few requests may classify as 'unknown' before init completes.
initClassifier();

/**
 * Send a payload to the Side Panel, silently swallowing connection errors.
 * The Side Panel may not be open — this is expected, not an error.
 * @param {Object} payload - Message to send
 * @returns {Promise<void>}
 */
async function sendToSidePanel(payload) {
  try {
    await chrome.runtime.sendMessage(payload);
  } catch (error) {
    // Swallow: Side Panel not open, or message port closed
    if (
      error.message &&
      !error.message.includes('Could not establish connection') &&
      !error.message.includes('message port closed') &&
      !error.message.includes('The message port closed')
    ) {
      console.warn('[WEBXRAY]', error.message);
    }
  }
}

/**
 * Minimal state for tracking request IDs to domain/tab pairs.
 * Used to associate onCompleted size data with the correct domain.
 * Kept small (<500 entries) since SW can be killed at any time.
 * @type {Map<string, {domain: string, tabId: number}>}
 */
const pendingRequests = new Map();

/**
 * Core request interception listener.
 * Fires for every HTTP/HTTPS request the browser makes.
 * Extracts metadata, classifies the target domain, forwards to Side Panel.
 */
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Skip non-HTTP(S) requests (chrome://, extension://, data:, blob:, etc.)
    if (!details.url.startsWith('http:') && !details.url.startsWith('https:')) return;

    let requestDomain;
    let initiatorDomain = '';

    try {
      requestDomain = new URL(details.url).hostname;
    } catch {
      // Malformed URL — skip silently (data: and blob: URLs are common)
      return;
    }

    try {
      if (details.initiator) {
        initiatorDomain = new URL(details.initiator).hostname;
      }
    } catch {
      initiatorDomain = '';
    }

    const category = classify(requestDomain, initiatorDomain);

    // Track this request ID for size data from onCompleted
    pendingRequests.set(details.requestId, { domain: requestDomain, tabId: details.tabId });

    // Prune map to prevent unbounded growth (SW memory is limited)
    if (pendingRequests.size > 500) {
      const oldestKey = pendingRequests.keys().next().value;
      pendingRequests.delete(oldestKey);
    }

    sendToSidePanel({
      type: 'request',
      domain: requestDomain,
      category,
      requestType: details.type,
      tabId: details.tabId,
      timestamp: Date.now(),
      url: details.url,
    });
  },
  // No types filter — capture ALL request types: main_frame, script, image,
  // xmlhttprequest, ping, beacon, websocket, sub_frame, and more.
  { urls: ['<all_urls>'] }
);

/**
 * Response completion listener.
 * Extracts Content-Length to estimate bytes transferred per domain.
 * Sends size update to Side Panel for display in the info card.
 */
chrome.webRequest.onCompleted.addListener(
  (details) => {
    const pending = pendingRequests.get(details.requestId);
    if (!pending) return;
    pendingRequests.delete(details.requestId);

    if (!details.responseHeaders) return;

    const contentLengthHeader = details.responseHeaders.find(
      (h) => h.name.toLowerCase() === 'content-length'
    );
    if (!contentLengthHeader?.value) return;

    const size = parseInt(contentLengthHeader.value, 10);
    if (isNaN(size) || size <= 0) return;

    sendToSidePanel({
      type: 'sizeUpdate',
      domain: pending.domain,
      tabId: pending.tabId,
      size,
    });
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

/**
 * Tab activation listener.
 * When the user switches tabs, notify the Side Panel to reset the visualization.
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    let tabDomain = '';

    try {
      if (tab.url && (tab.url.startsWith('http:') || tab.url.startsWith('https:'))) {
        tabDomain = new URL(tab.url).hostname;
      }
    } catch {
      tabDomain = '';
    }

    sendToSidePanel({
      type: 'tabChanged',
      tabId: activeInfo.tabId,
      tabDomain,
    });
  } catch (error) {
    console.warn('[WEBXRAY] Tab activation error:', error.message);
  }
});

/**
 * Tab URL update listener.
 * Catches navigations within the same tab (e.g., SPA routing, full page loads).
 * Only fires the tabChanged signal when the active tab navigates.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only care about new page loads, not other state changes
  if (changeInfo.status !== 'loading' || !changeInfo.url) return;

  let tabDomain = '';
  try {
    if (changeInfo.url.startsWith('http:') || changeInfo.url.startsWith('https:')) {
      tabDomain = new URL(changeInfo.url).hostname;
    }
  } catch {
    return;
  }

  // Only notify if this is the currently active tab
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id === tabId) {
      sendToSidePanel({
        type: 'tabChanged',
        tabId,
        tabDomain,
      });
    }
  } catch {
    // Tab may have closed between query and message — ignore
  }
});

/**
 * Tab removal listener.
 * Notifies Side Panel when the visualized tab is closed.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  sendToSidePanel({
    type: 'tabRemoved',
    tabId,
  });
});
