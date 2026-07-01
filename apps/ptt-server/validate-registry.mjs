#!/usr/bin/env node
// Guards against the quick-commands drift bug (PR #354): the deployed configMap
// must embed a registry.json whose entries match server.ts's QuickCommand
// interface ({ skill: string, action: string }). The old manifest used a stale
// { session, message } schema, which silently shipped 7 mis-typed commands.
//
// This is a SCHEMA + sanity guard, intentionally self-contained inside moonrepo
// (the canonical registry.json lives in ~/clawd, outside this repo, so we cannot
// diff against it from CI). Run via `moon ptt-server:validate-registry`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cmPath = path.resolve(
  here,
  "../../infra/manifests/ptt-server/quick-commands-configmap.yaml",
);

const fail = (msg) => {
  console.error(`❌ quick-commands registry invalid: ${msg}`);
  process.exit(1);
};

let yaml;
try {
  yaml = fs.readFileSync(cmPath, "utf-8");
} catch (e) {
  fail(`cannot read configMap at ${cmPath}: ${e.message}`);
}

// Extract the `registry.json: |` block literal and dedent it.
const marker = "registry.json: |";
const idx = yaml.indexOf(marker);
if (idx === -1) fail(`'${marker}' block not found in configMap`);
const after = yaml.slice(idx + marker.length).split("\n").slice(1);
// Block-scalar lines are indented deeper than the key; collect while indented.
const blockLines = [];
let baseIndent = null;
for (const line of after) {
  if (line.trim() === "") {
    blockLines.push("");
    continue;
  }
  const indent = line.length - line.trimStart().length;
  if (baseIndent === null) baseIndent = indent;
  if (indent < baseIndent) break;
  blockLines.push(line.slice(baseIndent));
}

let reg;
try {
  reg = JSON.parse(blockLines.join("\n"));
} catch (e) {
  fail(`embedded registry.json is not valid JSON: ${e.message}`);
}

if (!reg.commands || typeof reg.commands !== "object")
  fail("missing top-level 'commands' object");

const entries = Object.entries(reg.commands);
if (entries.length === 0) fail("'commands' is empty");

for (const [phrase, spec] of entries) {
  if (typeof spec !== "object" || spec === null)
    fail(`command '${phrase}' is not an object`);
  if (typeof spec.skill !== "string" || spec.skill.length === 0)
    fail(`command '${phrase}' missing string 'skill' (stale schema?)`);
  if (typeof spec.action !== "string" || spec.action.length === 0)
    fail(`command '${phrase}' missing string 'action' (stale schema?)`);
  if ("session" in spec || "message" in spec)
    fail(
      `command '${phrase}' uses the deprecated { session, message } schema — ` +
        `expected { skill, action }`,
    );
}

console.log(
  `✅ quick-commands registry OK: ${entries.length} commands, all { skill, action }`,
);
