#!/bin/bash
set -e
mkdir -p .vercel/output/static
echo '{"version":3}' > .vercel/output/config.json
cp -r public/* .vercel/output/static/
