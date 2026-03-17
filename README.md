<div align="center">

# WEBXRAY

**See every hidden connection your browser makes. In real-time. In 3D.**

`51,000+ classified domains` · `~700 lines of code` · `zero data leaves your browser`

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](#installation)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-00C48C)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![No tracking](https://img.shields.io/badge/telemetry-none-brightgreen)](#privacy)

</div>

---


![WEBXRAY scanning a news site — 47 third-party connections revealed in real-time 3D](demo.gif)

<div align="center">

*That news site you just visited? It contacted 47 servers you've never heard of.*
*Ad networks. Data brokers. Fingerprinting services. All in under 2 seconds.*
*You never saw any of it. Until now.*

</div>

---

## Install in 30 seconds

```bash
git clone https://github.com/Oliverwebdev/webxray.git
```

1. Open `chrome://extensions` → enable **Developer mode**
2. Click **Load unpacked** → select the `webxray/` folder
3. Click the WEBXRAY icon → **Open Visualization**
4. Visit any website. Watch.

No account. No API key. No config. Just open it.

---

## What happens when you open a website

Your browser makes a request. WEBXRAY catches it — not the content, just the metadata: where it's going, what type it is, when it happened. It classifies the destination domain against 51,000+ known domains from four open-source community lists. Then it drops a node into a live 3D graph in Chrome's Side Panel.

Within seconds, you see the full picture:

| Color | What it means |
|---|---|
| 🔵 **Cyan** | The site you're visiting |
| 🟢 **Green** | First-party resources — the site's own stuff |
| 🟡 **Yellow** | Analytics — Google Analytics, Hotjar, Mixpanel |
| 🟠 **Orange** | Advertising networks |
| 🟣 **Purple** | Social media trackers |
| 🔴 **Red** | Cross-site trackers & fingerprinting |
| ⚫ **Dark red** | Confirmed malware or phishing domains |
| ⚪ **Gray** | Unknown third parties — nobody has catalogued these yet |

Lines pulse when data flows. Thickness = request volume. Click any node for the full breakdown: domain name, why it was classified that way, how many requests, how much data, and the raw URLs.

**WEBXRAY doesn't block anything.** It doesn't touch your traffic. It's a diagnostic instrument — a digital X-ray for the web.

---

## Why this exists

Every few weeks, another headline: *"Chrome extensions steal ChatGPT conversations from 900,000 users."* *"8.8 million users affected by DarkSpectre tracking campaign."* *"Extensions sold to new owners, silently turned into malware."*

The problem isn't that people don't care about privacy. The problem is they can't *see* what's happening. DevTools exist, but they show raw data tables that mean nothing to most people. Privacy extensions show numbers and lists. None of them show you the actual, living network of connections.

WEBXRAY makes it visual, visceral, and impossible to ignore. When you see 40+ red lines pulsing to servers you've never heard of, you don't need an explanation. You understand.

---

## Features

**Zero configuration** — Install → click → see. Nothing else required.

**Real-time 3D graph** — Force-directed layout with spring physics. Rotate, zoom, hover, click. New nodes animate in with organic motion.

**51,000+ classified domains** — Disconnect, EasyPrivacy, Peter Lowe's list, URLhaus. All open-source. Updated by thousands of community contributors.

**Share your scan** — One click exports a branded PNG screenshot. Every website becomes shareable content.

**Fully offline** — Every classification runs locally inside your browser. No external API calls. No cloud. Works in airplane mode.

**Tab-aware** — Switches cleanly between tabs. Proper Three.js disposal — no memory leaks, even after hours of use.

**~700 lines of vanilla JS** — No framework. No build step. No dependencies beyond Three.js. Read the entire codebase in one sitting.

---

## How it works

```
Your browser makes a request
          │
          ▼
   background.js  (Service Worker)
   ├─ Extracts:  URL · type · initiator · timestamp
   ├─ Classifies: O(1) lookup against 51k domains
   │              + eTLD+1 first-party detection
   └─ Forwards:   message → Side Panel
          │
          ▼
   sidepanel.js  (Three.js WebGL)
   ├─ New domain?   → spawn node + edge + spring physics
   ├─ Known domain? → pulse animation + increment counter
   └─ Renders at 60fps in isolated process
```

The Service Worker processes each request in **under 1ms**. The Side Panel runs in its own process — it **cannot slow down your browsing**.

---

## Privacy

WEBXRAY requests broad permissions. Here's exactly what each one does and doesn't do:

| Permission | What it does | What it never does |
|---|---|---|
| `webRequest` | Reads request URL, type, initiator, timing | Read bodies, cookies, form data, passwords |
| `sidePanel` | Renders the 3D visualization | — |
| `activeTab` | Identifies which tab to visualize | Access page content or DOM |
| `tabs` | Detects tab switches | — |
| `storage` | Saves your preferences locally | Sync or send data anywhere |
| `<all_urls>` | Required for webRequest to observe any domain | Cannot be scoped narrower by Chrome's API |

**WEBXRAY never:**
- Reads request or response bodies
- Accesses cookies, passwords, or auth headers
- Injects scripts into web pages
- Sends data to any external server
- Stores your browsing history

Don't trust the words — **read the code.** The entire extension is ~700 lines of vanilla JavaScript. No minification, no obfuscation. What you see is what runs.

---

## Rebuild the domain lists

`data/domains.json` ships pre-compiled. To regenerate with the latest community lists:

```bash
node scripts/build-lists.js
```

| Source | Maps to |
|---|---|
| [Disconnect services.json](https://github.com/nicedoc/disconnect-tracking-protection) | Advertising, Analytics, Social, Fingerprinting, Cryptomining |
| [EasyPrivacy](https://easylist.to/easylist/easyprivacy.txt) | Tracker |
| [Peter Lowe's Ad Servers](https://pgl.yoyo.org/adservers/) | Advertising |
| [URLhaus](https://urlhaus.abuse.ch/downloads/hostfile/) | Malicious |

---

## Performance

| Metric | Target |
|---|---|
| Side Panel memory | < 150 MB after 5 min on heavy sites |
| Frame rate | > 24 fps with 100+ visible nodes |
| Page load impact | < 50 ms |
| Time to first node | < 500 ms from navigation |
| Package size | ~2.3 MB |

200-node cap prevents layout explosion. Excess domains collapse into a **+N more** cluster node.

---

## Project structure

```
webxray/
├── manifest.json            # MV3 — every permission justified
├── background.js            # Service Worker: intercept → classify → forward
├── classifier.js            # eTLD+1 matching + domain lookup
├── sidepanel.html/js/css    # 3D visualization engine
├── popup.html/js/css        # Toolbar popup
├── graph/
│   ├── scene.js             # Three.js scene, camera, controls
│   ├── nodes.js             # Sphere meshes, color management
│   ├── edges.js             # Cylinder edges, pulse shaders
│   ├── layout.js            # Force-directed physics
│   └── interaction.js       # Raycasting, hover, click
├── ui/
│   ├── statsbar.js          # Live category breakdown
│   ├── infocard.js          # Node detail overlay
│   └── screenshot.js        # Canvas capture + branding
├── lib/three.min.js         # Three.js r128 — bundled, never CDN
├── data/domains.json        # 51k+ classified domains
└── scripts/build-lists.js   # Compiles domain lists at build time
```

---

## Contributing

Bug reports, PRs, and classification corrections welcome.

**Good first issues:**
- Wrong category for a known domain → fix source mapping in `scripts/build-lists.js`
- Performance improvements in `graph/layout.js`
- 2D flat view mode toggle

**Hard rules:**
- No content scripts injected into pages
- No external network requests from the extension
- No `eval()` or dynamic script loading
- Manifest stays MV3

---

## License

[MIT](LICENSE) — © 2026 webdevoli ([@Oliverwebdev](https://github.com/Oliverwebdev))

---

<div align="center">

*Built by a developer from Bavaria who got tired of not seeing what websites do behind the curtain.*

**WEBXRAY observes. It never touches.**

</div>
