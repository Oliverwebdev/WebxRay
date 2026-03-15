/**
 * @fileoverview WEBXRAY Force-Directed Layout Engine
 * Implements a simple 3D force simulation:
 *   - Repulsion between all node pairs (Coulomb's law, coefficient ~50)
 *   - Attraction along edges (Hooke's law, spring constant ~0.05, rest length ~5)
 *   - Centering force toward origin (coefficient ~0.01)
 *   - Velocity damping factor 0.9 per frame
 *   - Max velocity cap 2.0 units/frame
 *
 * Runs every frame for the first 200 frames, then every 5th frame for stability.
 * Exports: ForceLayout class
 */

/** Coulomb repulsion coefficient (prevents node overlap) */
const K_REPULSION  = 50;
/** Hooke spring constant (keeps connected nodes nearby) */
const K_SPRING     = 0.05;
/** Spring rest length in world units */
const REST_LENGTH  = 5;
/** Centering force coefficient (pulls graph toward origin) */
const K_CENTER     = 0.01;
/** Velocity damping factor per frame */
const DAMPING      = 0.9;
/** Maximum velocity magnitude per frame */
const MAX_VELOCITY = 2.0;

export class ForceLayout {
  constructor() {
    /** @type {string[]} Ordered list of node domain keys */
    this._nodeKeys = [];
    /** @type {Set<string>} Set of edge keys ("src->dst") for connected pairs */
    this._edgeSet = new Set();
    /** @type {number} Frame counter for simulation throttle */
    this._frame = 0;
  }

  /**
   * Register a new node with the layout engine.
   * The nodeData object is mutated in place — position and velocity
   * are updated each tick() call.
   * @param {string} domain - Domain key
   */
  addNode(domain) {
    if (!this._nodeKeys.includes(domain)) {
      this._nodeKeys.push(domain);
    }
  }

  /**
   * Register an edge between two nodes (both must exist in the layout).
   * @param {string} sourceDomain
   * @param {string} targetDomain
   */
  addEdge(sourceDomain, targetDomain) {
    this._edgeSet.add(`${sourceDomain}->${targetDomain}`);
  }

  /**
   * Remove a node from the simulation (used when nodes are collapsed into cluster).
   * @param {string} domain
   */
  removeNode(domain) {
    const idx = this._nodeKeys.indexOf(domain);
    if (idx !== -1) this._nodeKeys.splice(idx, 1);
  }

  /**
   * Advance the physics simulation by one step.
   * Mutates nodeData.position and nodeData.velocity in the provided nodes Map.
   * No-ops if not enough frames have elapsed (throttle after frame 200).
   * @param {Map<string, Object>} nodes - domain → NodeData
   * @param {number} globalFrame        - Global frame counter from render loop
   */
  tick(nodes, globalFrame) {
    this._frame++;

    // Run every frame for first 200, then every 5th for stability
    if (globalFrame > 200 && (globalFrame % 5 !== 0)) return;

    const keys = this._nodeKeys.filter((k) => nodes.has(k));
    const n = keys.length;
    if (n < 2) return;

    // Accumulate forces into a temp object
    const forces = {};
    keys.forEach((k) => {
      forces[k] = { x: 0, y: 0, z: 0 };
    });

    // --- Repulsion (O(n²) — acceptable for ≤200 nodes) ---
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes.get(keys[i]);
        const b = nodes.get(keys[j]);
        if (!a || !b) continue;

        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dz = b.position.z - a.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < 0.0001) continue;

        const dist = Math.sqrt(distSq);
        const force = K_REPULSION / distSq;

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fz = (dz / dist) * force;

        forces[keys[i]].x -= fx;
        forces[keys[i]].y -= fy;
        forces[keys[i]].z -= fz;
        forces[keys[j]].x += fx;
        forces[keys[j]].y += fy;
        forces[keys[j]].z += fz;
      }
    }

    // --- Spring attraction along edges ---
    this._edgeSet.forEach((edgeKey) => {
      const [srcKey, dstKey] = edgeKey.split('->');
      const a = nodes.get(srcKey);
      const b = nodes.get(dstKey);
      if (!a || !b) return;

      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const dz = b.position.z - a.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;

      const displacement = dist - REST_LENGTH;
      const force = K_SPRING * displacement;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const fz = (dz / dist) * force;

      if (forces[srcKey]) {
        forces[srcKey].x += fx;
        forces[srcKey].y += fy;
        forces[srcKey].z += fz;
      }
      if (forces[dstKey]) {
        forces[dstKey].x -= fx;
        forces[dstKey].y -= fy;
        forces[dstKey].z -= fz;
      }
    });

    // --- Centering force (keeps graph from drifting off-screen) ---
    keys.forEach((k) => {
      const node = nodes.get(k);
      if (!node) return;
      // The central node stays pinned at origin
      if (node.pinned) return;

      forces[k].x -= node.position.x * K_CENTER;
      forces[k].y -= node.position.y * K_CENTER;
      forces[k].z -= node.position.z * K_CENTER;
    });

    // --- Integrate velocity and position ---
    keys.forEach((k) => {
      const node = nodes.get(k);
      if (!node || node.pinned) return;

      node.velocity.x = (node.velocity.x + forces[k].x) * DAMPING;
      node.velocity.y = (node.velocity.y + forces[k].y) * DAMPING;
      node.velocity.z = (node.velocity.z + forces[k].z) * DAMPING;

      // Cap maximum velocity
      const speed = Math.sqrt(
        node.velocity.x ** 2 + node.velocity.y ** 2 + node.velocity.z ** 2
      );
      if (speed > MAX_VELOCITY) {
        const scale = MAX_VELOCITY / speed;
        node.velocity.x *= scale;
        node.velocity.y *= scale;
        node.velocity.z *= scale;
      }

      node.position.x += node.velocity.x;
      node.position.y += node.velocity.y;
      node.position.z += node.velocity.z;
    });
  }

  /**
   * Reset the layout engine state (called on tab switch).
   */
  reset() {
    this._nodeKeys = [];
    this._edgeSet.clear();
    this._frame = 0;
  }
}
