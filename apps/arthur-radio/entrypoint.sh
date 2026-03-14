#!/bin/bash
set -e

echo "Arthur Radio — Starting up..."

# Trap SIGTERM for clean shutdown
cleanup() {
    echo "Shutting down Arthur Radio..."
    kill "$ICECAST_PID" 2>/dev/null || true
    kill "$LIQUIDSOAP_PID" 2>/dev/null || true
    wait
    echo "Arthur Radio stopped."
    exit 0
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

# Start Liquidsoap in foreground
echo "Starting Liquidsoap..."
liquidsoap /radio/arthur-radio.liq &
LIQUIDSOAP_PID=$!

echo "Arthur Radio is live! Stream: http://localhost:8100/stream"

# Wait for either process to exit
wait -n "$ICECAST_PID" "$LIQUIDSOAP_PID" 2>/dev/null || true
echo "A process exited, shutting down..."
cleanup
