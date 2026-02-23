#!/usr/bin/env bash
# Validates proto non-WASM plugin TOML files against the expected schema.
# https://moonrepo.dev/docs/proto/non-wasm-plugin
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGINS_DIR="$REPO_ROOT/infra/.proto/plugins"

if [[ ! -d "$PLUGINS_DIR" ]]; then
  echo "No plugins directory found at $PLUGINS_DIR — skipping"
  exit 0
fi

errors=0

for plugin_file in "$PLUGINS_DIR"/*.toml; do
  [[ -f "$plugin_file" ]] || continue
  name=$(basename "$plugin_file" .toml)
  echo "Validating: $name ($plugin_file)"

  PLUGIN_FILE="$plugin_file" python3 -c "
import tomllib, sys, os

with open(os.environ['PLUGIN_FILE'], 'rb') as f:
    p = tomllib.load(f)

errs = []

# Required top-level fields
for field in ['name', 'type']:
    if field not in p:
        errs.append(f'Missing required field: {field}')

valid_types = ['language', 'dependency-manager', 'package-manager', 'cli']
if p.get('type') not in valid_types:
    errs.append(f\"Invalid type '{p.get('type')}', expected one of: {valid_types}\")

# Platform section — at least one OS with download-file
if 'platform' not in p:
    errs.append('Missing required section: [platform]')
else:
    oses = [k for k in p['platform'] if k in ('linux', 'macos', 'windows')]
    if not oses:
        errs.append('platform must define at least one of: linux, macos, windows')
    for os_name in oses:
        if 'download-file' not in p['platform'][os_name]:
            errs.append(f'platform.{os_name} missing required: download-file')

# Install section
if 'install' not in p:
    errs.append('Missing required section: [install]')
elif 'download-url' not in p['install']:
    errs.append('install missing required: download-url')

# Resolve section
if 'resolve' not in p:
    errs.append('Missing required section: [resolve]')
elif not any(k in p['resolve'] for k in ('git-url', 'manifest-url', 'versions')):
    errs.append('resolve must have git-url, manifest-url, or versions')

if errs:
    for e in errs:
        print(f'  ✗ {e}')
    sys.exit(1)
else:
    print('  ✓ schema valid')
" || errors=1
done

if [[ $errors -ne 0 ]]; then
  echo ""
  echo "✗ Plugin validation failed"
  exit 1
fi

echo ""
echo "✓ All proto plugins validated"
