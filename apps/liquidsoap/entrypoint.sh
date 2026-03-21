#!/bin/bash
set -e

echo "Liquidsoap — Starting up..."

mkdir -p /state
[ -w /state ] || { echo "ERROR: /state is not writable"; exit 1; }

echo "Starting Liquidsoap..."
exec liquidsoap /radio/radio-dj.liq
