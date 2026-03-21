#!/bin/bash
set -e

echo "Icecast — Starting up..."

# Template Icecast config with environment variables
envsubst '${ICECAST_SOURCE_PASSWORD} ${ICECAST_RELAY_PASSWORD} ${ICECAST_ADMIN_PASSWORD}' \
    < /etc/icecast2/icecast.xml > /tmp/icecast2.xml
cp /tmp/icecast2.xml /etc/icecast2/icecast.xml

echo "Starting Icecast on port 8100..."
exec icecast2 -c /etc/icecast2/icecast.xml
