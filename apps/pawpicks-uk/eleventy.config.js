module.exports = async function(eleventyConfig) {
  // ── Stock status data ──────────────────────────────────────────────────────
  // Fetches latest stock status per ASIN from Hasura at build time.
  // Requires HASURA_ENDPOINT and HASURA_ADMIN_SECRET env vars (set in Vercel).
  // Falls back to an empty object so builds don't fail when Hasura is unreachable.
  //
  // TODO: Replace HASURA_ADMIN_SECRET with a read-only Hasura role for Vercel builds.
  const hasuraEndpoint = process.env.HASURA_ENDPOINT || 'https://hasura.brandwhisper.cloud';
  const hasuraAdminSecret = process.env.HASURA_ADMIN_SECRET;

  /** @type {Record<string, { status: string, price: number|null, checkedAt: string }>} */
  let stockStatus = {};

  if (hasuraAdminSecret) {
    try {
      const query = `
        query LatestStockStatus {
          pawpicks_products {
            asin
            name
            slug
            stock_checks(order_by: { checked_at: desc }, limit: 1) {
              status
              price
              checked_at
            }
          }
        }
      `;
      const hasuraController = new AbortController();
      const hasuraTimeoutId = setTimeout(() => hasuraController.abort(), 8_000);
      const response = await fetch(`${hasuraEndpoint}/v1/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hasura-admin-secret': hasuraAdminSecret,
        },
        body: JSON.stringify({ query }),
        signal: hasuraController.signal,
      });
      clearTimeout(hasuraTimeoutId);

      if (!response.ok) {
        throw new Error(`Hasura HTTP error: ${response.status} ${response.statusText}`);
      }

      const json = await response.json();

      if (json.errors && json.errors.length > 0) {
        const messages = json.errors.map((e) => e.message).join('; ');
        throw new Error(`Hasura GraphQL error: ${messages}`);
      }

      const products = json.data?.pawpicks_products ?? [];
      for (const product of products) {
        const latest = product.stock_checks?.[0];
        if (latest) {
          stockStatus[product.asin] = {
            status: latest.status,
            price: latest.price ?? null,
            checkedAt: latest.checked_at,
          };
        }
      }

      console.log(`[pawpicks] Loaded stock status from Hasura for ${Object.keys(stockStatus).length} products`);
    } catch (err) {
      console.warn(`[pawpicks] Failed to fetch stock status from Hasura — stock badges will be hidden: ${err.message}`);
    }
  } else {
    console.warn('[pawpicks] HASURA_ADMIN_SECRET not set — stock badges will be hidden');
  }

  eleventyConfig.addGlobalData('stockStatus', stockStatus);
  // ──────────────────────────────────────────────────────────────────────────

  // Passthrough copy
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/images");
  eleventyConfig.addPassthroughCopy("src/robots.txt");

  // Custom collections
  eleventyConfig.addCollection("productRoundups", function(collectionApi) {
    return collectionApi.getFilteredByTag("roundup").sort((a, b) => {
      return (b.data.priority || 0) - (a.data.priority || 0);
    });
  });

  eleventyConfig.addCollection("comparisons", function(collectionApi) {
    return collectionApi.getFilteredByTag("comparison");
  });

  eleventyConfig.addCollection("brandReviews", function(collectionApi) {
    return collectionApi.getFilteredByTag("brand-review");
  });

  // Filters
  eleventyConfig.addFilter("limit", function(arr, count) {
    return arr.slice(0, count);
  });

  eleventyConfig.addFilter("sortByRating", function(arr) {
    return [...arr].sort((a, b) => b.rating - a.rating);
  });

  eleventyConfig.addFilter("dateDisplay", function(date) {
    return new Date(date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  });

  eleventyConfig.addFilter("jsonLd", function(obj) {
    return JSON.stringify(obj, null, 0);
  });

  eleventyConfig.addFilter("slug", function(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  });

  eleventyConfig.addFilter("stars", function(rating) {
    const full = Math.floor(rating);
    const half = rating % 1 >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
  });

  eleventyConfig.addFilter("gbp", function(price) {
    if (!price) return 'Check price';
    return `£${parseFloat(price).toFixed(2)}`;
  });

  eleventyConfig.addFilter("dateFormat", function(date) {
    return new Date(date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  });

  eleventyConfig.addFilter("excerpt", function(content) {
    if (!content) return '';
    const text = content.replace(/<[^>]+>/g, '');
    return text.substring(0, 160).trim() + '...';
  });

  // Shortcodes
  eleventyConfig.addShortcode("year", () => `${new Date().getFullYear()}`);
  
  eleventyConfig.addShortcode("affiliateButton", function(url, text) {
    return `<a href="${url}" class="affiliate-btn" rel="nofollow noopener sponsored" target="_blank">${text || 'Check Price on Amazon'}</a>`;
  });

  eleventyConfig.addShortcode("proscons", function(pros, cons) {
    const prosList = pros.map(p => `<li>✅ ${p}</li>`).join('');
    const consList = cons.map(c => `<li>❌ ${c}</li>`).join('');
    return `<div class="pros-cons"><div class="pros"><h4>Pros</h4><ul>${prosList}</ul></div><div class="cons"><h4>Cons</h4><ul>${consList}</ul></div></div>`;
  });

  return {
    pathPrefix: process.env.GITHUB_ACTIONS ? "/pawpicks-uk/" : "/",
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data"
    },
    templateFormats: ["njk", "md", "html"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk"
  };
};
