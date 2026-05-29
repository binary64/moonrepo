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
# At the outro the "current" track is still the ENDING track (the next one
# hasn't started), which is exactly what we want to back-announce.

# TRACK_PATH/TRACK_BPM/TRACK_NAME/TIMESTAMP are assigned by the sourced
# track-filter.sh below; shellcheck can't follow the source at analysis time.
# shellcheck disable=SC2154
set -e

# Load track state + apply the shared loop guard (identical to announce-track.sh
# so a DJ clip can never trigger another DJ clip). Sourcing means a non-library
# track causes track-filter.sh to `exit 0`, skipping this script.
# Provides: TRACK_PATH, TRACK_BPM, TRACK_FILE, TRACK_NAME, TIMESTAMP.
# shellcheck source=apps/liquidsoap/track-filter.sh
. /radio/track-filter.sh

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
