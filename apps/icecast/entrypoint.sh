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
envsubst '${ICECAST_SOURCE_PASSWORD} ${ICECAST_RELAY_PASSWORD} ${ICECAST_ADMIN_PASSWORD}' \
    < /etc/icecast2/icecast.xml > /tmp/icecast2.xml
cp /tmp/icecast2.xml /etc/icecast2/icecast.xml

echo "Starting Icecast on port 8100..."
exec icecast2 -c /etc/icecast2/icecast.xml
