#!/bin/bash
set -e

echo "Icecast — Starting up..."

# Validate required password variables before templating config
MISSING=""
[ -z "${ICECAST_SOURCE_PASSWORD:-}" ] && MISSING="$MISSING ICECAST_SOURCE_PASSWORD"
[ -z "${ICECAST_RELAY_PASSWORD:-}" ] && MISSING="$MISSING ICECAST_RELAY_PASSWORD"
[ -z "${ICECAST_ADMIN_PASSWORD:-}" ] && MISSING="$MISSING ICECAST_ADMIN_PASSWORD"
if [ -n "$MISSING" ]; then
    echo "ERROR: Required Icecast password variables are not set:$MISSING" >&2
    exit 1
fi

# Template Icecast config with environment variables
# Use restricted temp file to avoid exposing passwords in world-readable /tmp
TMPCONF=$(mktemp /tmp/icecast-XXXXXX.xml)
chmod 600 "$TMPCONF"
envsubst '${ICECAST_SOURCE_PASSWORD} ${ICECAST_RELAY_PASSWORD} ${ICECAST_ADMIN_PASSWORD}' \
    < /etc/icecast2/icecast.xml > "$TMPCONF"
cp "$TMPCONF" /etc/icecast2/icecast.xml
rm -f "$TMPCONF"

echo "Starting Icecast on port 8100..."
exec icecast2 -c /etc/icecast2/icecast.xml
