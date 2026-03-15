/**
 * @fileoverview WEBXRAY Screenshot Export & Share
 * Captures the WebGL canvas, composites a WEBXRAY branding overlay,
 * and offers three export paths:
 *   1. Download PNG to disk
 *   2. Copy to clipboard (paste directly into Twitter, Discord, etc.)
 *   3. Web Share API — native share sheet on supported platforms
 *
 * The screenshot IS the marketing. Every shared image carries the WEBXRAY
 * brand and the domain count, making the viral loop self-contained.
 * Exports: captureScreenshot
 */

/**
 * Capture the current visualization, composite branding, and trigger the share flow.
 * @param {THREE.WebGLRenderer} renderer
 * @param {string}  currentUrl      - Page URL shown in the bottom corner
 * @param {number}  domainCount     - Total third-party domain count
 * @param {number}  trackerCount    - Count of flagged (tracker/ad/malicious) domains
 */
export async function captureScreenshot(renderer, currentUrl, domainCount, trackerCount) {
  try {
    const branded = await buildBrandedCanvas(renderer, currentUrl, domainCount, trackerCount);
    showShareSheet(branded, currentUrl, domainCount, trackerCount);
  } catch (err) {
    console.warn('[WEBXRAY] Screenshot failed:', err.message);
  }
}

// -------------------------------------------------------------------
// Canvas composition
// -------------------------------------------------------------------

/**
 * Build an offscreen canvas with the WebGL frame + WEBXRAY branding overlay.
 * @returns {Promise<HTMLCanvasElement>}
 */
