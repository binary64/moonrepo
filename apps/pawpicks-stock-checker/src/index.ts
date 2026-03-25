#!/usr/bin/env tsx
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
// Types
// ──────────────────────────────────────────────

type StockStatus = 'in_stock' | 'out_of_stock' | 'dead' | 'unknown' | 'error';

interface ParseResult {
  status: StockStatus;
  price: number | null;
}

interface ProductResult {
  status: StockStatus;
  checkedAt: string;
  price?: number;
  error?: string;
}

interface StockOutput {
  lastChecked: string | null;
  products: Record<string, ProductResult>;
}

interface Product {
  amazonAsin?: string;
  [key: string]: unknown;
}

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const OUTPUT_DIR = process.env['OUTPUT_DIR'] ?? '/data';
const OUTPUT_FILE = join(OUTPUT_DIR, 'stock-status.json');

// Load ASINs from products.json — all top-level array values, any key
const PRODUCTS_JSON_PATH = process.env['PRODUCTS_JSON_PATH'] ?? '/app/products.json';
let ASINS: string[];
try {
  const raw = readFileSync(PRODUCTS_JSON_PATH, 'utf8');
  const products = JSON.parse(raw) as Record<string, Product[]>;
  ASINS = Object.values(products)
    .flat()
    .map((p) => p.amazonAsin)
    .filter((asin): asin is string => typeof asin === 'string' && asin.length > 0);
  if (ASINS.length === 0) throw new Error('No ASINs found in products.json');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Failed to load ASINs from ${PRODUCTS_JSON_PATH}: ${message}`);
  process.exit(1);
}

const USER_AGENTS: string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] as string;
}

function randomDelay(minMs = 2000, maxMs = 5000): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs),
  );
}

function parseAmazonPage(html: string, statusCode: number): ParseResult {
  if (statusCode === 404) {
    return { status: 'dead', price: null };
  }

  const $ = load(html);
  const bodyText = $('body').text();

  // Dead / not found patterns
  const deadPatterns: RegExp[] = [
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
  const outPatterns: RegExp[] = [
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
  const inPatterns: RegExp[] = [
    /add to basket/i,
    /add to cart/i,
    /in stock/i,
    /buy now/i,
  ];
  const inStockMatch = inPatterns.some((p) => p.test(bodyText));
  if (inStockMatch) {
    // Best-effort price extraction
    let price: number | null = null;
    const priceSelectors: string[] = [
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
          const parsed = parseFloat(match[0].replace(/,/g, ''));
          if (!isNaN(parsed)) {
            price = parsed;
            break;
          }
        }
      }
    }
    return { status: 'in_stock', price };
  }

  return { status: 'unknown', price: null };
}

async function checkAsin(asin: string): Promise<ProductResult> {
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

    console.log(
      `  [${asin}] HTTP ${response.status} → ${status}${price != null ? ` @ £${price}` : ''}`,
    );

    const result: ProductResult = { status, checkedAt };
    if (price != null) result.price = price;
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  [${asin}] Error: ${message}`);
    return { status: 'error', checkedAt, error: message };
  }
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`PawPicks Stock Checker — ${new Date().toISOString()}`);
  console.log(`Checking ${ASINS.length} ASINs…`);

  // Load existing data so we can preserve history on error
  let existing: StockOutput = { lastChecked: null, products: {} };
  try {
    existing = JSON.parse(readFileSync(OUTPUT_FILE, 'utf8')) as StockOutput;
  } catch {
    // Fresh run — no existing file
  }

  const products: Record<string, ProductResult> = { ...existing.products };

  for (let i = 0; i < ASINS.length; i++) {
    const asin = ASINS[i] as string;
    console.log(`\n[${i + 1}/${ASINS.length}] Checking ${asin}…`);

    products[asin] = await checkAsin(asin);

    // Delay between requests (skip after last one)
    if (i < ASINS.length - 1) {
      const delay = Math.floor(Math.random() * 3000) + 2000;
      console.log(`  Waiting ${delay}ms before next request…`);
      await randomDelay(2000, 5000);
    }
  }

  const output: StockOutput = {
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

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
