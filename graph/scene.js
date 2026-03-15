/**
 * @fileoverview WEBXRAY Scene Setup
 * Manages the Three.js WebGLRenderer, PerspectiveCamera, Scene,
 * a minimal orbit controller, and the animation loop.
 * Exports: initScene, getScene, getCamera, getRenderer, startRenderLoop, disposeScene
 */

/* global THREE */

/** @type {THREE.WebGLRenderer} */
let renderer = null;
/** @type {THREE.PerspectiveCamera} */
let camera = null;
/** @type {THREE.Scene} */
let scene = null;
/** @type {MinimalOrbitControls} */
let controls = null;
/** @type {number|null} Animation frame ID */
let animFrameId = null;
/** @type {Function|null} Per-frame callback for physics + logic updates */
let frameCallback = null;

// -------------------------------------------------------------------
// Minimal Orbit Controller
// Implements: mouse-drag rotation (azimuthal + polar), scroll zoom,
// and smooth exponential damping. No external dependencies.
// -------------------------------------------------------------------
class MinimalOrbitControls {
  /**
   * @param {THREE.Camera} cam - Camera to control
   * @param {HTMLElement} el  - DOM element to attach mouse events to
   */
  constructor(cam, el) {
    this.camera = cam;
    this.el = el;
    this.enableDamping = true;
    this.dampingFactor = 0.08;
    this.minDistance = 5;
    this.maxDistance = 100;

    // Spherical coordinates (theta = azimuth, phi = polar)
    this._theta = Math.PI * 0.3;
    this._phi   = Math.PI * 0.35;
    this._r     = 22;

    // Velocity for damping
    this._dTheta = 0;
    this._dPhi   = 0;

    // Mouse drag state
    this._dragging = false;
    this._prevX = 0;
    this._prevY = 0;

    // Bind handlers (stored so they can be removed on dispose)
    this._onDown  = this._handleDown.bind(this);
    this._onMove  = this._handleMove.bind(this);
    this._onUp    = this._handleUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);

    el.addEventListener('mousedown',  this._onDown);
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('mouseup',   this._onUp);
    el.addEventListener('wheel', this._onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    this._apply();
  }

  _handleDown(e) {
    if (e.button !== 0) return;
    this._dragging = true;
    this._prevX = e.clientX;
    this._prevY = e.clientY;
  }

  _handleMove(e) {
    if (!this._dragging) return;
    const dx = e.clientX - this._prevX;
    const dy = e.clientY - this._prevY;
    this._prevX = e.clientX;
    this._prevY = e.clientY;
    // Accumulate velocity
    this._dTheta -= dx * 0.008;
    this._dPhi   -= dy * 0.008;
  }

  _handleUp() {
    this._dragging = false;
  }

  _handleWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.08 : 0.926;
    this._r = Math.max(this.minDistance, Math.min(this.maxDistance, this._r * factor));
    this._apply();
  }

  /** Called every frame from the render loop to apply damping. */
  update() {
    if (!this.enableDamping) {
      this._theta += this._dTheta;
      this._phi   += this._dPhi;
      this._dTheta = 0;
      this._dPhi   = 0;
    } else {
      this._theta += this._dTheta;
      this._phi   += this._dPhi;
      this._dTheta *= (1 - this.dampingFactor);
      this._dPhi   *= (1 - this.dampingFactor);
    }

    // Clamp polar angle away from poles
    this._phi = Math.max(0.05, Math.min(Math.PI - 0.05, this._phi));
    this._apply();
  }

  /** Compute camera position from spherical coords and point at origin. */
  _apply() {
    const { _theta: t, _phi: p, _r: r } = this;
    this.camera.position.set(
      r * Math.sin(p) * Math.sin(t),
      r * Math.cos(p),
      r * Math.sin(p) * Math.cos(t)
    );
    this.camera.lookAt(0, 0, 0);
  }

  dispose() {
    this.el.removeEventListener('mousedown', this._onDown);
    document.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('mouseup',   this._onUp);
    this.el.removeEventListener('wheel', this._onWheel);
  }
}

