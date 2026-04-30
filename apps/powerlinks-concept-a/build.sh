#!/bin/bash
set -euo pipefail
mkdir -p .vercel/output/static
echo '{"version":3}' > .vercel/output/config.json
if [ -d public ]; then
  cp -a public/. .vercel/output/static/
fi
