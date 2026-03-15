/**
 * @fileoverview WEBXRAY Side Panel Orchestrator
 * Receives classified request data from the Service Worker,
 * maintains the graph data model, and drives the 3D visualization.
 *
 * Data model:
 *   nodes: Map<domain, NodeData>
 *   edges: Map<"src->dst", EdgeData>
 *
 * NodeData: { domain, category, requestCount, totalSize, lastSeen,
 *             mesh, position{x,y,z}, velocity{x,y,z}, urls[], requestTypes{},
 *             pinned, _glowPulseTime }
 * EdgeData: { sourceDomain, targetDomain, requestCount, lastPulse, mesh }
 */

import { initScene, getScene, getCamera, getRenderer, startRenderLoop } from './graph/scene.js';
import { CATEGORY_COLORS, createCentralNode, createSatelliteNode, updateNodes, disposeAllNodes } from './graph/nodes.js';
import { createEdge, pulseEdge, updateEdges, disposeAllEdges } from './graph/edges.js';
import { ForceLayout } from './graph/layout.js';
import { initInteraction, clearClickedNode, resetInteraction } from './graph/interaction.js';
import { initStatsBar, updateStatsBar } from './ui/statsbar.js';
import { initInfoCard, showInfoCard, hideInfoCard } from './ui/infocard.js';
import { captureScreenshot } from './ui/screenshot.js';

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------
const MAX_NODES     = 200;
const MAX_URLS      = 20;   // Max stored URLs per node
const SPAWN_RADIUS  = { min: 3, max: 5 }; // Units from center on new node spawn

// -------------------------------------------------------------------
// State
// -------------------------------------------------------------------
/** @type {Map<string, Object>} Live node data */
const nodes = new Map();
/** @type {Map<string, Object>} Live edge data */
const edges = new Map();

let activeTabId    = null;
let currentDomain  = '';
let currentPageUrl = '';
let overflowCount  = 0;
let frameCount     = 0;

/** @type {ForceLayout} */
let layout = null;

// -------------------------------------------------------------------
// DOM references (bound after DOMContentLoaded)
// -------------------------------------------------------------------
let canvas, statsBar, tooltip, infoCard, screenshotBtn, emptyState;

// -------------------------------------------------------------------
// Initialization
// -------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  canvas       = document.getElementById('wx-canvas');
  statsBar     = document.getElementById('wx-statsbar');
  tooltip      = document.getElementById('wx-tooltip');
  infoCard     = document.getElementById('wx-infocard');
  screenshotBtn = document.getElementById('wx-screenshot-btn');
  emptyState   = document.getElementById('wx-empty-state');

  // Three.js scene
  initScene(canvas);

  // UI components
  initStatsBar(statsBar);
  initInfoCard(infoCard, () => {
    clearClickedNode();
    hideInfoCard();
  });

  // Interaction (hover + click raycasting)
  initInteraction(
    getCamera(), canvas, nodes, tooltip,
    (nodeData) => showInfoCard(nodeData),
    () => hideInfoCard()
  );

  // Screenshot / Share button
  screenshotBtn.addEventListener('click', () => {
    const trackerCount = countTrackers();
    // nodes.size - 1 excludes the central node from the "third-party" count
    captureScreenshot(getRenderer(), currentPageUrl, Math.max(0, nodes.size - 1), trackerCount);
  });

  // Layout engine
  layout = new ForceLayout();

  // Start render loop — physics + mesh updates happen here each frame
  startRenderLoop(onFrame);

  // Register message listener BEFORE the async tab query so no messages are lost
  chrome.runtime.onMessage.addListener(handleMessage);

  // Bootstrap: find the current active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      activeTabId = tab.id;
      if (tab.url && (tab.url.startsWith('http:') || tab.url.startsWith('https:'))) {
        currentPageUrl = tab.url;
        const domain = new URL(tab.url).hostname;
        initializeCentralNode(domain);
      } else {
        showEmptyState();
      }
    }
  } catch (err) {
    console.warn('[WEBXRAY] Could not query active tab:', err.message);
    showEmptyState();
  }

  console.log('[WEBXRAY] Side Panel ready');
});

// -------------------------------------------------------------------
// Message Handler
// -------------------------------------------------------------------

/**
 * Route incoming messages from background.js.
 * @param {Object} message
 */
function handleMessage(message) {
  try {
    switch (message.type) {
      case 'request':    handleRequest(message);    break;
      case 'sizeUpdate': handleSizeUpdate(message); break;
      case 'tabChanged': handleTabChanged(message); break;
      case 'tabRemoved': handleTabRemoved(message); break;
    }
  } catch (err) {
    console.warn('[WEBXRAY] Message handler error:', err.message);
  }
}

