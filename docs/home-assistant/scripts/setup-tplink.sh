#!/bin/bash
# Setup TP-Link devices in Home Assistant via config flow API
#
# Prerequisites:
#   - HA port-forwarded to localhost:8123
#   - HA_TOKEN set or token file exists at ~/.config/home-assistant/token
#   - TPLINK_PASSWORD set (TP-Link cloud password)
#
# Usage:
#   export TPLINK_PASSWORD='your-password'
#   bash setup-tplink.sh

set -euo pipefail

HA_URL="${HA_URL:-http://localhost:8123}"
HA_TOKEN="${HA_TOKEN:-$(cat ~/.config/home-assistant/token 2>/dev/null || echo '')}"
TPLINK_USERNAME="${TPLINK_USERNAME:-}"

if [ -z "$HA_TOKEN" ]; then
  echo "Error: HA_TOKEN not set and ~/.config/home-assistant/token not found"
  exit 1
fi

if [ -z "$TPLINK_USERNAME" ]; then
  echo "Error: TPLINK_USERNAME environment variable not set"
  exit 1
fi

if [ -z "${TPLINK_PASSWORD:-}" ]; then
  echo "Error: TPLINK_PASSWORD environment variable not set"
  exit 1
fi

api() {
  curl -s "$HA_URL/api/$1" \
    -H "Authorization: Bearer $HA_TOKEN" \
    -H "Content-Type: application/json" \
    "${@:2}"
}

echo "=== TP-Link Integration Setup ==="
echo ""

# Check API connectivity
echo "Checking HA API..."
api "" | jq -r '.message' || { echo "Failed to connect to HA API"; exit 1; }
echo ""

# Check if tplink integration is already configured
echo "Checking existing tplink config entries..."
EXISTING=$(api "config/config_entries/entry" | jq '[.[] | select(.domain == "tplink")]')
COUNT=$(echo "$EXISTING" | jq 'length')

if [ "$COUNT" -gt 0 ]; then
  echo "Found $COUNT existing tplink config entries:"
  echo "$EXISTING" | jq -r '.[] | "  - \(.title) (source: \(.source), state: \(.state // "unknown"))"'
  echo ""
  echo "To add more devices, use the HA UI: Settings → Devices & Services → + Add Integration → TP-Link Smart Home"
else
  echo "No existing tplink config entries found."
  echo ""
  echo "== Manual Setup Required =="
  echo ""
  echo "The TP-Link integration uses a config flow that requires interactive UI setup."
  echo "Please add each device via the HA UI:"
  echo ""
  echo "1. Go to: ${HA_URL}/config/integrations"
  echo "   Or: Settings → Devices & Services → + Add Integration"
  echo ""
  echo "2. Search for 'TP-Link Smart Home'"
  echo ""
  echo "3. For each device, enter:"
  echo "   - Host: Device IP (e.g., YOUR_DEVICE_IP for Lounge 1)"
  echo "   - Username: $TPLINK_USERNAME"
  echo "   - Password: (your TP-Link cloud password)"
  echo ""
  echo "Devices to add:"
  echo "  • Lounge 1 — Kasa KL130B — IP: YOUR_DEVICE_IP"
  echo "  • Lounge 2 — Kasa KL130B — IP: (check auto-discovery)"
  echo "  • Smart Device — Tapo P304M — IP: (check auto-discovery)"
fi

echo ""
echo "=== Checking for discovered devices ==="
# List discovered config flows (may include auto-discovered TP-Link devices)
DISCOVERIES=$(api "config/config_entries/flow" 2>/dev/null | jq '[.[] | select(.handler == "tplink")]' 2>/dev/null || echo "[]")
DISC_COUNT=$(echo "$DISCOVERIES" | jq 'length')

if [ "$DISC_COUNT" -gt 0 ]; then
  echo "Found $DISC_COUNT discovered TP-Link devices waiting for setup:"
  echo "$DISCOVERIES" | jq -r '.[] | "  - Flow ID: \(.flow_id) — \(.context.title_placeholders // {})"'
  echo ""
  echo "Complete setup in the HA UI: ${HA_URL}/config/integrations"
else
  echo "No auto-discovered TP-Link devices pending."
  echo "Ensure hostNetwork is enabled and devices are on the same subnet."
fi

echo ""
echo "Done."