// -------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------

/**
 * Initialize the Three.js scene, camera, renderer, and orbit controls.
 * Must be called once before any graph modules are used.
 * @param {HTMLCanvasElement} canvas - Canvas element to render into
 * @returns {{ scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer }}
 */
export function initScene(canvas) {
  // Renderer — antialiased, preserveDrawingBuffer required for screenshot capture
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0A0A1A, 1);

  // Determine initial canvas dimensions.
  // canvas.clientWidth/Height can be 0 at DOMContentLoaded if layout hasn't
  // flushed yet (common in extension Side Panels). Fall back to window dimensions.
  // Use updateStyle:false so CSS keeps control — Three.js only sets the WebGL
  // buffer resolution, not the inline style.
  const w = canvas.offsetWidth  || window.innerWidth  || 400;
  const h = canvas.offsetHeight || window.innerHeight || 500;
  renderer.setSize(w, h, false);

  // Camera — FOV 60, near 0.1, far 1000 (as per spec)
  camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0A0A1A);

  // Subtle fill light
  const ambient = new THREE.AmbientLight(0x222244, 1);
  scene.add(ambient);

  // Orbit controls
  controls = new MinimalOrbitControls(camera, canvas);

  // Use ResizeObserver for the canvas — more reliable than window.resize
  // for Side Panel size changes when user drags the panel border.
  const ro = new ResizeObserver(handleResize);
  ro.observe(canvas);
  // Also keep window resize as fallback
  window.addEventListener('resize', handleResize);

  // Run one resize immediately on the next frame to catch any layout flush
  requestAnimationFrame(handleResize);

  console.log('[WEBXRAY] Scene initialized', w, 'x', h);
  return { scene, camera, renderer };
}

/**
 * Start the animation loop. Calls the provided callback once per frame
 * for physics and graph updates before rendering.
 * Throttles to 30fps when the document is hidden (tab unfocused).
 * @param {Function} onFrame - Called each frame with no arguments
 */
export function startRenderLoop(onFrame) {
  frameCallback = onFrame;

  let lastFrameTime = 0;

  function loop(timestamp) {
    animFrameId = requestAnimationFrame(loop);

    // Throttle to 30fps when hidden to save CPU
    const targetInterval = document.hidden ? 33 : 16;
    if (timestamp - lastFrameTime < targetInterval) return;
    lastFrameTime = timestamp;

    if (controls) controls.update();
    if (frameCallback) frameCallback();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  animFrameId = requestAnimationFrame(loop);
}

/**
 * Stop the animation loop.
 */
export function stopRenderLoop() {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

/**
 * Returns the active Three.js Scene.
 * @returns {THREE.Scene}
 */
export function getScene() { return scene; }

/**
 * Returns the active PerspectiveCamera.
 * @returns {THREE.PerspectiveCamera}
 */
export function getCamera() { return camera; }

/**
 * Returns the WebGLRenderer.
 * @returns {THREE.WebGLRenderer}
 */
export function getRenderer() { return renderer; }

/**
 * Dispose the entire scene: renderer, controls, all scene objects.
 * Call this only when completely shutting down the visualization.
 */
export function disposeScene() {
  stopRenderLoop();
  window.removeEventListener('resize', handleResize);
  if (controls) { controls.dispose(); controls = null; }
  if (renderer) { renderer.dispose(); renderer = null; }
  scene = null;
  camera = null;
  console.log('[WEBXRAY] Scene disposed');
}

/** Handle canvas/window resize events. */
function handleResize() {
  if (!renderer || !camera) return;
  const canvas = renderer.domElement;
  // offsetWidth/Height reflects the actual rendered CSS dimensions reliably
  const w = canvas.offsetWidth  || window.innerWidth  || 400;
  const h = canvas.offsetHeight || window.innerHeight || 500;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