/**
 * Handle a new classified request from the Service Worker.
 * @param {{ domain, category, requestType, tabId, timestamp, url }} msg
 */
function handleRequest({ domain, category, requestType, tabId, timestamp, url }) {
  // Ignore requests not from the active tab
  if (tabId !== activeTabId) return;
  // Ignore the central node's own domain (it's already shown as central)
  if (domain === currentDomain && category === 'first-party') {
    // Still count it but don't create a satellite for the exact central domain
    const central = nodes.get(currentDomain);
    if (central) {
      central.requestCount++;
      central.lastSeen = timestamp;
    }
    updateStatsBar(nodes, overflowCount);
    return;
  }

  if (nodes.has(domain)) {
    // Update existing node
    const nodeData = nodes.get(domain);
    nodeData.requestCount++;
    nodeData.lastSeen = timestamp;
    nodeData.urls.push(url);
    if (nodeData.urls.length > MAX_URLS) nodeData.urls.shift();
    nodeData.requestTypes[requestType] = (nodeData.requestTypes[requestType] || 0) + 1;

    // Pulse the edge
    const edgeKey = `${currentDomain}->${domain}`;
    const edgeData = edges.get(edgeKey);
    if (edgeData) {
      pulseEdge(edgeData);
      edgeData.requestCount++;
    }
  } else if (nodes.size < MAX_NODES + 1) { // +1 for central node
    createNewSatelliteNode(domain, category, requestType, timestamp, url);
  } else {
    // Over the 200-node cap — increment overflow counter and update cluster node
    overflowCount++;
    updateOverflowCluster();
  }

  updateStatsBar(nodes, overflowCount);
}

/**
 * Handle a size update from the Service Worker (Content-Length from response).
 * @param {{ domain, tabId, size }} msg
 */
function handleSizeUpdate({ domain, tabId, size }) {
  if (tabId !== activeTabId) return;
  const nodeData = nodes.get(domain);
  if (nodeData) {
    nodeData.totalSize = (nodeData.totalSize || 0) + size;
  }
}

/**
 * Handle a tab switch — reset visualization for the new tab.
 * @param {{ tabId, tabDomain }} msg
 */
function handleTabChanged({ tabId, tabDomain }) {
  activeTabId   = tabId;
  currentPageUrl = tabDomain ? `https://${tabDomain}/` : '';

  resetVisualization();

  if (tabDomain) {
    initializeCentralNode(tabDomain);
    hideEmptyState();
  } else {
    showEmptyState();
  }
}

/**
 * Handle tab removal — show empty state if it was our tab.
 * @param {{ tabId }} msg
 */
function handleTabRemoved({ tabId }) {
  if (tabId === activeTabId) {
    resetVisualization();
    showEmptyState();
  }
}

// -------------------------------------------------------------------
// Graph management
// -------------------------------------------------------------------

/**
 * Create and register the central (current site) node.
 * @param {string} domain
 */
function initializeCentralNode(domain) {
  currentDomain = domain;
  const scene = getScene();

  const mesh = createCentralNode(scene);
  const nodeData = {
    domain,
    category: 'current',
    requestCount: 0,
    totalSize: 0,
    lastSeen: Date.now(),
    mesh,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    pinned: true,  // Central node never moves
    urls: [],
    requestTypes: {},
  };

  nodes.set(domain, nodeData);
  layout.addNode(domain);
  console.log('[WEBXRAY] Central node:', domain);
}

/**
 * Create a new satellite node for a third-party domain.
 * Assigns a random spawn position near the center, creates the mesh and edge.
 * @param {string} domain
 * @param {string} category
 * @param {string} requestType
 * @param {number} timestamp
 * @param {string} url
 */
