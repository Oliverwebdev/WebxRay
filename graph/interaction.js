/**
 * @fileoverview WEBXRAY Interaction Handler
 * Raycasting for mouse hover and click detection against graph nodes.
 * Hover: tooltip with domain name + category.
 * Click: pin node (stop physics), show full info card.
 * Exports: initInteraction, updateInteraction, getHoveredNode, getClickedNode
 */

/* global THREE */

/** @type {THREE.Raycaster} */
let raycaster = null;
/** @type {THREE.Vector2} Normalized mouse position */
const mouse = new THREE.Vector2(-99, -99);
/** @type {THREE.Camera} */
let _camera = null;
/** @type {HTMLCanvasElement} */
let _canvas = null;
/** @type {Map<string, Object>} Reference to nodes Map */
let _nodes = null;

/** @type {Object|null} Currently hovered NodeData */
let hoveredNode = null;
/** @type {Object|null} Currently clicked/pinned NodeData */
let clickedNode = null;

/** @type {HTMLElement|null} Tooltip DOM element */
let tooltipEl = null;
/** @type {Function|null} Called when a node is clicked with NodeData argument */
let onClickCallback = null;
/** @type {Function|null} Called when background is clicked (hide info card) */
let onBgClickCallback = null;

/**
 * Initialize the interaction system.
 * @param {THREE.Camera} camera
 * @param {HTMLCanvasElement} canvas
 * @param {Map<string, Object>} nodes         - Live reference to nodes Map
 * @param {HTMLElement} tooltip               - Tooltip DOM element to position
 * @param {Function} onNodeClick              - Called with NodeData when a node is clicked
 * @param {Function} onBackgroundClick        - Called when canvas clicked with no node
 */
export function initInteraction(camera, canvas, nodes, tooltip, onNodeClick, onBackgroundClick) {
  _camera = camera;
  _canvas = canvas;
  _nodes  = nodes;
  tooltipEl = tooltip;
  onClickCallback = onNodeClick;
  onBgClickCallback = onBackgroundClick;

  raycaster = new THREE.Raycaster();
  raycaster.params.Mesh.threshold = 0.5; // Slightly forgiving hit radius

  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mouseleave', () => {
    hideTooltip();
    clearHover();
  });
}

/** @param {MouseEvent} e */
function onMouseMove(e) {
  updateMouseCoords(e);
  if (!raycaster || !_camera || !_nodes) return;

  const meshes = collectMeshes();
  raycaster.setFromCamera(mouse, _camera);
  const intersects = raycaster.intersectObjects(meshes, false);

  const hit = intersects.length > 0 ? intersects[0].object : null;
  const hitNodeData = hit ? findNodeByMesh(hit) : null;

  if (hitNodeData !== hoveredNode) {
    if (hoveredNode && hoveredNode !== clickedNode) {
      clearHighlight(hoveredNode);
    }
    hoveredNode = hitNodeData;
    if (hoveredNode) {
      highlightNode(hoveredNode);
      showTooltip(hoveredNode, e);
    } else {
      hideTooltip();
    }
  } else if (hoveredNode) {
    // Update tooltip position as mouse moves
    updateTooltipPosition(e);
  }
}

/** @param {MouseEvent} e */
function onCanvasClick(e) {
  updateMouseCoords(e);
  if (!raycaster || !_camera || !_nodes) return;

  const meshes = collectMeshes();
  raycaster.setFromCamera(mouse, _camera);
  const intersects = raycaster.intersectObjects(meshes, false);

  if (intersects.length > 0) {
    const nodeData = findNodeByMesh(intersects[0].object);
    if (nodeData) {
      // Unpin previous clicked node
      if (clickedNode && clickedNode !== nodeData) {
        clickedNode.pinned = false;
        clearHighlight(clickedNode);
      }
      clickedNode = nodeData;
      nodeData.pinned = true;
      highlightNode(nodeData);
      hideTooltip();
      if (onClickCallback) onClickCallback(nodeData);
      return;
    }
  }

  // Clicked background — unpin and hide info card
  if (clickedNode) {
    clickedNode.pinned = false;
    clearHighlight(clickedNode);
    clickedNode = null;
  }
  if (onBgClickCallback) onBgClickCallback();
}

