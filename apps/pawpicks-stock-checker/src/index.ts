#!/usr/bin/env tsx

/**
 * PawPicks UK — Amazon Stock Checker
 *
 * Checks stock status for each ASIN via HTTP GET + cheerio HTML parsing.
 * Persists results to Hasura via GraphQL mutations.
 *
 * Status values:
 *   in_stock       — "Add to Basket" / "In Stock" found
 *   out_of_stock   — "Currently unavailable" found
 *   dead           — 404 / "page not found"
 *   unknown        — response received but couldn't classify
 *   error          — network/fetch error
 */

import { readFileSync } from "node:fs";
import { load } from "cheerio";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type StockStatus = "in_stock" | "out_of_stock" | "dead" | "unknown" | "error";

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

interface Product {
  amazonAsin?: string;
  name?: string;
  brand?: string;
  slug?: string;
  [key: string]: unknown;
}

interface ProductMeta {
  asin: string;
  name: string;
  brand: string | null;
  slug: string | null;
}

interface HasuraResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const HASURA_ENDPOINT =
  process.env.HASURA_ENDPOINT ?? "http://hasura.hasura.svc.cluster.local:8080";
const HASURA_ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET;

if (!HASURA_ADMIN_SECRET) {
  console.error("HASURA_ADMIN_SECRET env var is required");
  process.exit(1);
}

// Load products from products.json — capture asin, name, brand, slug
const PRODUCTS_JSON_PATH =
  process.env.PRODUCTS_JSON_PATH ?? "/app/products.json";
let PRODUCTS: ProductMeta[];
try {
  const raw = readFileSync(PRODUCTS_JSON_PATH, "utf8");
  const products = JSON.parse(raw) as Record<string, Product[]>;
  PRODUCTS = Object.values(products)
    .flat()
    .filter(
      (p): p is Product & { amazonAsin: string } =>
        typeof p.amazonAsin === "string" && p.amazonAsin.length > 0,
    )
    .map((p) => ({
      asin: p.amazonAsin,
      name: typeof p.name === "string" ? p.name : p.amazonAsin,
      brand: typeof p.brand === "string" ? p.brand : null,
      slug: typeof p.slug === "string" ? p.slug : null,
    }));
  if (PRODUCTS.length === 0) throw new Error("No ASINs found in products.json");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    `Failed to load products from ${PRODUCTS_JSON_PATH}: ${message}`,
  );
  process.exit(1);
}

const USER_AGENTS: string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] as string;
}

function parseAmazonPage(html: string, statusCode: number): ParseResult {
  if (statusCode === 404) {
    return { status: "dead", price: null };
  }

  const $ = load(html);
  const bodyText = $("body").text();

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
      return { status: "dead", price: null };
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
      return { status: "out_of_stock", price: null };
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
      ".a-price .a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      ".a-price-whole",
      "#price_inside_buybox",
    ];
    for (const selector of priceSelectors) {
      const raw = $(selector).first().text().trim();
      if (raw) {
        const match = raw.match(/[\d,]+\.?\d*/);
        if (match) {
          const parsed = parseFloat(match[0].replace(/,/g, ""));
          if (!Number.isNaN(parsed)) {
            price = parsed;
            break;
          }
        }
      }
    }
    return { status: "in_stock", price };
  }

  return { status: "unknown", price: null };
}

async function checkAsin(asin: string): Promise<ProductResult> {
  const url = `https://www.amazon.co.uk/dp/${asin}`;
  const checkedAt = new Date().toISOString();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": randomUserAgent(),
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (response.status === 404) {
      clearTimeout(timeoutId);
      console.log(`  [${asin}] 404 → dead`);
      return { status: "dead", checkedAt };
    }

    const html = await response.text();
    clearTimeout(timeoutId);
    const { status, price } = parseAmazonPage(html, response.status);

    console.log(
      `  [${asin}] HTTP ${response.status} → ${status}${price != null ? ` @ £${price}` : ""}`,
    );

    const result: ProductResult = { status, checkedAt };
    if (price != null) result.price = price;
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      console.error(`  [${asin}] Error: Request timed out after 10s`);
      return {
        status: "error",
        checkedAt,
        error: "Request timed out after 10s",
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  [${asin}] Error: ${message}`);
    return { status: "error", checkedAt, error: message };
  }
}

// ──────────────────────────────────────────────
// Hasura GraphQL helpers
// ──────────────────────────────────────────────

async function hasuraQuery<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  const response = await fetch(`${HASURA_ENDPOINT}/v1/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": HASURA_ADMIN_SECRET as string,
    },
    body: JSON.stringify({ query, variables }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));

  if (!response.ok) {
    throw new Error(
      `Hasura HTTP error: ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as HasuraResponse<T>;

  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message).join("; ");
    throw new Error(`Hasura GraphQL error: ${messages}`);
  }

  return json.data as T;
}

async function upsertProduct(product: ProductMeta): Promise<void> {
  const mutation = `
    mutation UpsertProduct($asin: String!, $name: String!, $brand: String, $slug: String) {
      insert_pawpicks_products_one(
        object: { asin: $asin, name: $name, brand: $brand, slug: $slug }
        on_conflict: { constraint: pawpicks_products_pkey, update_columns: [name, brand, slug, updated_at] }
      ) {
        asin
      }
    }
  `;
  await hasuraQuery(mutation, {
    asin: product.asin,
    name: product.name,
    brand: product.brand,
    slug: product.slug,
  });
}

async function insertStockCheck(
  asin: string,
  result: ProductResult,
): Promise<void> {
  const mutation = `
    mutation InsertStockCheck($asin: String!, $status: String!, $price: numeric, $error: String) {
      insert_pawpicks_stock_checks_one(object: {
        asin: $asin, status: $status, price: $price, error: $error
      }) {
        id
        checked_at
      }
    }
  `;
  await hasuraQuery(mutation, {
    asin,
    status: result.status,
    price: result.price ?? null,
    error: result.error ?? null,
  });
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`PawPicks Stock Checker — ${new Date().toISOString()}`);
  console.log(`Checking ${PRODUCTS.length} ASINs…`);
  console.log(`Hasura endpoint: ${HASURA_ENDPOINT}`);

  const results: Record<string, ProductResult> = {};

  for (let i = 0; i < PRODUCTS.length; i++) {
    const product = PRODUCTS[i] as ProductMeta;
    console.log(
      `\n[${i + 1}/${PRODUCTS.length}] Checking ${product.asin} (${product.name})…`,
    );

    const result = await checkAsin(product.asin);
    results[product.asin] = result;

    // Persist to Hasura
    try {
      await upsertProduct(product);
      // Skip recording error results — preserve the last known good status
      if (result.status !== "error") {
        await insertStockCheck(product.asin, result);
      }
      console.log(`  [${product.asin}] ✓ Saved to Hasura`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `  [${product.asin}] ✗ Failed to save to Hasura: ${message}`,
      );
      // Continue with remaining ASINs — don't abort the whole run
    }

    // Delay between requests (skip after last one)
    if (i < PRODUCTS.length - 1) {
      const delayMs = Math.floor(Math.random() * 3000) + 2000;
      console.log(`  Waiting ${delayMs}ms before next request…`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  console.log(`\n✓ Completed stock check for ${PRODUCTS.length} ASINs`);

  const summary = Object.entries(results).map(
    ([asin, data]) => `  ${asin}: ${data.status}`,
  );
  console.log(`\nSummary:\n${summary.join("\n")}`);
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
