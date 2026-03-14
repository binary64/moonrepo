#!/bin/bash
set -euo pipefail

echo "Arthur Radio — Starting up..."

# XML-escape a value for safe substitution into icecast.xml
xml_escape() {
    local val="$1"
    val="${val//&/&amp;}"
    val="${val//</&lt;}"
    val="${val//>/&gt;}"
    val="${val//\"/&quot;}"
    val="${val//\'/&apos;}"
    echo "$val"
}

# Template Icecast config with XML-escaped environment variables
echo "Templating Icecast config..."
export ICECAST_SOURCE_PASSWORD="$(xml_escape "${ICECAST_SOURCE_PASSWORD:-changeme}")"
export ICECAST_RELAY_PASSWORD="$(xml_escape "${ICECAST_RELAY_PASSWORD:-changeme}")"
export ICECAST_ADMIN_PASSWORD="$(xml_escape "${ICECAST_ADMIN_PASSWORD:-changeme}")"
envsubst '${ICECAST_SOURCE_PASSWORD} ${ICECAST_RELAY_PASSWORD} ${ICECAST_ADMIN_PASSWORD}' \
    < /etc/icecast2/icecast.xml > /tmp/icecast2.xml
cp /tmp/icecast2.xml /etc/icecast2/icecast.xml

# Trap SIGTERM for clean shutdown
cleanup() {
    echo "Shutting down Arthur Radio..."
    kill "$ICECAST_PID" 2>/dev/null || true
    kill "$LIQUIDSOAP_PID" 2>/dev/null || true
    wait
    echo "Arthur Radio stopped."
    exit "${1:-0}"
}
trap cleanup SIGTERM SIGINT

# Start Icecast in background
echo "Starting Icecast on port 8100..."
icecast2 -c /etc/icecast2/icecast.xml &
ICECAST_PID=$!

# Wait for Icecast to be ready
echo "Waiting for Icecast..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:8100/status-json.xsl >/dev/null 2>&1; then
        echo "Icecast ready."
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "ERROR: Icecast failed to start within 30s"
        exit 1
    fi
    sleep 1
done

# Start Liquidsoap in background
echo "Starting Liquidsoap..."
liquidsoap /radio/radio-dj.liq &
LIQUIDSOAP_PID=$!

echo "Arthur Radio is live! Stream: http://localhost:8100/stream"

# Wait for either process to exit — capture exit code without set -e aborting
# wait -n returns the exit code of the first child to finish
EXIT_CODE=0
wait -n "$ICECAST_PID" "$LIQUIDSOAP_PID" || EXIT_CODE=$?
echo "A process exited (code $EXIT_CODE), shutting down..."
cleanup "$EXIT_CODE"
