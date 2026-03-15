#!/usr/bin/env node
/**
 * WEBXRAY Domain List Builder
 * Downloads open-source tracker/malware domain lists and compiles them
 * into a single optimized JSON hashmap at data/domains.json.
 *
 * Sources:
 *   - Disconnect services.json  → Advertising, Analytics, Social, Fingerprinting, Cryptomining
 *   - EasyPrivacy               → tracker
 *   - Peter Lowe's adservers    → advertising
 *   - URLhaus hostfile          → malicious
 *
 * Priority (first match wins during merge):
 *   malicious > cryptomining > fingerprinting > advertising > analytics > social > tracker
 *
 * Run: node scripts/build-lists.js
 * Output: data/domains.json (~150-300KB minified, ~20k-30k entries)
 */

import https from 'https';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT    = path.resolve(__dirname, '..', 'data', 'domains.json');

// Category priority: lower index = higher priority (first wins on conflict)
const PRIORITY = [
  'malicious', 'cryptomining', 'fingerprinting',
  'advertising', 'analytics', 'social', 'tracker',
];

// Disconnect category → WEBXRAY category mapping
const DISCONNECT_MAP = {
  'Advertising':    'advertising',
  'Analytics':      'analytics',
  'Social':         'social',
  'Content':        'analytics',   // CDN/content delivery — treat as analytics
  'FingerprintingInvasive': 'fingerprinting',
  'FingerprintingGeneral':  'fingerprinting',
  'Cryptomining':   'cryptomining',
};

// Source definitions
const SOURCES = [
  {
    name: 'Disconnect services.json',
    url:  'https://raw.githubusercontent.com/disconnectme/disconnect-tracking-protection/master/services.json',
    parse: parseDisconnect,
  },
  {
    name: 'EasyPrivacy',
    url:  'https://easylist.to/easylist/easyprivacy.txt',
    parse: parseEasyPrivacy,
  },
  {
    name: "Peter Lowe's Ad Servers",
    url:  'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=nohtml&showintro=0&mimetype=plaintext',
    parse: parsePeterLowe,
  },
  {
    name: 'URLhaus Malware Hostfile',
    url:  'https://urlhaus.abuse.ch/downloads/hostfile/',
    parse: parseUrlhaus,
  },
];

// -----------------------------------------------------------------------
// HTTP fetch helper (no external dependencies)
// -----------------------------------------------------------------------

/**
 * Fetch a URL and return the response body as a string.
 * Follows up to 3 HTTP redirects.
 * @param {string} url
 * @param {number} [redirects=0]
 * @returns {Promise<string>}
 */
function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 3) {
      reject(new Error(`Too many redirects for ${url}`));
      return;
    }

    const req = https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(fetchUrl(res.headers.location, redirects + 1));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

// -----------------------------------------------------------------------
// Per-source parsers — return { domain: category } objects
// -----------------------------------------------------------------------

/**
 * Parse Disconnect's services.json into a domain → category map.
 * @param {string} text
 * @returns {Object.<string, string>}
 */
function parseDisconnect(text) {
  const result = {};
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error('  Failed to parse Disconnect JSON:', e.message);
    return result;
  }

  const categories = data.categories || {};
  for (const [disconnectCat, services] of Object.entries(categories)) {
    const wxCategory = DISCONNECT_MAP[disconnectCat];
    if (!wxCategory) continue;

    for (const service of services) {
      // Each service is an object with one key (service name) → object of { name: [domains] }
      for (const serviceData of Object.values(service)) {
        for (const domains of Object.values(serviceData)) {
          if (!Array.isArray(domains)) continue;
          for (const domain of domains) {
            if (typeof domain === 'string' && domain.includes('.')) {
              result[domain.toLowerCase()] = wxCategory;
            }
          }
        }
      }
    }
  }
  return result;
}

/**
 * Parse EasyPrivacy .txt filter list — extract domain-based rules.
 * Focuses on ||domain.tld^ patterns (the most common tracker format).
 * @param {string} text
 * @returns {Object.<string, string>}
 */
