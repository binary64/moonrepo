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

# Config template source. Defaults to the image-baked copy, but the deployment
# overrides this to a ConfigMap mounted read-only (so buffer/limit tuning is a
# YAML edit + ArgoCD sync — no image rebuild). The mount is read-only, so we
# render the password-substituted result to a writable temp file and run from it.
TEMPLATE="${ICECAST_CONFIG_TEMPLATE:-/etc/icecast2/icecast.xml}"
if [ ! -f "$TEMPLATE" ]; then
    echo "ERROR: Icecast config template not found at $TEMPLATE" >&2
    exit 1
fi
echo "Using config template: $TEMPLATE"

# Render to a restricted temp file to avoid exposing passwords in world-readable /tmp
RENDERED=$(mktemp /tmp/icecast-XXXXXX.xml)
chmod 600 "$RENDERED"
envsubst '${ICECAST_SOURCE_PASSWORD} ${ICECAST_RELAY_PASSWORD} ${ICECAST_ADMIN_PASSWORD}' \
    < "$TEMPLATE" > "$RENDERED"

echo "Starting Icecast on port 8100..."
exec icecast2 -c "$RENDERED"
