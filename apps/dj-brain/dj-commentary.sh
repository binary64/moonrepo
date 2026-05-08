#!/bin/bash
set -euo pipefail

# Environment (with defaults)
DJ_NAME="${1:-arthur}"
CLIP_TYPE="${2:-api-call}"
TEXT="${3:-}"
TTS_SERVER_URL="${TTS_SERVER_URL:-http://tts-server.tts-server.svc.cluster.local:3090}"
TTS_AUTH_TOKEN="${TTS_AUTH_TOKEN:-}"
LIQUIDSOAP_HOST="${LIQUIDSOAP_HOST:-liquidsoap.radio-dj.svc.cluster.local}"
LIQUIDSOAP_PORT="${LIQUIDSOAP_PORT:-1234}"

# Voice IDs
ARTHUR_VOICE_ID="b4e39673-3fec-446a-a965-6517b5e0ea52"
CARA_VOICE_ID="7c45223a-60a8-45e5-9c74-0339f354ca81"

# Determine voice ID and queue name from DJ name
case "${DJ_NAME,,}" in
    arthur) VOICE_ID="$ARTHUR_VOICE_ID"; QUEUE_NAME="queue_arthur" ;;
    cara)   VOICE_ID="$CARA_VOICE_ID";   QUEUE_NAME="queue_cara"   ;;
    *)      echo "[dj-commentary] ERROR: Unknown DJ '$DJ_NAME'" >&2; exit 1 ;;
esac

CLIP_ID="dj-$(date +%s)-$$"
RAW_FILE="/state/${CLIP_ID}-raw.mp3"
PADDED_FILE="/state/${CLIP_ID}.mp3"

cleanup() {
    rm -f "$RAW_FILE" "$PADDED_FILE" 2>/dev/null || true
}
trap cleanup EXIT

# Build auth header
if [ -n "$TTS_AUTH_TOKEN" ]; then
    AUTH_HEADER="Authorization: Bearer $TTS_AUTH_TOKEN"
fi

# Step 1: Call /prepare to generate TTS
echo "[dj-commentary] Generating TTS for DJ $DJ_NAME: ${TEXT:0:60}..."
PREPARE_RESPONSE=$(curl -sf \
    --max-time 30 \
    -X POST \
    -H "Content-Type: application/json" \
    ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
    -d "$(jq -n \
        --arg text "$TEXT" \
        --arg voice_id "$VOICE_ID" \
        '{utterances: [{text: $text, voice: {id: $voice_id}}], format: {type: \"mp3\"}}')" \
    "${TTS_SERVER_URL}/prepare") || {
    echo "[dj-commentary] ERROR: TTS /prepare failed" >&2
    exit 1
}

DOWNLOAD_URL=$(echo "$PREPARE_RESPONSE" | jq -r '.url // empty')
if [ -z "$DOWNLOAD_URL" ]; then
    echo "[dj-commentary] ERROR: No URL in TTS response: $PREPARE_RESPONSE" >&2
    exit 1
fi

# Step 2: Download the MP3
echo "[dj-commentary] Downloading TTS clip from $DOWNLOAD_URL..."
curl -sf --max-time 30 \
    ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
    -o "$RAW_FILE" \
    "$DOWNLOAD_URL" || {
    echo "[dj-commentary] ERROR: Failed to download TTS clip" >&2
    exit 1
}

# Verify file size
FILE_SIZE=$(stat -c%s "$RAW_FILE" 2>/dev/null || echo 0)
if [ "$FILE_SIZE" -lt 1000 ]; then
    echo "[dj-commentary] ERROR: TTS file too small (${FILE_SIZE} bytes)" >&2
    exit 1
fi

# Step 3: Pad 300ms silence for smooth ducking
echo "[dj-commentary] Padding 300ms silence..."
if command -v ffmpeg &>/dev/null; then
    ffmpeg -y -loglevel error \
        -f lavfi -i "anullsrc=r=44100:cl=stereo" \
        -i "$RAW_FILE" \
        -filter_complex "[0]atrim=0:0.3[silence];[silence][1:a]concat=n=2:v=0:a=1" \
        "$PADDED_FILE" 2>/dev/null || {
        echo "[dj-commentary] WARN: ffmpeg padding failed, using raw file" >&2
        cp "$RAW_FILE" "$PADDED_FILE"
    }
else
    cp "$RAW_FILE" "$PADDED_FILE"
fi

# Step 4: Push to Liquidsoap queue via telnet
echo "[dj-commentary] Pushing to ${QUEUE_NAME} via ${LIQUIDSOAP_HOST}:${LIQUIDSOAP_PORT}..."
PUSH_RESPONSE=$(echo "${QUEUE_NAME}.push ${PADDED_FILE}" | nc -w2 "$LIQUIDSOAP_HOST" "$LIQUIDSOAP_PORT" 2>&1) || true
if echo "$PUSH_RESPONSE" | grep -qi 'error\|failed\|unknown'; then
    echo "[dj-commentary] WARNING: Push to Liquidsoap had issues: $PUSH_RESPONSE" >&2
fi

# Success — disable EXIT trap cleanup for PADDED_FILE (Liquidsoap will consume it)
trap - EXIT
rm -f "$RAW_FILE" 2>/dev/null || true
(sleep "${CLEANUP_DELAY_SECS:-30}" && rm -f "$PADDED_FILE") &

echo "[dj-commentary] Done — DJ $DJ_NAME commentary queued ($CLIP_ID)"
