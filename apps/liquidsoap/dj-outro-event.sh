#!/bin/bash
# Outro commentary trigger — invoked from radio-dj.liq via source.on_end when
# ~OUTRO_LEAD seconds remain on the current track.
#
# Writes /state/new-track-event, which dj-watcher.sh consumes to render a TTS
# commentary clip. Because this fires at the OUTRO (not at track start), the
# LLM+TTS render window (~10-20s) completes while the track is finishing, so
# the clip lands over the outro and carries across the crossfade into the next
# track — a real radio back-announce, instead of talking over verse 2.
#
# Reads the same Liquidsoap-written state files announce-track.sh uses. At the
# outro the "current" track is still the ENDING track (the next one hasn't
# started), which is exactly what we want to back-announce.
#   /state/current-track-path  — full path to the track
#   /state/current-track-bpm   — detected BPM

set -e

TRACK_PATH=$(cat /state/current-track-path 2>/dev/null || echo "")
if [ -z "$TRACK_PATH" ]; then
    exit 0
fi
TRACK_BPM=$(cat /state/current-track-bpm 2>/dev/null || echo "")

TRACK_FILE=$(basename "$TRACK_PATH" 2>/dev/null || echo "unknown")

# Skip TTS clips / DJ injections / non-library files (avoid event loops!).
# Mirrors announce-track.sh — a DJ clip must never trigger another DJ clip.
if [[ "$TRACK_PATH" == /tmp/* ]] || [[ "$TRACK_PATH" == /state/* ]] || \
   [[ "$TRACK_FILE" == *"radio-norm"* ]] || [[ "$TRACK_FILE" == *"dj-"* ]] || \
   [[ "$TRACK_FILE" == *"cara-"* ]] || [[ "$TRACK_FILE" == *"shoutout"* ]] || \
   [[ "$TRACK_FILE" == *"transition"* ]] || [[ "$TRACK_FILE" == *"track-announce"* ]] || \
   [[ "$TRACK_FILE" == *"greeting"* ]] || [[ "$TRACK_FILE" == *"voice-"* ]] || \
   [[ "$TRACK_FILE" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} ]]; then
    exit 0
fi

# Build the pretty name the same way announce-track.sh does.
TRACK_NAME=$(echo "$TRACK_FILE" | sed 's/^[0-9]*-//; s/\.mp3$//; s/\.m4a$//; s/-/ /g; s/_/ /g')
TIMESTAMP=$(date -Iseconds)

# ─── Write new-track-event for dj-watcher.sh to consume ───
# Atomic write via temp + mv so the watcher never reads a partial file.
TMP_EVENT="/state/new-track-event.tmp.$$"
jq -n \
    --arg path "$TRACK_PATH" \
    --arg bpm "$TRACK_BPM" \
    --arg name "$TRACK_NAME" \
    --arg timestamp "$TIMESTAMP" \
    '{path: $path, bpm: $bpm, name: $name, timestamp: $timestamp}' > "$TMP_EVENT"
mv "$TMP_EVENT" /state/new-track-event

exit 0
