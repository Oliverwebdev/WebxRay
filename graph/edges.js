/**
 * @fileoverview WEBXRAY Edge Rendering
 * Creates edges between nodes as thin cylinder meshes.
 * Line thickness (linewidth) is unreliable in WebGL — cylinders give
 * consistent visual weight across all platforms.
 * Pulse animation: opacity 1.0 → decays to 0.3 over 1s on new request.
 * Exports: createEdge, pulseEdge, updateEdges, disposeEdge, disposeAllEdges
 */

/* global THREE */

// Shared up-vector for cylinder orientation (avoid allocating per-frame)
const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();

/**
 * Compute cylinder radius from request count (more requests = thicker line).
 * Capped at 0.10 to prevent visual clutter on high-traffic edges.
 * @param {number} requestCount
 * @returns {number} Radius in world units
 */
function edgeRadius(requestCount) {
  return Math.min(0.02 + Math.log1p(requestCount) * 0.015, 0.10);
}

/**
 * Orient and scale a cylinder mesh to span from fromPos to toPos.
 * Sets position (midpoint), scale (thickness × length × thickness), and quaternion.
 * @param {THREE.Mesh} mesh
 * @param {{ x:number, y:number, z:number }} fromPos
 * @param {{ x:number, y:number, z:number }} toPos
 * @param {number} thickness - X/Z scale for the cylinder radius
 */
function orientCylinder(mesh, fromPos, toPos, thickness) {
  _dir.set(
    toPos.x - fromPos.x,
    toPos.y - fromPos.y,
    toPos.z - fromPos.z
  );
  const len = _dir.length();
  if (len < 0.001) return;

  _mid.set(
    (fromPos.x + toPos.x) * 0.5,
    (fromPos.y + toPos.y) * 0.5,
    (fromPos.z + toPos.z) * 0.5
  );

  mesh.position.copy(_mid);
  mesh.scale.set(thickness, len, thickness);

  // Align cylinder Y-axis to the world-space direction
  _dir.normalize();
  const dot = _dir.dot(UP);
  if (Math.abs(dot) > 0.9999) {
    // Direction is nearly parallel to UP — handle degenerate case
    mesh.quaternion.identity();
    if (dot < 0) {
      mesh.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    }
  } else {
    mesh.quaternion.setFromUnitVectors(UP, _dir);
  }
}

/**
 * Create an edge (cylinder mesh) connecting two nodes.
 * @param {Object} sourceNodeData - Source NodeData (has .position and .mesh)
 * @param {Object} targetNodeData - Target NodeData (has .position and .mesh)
 * @param {number} colorHex        - Hex color for the edge (target node color)
 * @param {THREE.Scene} scene
 * @returns {THREE.Mesh} The cylinder mesh (already added to scene)
 */
export function createEdge(sourceNodeData, targetNodeData, colorHex, scene) {
  // Unit-height cylinder; we'll scale it each frame via orientCylinder
  const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1; // Draw behind nodes

  const thickness = edgeRadius(1);
  orientCylinder(mesh, sourceNodeData.position, targetNodeData.position, thickness);

  scene.add(mesh);
  return mesh;
}

/**
 * Trigger a pulse on an edge — opacity jumps to 1.0 then decays.
 * @param {Object} edgeData - EdgeData with mesh and lastPulse timestamp
 */
export function pulseEdge(edgeData) {
  if (!edgeData?.mesh) return;
  edgeData.lastPulse = Date.now();
  edgeData.mesh.material.opacity = 1.0;
}

/**
 * Update all edge positions and pulse decay each frame.
 * Must be called after node positions are updated by the layout engine.
 * @param {Map<string, Object>} nodes - domain → NodeData
 * @param {Map<string, Object>} edges - "src->dst" → EdgeData
 */
export function updateEdges(nodes, edges) {
  const now = Date.now();

  edges.forEach((edgeData) => {
    const mesh = edgeData.mesh;
    if (!mesh) return;

    const src = nodes.get(edgeData.sourceDomain);
    const dst = nodes.get(edgeData.targetDomain);
    if (!src || !dst) return;

    const thickness = edgeRadius(edgeData.requestCount);
    orientCylinder(mesh, src.position, dst.position, thickness);

    // Pulse decay: 1.0 → 0.3 exponentially over 1 second
    const elapsed = now - (edgeData.lastPulse || 0);
    if (elapsed < 1500) {
      const t = elapsed / 1000;
      mesh.material.opacity = 0.3 + 0.7 * Math.exp(-t * 3);
    } else {
      mesh.material.opacity = 0.3;
    }
  });
}

/**
 * Dispose a single edge: removes geometry, material, and mesh from scene.
 * @param {Object} edgeData - EdgeData with mesh
 * @param {THREE.Scene} scene
 */
export function disposeEdge(edgeData, scene) {
  const mesh = edgeData?.mesh;
  if (!mesh) return;
  mesh.geometry.dispose();
  mesh.material.dispose();
  scene.remove(mesh);
  edgeData.mesh = null;
}

/**
 * Dispose all edges in the edges Map.
 * @param {Map<string, Object>} edges
 * @param {THREE.Scene} scene
 */
export function disposeAllEdges(edges, scene) {
  edges.forEach((edgeData) => disposeEdge(edgeData, scene));
  edges.clear();
}
