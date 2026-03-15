/**
 * @fileoverview WEBXRAY Popup
 * Minimal popup — opens the Side Panel and shows quick stats for the active tab.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const openBtn  = document.getElementById('wx-open-panel');
  const statsDiv = document.getElementById('wx-popup-stats');

  // Open the Side Panel when the button is clicked
  openBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      }
      window.close();
    } catch (err) {
      console.warn('[WEBXRAY] Could not open side panel:', err.message);
    }
  });

  // Load quick stats from chrome.storage.local (written by side panel)
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !tab.url.startsWith('http')) {
      renderStats(statsDiv, null);
      return;
    }

    const domain = new URL(tab.url).hostname;
    const key = `stats_${tab.id}`;
    const result = await chrome.storage.local.get(key);
    const stats  = result[key] || null;
    renderStats(statsDiv, stats, domain);
  } catch {
    renderStats(statsDiv, null);
  }
});

/**
 * Render quick stats into the popup stats area.
 * @param {HTMLElement} el
 * @param {Object|null} stats
 * @param {string} [domain]
 */
function renderStats(el, stats, domain) {
  if (!stats) {
    el.innerHTML = `
      <div class="wx-ps-domain">${domain ? escapeHtml(domain) : 'No active page'}</div>
      <div class="wx-ps-hint">Open the panel to start scanning.</div>
    `;
    el.classList.remove('wx-popup-stats--loading');
    return;
  }

  const { totalDomains = 0, totalRequests = 0, trackerCount = 0 } = stats;
  el.innerHTML = `
    <div class="wx-ps-domain">${escapeHtml(domain || '')}</div>
    <div class="wx-ps-row">
      <span class="wx-ps-num">${totalDomains}</span>
      <span class="wx-ps-label">domains</span>
    </div>
    <div class="wx-ps-row">
      <span class="wx-ps-num wx-ps-num--red">${trackerCount}</span>
      <span class="wx-ps-label">flagged</span>
    </div>
    <div class="wx-ps-row">
      <span class="wx-ps-num">${totalRequests}</span>
      <span class="wx-ps-label">requests</span>
    </div>
  `;
  el.classList.remove('wx-popup-stats--loading');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
