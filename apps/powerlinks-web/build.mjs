#!/usr/bin/env node
// Produces Vercel Build Output API v3 (.vercel/output) from src/.
// This is what ships to Vercel via `vercel deploy --prebuilt` — Vercel never
// sees src/ or runs a build of its own. Pure static: copy src -> static, emit config.
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(root, "src");
const outDir = resolve(root, ".vercel", "output");
const staticDir = resolve(outDir, "static");

await rm(outDir, { recursive: true, force: true });
await mkdir(staticDir, { recursive: true });

// Copy all static assets verbatim.
await cp(srcDir, staticDir, { recursive: true });

// Build Output API v3 config. cleanUrls lets /about resolve to about.html etc.
const config = {
  version: 3,
  cleanUrls: true,
  trailingSlash: false,
};
await writeFile(resolve(outDir, "config.json"), JSON.stringify(config, null, 2));

console.log("Built Vercel output -> .vercel/output (version 3, static)");