/** Collect only the top-level node meshes (exclude glow children). */
function collectMeshes() {
  const meshes = [];
  if (!_nodes) return meshes;
  _nodes.forEach((nodeData) => {
    if (nodeData.mesh) meshes.push(nodeData.mesh);
  });
  return meshes;
}

/** Find NodeData whose mesh matches the given Three.js object. */
function findNodeByMesh(mesh) {
  let found = null;
  _nodes.forEach((nodeData) => {
    if (nodeData.mesh === mesh) found = nodeData;
  });
  return found;
}

/** @param {MouseEvent} e */
function updateMouseCoords(e) {
  if (!_canvas) return;
  const rect = _canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
  mouse.y = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
}

function highlightNode(nodeData) {
  if (!nodeData?.mesh) return;
  nodeData.mesh.scale.setScalar(1.4);
  const glow = nodeData.mesh.userData.glow;
  if (glow) glow.material.opacity = 0.35;
}

function clearHighlight(nodeData) {
  if (!nodeData?.mesh) return;
  nodeData.mesh.scale.setScalar(1.0);
  const glow = nodeData.mesh.userData.glow;
  if (glow) glow.material.opacity = 0.12;
}

function clearHover() {
  if (hoveredNode && hoveredNode !== clickedNode) {
    clearHighlight(hoveredNode);
  }
  hoveredNode = null;
}

/** @param {Object} nodeData @param {MouseEvent} e */
function showTooltip(nodeData, e) {
  if (!tooltipEl) return;
  const { domain, category, requestCount } = nodeData;
  tooltipEl.innerHTML = `
    <span class="wx-tooltip-domain">${escapeHtml(domain)}</span>
    <span class="wx-tooltip-meta">${category} · ${requestCount} req</span>
  `;
  tooltipEl.classList.add('wx-tooltip--visible');
  updateTooltipPosition(e);
}

/** @param {MouseEvent} e */
function updateTooltipPosition(e) {
  if (!tooltipEl || !_canvas) return;
  const rect = _canvas.getBoundingClientRect();
  let x = e.clientX - rect.left + 14;
  let y = e.clientY - rect.top  - 10;

  // Keep tooltip within canvas bounds
  const tipW = tooltipEl.offsetWidth  || 180;
  const tipH = tooltipEl.offsetHeight || 50;
  if (x + tipW > rect.width)  x = e.clientX - rect.left - tipW - 14;
  if (y + tipH > rect.height) y = e.clientY - rect.top  - tipH - 10;

  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top  = `${y}px`;
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.classList.remove('wx-tooltip--visible');
}

/** Basic HTML escaping to prevent XSS in domain names. */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Returns the currently hovered NodeData or null.
 * @returns {Object|null}
 */
export function getHoveredNode() { return hoveredNode; }

/**
 * Returns the currently clicked/pinned NodeData or null.
 * @returns {Object|null}
 */
export function getClickedNode() { return clickedNode; }

/**
 * Programmatically clear the pinned node (called from info card close button).
 */
export function clearClickedNode() {
  if (clickedNode) {
    clickedNode.pinned = false;
    clearHighlight(clickedNode);
    clickedNode = null;
  }
}

/**
 * Clean up all interaction state and event listeners.
 * Call on tab switch / scene disposal.
 */
export function resetInteraction() {
  hoveredNode = null;
  clickedNode = null;
  hideTooltip();
  // Note: event listeners persist on canvas — they reference the live _nodes Map
  // which will be empty after disposeAllNodes(), so raycasting will find nothing.
}
