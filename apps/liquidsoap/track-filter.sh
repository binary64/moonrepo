# shellcheck shell=bash
# track-filter.sh — shared track-state loader + loop guard for the radio-dj
# container. Sourced by announce-track.sh (track start) and dj-outro-event.sh
# (track outro) so the filtering logic lives in ONE place and cannot drift.
#
# On source it:
#   1. Reads /state/current-track-path and /state/current-track-bpm (written by
#      Liquidsoap on_metadata).
#   2. Exits 0 (skipping the *calling* script) when there is no track, or when
#      the track is a TTS clip / DJ injection / non-library file — this prevents
#      DJ-voice clips from triggering further events (infinite loop guard).
#   3. Exports for the caller: TRACK_PATH, TRACK_BPM, TRACK_FILE, TRACK_NAME,
#      TIMESTAMP.
#
# Because this is sourced (not executed), `exit 0` terminates the calling
# script — which is exactly the desired "skip this track" behaviour.

TRACK_PATH=$(cat /state/current-track-path 2>/dev/null || echo "")
if [ -z "$TRACK_PATH" ]; then
    exit 0
fi
TRACK_BPM=$(cat /state/current-track-bpm 2>/dev/null || echo "")

TRACK_FILE=$(basename "$TRACK_PATH" 2>/dev/null || echo "unknown")

# Skip TTS clips / DJ injections / non-library files (avoid event loops!)
if [[ "$TRACK_PATH" == /tmp/* ]] || [[ "$TRACK_PATH" == /state/* ]] || \
   [[ "$TRACK_FILE" == *"radio-norm"* ]] || [[ "$TRACK_FILE" == *"dj-"* ]] || \
   [[ "$TRACK_FILE" == *"cara-"* ]] || [[ "$TRACK_FILE" == *"shoutout"* ]] || \
   [[ "$TRACK_FILE" == *"transition"* ]] || [[ "$TRACK_FILE" == *"track-announce"* ]] || \
   [[ "$TRACK_FILE" == *"greeting"* ]] || [[ "$TRACK_FILE" == *"voice-"* ]] || \
   [[ "$TRACK_FILE" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} ]]; then
    exit 0
fi

# Prettify "01-Artist_Name-Title.mp3" → "Artist Name Title"
TRACK_NAME=$(echo "$TRACK_FILE" | sed 's/^[0-9]*-//; s/\.mp3$//; s/\.m4a$//; s/-/ /g; s/_/ /g')
TIMESTAMP=$(date -Iseconds)

# Consumed by the sourcing scripts (announce-track.sh / dj-outro-event.sh).
# shellcheck disable=SC2034
export TRACK_PATH TRACK_BPM TRACK_FILE TRACK_NAME TIMESTAMP