function createNewSatelliteNode(domain, category, requestType, timestamp, url) {
  const scene = getScene();
  if (!scene) return;

  // Random spherical spawn position near the central node
  const angle = Math.random() * Math.PI * 2;
  const polar  = Math.random() * Math.PI;
  const radius = SPAWN_RADIUS.min + Math.random() * (SPAWN_RADIUS.max - SPAWN_RADIUS.min);
  const position = {
    x: radius * Math.sin(polar) * Math.cos(angle),
    y: radius * Math.sin(polar) * Math.sin(angle),
    z: radius * Math.cos(polar),
  };

  const mesh = createSatelliteNode(category, position, scene);
  const nodeData = {
    domain,
    category,
    requestCount: 1,
    totalSize: 0,
    lastSeen: timestamp,
    mesh,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    pinned: false,
    urls: [url],
    requestTypes: { [requestType]: 1 },
    _glowPulseTime: Date.now(),
  };

  nodes.set(domain, nodeData);
  layout.addNode(domain);

  // Create edge from central node to this satellite
  const centralNode = nodes.get(currentDomain);
  if (centralNode) {
    const edgeKey = `${currentDomain}->${domain}`;
    const colorHex = CATEGORY_COLORS[category] ?? CATEGORY_COLORS['unknown'];
    const edgeMesh = createEdge(centralNode, nodeData, colorHex, scene);
    const edgeData = {
      sourceDomain: currentDomain,
      targetDomain: domain,
      requestCount: 1,
      lastPulse: Date.now(),
      mesh: edgeMesh,
    };
    edges.set(edgeKey, edgeData);
    layout.addEdge(currentDomain, domain);
  }
}

/**
 * Update or create the overflow cluster node ("+N more domains").
 */
function updateOverflowCluster() {
  const OVERFLOW_KEY = '__overflow__';
  if (nodes.has(OVERFLOW_KEY)) {
    const cluster = nodes.get(OVERFLOW_KEY);
    cluster.domain = `+${overflowCount} more domains`;
    cluster.requestCount++;
    if (cluster.mesh) {
      // Scale the cluster node larger as overflow grows
      const s = 1 + Math.log1p(overflowCount) * 0.2;
      cluster.mesh.scale.setScalar(s);
    }
  } else {
    // Create the overflow cluster node for the first time
    const scene = getScene();
    if (!scene) return;
    const position = { x: -8, y: 3, z: 0 };
    const mesh = createSatelliteNode('unknown', position, scene);
    mesh.scale.setScalar(1.3);

    const nodeData = {
      domain: `+${overflowCount} more domains`,
      category: 'unknown',
      requestCount: 1,
      totalSize: 0,
      lastSeen: Date.now(),
      mesh,
      position,
      velocity: { x: 0, y: 0, z: 0 },
      pinned: false,
      urls: [],
      requestTypes: {},
    };
    nodes.set(OVERFLOW_KEY, nodeData);
    layout.addNode(OVERFLOW_KEY);
  }
}

/**
 * Count domains in high-threat categories for the screenshot overlay.
 * @returns {number}
 */
function countTrackers() {
  let count = 0;
  const flagged = new Set(['tracker', 'fingerprinting', 'cryptomining', 'malicious', 'advertising']);
  nodes.forEach((n) => {
    if (flagged.has(n.category)) count++;
  });
  return count;
}

// -------------------------------------------------------------------
// Render loop callback
// -------------------------------------------------------------------

/**
 * Called every animation frame by scene.js.
 * Updates physics layout, then syncs mesh positions.
 */
function onFrame() {
  frameCount++;

  // Physics
  layout.tick(nodes, frameCount);

  // Sync Three.js mesh positions from physics positions
  nodes.forEach((nodeData) => {
    if (nodeData.mesh && !nodeData.pinned) {
      nodeData.mesh.position.set(
        nodeData.position.x,
        nodeData.position.y,
        nodeData.position.z
      );
    }
  });

  // Update edge cylinders (position + opacity decay)
  updateEdges(nodes, edges);

  // Update node glow pulse decays
  updateNodes(nodes);
}

// -------------------------------------------------------------------
// Visualization reset (tab switch / page load)
// -------------------------------------------------------------------

/**
 * Dispose all Three.js objects and reset state.
 * CRITICAL: Every geometry and material must be disposed to prevent memory leaks.
 */
function resetVisualization() {
  const scene = getScene();
  if (scene) {
    disposeAllEdges(edges, scene);
    disposeAllNodes(nodes, scene);
  }

  layout.reset();
  resetInteraction();
  hideInfoCard();

  overflowCount = 0;
  currentDomain = '';
  frameCount    = 0;

  updateStatsBar(nodes, 0);
  console.log('[WEBXRAY] Visualization reset');
}

// -------------------------------------------------------------------
// Empty state
// -------------------------------------------------------------------

function showEmptyState() {
  if (emptyState) emptyState.classList.add('wx-empty--visible');
  if (canvas) canvas.style.opacity = '0.1';
}

function hideEmptyState() {
  if (emptyState) emptyState.classList.remove('wx-empty--visible');
  if (canvas) canvas.style.opacity = '1';
}
