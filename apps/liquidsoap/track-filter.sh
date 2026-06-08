#!/bin/bash
# shellcheck shell=bash
# NOTE: this file is sourced (never executed directly); the shebang is here so
# static analysers detect bash and don't flag bash-only syntax (e.g. [[ ]] with
# ==) as non-portable sh.
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
if [[ -z "$TRACK_PATH" ]]; then
    exit 0
fi
TRACK_BPM=$(cat /state/current-track-bpm 2>/dev/null || echo "")

TRACK_FILE=$(basename "$TRACK_PATH" 2>/dev/null || echo "unknown")

# Skip TTS clips / DJ injections / non-library files (avoid event loops!).
# Uses [[ ]] with `=` glob matching (not `==`/`=~`) so it stays portable per
# DeepSource SH-3014/SH-3015 while remaining bash pattern matching. The final
# pattern matches a leading UUID (8-4-4-4-12 hex) used by DJ-clip filenames.
# Use hex character classes ([0-9a-fA-F]) rather than `?` so non-UUID library
# filenames (which may contain digits/hyphens in the same positions) are not
# falsely filtered as DJ clips and silently skipped (cubic review #277).
hx='[0-9a-fA-F]'
uuid_glob="${hx}${hx}${hx}${hx}${hx}${hx}${hx}${hx}-${hx}${hx}${hx}${hx}-${hx}${hx}${hx}${hx}-${hx}${hx}${hx}${hx}-${hx}${hx}${hx}${hx}${hx}${hx}${hx}${hx}${hx}${hx}${hx}${hx}*"
# shellcheck disable=SC2053  # $uuid_glob is an intentional glob pattern
if [[ "$TRACK_PATH" = /tmp/* ]] || [[ "$TRACK_PATH" = /state/* ]] || \
   [[ "$TRACK_FILE" = *"radio-norm"* ]] || [[ "$TRACK_FILE" = *"dj-"* ]] || \
   [[ "$TRACK_FILE" = *"cara-"* ]] || [[ "$TRACK_FILE" = *"shoutout"* ]] || \
   [[ "$TRACK_FILE" = *"transition"* ]] || [[ "$TRACK_FILE" = *"track-announce"* ]] || \
   [[ "$TRACK_FILE" = *"greeting"* ]] || [[ "$TRACK_FILE" = *"voice-"* ]] || \
   [[ "$TRACK_FILE" = $uuid_glob ]]; then
    exit 0
fi

# Prettify "01-Artist_Name-Title.mp3" → "Artist Name Title"
TRACK_NAME=$(echo "$TRACK_FILE" | sed 's/^[0-9]*-//; s/\.mp3$//; s/\.m4a$//; s/-/ /g; s/_/ /g')
TIMESTAMP=$(date -Iseconds)

# Consumed by the sourcing scripts (announce-track.sh / dj-outro-event.sh).
# shellcheck disable=SC2034
export TRACK_PATH TRACK_BPM TRACK_FILE TRACK_NAME TIMESTAMP
