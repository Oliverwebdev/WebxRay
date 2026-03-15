/**
 * @fileoverview WEBXRAY Statistics Bar
 * Displays a live-updating compact breakdown of domain counts by category.
 * Rendered as a fixed bar at the top of the Side Panel.
 * Exports: initStatsBar, updateStatsBar
 */

import { CATEGORY_COLORS } from '../graph/nodes.js';

/** @type {HTMLElement|null} Container element */
let container = null;

/** Human-readable labels for each category */
const CATEGORY_LABELS = {
  'first-party':    '1st party',
  'analytics':      'Analytics',
  'advertising':    'Ads',
  'social':         'Social',
  'tracker':        'Trackers',
  'fingerprinting': 'Fingerprint',
  'cryptomining':   'Cryptomining',
  'malicious':      'Malicious',
  'unknown':        'Unknown',
};

/** Display order for category badges */
const DISPLAY_ORDER = [
  'first-party', 'analytics', 'advertising', 'social',
  'tracker', 'fingerprinting', 'cryptomining', 'malicious', 'unknown',
];

/**
 * Convert a hex color number to a CSS rgb string.
 * @param {number} hex
 * @returns {string} e.g. "rgb(0, 212, 255)"
 */
function hexToCss(hex) {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8)  & 0xff;
  const b =  hex        & 0xff;
  return `rgb(${r},${g},${b})`;
}

/**
 * Initialize the statistics bar by binding to a container element.
 * @param {HTMLElement} el - The stats bar container div
 */
export function initStatsBar(el) {
  container = el;
  renderEmpty();
}

/**
 * Update the statistics bar with current node data.
 * @param {Map<string, Object>} nodes         - domain → NodeData
 * @param {number} [overflowCount=0]          - Count of nodes over the 200-cap
 */
export function updateStatsBar(nodes, overflowCount = 0) {
  if (!container) return;

  // Count domains by category (skip the central 'current' node)
  const counts = {};
  let totalDomains = 0;
  let totalRequests = 0;

  nodes.forEach((nodeData) => {
    if (nodeData.category === 'current') return;
    const cat = nodeData.category;
    counts[cat] = (counts[cat] || 0) + 1;
    totalDomains++;
    totalRequests += nodeData.requestCount;
  });

  // Build HTML
  const badges = DISPLAY_ORDER
    .filter((cat) => counts[cat] > 0)
    .map((cat) => {
      const color = hexToCss(CATEGORY_COLORS[cat] || 0x6B7280);
      return `<span class="wx-badge" style="background:${color}20;border-color:${color};color:${color}">
        ${CATEGORY_LABELS[cat]} <strong>${counts[cat]}</strong>
      </span>`;
    })
    .join('');

  const overflowBadge = overflowCount > 0
    ? `<span class="wx-badge wx-badge--overflow">+${overflowCount} more</span>`
    : '';

  container.innerHTML = `
    <div class="wx-stats-summary">
      <span class="wx-stats-total"><strong>${totalDomains}</strong> domains</span>
      <span class="wx-stats-requests">${totalRequests} requests</span>
    </div>
    <div class="wx-stats-badges">${badges}${overflowBadge}</div>
  `;
}

/** Render the initial empty state. */
function renderEmpty() {
  if (!container) return;
  container.innerHTML = `
    <div class="wx-stats-summary">
      <span class="wx-stats-total"><strong>0</strong> domains</span>
      <span class="wx-stats-requests">0 requests</span>
    </div>
    <div class="wx-stats-badges">
      <span class="wx-stats-waiting">Waiting for traffic…</span>
    </div>
  `;
}
