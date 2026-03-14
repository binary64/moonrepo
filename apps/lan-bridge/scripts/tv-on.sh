#!/bin/bash
# TV On — Wake + Cast with retry protocol (handles daydream/screensaver/deep standby)
# Usage: tv-on.sh [URL]
# Dependencies: catt, curl, python3 (all installed in Docker image)

set -euo pipefail

DEVICE="Lounge TV"
TV_IP="192.168.1.101"
TV_MAC="c0:38:96:7c:50:8e"
TV_PSK="sony"
HA_BASE="https://home.brandwhisper.cloud"
HA_TOKEN_FILE="${HOME}/.config/home-assistant/token"
DEFAULT_URL="http://192.168.1.187:3003/?token=693544bfcb1294b0624646c72aee5b5f"
URL="${1:-$DEFAULT_URL}"

HA_TOKEN=""
[ -f "$HA_TOKEN_FILE" ] && HA_TOKEN=$(cat "$HA_TOKEN_FILE")

ha_service() {
  [ -z "$HA_TOKEN" ] && return 1
  curl -s -m 8 -X POST "${HA_BASE}/api/services/$1/$2" \
    -H "Authorization: Bearer $HA_TOKEN" \
    -H "Content-Type: application/json" \
    -d "${3:-{}}" >/dev/null 2>&1
}

get_tv_is_on() {
  /app/scripts/tv-app-status.py 2>/dev/null | grep "^on=" | cut -d= -f2 || echo "false"
}

get_tv_app() {
  /app/scripts/tv-app-status.py 2>/dev/null | grep "^app=" | cut -d= -f2 || echo "unknown"
}

wake_tv() {
  local is_on
  is_on=$(get_tv_is_on)
  echo "🔌 TV is_on (port 6466): $is_on"

  if [ "$is_on" != "True" ]; then
    echo "⚡ Sending turn_on via HA..."
    ha_service "media_player" "turn_on" '{"entity_id":"media_player.bravia_kdl_42w829b"}' || true
    ha_service "remote"       "turn_on" '{"entity_id":"remote.bravia_kdl_42w829b"}'        || true

    local waited=0
    while [ $waited -lt 30 ]; do
      sleep 2; waited=$((waited + 2))
      is_on=$(get_tv_is_on)
      echo "  ... waiting (${waited}s): is_on=$is_on"
      [ "$is_on" = "True" ] && break
      if [ $waited -eq 10 ]; then
        echo "  WoL fallback — sending magic packet to $TV_MAC..."
        python3 -c "
import socket, struct
mac = '$TV_MAC'.replace(':','')
pkt = b'\xff'*6 + bytes.fromhex(mac)*16
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
s.sendto(pkt, ('255.255.255.255', 9))
s.close()
print('  WoL sent')
" 2>/dev/null || true
      fi
    done
  fi

  echo "📺 TV is_on: $is_on"
}

echo "📺 Starting TV on sequence..."
wake_tv

echo "📺 Casting $URL ..."
catt -d "$DEVICE" cast_site "$URL" 2>&1 &

IS_ON=$(get_tv_is_on)
APP=$(get_tv_app)
CAST=$(catt -d "$DEVICE" info 2>/dev/null | grep -E "display_name|is_active_input|is_stand_by" | tr '\n' ' ')

echo ""
echo "  6466 is_on:     $IS_ON"
echo "  6466 app:       $APP"
echo "  Cast session:   $CAST"

if [ "$IS_ON" = "True" ]; then
  echo "✅ TV on (app: $APP)"
else
  echo "⚠️ TV not responding — may need manual power press"
  exit 1
fi
