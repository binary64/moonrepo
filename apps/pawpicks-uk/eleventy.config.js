module.exports = function(eleventyConfig) {
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