function parseEasyPrivacy(text) {
  const result = {};
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments, empty lines, exception rules, cosmetic filters
    if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('#') ||
        trimmed.startsWith('@@') || trimmed.includes('##') || trimmed.includes('#@#')) {
      continue;
    }

    // ||domain.tld^ or ||domain.tld^$options
    const match = trimmed.match(/^\|\|([a-z0-9][a-z0-9._-]+\.[a-z]{2,})\^/i);
    if (match) {
      const domain = match[1].toLowerCase();
      if (isValidDomain(domain)) {
        result[domain] = 'tracker';
      }
    }
  }
  return result;
}

/**
 * Parse Peter Lowe's ad server list (one domain per line, no comments).
 * @param {string} text
 * @returns {Object.<string, string>}
 */
function parsePeterLowe(text) {
  const result = {};
  const lines = text.split('\n');

  for (const line of lines) {
    const domain = line.trim().toLowerCase();
    if (domain && !domain.startsWith('#') && isValidDomain(domain)) {
      result[domain] = 'advertising';
    }
  }
  return result;
}

/**
 * Parse URLhaus hostfile format: "127.0.0.1 domain.tld" or "0.0.0.0 domain.tld"
 * @param {string} text
 * @returns {Object.<string, string>}
 */
function parseUrlhaus(text) {
  const result = {};
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Hostfile format: "127.0.0.1 domain" or "0.0.0.0 domain"
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const domain = parts[1].toLowerCase();
      if (isValidDomain(domain) && domain !== 'localhost') {
        result[domain] = 'malicious';
      }
    }
  }
  return result;
}

// -----------------------------------------------------------------------
// Merge logic
// -----------------------------------------------------------------------

/**
 * Merge multiple domain maps respecting PRIORITY order.
 * Higher priority category wins on conflict.
 * @param {Array<Object.<string, string>>} maps
 * @returns {Object.<string, string>}
 */
function mergeMaps(maps) {
  const merged = {};

  for (const map of maps) {
    for (const [domain, category] of Object.entries(map)) {
      if (!merged[domain]) {
        merged[domain] = category;
      } else {
        // Keep whichever has higher priority (lower index in PRIORITY array)
        const existingPriority = PRIORITY.indexOf(merged[domain]);
        const newPriority      = PRIORITY.indexOf(category);
        if (newPriority !== -1 && (existingPriority === -1 || newPriority < existingPriority)) {
          merged[domain] = category;
        }
      }
    }
  }

  return merged;
}

// -----------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------

/** Basic domain validation — must have at least one dot, no spaces, etc. */
function isValidDomain(domain) {
  if (!domain || domain.length > 253) return false;
  if (!domain.includes('.'))          return false;
  if (domain.includes(' '))           return false;
  if (domain.startsWith('.') || domain.endsWith('.')) return false;
  // Must match basic domain pattern
  return /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i.test(domain);
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------

async function main() {
  console.log('WEBXRAY Domain List Builder v1.0');
  console.log('==================================\n');

  // Ensure output directory exists
  const dataDir = path.dirname(OUTPUT);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const maps = [];

  for (const source of SOURCES) {
    console.log(`Downloading: ${source.name}`);
    console.log(`  URL: ${source.url}`);

    try {
      const text    = await fetchUrl(source.url);
      const parsed  = source.parse(text);
      const count   = Object.keys(parsed).length;
      console.log(`  → ${count.toLocaleString()} domains parsed`);
      maps.push(parsed);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      console.error('  Continuing without this source…\n');
      maps.push({});
    }

    console.log('');
  }

  console.log('Merging lists with priority order…');
  const merged = mergeMaps(maps);
  const total  = Object.keys(merged).length;
  console.log(`→ ${total.toLocaleString()} unique domains in final dataset\n`);

  // Category breakdown
  const breakdown = {};
  for (const cat of Object.values(merged)) {
    breakdown[cat] = (breakdown[cat] || 0) + 1;
  }
  console.log('Breakdown by category:');
  for (const [cat, count] of Object.entries(breakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(16)} ${count.toLocaleString()}`);
  }

  // Write output
  const json = JSON.stringify(merged);
  fs.writeFileSync(OUTPUT, json, 'utf8');

  const sizeKB = (Buffer.byteLength(json, 'utf8') / 1024).toFixed(1);
  console.log(`\n✓ Written to ${OUTPUT}`);
  console.log(`  Size: ${sizeKB} KB`);
  console.log('\nDone. Rebuild whenever you want to update the domain lists.');
}

main().catch((err) => {
  console.error('\nBuild failed:', err.message);
  process.exit(1);
});
