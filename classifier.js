/**
 * @fileoverview WEBXRAY Domain Classification Engine
 * Classifies request domains into categories using embedded domain lists.
 * Single exported API: init() + classify()
 */

/** @type {Object.<string, string>} Loaded domain classification data */
let domainData = {};
let initPromise = null;

/**
 * Multi-part TLD suffixes (compound public suffixes like co.uk, com.au, etc.)
 * Covers the top ~200 most common compound suffixes worldwide.
 * Source: Public Suffix List subset.
 * @type {Set<string>}
 */
const MULTI_PART_SUFFIXES = new Set([
  // United Kingdom
  'co.uk', 'org.uk', 'me.uk', 'net.uk', 'ltd.uk', 'plc.uk', 'ac.uk',
  'gov.uk', 'sch.uk', 'nhs.uk', 'police.uk',
  // Australia
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  // Japan
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ad.jp', 'ed.jp',
  // New Zealand
  'co.nz', 'net.nz', 'org.nz', 'edu.nz', 'govt.nz', 'ac.nz',
  // South Africa
  'co.za', 'net.za', 'org.za', 'edu.za', 'gov.za', 'ac.za',
  // India
  'co.in', 'net.in', 'org.in', 'edu.in', 'gov.in', 'ac.in', 'nic.in',
  // Brazil
  'com.br', 'net.br', 'org.br', 'edu.br', 'gov.br', 'mil.br',
  // China
  'com.cn', 'net.cn', 'org.cn', 'edu.cn', 'gov.cn', 'ac.cn',
  // Hong Kong
  'com.hk', 'net.hk', 'org.hk', 'edu.hk', 'gov.hk',
  // Singapore
  'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'gov.sg',
  // Malaysia
  'com.my', 'net.my', 'org.my', 'edu.my', 'gov.my',
  // Taiwan
  'com.tw', 'net.tw', 'org.tw', 'edu.tw', 'gov.tw',
  // Argentina
  'com.ar', 'net.ar', 'org.ar', 'edu.ar', 'gov.ar',
  // Mexico
  'com.mx', 'net.mx', 'org.mx', 'edu.mx', 'gob.mx',
  // Colombia
  'com.co', 'net.co', 'org.co', 'edu.co', 'gov.co',
  // Peru
  'com.pe', 'net.pe', 'org.pe', 'edu.pe', 'gob.pe',
  // Venezuela
  'com.ve', 'net.ve', 'org.ve', 'edu.ve', 'gov.ve',
  // Spain
  'com.es', 'nom.es', 'org.es', 'gob.es', 'edu.es',
  // Vietnam
  'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn',
  // Philippines
  'com.ph', 'net.ph', 'org.ph', 'edu.ph', 'gov.ph',
  // Nigeria
  'com.ng', 'net.ng', 'org.ng', 'edu.ng', 'gov.ng',
  // Other common regions
  'com.ua', 'com.eg', 'com.tr', 'com.pk', 'com.kw',
  'com.sa', 'com.ae', 'com.qa', 'com.lb',
  'co.ke', 'co.tz', 'co.ug', 'co.il',
  'net.il', 'org.il', 'ac.il',
  'or.kr', 'co.kr', 'go.kr', 'ac.kr', 'ne.kr',
  'com.pl', 'net.pl', 'org.pl',
  'com.fr', 'com.de', 'com.ru',
]);

/**
 * Extract the eTLD+1 (effective top-level domain + one label) from a hostname.
 * Handles compound public suffixes like co.uk, com.au.
 * Examples: cdn.example.com → example.com, www.bbc.co.uk → bbc.co.uk
 * @param {string} hostname
 * @returns {string} eTLD+1 of the hostname, or empty string on failure
 */
function getETLDPlusOne(hostname) {
  if (!hostname) return '';
  const parts = hostname.split('.');
  if (parts.length < 2) return hostname;

  // Check for two-part public suffix (e.g., co.uk)
  if (parts.length >= 3) {
    const twoPartSuffix = parts.slice(-2).join('.');
    if (MULTI_PART_SUFFIXES.has(twoPartSuffix)) {
      return parts.slice(-3).join('.');
    }
  }

  // Default: last two labels (covers .com, .org, .de, .io, etc.)
  return parts.slice(-2).join('.');
}

/**
 * Walk up subdomains to find a classification match.
 * Checks: tracker.ads.example.com → ads.example.com → example.com
 * Stops after 3 levels to prevent over-broad matches.
 * @param {string} domain
 * @returns {string|null} Category string or null if not found
 */
function lookupDomain(domain) {
  const parts = domain.split('.');
  for (let i = 0; i < Math.min(parts.length - 1, 3); i++) {
    const candidate = parts.slice(i).join('.');
    if (domainData[candidate]) return domainData[candidate];
  }
  return null;
}

/**
 * Initialize the classification engine by loading the compiled domain list.
 * Safe to call multiple times — subsequent calls return the cached promise.
 * The domains.json is built by scripts/build-lists.js at build time.
 * @returns {Promise<void>}
 */
export function init() {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const url = chrome.runtime.getURL('data/domains.json');
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        domainData = await resp.json();
        console.log(`[WEBXRAY] Classifier loaded ${Object.keys(domainData).length} domain entries`);
      } catch (err) {
        console.warn('[WEBXRAY] Failed to load domain data:', err.message);
        domainData = {};
      }
    })();
  }
  return initPromise;
}

/**
 * Classify a request domain relative to its initiating page domain.
 * Priority order (first match wins):
 *   first-party → malicious → cryptomining → fingerprinting →
 *   advertising → analytics → social → tracker → unknown
 *
 * @param {string} requestDomain - The domain receiving the request
 * @param {string} initiatorDomain - The page domain that triggered the request
 * @returns {string} One of: first-party, analytics, advertising, social,
 *   fingerprinting, cryptomining, malicious, tracker, unknown
 */
export function classify(requestDomain, initiatorDomain) {
  if (!requestDomain) return 'unknown';

  // 1. First-party: same eTLD+1 as the initiating page
  if (initiatorDomain) {
    const reqBase = getETLDPlusOne(requestDomain);
    const initBase = getETLDPlusOne(initiatorDomain);
    if (reqBase && initBase && reqBase === initBase) {
      return 'first-party';
    }
  }

  // 2. Embedded list lookup (priority encoded in domains.json at build time)
  const found = lookupDomain(requestDomain);
  if (found) return found;

  return 'unknown';
}

/**
 * Returns the human-readable reason for a classification result.
 * Used in the info card overlay.
 * @param {string} category
 * @param {string} domain
 * @returns {string} Human-readable classification reason
 */
export function getClassificationReason(category, domain) {
  const reasons = {
    'first-party': 'Same domain as the current site — your own content.',
    'analytics':   'Found in analytics tracking lists (Disconnect / EasyPrivacy).',
    'advertising': "Found in advertising blocklists (Disconnect / Peter Lowe's).",
    'social':      'Found in social media tracking lists (Disconnect).',
    'fingerprinting': 'Found in browser fingerprinting domain lists.',
    'cryptomining':   'Found in cryptomining domain lists.',
    'malicious':      'Found on URLhaus malware / phishing blocklist.',
    'tracker':        'Found in cross-site tracker lists (EasyPrivacy).',
    'unknown':        'Not found in any classification list — unidentified third party.',
  };
  return reasons[category] || 'Classification unknown.';
}
