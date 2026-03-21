#!/bin/bash
set -e

echo "DJ Brain — Starting up..."

mkdir -p /state
[ -w /state ] || { echo "ERROR: /state is not writable"; exit 1; }

echo "Starting DJ watcher..."
exec /radio/dj-watcher.sh