async function buildBrandedCanvas(renderer, currentUrl, domainCount, trackerCount) {
  const src = renderer.domElement;
  const w = src.width;
  const h = src.height;

  const off = document.createElement('canvas');
  off.width  = w;
  off.height = h;
  const ctx = off.getContext('2d');

  // Draw the WebGL frame
  ctx.drawImage(src, 0, 0);

  const scale   = window.devicePixelRatio || 1;
  const pad     = Math.round(18 * scale);
  const fzSmall = Math.max(11, Math.round(13 * scale));
  const fzLogo  = Math.max(16, Math.round(20 * scale));

  // --- Bottom-left: WEBXRAY logo ---
  ctx.save();
  ctx.font         = `800 ${fzLogo}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle    = 'rgba(0, 212, 255, 0.92)';
  ctx.textBaseline = 'bottom';
  ctx.textAlign    = 'left';
  ctx.shadowColor  = 'rgba(0, 212, 255, 0.6)';
  ctx.shadowBlur   = 12 * scale;
  ctx.fillText('WEBXRAY', pad, h - pad);
  ctx.restore();

  // --- Bottom-right: scanned domain ---
  const hostname = safeHostname(currentUrl);
  ctx.save();
  ctx.font         = `${fzSmall}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle    = 'rgba(180, 200, 220, 0.80)';
  ctx.textBaseline = 'bottom';
  ctx.textAlign    = 'right';
  ctx.fillText(hostname, w - pad, h - pad);
  ctx.restore();

  // --- Top-left: stats badge ---
  const flaggedLabel = trackerCount > 0
    ? `${domainCount} domains · ${trackerCount} flagged`
    : `${domainCount} domains`;

  ctx.save();
  ctx.font      = `600 ${fzSmall}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const tw = ctx.measureText(flaggedLabel).width;
  const bh = fzSmall + Math.round(12 * scale);
  const bw = tw + Math.round(20 * scale);
  // Badge background
  ctx.fillStyle = 'rgba(10, 10, 26, 0.75)';
  roundRect(ctx, pad - 6, pad - 6, bw, bh, 5);
  ctx.fill();
  // Badge border
  ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
  ctx.lineWidth   = 1;
  roundRect(ctx, pad - 6, pad - 6, bw, bh, 5);
  ctx.stroke();
  // Badge text
  ctx.fillStyle = trackerCount > 0 ? 'rgba(255, 90, 130, 0.95)' : 'rgba(0, 212, 255, 0.95)';
  ctx.fillText(flaggedLabel, pad, pad);
  ctx.restore();

  return off;
}

// -------------------------------------------------------------------
// Share sheet overlay
// -------------------------------------------------------------------

let shareSheetEl = null;

/**
 * Show a compact share-sheet overlay with Download, Copy, and Share options.
 * @param {HTMLCanvasElement} brandedCanvas
 * @param {string} currentUrl
 * @param {number} domainCount
 * @param {number} trackerCount
 */
function showShareSheet(brandedCanvas, currentUrl, domainCount, trackerCount) {
  // Remove any previous sheet
  if (shareSheetEl) shareSheetEl.remove();

  const sheet = document.createElement('div');
  sheet.className = 'wx-share-sheet';
  shareSheetEl = sheet;

  const tweetText = buildTweetText(currentUrl, domainCount, trackerCount);
  const hasWebShare = Boolean(navigator.share && navigator.canShare);

  sheet.innerHTML = `
    <div class="wx-share-header">
      <span class="wx-share-title">Share this scan</span>
      <button class="wx-share-close" aria-label="Close">✕</button>
    </div>
    <div class="wx-share-preview-wrap">
      <canvas class="wx-share-preview"></canvas>
    </div>
    <div class="wx-share-actions">
      <button class="wx-share-btn wx-share-btn--primary" id="wx-btn-download">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download PNG
      </button>
      <button class="wx-share-btn" id="wx-btn-copy">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Copy Image
      </button>
      ${hasWebShare ? `
      <button class="wx-share-btn" id="wx-btn-share">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        Share…
      </button>` : ''}
      <a class="wx-share-btn wx-share-btn--tweet" id="wx-btn-tweet"
         href="https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}"
         target="_blank" rel="noopener">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        Post on X
      </a>
    </div>
  `;

  document.querySelector('.wx-canvas').insertAdjacentElement('afterend', sheet);

  // Render preview thumbnail
  const preview = sheet.querySelector('.wx-share-preview');
  const maxW = sheet.querySelector('.wx-share-preview-wrap').clientWidth || 260;
  const scale = maxW / brandedCanvas.width;
  preview.width  = Math.round(brandedCanvas.width  * scale);
  preview.height = Math.round(brandedCanvas.height * scale);
  preview.getContext('2d').drawImage(brandedCanvas, 0, 0, preview.width, preview.height);

  // --- Button handlers ---
  sheet.querySelector('.wx-share-close').addEventListener('click', () => sheet.remove());

  sheet.querySelector('#wx-btn-download').addEventListener('click', () => {
    brandedCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `webxray-${safeFilename(currentUrl)}-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }, 'image/png');
    markBtn(sheet.querySelector('#wx-btn-download'), 'Downloaded!');
  });

  sheet.querySelector('#wx-btn-copy').addEventListener('click', async () => {
    try {
      const blob = await canvasToBlob(brandedCanvas);
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      markBtn(sheet.querySelector('#wx-btn-copy'), 'Copied!');
    } catch {
      // Clipboard API not available — fall back to download
      sheet.querySelector('#wx-btn-download').click();
    }
  });

  if (hasWebShare) {
    sheet.querySelector('#wx-btn-share').addEventListener('click', async () => {
      try {
        const blob = await canvasToBlob(brandedCanvas);
        const file = new File([blob], `webxray-${safeFilename(currentUrl)}.png`, { type: 'image/png' });
        await navigator.share({ files: [file], title: 'WEBXRAY scan', text: tweetText });
      } catch { /* user cancelled */ }
    });
  }
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/** Build the pre-filled tweet text. */
function buildTweetText(url, domainCount, trackerCount) {
  const host = safeHostname(url);
  const flagPart = trackerCount > 0
    ? ` (${trackerCount} flagged)`
    : '';
  return `${host} connects to ${domainCount} third-party domains${flagPart} the moment you visit it.\n\nVisualized with WEBXRAY 👁 #privacy #webxray\n${url}`;
}

/** Convert canvas to a Blob via Promise. */
function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
  });
}

/** Flash a success label on a button, then restore original text. */
function markBtn(btn, label) {
  if (!btn) return;
  const orig = btn.innerHTML;
  btn.textContent = label;
  btn.disabled = true;
  setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 2200);
}

function safeHostname(url) {
  try { return new URL(url).hostname || url; } catch { return url || 'unknown'; }
}

function safeFilename(url) {
  try { return new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_').slice(0, 40); }
  catch { return 'capture'; }
}

/** Draw a rounded rectangle path (no fill/stroke — caller decides). */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
