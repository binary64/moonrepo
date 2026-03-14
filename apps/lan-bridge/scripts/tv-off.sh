#!/bin/bash
# TV Off — Stop cast + power off Sony Bravia
# Dependencies: catt, curl (installed in Docker image)
DEVICE="Lounge TV"
SONY_IP="192.168.1.101"
SONY_PSK="sony"

echo "📺 Stopping cast..."
catt -d "$DEVICE" stop 2>&1 || true

echo "🔌 Powering off TV..."
curl -s "http://${SONY_IP}/sony/system" \
  -d '{"method":"setPowerStatus","params":[{"status":false}],"id":1,"version":"1.0"}' \
  -H "Content-Type: application/json" \
  -H "X-Auth-PSK: ${SONY_PSK}" 2>&1 || true

echo "✅ TV off"
