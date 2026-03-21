#!/bin/bash
# Track change hook — logs play history, writes now-playing, updates Icecast
# metadata, and writes a new-track-event for dj-brain to consume.
#
# Reads track info from state files written by Liquidsoap:
#   /state/current-track-path  — full path to the track
#   /state/current-track-bpm   — detected BPM

set -e

TRACK_PATH=$(cat /state/current-track-path 2>/dev/null || echo "")
TRACK_BPM=$(cat /state/current-track-bpm 2>/dev/null || echo "")
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
PRETTY_NAME="$TRACK_NAME"
echo "$PRETTY_NAME" > /state/radio-now-playing

# Update Icecast stream metadata via Liquidsoap telnet (local — same container)
echo "meta.update $PRETTY_NAME" | nc -w1 127.0.0.1 1234 >/dev/null 2>&1 || true

# ─── Write new-track-event for dj-brain to consume ───
TMP_EVENT="/state/new-track-event.tmp.$$"
printf '{"path":"%s","bpm":"%s","name":"%s","timestamp":"%s"}\n' \
    "$TRACK_PATH" "$TRACK_BPM" "$PRETTY_NAME" "$TIMESTAMP" > "$TMP_EVENT"
mv "$TMP_EVENT" /state/new-track-event

exit 0
