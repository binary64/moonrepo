#!/bin/bash
# Track change hook (track START) — logs play history, writes now-playing, logs
# to Hasura, and updates Icecast stream metadata.
# Replaces the old radio-listener-monitor service for track logging.
#
# DJ commentary is NOT triggered here. It is triggered separately at the track
# OUTRO by dj-outro-event.sh (invoked from radio-dj.liq via source.on_end), so
# the rendered TTS clip lands over the outro/crossfade instead of mid-song.
#
# Reads track info from state files written by Liquidsoap (via track-filter.sh):
#   /state/current-track-path  — full path to the track
#   /state/current-track-bpm   — detected BPM

set -e

# Load track state + apply the shared loop guard. Sourcing means a non-library
# or DJ-clip track causes track-filter.sh to `exit 0`, skipping this script.
# Provides: TRACK_PATH, TRACK_BPM, TRACK_FILE, TRACK_NAME, TIMESTAMP.
# shellcheck source=apps/liquidsoap/track-filter.sh
. /radio/track-filter.sh

HISTORY_LOG="/data/music/play-history.log"

# ─── Always: log play history + write now-playing ───
mkdir -p "$(dirname "$HISTORY_LOG")"
echo "$TIMESTAMP  $TRACK_NAME  ($TRACK_FILE)" >> "$HISTORY_LOG"

# Write now-playing for instant lookups
PRETTY_NAME="$TRACK_NAME"
echo "$PRETTY_NAME" > /state/radio-now-playing

# ─── Log to Hasura play history ───
# Parse artist - title from PRETTY_NAME (matches what Icecast shows)
ARTIST=""
TITLE=""
if [[ "$PRETTY_NAME" == *" - "* ]]; then
    ARTIST="${PRETTY_NAME%% - *}"
    TITLE="${PRETTY_NAME#* - }"
else
    ARTIST="Unknown"
    TITLE="$PRETTY_NAME"
fi

HASURA_URL="${HASURA_URL:-https://hasura.brandwhisper.cloud/v1/graphql}"
HASURA_SECRET="${HASURA_ADMIN_SECRET:-}"

# Fire and forget — don't block track playback if Hasura is down
(
    CURL_ARGS=(-s --max-time 5 -X POST "$HASURA_URL" -H "Content-Type: application/json")
    if [ -n "$HASURA_SECRET" ]; then
        CURL_ARGS+=(-H "x-hasura-admin-secret: $HASURA_SECRET")
    fi
    curl "${CURL_ARGS[@]}" \
        -d "$(jq -n \
            --arg artist "$ARTIST" \
            --arg title "$TITLE" \
            --arg played_at "$TIMESTAMP" \
            '{query: "mutation($artist: String!, $title: String!, $played_at: timestamptz!) { insert_radio_play_history_one(object: {artist: $artist, title: $title, played_at: $played_at}) { id } }", variables: {artist: $artist, title: $title, played_at: $played_at}}'
        )" >/dev/null 2>&1 || true
) &

# Update Icecast stream metadata via Liquidsoap telnet (local — same container)
echo "meta.update $PRETTY_NAME" | nc -w1 127.0.0.1 1234 >/dev/null 2>&1 || true

exit 0
