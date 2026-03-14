#!/bin/bash
# Track change hook — v1 container version
# Logs play history, writes now-playing, updates Icecast metadata via telnet.
# DJ commentary and TTS are disabled for v1.
#
# Usage: announce-track.sh <full_path_to_track> [bpm]

set -e

TRACK_PATH="$1"
TRACK_BPM="$2"
TRACK_FILE=$(basename "$TRACK_PATH" 2>/dev/null || echo "unknown")
HISTORY_LOG="/data/music/play-history.log"

# Skip TTS clips / DJ injections / non-library files (avoid event loops!)
if [[ "$TRACK_PATH" == /tmp/* ]] || [[ "$TRACK_PATH" == /state/* ]] || \
   [[ "$TRACK_FILE" == *"radio-norm"* ]] || [[ "$TRACK_FILE" == *"dj-"* ]] || \
   [[ "$TRACK_FILE" == *"cara-"* ]] || [[ "$TRACK_FILE" == *"shoutout"* ]] || \
   [[ "$TRACK_FILE" == *"transition"* ]] || [[ "$TRACK_FILE" == *"track-announce"* ]] || \
   [[ "$TRACK_FILE" == *"greeting"* ]] || [[ "$TRACK_FILE" == *"voice-"* ]] || \
   [[ "$TRACK_FILE" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} ]]; then
    exit 0
fi

# ─── Always: log play history + write now-playing ───
TRACK_NAME=$(echo "$TRACK_FILE" | sed 's/^[0-9]*-//; s/\.mp3$//; s/\.m4a$//; s/-/ /g; s/_/ /g')
TIMESTAMP=$(date -Iseconds)
mkdir -p "$(dirname "$HISTORY_LOG")"
echo "$TIMESTAMP  $TRACK_NAME  ($TRACK_FILE)" >> "$HISTORY_LOG"

# Write now-playing for instant lookups
PRETTY_NAME=$(echo "$TRACK_FILE" | sed 's/\.mp3$//')
echo "$PRETTY_NAME" > /state/radio-now-playing

# Update Icecast stream metadata via Liquidsoap telnet
echo "meta.update $PRETTY_NAME" | nc -w1 127.0.0.1 1234 >/dev/null 2>&1 || true

exit 0
