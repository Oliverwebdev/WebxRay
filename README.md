# WEBXRAY — See the invisible web.

<div align="center">

**Real-time 3D visualization of every hidden connection your browser makes.**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](#installation)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-00C48C)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![Three.js r128](https://img.shields.io/badge/Three.js-r128-black)](#)
[![No tracking](https://img.shields.io/badge/telemetry-none-brightgreen)](#privacy)

</div>

---

> *"Every website you visit silently contacts dozens of external servers — ad networks, data brokers, fingerprinting services, social trackers. It happens in milliseconds. You never see it.*
> *WEBXRAY makes it impossible to miss."*

---

<!-- Replace with your actual demo GIF. Record with ScreenToGif or LICEcap:
     Visit nytimes.com, open the Side Panel, wait 3 seconds, pan the graph.
     Recommended: 600×400px, 15-20 seconds, looping. -->
<!-- ![WEBXRAY scanning nytimes.com — 47 third-party connections visualized in real-time](demo.gif) -->

## What you see

When WEBXRAY is active, Chrome's Side Panel shows a live 3D force-directed graph. The site you're visiting sits at the center. Every server it contacts materializes as a satellite node. Lines pulse when data flows. Colors tell the story instantly:

| Node color | Meaning |
|---|---|
| 🔵 **Cyan** | The site you're visiting |
| 🟢 **Green** | First-party — the site's own resources |
| 🟡 **Yellow** | Analytics (Google Analytics, Hotjar…) |
| 🟠 **Orange** | Advertising networks |
| 🟣 **Purple** | Social media trackers |
| 🔴 **Red** | Cross-site trackers & fingerprinting |
| ⚫ **Dark red** | Confirmed malware / phishing domains |
| ⚪ **Gray** | Unknown third parties |

Line thickness scales with request volume. Click any node for the full breakdown: domain, classification reason, request count, data transferred, request types, and raw URLs.

**WEBXRAY is not a blocker. It doesn't touch a single request. It's a diagnostic instrument — a digital X-ray for the web.**

---

## Features

- **Zero configuration** — Install and open. No account, no API key, no setup wizard.
- **Real-time 3D graph** — Force-directed layout with smooth spring physics. Rotate, zoom, hover, click.
- **51,000+ classified domains** — Powered by Disconnect, EasyPrivacy, Peter Lowe's list, and URLhaus — all open-source, community-maintained.
- **Tab-aware** — Resets cleanly when you switch tabs. No memory leaks.
- **Share your scan** — One button generates a branded PNG. Copy to clipboard, download, or post directly to X/Twitter with a pre-filled message.
- **Fully offline** — Classification runs locally. No data ever leaves your browser.
- **Open source** — Every permission is justified and auditable.

---

## Installation

### Option A — Load unpacked (instant, no review wait)

```bash
git clone https://github.com/Oliverwebdev/webxray.git
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** → select the `webxray/` folder
4. Click the WEBXRAY icon in the toolbar → **Open Visualization**
5. Navigate to any website and watch the graph build

### Option B — Chrome Web Store *(coming soon)*

---

## Rebuild the domain lists

`data/domains.json` is pre-compiled and ships with the extension. To regenerate it with the latest community lists:

```bash
node scripts/build-lists.js
```

Sources pulled at build time:

| List | Category |
|---|---|
| [Disconnect services.json](https://github.com/disconnectme/disconnect-tracking-protection) | Advertising, Analytics, Social, Fingerprinting, Cryptomining |
| [EasyPrivacy](https://easylist.to/easylist/easyprivacy.txt) | Tracker |
| [Peter Lowe's Ad Servers](https://pgl.yoyo.org/adservers/) | Advertising |
| [URLhaus](https://urlhaus.abuse.ch/downloads/hostfile/) | Malicious |

---

## How it works

```
Your browser makes a request
          │
          ▼
   background.js  (Service Worker)
   ├─ Extracts:  URL · request type · initiator · timestamp
   ├─ Classifies: O(1) lookup in domains.json
   │              → first-party detection via eTLD+1 matching
   └─ Forwards:  chrome.runtime.sendMessage → Side Panel
          │
          ▼
   sidepanel.js  (Three.js WebGL)
   ├─ New domain?  → spawn node + edge + spring physics
   ├─ Known domain? → increment counter + pulse animation
   └─ Renders at 60fps
```

The Service Worker processes each request in under 1ms. The Side Panel runs in its own isolated process and **cannot slow down page loading**.

---

## Privacy

WEBXRAY needs broad permissions to do its job. Here's the exact accounting:

| Permission | Does | Never does |
|---|---|---|
| `webRequest` | Reads URL, request type, initiator, timing | Reads bodies, cookies, form data |
| `sidePanel` | Renders the visualization | — |
| `activeTab` | Knows which tab to watch | Accesses page content |
| `tabs` | Detects tab switches | — |
| `storage` | Saves preferences locally | Syncs anywhere |
| `<all_urls>` | Required for webRequest to observe any domain | Cannot be scoped narrower |

**WEBXRAY never:**
- Reads request or response bodies
- Accesses cookies, passwords, or authentication headers
- Injects scripts into web pages
- Sends any data to any external server
- Stores your browsing history

Don't trust the words — read the code. The complete extension is ~700 lines of vanilla JavaScript.

---

## Project structure

```
webxray/
├── manifest.json           # MV3 — every permission documented
├── background.js           # Service Worker: intercept → classify → forward
├── classifier.js           # eTLD+1 matching + domain list lookup
├── sidepanel.html/js/css   # 3D visualization
├── popup.html/js/css       # Toolbar popup
├── graph/
│   ├── scene.js            # Three.js scene, orbit controls, render loop
│   ├── nodes.js            # Sphere meshes, glow effects
│   ├── edges.js            # Cylinder edges, pulse animation
│   ├── layout.js           # Force-directed physics (Coulomb + Hooke)
│   └── interaction.js      # Raycasting, hover, click
├── ui/
│   ├── statsbar.js         # Live category breakdown
│   ├── infocard.js         # Node detail overlay
│   └── screenshot.js       # Canvas capture, branding, share sheet
├── lib/three.min.js        # Three.js r128 — bundled locally, never CDN
├── data/domains.json       # ~52k classified domains
└── scripts/
    ├── build-lists.js      # Compiles domain lists at build time
    └── make_icons.py       # Regenerates extension icons
```

---

## Performance budget

| Metric | Target |
|---|---|
| Side Panel memory | < 150 MB after 5 min on a heavy news site |
| Frame rate | > 24 fps with 100+ visible nodes |
| Page load impact | < 50 ms — webRequest observation is read-only |
| Time to first node | < 500 ms from navigation |
| Extension package | ~2.3 MB (Three.js 590 KB + domains.json 1.7 MB + code) |

The 200-node cap prevents layout explosion on ad-heavy sites. Excess nodes collapse into a single **+N more** cluster.

---

## Contributing

Bug reports, PRs, and domain classification corrections are welcome.

**Good first issues:**
- Wrong category for a known domain → fix in `scripts/build-lists.js` source mapping
- Performance improvements to the force layout in `graph/layout.js`
- 2D flat view mode toggle

**Hard rules (non-negotiable):**
- No content scripts injected into web pages
- No external network requests from the extension
- No `eval()` or dynamic script loading
- Manifest stays MV3

---

## Tech stack

- **Chrome Extensions Manifest V3** — Service Worker, Side Panel API, webRequest
- **Three.js r128** — WebGL rendering, bundled locally
- **Vanilla JavaScript** — ES modules, zero build step for the extension
- **Node.js 18+** — Build-time only, for compiling domain lists

---

## License

[MIT](LICENSE) — © 2026 Oliver ([@Oliverwebdev](https://github.com/Oliverwebdev))

---

<div align="center">

*Built by a developer from Bavaria who got tired of not being able to see what websites were doing to his browser.*

**WEBXRAY observes. It never touches.**

</div>
