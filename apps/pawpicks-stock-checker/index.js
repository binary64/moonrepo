#!/usr/bin/env node
/**
 * PawPicks UK — Amazon Stock Checker
 *
 * Checks stock status for each ASIN via HTTP GET + cheerio HTML parsing.
 * Writes stock-status.json to OUTPUT_DIR (default: /data).
 *
 * Status values:
 *   in_stock       — "Add to Basket" / "In Stock" found
 *   out_of_stock   — "Currently unavailable" found
 *   dead           — 404 / "page not found"
 *   unknown        — response received but couldn't classify
 *   error          — network/fetch error
 */

import { load } from 'cheerio';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const OUTPUT_DIR = process.env.OUTPUT_DIR || '/data';
const OUTPUT_FILE = join(OUTPUT_DIR, 'stock-status.json');

const ASINS = [
  'B00CFFLEDA', // Canagan Free-Run Chicken
  'B06XNBWL48', // Orijen Original
  'B00BSSMLT6', // Lily's Kitchen
  'B0CB21P5W7', // Symply Fresh Turkey
  'B00SYH7MC0', // Eden Holistic
  'B00WAE2MSM', // Harringtons GF Turkey
  'B07B9TS1VF', // Forthglade Lifestage
  'B01M5ES0TR', // Acana Prairie Poultry
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomDelay(minMs = 2000, maxMs = 5000) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs)
  );
}

/**
 * Parse Amazon product page HTML into a stock result.
 * @param {string} html
 * @param {number} statusCode
 * @returns {{ status: string, price: number|null }}
 */
function parseAmazonPage(html, statusCode) {
  if (statusCode === 404) {
    return { status: 'dead', price: null };
  }

  const $ = load(html);
  const bodyText = $('body').text();

  // Dead / not found patterns
  const deadPatterns = [
    /page not found/i,
    /looking for something\?/i,
    /sorry! we couldn.*t find that page/i,
    /this listing has ended/i,
    /asin.*not found/i,
  ];
  for (const pattern of deadPatterns) {
    if (pattern.test(bodyText)) {
      return { status: 'dead', price: null };
    }
  }

  // Out of stock patterns (check before in_stock — order matters)
  const outPatterns = [
    /currently unavailable/i,
    /currently out of stock/i,
    /we don.*t know when or if this item will be back in stock/i,
    /unavailable/i,
  ];
  for (const pattern of outPatterns) {
    if (pattern.test(bodyText)) {
      return { status: 'out_of_stock', price: null };
    }
  }

  // In stock patterns
  const inPatterns = [
    /add to basket/i,
    /add to cart/i,
    /in stock/i,
    /buy now/i,
  ];
  const inStockMatch = inPatterns.some((p) => p.test(bodyText));
  if (inStockMatch) {
    // Best-effort price extraction
    let price = null;
    const priceSelectors = [
      '.a-price .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '.a-price-whole',
      '#price_inside_buybox',
    ];
    for (const selector of priceSelectors) {
      const raw = $(selector).first().text().trim();
      if (raw) {
        const match = raw.match(/[\d,]+\.?\d*/);
        if (match) {
          price = parseFloat(match[0].replace(/,/g, ''));
          if (!isNaN(price)) break;
        }
      }
    }
    return { status: 'in_stock', price };
  }

  return { status: 'unknown', price: null };
}

/**
 * Fetch and parse a single ASIN.
 * @param {string} asin
 * @returns {Promise<{ status: string, checkedAt: string, price?: number }>}
 */
async function checkAsin(asin) {
  const url = `https://www.amazon.co.uk/dp/${asin}`;
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': randomUserAgent(),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
    });

    if (response.status === 404) {
      console.log(`  [${asin}] 404 → dead`);
      return { status: 'dead', checkedAt };
    }

    const html = await response.text();
    const { status, price } = parseAmazonPage(html, response.status);

    console.log(`  [${asin}] HTTP ${response.status} → ${status}${price != null ? ` @ £${price}` : ''}`);

    const result = { status, checkedAt };
    if (price != null) result.price = price;
    return result;
  } catch (err) {
    console.error(`  [${asin}] Error: ${err.message}`);
    return { status: 'error', checkedAt, error: err.message };
  }
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  console.log(`PawPicks Stock Checker — ${new Date().toISOString()}`);
  console.log(`Checking ${ASINS.length} ASINs…`);

  // Load existing data so we can preserve history on error
  let existing = { lastChecked: null, products: {} };
  try {
    existing = JSON.parse(readFileSync(OUTPUT_FILE, 'utf8'));
  } catch {
    // Fresh run — no existing file
  }

  const products = { ...existing.products };

  for (let i = 0; i < ASINS.length; i++) {
    const asin = ASINS[i];
    console.log(`\n[${i + 1}/${ASINS.length}] Checking ${asin}…`);

    products[asin] = await checkAsin(asin);

    // Delay between requests (skip after last one)
    if (i < ASINS.length - 1) {
      const delay = Math.floor(Math.random() * 3000) + 2000;
      console.log(`  Waiting ${delay}ms before next request…`);
      await randomDelay(2000, 5000);
    }
  }

  const output = {
    lastChecked: new Date().toISOString(),
    products,
  };

  // Ensure output directory exists
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\n✓ Wrote stock-status.json to ${OUTPUT_FILE}`);

  const summary = Object.entries(products).map(([asin, data]) => `  ${asin}: ${data.status}`);
  console.log('\nSummary:\n' + summary.join('\n'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
