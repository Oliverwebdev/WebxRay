/**
 * @fileoverview WEBXRAY Node Rendering
 * Creates and manages Three.js sphere meshes for graph nodes.
 * Central node is larger with a stronger glow. Satellite nodes use category colors.
 * Exports: CATEGORY_COLORS, createCentralNode, createSatelliteNode,
 *          setNodeHighlight, disposeNode, disposeAllNodes
 */

/* global THREE */

/**
 * Category → hex color mapping.
 * Exactly as specified in the DevProtocol.
 * @type {Object.<string, number>}
 */
export const CATEGORY_COLORS = {
  'current':        0x00D4FF,  // Cyan
  'first-party':    0x00FF88,  // Green
  'analytics':      0xFFD700,  // Yellow
  'advertising':    0xFF8C00,  // Orange
  'social':         0xA855F7,  // Purple
  'tracker':        0xFF3366,  // Red
  'fingerprinting': 0xFF3366,  // Red (same as tracker)
  'malicious':      0x8B0000,  // Dark red
  'cryptomining':   0x8B0000,  // Dark red (same as malicious)
  'unknown':        0x6B7280,  // Gray
};

/**
 * Create a glow halo mesh — a slightly larger, additive-blended transparent sphere.
 * Attaches to the node mesh as a child so it moves with the node.
 * @param {number} color - Hex color
 * @param {number} radius - Sphere radius (glow sphere will be ~2.5x this)
 * @returns {THREE.Mesh} Glow mesh
 */
function createGlowMesh(color, radius) {
  const geo = new THREE.SphereGeometry(radius * 2.5, 8, 8);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  return new THREE.Mesh(geo, mat);
}

/**
 * Create the central node — the website being visited.
 * Larger sphere, brighter glow, stronger presence.
 * @param {THREE.Scene} scene
 * @returns {THREE.Mesh} The central node mesh (already added to scene)
 */
export function createCentralNode(scene) {
  const color = CATEGORY_COLORS['current'];
  const geo = new THREE.SphereGeometry(0.5, 24, 24);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 1.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0, 0);
  mesh.userData.isCentral = true;
  mesh.userData.baseOpacity = 1.0;

  // Glow halo
  const glow = createGlowMesh(color, 0.5);
  glow.userData.isGlow = true;
  mesh.add(glow);
  mesh.userData.glow = glow;

  scene.add(mesh);
  return mesh;
}

/**
 * Create a satellite node for a third-party domain.
 * @param {string} category  - Classification category (determines color)
 * @param {{ x: number, y: number, z: number }} position - Initial world position
 * @param {THREE.Scene} scene
 * @returns {THREE.Mesh} The satellite node mesh (already added to scene)
 */
export function createSatelliteNode(category, position, scene) {
  const colorHex = CATEGORY_COLORS[category] ?? CATEGORY_COLORS['unknown'];
  const geo = new THREE.SphereGeometry(0.3, 16, 16);
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.85,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(position.x, position.y, position.z);
  mesh.userData.isCentral = false;
  mesh.userData.baseOpacity = 0.85;
  mesh.userData.category = category;

  // Glow halo (smaller, subtler on satellites)
  const glow = createGlowMesh(colorHex, 0.3);
  glow.userData.isGlow = true;
  mesh.add(glow);
  mesh.userData.glow = glow;

  scene.add(mesh);
  return mesh;
}

/**
 * Highlight a node (on hover) or return it to its resting state.
 * Scales the mesh and increases glow opacity when highlighted.
 * @param {Object} nodeData - NodeData with a mesh property
 * @param {boolean} highlighted - True to highlight, false to restore
 */
export function setNodeHighlight(nodeData, highlighted) {
  const mesh = nodeData?.mesh;
  if (!mesh) return;

  const scale = highlighted ? 1.4 : 1.0;
  mesh.scale.setScalar(scale);

  const glow = mesh.userData.glow;
  if (glow) {
    glow.material.opacity = highlighted ? 0.35 : 0.12;
  }
}

/**
 * Trigger a pulse animation on a node (flash of opacity on new request).
 * @param {Object} nodeData - NodeData with a mesh property
 */
export function pulseNode(nodeData) {
  const mesh = nodeData?.mesh;
  if (!mesh) return;

  const glow = mesh.userData.glow;
  if (glow) {
    glow.material.opacity = 0.6;
    // Decay is handled in the render loop via updateNodes()
    nodeData._glowPulseTime = Date.now();
  }
}

/**
 * Update all node glow decays each frame. Call from the main render loop.
 * @param {Map<string, Object>} nodes - Map of domain → NodeData
 */
export function updateNodes(nodes) {
  const now = Date.now();
  nodes.forEach((nodeData) => {
    const mesh = nodeData.mesh;
    if (!mesh) return;
    const glow = mesh.userData.glow;
    if (!glow || !nodeData._glowPulseTime) return;

    const elapsed = now - nodeData._glowPulseTime;
    if (elapsed > 1500) {
      glow.material.opacity = 0.12;
      nodeData._glowPulseTime = 0;
    } else {
      // Exponential decay: 0.6 → 0.12 over 1.5s
      const t = elapsed / 1500;
      glow.material.opacity = 0.12 + 0.48 * Math.exp(-t * 3);
    }
  });
}

/**
 * Dispose a single node: remove its geometry, material, and mesh from the scene.
 * MUST be called on every node during tab switch to prevent memory leaks.
 * @param {Object} nodeData - NodeData with a mesh property
 * @param {THREE.Scene} scene
 */
export function disposeNode(nodeData, scene) {
  const mesh = nodeData?.mesh;
  if (!mesh) return;

  // Dispose glow child
  const glow = mesh.userData.glow;
  if (glow) {
    glow.geometry.dispose();
    glow.material.dispose();
  }

  mesh.geometry.dispose();
  mesh.material.dispose();
  scene.remove(mesh);
  nodeData.mesh = null;
}

/**
 * Dispose all nodes in the nodes Map.
 * @param {Map<string, Object>} nodes
 * @param {THREE.Scene} scene
 */
export function disposeAllNodes(nodes, scene) {
  nodes.forEach((nodeData) => disposeNode(nodeData, scene));
  nodes.clear();
}
