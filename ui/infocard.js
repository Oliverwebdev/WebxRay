/**
 * @fileoverview WEBXRAY Node Info Card
 * Overlay panel shown when a node is clicked.
 * Displays: domain, category, request count, data size, request type breakdown,
 * classification reason, and up to 5 recent request URLs.
 * Exports: initInfoCard, showInfoCard, hideInfoCard
 */

import { CATEGORY_COLORS } from '../graph/nodes.js';
import { getClassificationReason } from '../classifier.js';

/** @type {HTMLElement|null} Info card container element */
let cardEl = null;
/** @type {HTMLElement|null} Close button element */
let closeBtn = null;
/** @type {Function|null} Callback when close button is clicked */
let onCloseCallback = null;

/**
 * Convert a hex color number to a CSS rgb string.
 * @param {number} hex
 * @returns {string}
 */
function hexToCss(hex) {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8)  & 0xff;
  const b =  hex        & 0xff;
  return `rgb(${r},${g},${b})`;
}

/**
 * Format bytes into a human-readable size string.
 * @param {number} bytes
 * @returns {string} e.g. "1.4 KB" or "3.2 MB"
 */
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format request type breakdown into a readable string.
 * @param {Object.<string, number>} requestTypes
 * @returns {string} e.g. "3 scripts, 2 images, 1 xhr"
 */
function formatRequestTypes(requestTypes) {
  if (!requestTypes) return '—';
  return Object.entries(requestTypes)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count} ${type}`)
    .join(', ') || '—';
}

/** Basic HTML escaping to prevent XSS from domain names / URLs. */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Initialize the info card system.
 * @param {HTMLElement} el      - The info card container div
 * @param {Function} onClose    - Called when the user closes the card
 */
export function initInfoCard(el, onClose) {
  cardEl = el;
  onCloseCallback = onClose;

  closeBtn = el.querySelector('.wx-infocard-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      hideInfoCard();
      if (onCloseCallback) onCloseCallback();
    });
  }
}

/**
 * Show the info card populated with data from the clicked node.
 * @param {Object} nodeData - NodeData object with all request details
 */
export function showInfoCard(nodeData) {
  if (!cardEl || !nodeData) return;

  const {
    domain, category, requestCount, totalSize,
    requestTypes, urls,
  } = nodeData;

  const colorHex  = CATEGORY_COLORS[category] ?? CATEGORY_COLORS['unknown'];
  const colorCss  = hexToCss(colorHex);
  const reason    = getClassificationReason(category, domain);
  const recentUrls = (urls || []).slice(-5).reverse();

  const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);

  const urlsHtml = recentUrls.length > 0
    ? recentUrls.map((u) => `
        <div class="wx-url-item" title="${escapeHtml(u)}">${escapeHtml(truncateUrl(u))}</div>
      `).join('')
    : '<div class="wx-url-empty">No URLs recorded</div>';

  cardEl.innerHTML = `
    <button class="wx-infocard-close" aria-label="Close info card">✕</button>

    <div class="wx-infocard-domain">${escapeHtml(domain)}</div>

    <span class="wx-infocard-badge" style="background:${colorCss}20;border-color:${colorCss};color:${colorCss}">
      ${escapeHtml(categoryLabel)}
    </span>

    <div class="wx-infocard-grid">
      <div class="wx-infocard-stat">
        <div class="wx-stat-label">Requests</div>
        <div class="wx-stat-value">${requestCount}</div>
      </div>
      <div class="wx-infocard-stat">
        <div class="wx-stat-label">Data transferred</div>
        <div class="wx-stat-value">${formatSize(totalSize)}</div>
      </div>
    </div>

    <div class="wx-infocard-section">
      <div class="wx-section-label">Request types</div>
      <div class="wx-section-value">${escapeHtml(formatRequestTypes(requestTypes))}</div>
    </div>

    <div class="wx-infocard-section">
      <div class="wx-section-label">Classification</div>
      <div class="wx-section-value wx-classification-reason">${escapeHtml(reason)}</div>
    </div>

    <div class="wx-infocard-section">
      <div class="wx-section-label">Recent URLs (${recentUrls.length})</div>
      <div class="wx-urls-list">${urlsHtml}</div>
    </div>
  `;

  // Re-attach close button listener after innerHTML re-render
  const newCloseBtn = cardEl.querySelector('.wx-infocard-close');
  if (newCloseBtn) {
    newCloseBtn.addEventListener('click', () => {
      hideInfoCard();
      if (onCloseCallback) onCloseCallback();
    });
  }

  cardEl.classList.add('wx-infocard--visible');
}

/**
 * Hide the info card overlay.
 */
export function hideInfoCard() {
  if (cardEl) cardEl.classList.remove('wx-infocard--visible');
}

/**
 * Truncate a URL for display (max 60 chars from the end of the path).
 * @param {string} url
 * @returns {string}
 */
function truncateUrl(url) {
  if (url.length <= 60) return url;
  // Show protocol + host + truncated path
  try {
    const u = new URL(url);
    const hostPart = `${u.protocol}//${u.hostname}`;
    const pathPart = u.pathname + u.search;
    if (pathPart.length <= 35) return `${hostPart}${pathPart}`;
    return `${hostPart}…${pathPart.slice(-30)}`;
  } catch {
    return url.slice(0, 57) + '…';
  }
}
