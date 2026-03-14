#!/bin/bash
# Track change hook — logs play history, writes now-playing, updates Icecast
# metadata, and triggers DJ commentary via TTS.
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

# Write now-playing for instant lookups (use cleaned name, not raw filename)
PRETTY_NAME="$TRACK_NAME"
echo "$PRETTY_NAME" > /state/radio-now-playing

# Update Icecast stream metadata via Liquidsoap telnet
echo "meta.update $PRETTY_NAME" | nc -w1 127.0.0.1 1234 >/dev/null 2>&1 || true

# ─── DJ Commentary (background, non-blocking) ───
(
    # 75% chance of commentary (25% skip)
    ROLL=$((RANDOM % 100))
    if [ "$ROLL" -ge 75 ]; then
        echo "[announce-track] Skipping DJ commentary (roll=$ROLL)" >&2
        exit 0
    fi

    # Determine which DJ is on based on day/time and schedule
    CURRENT_HOUR=$(date +%-H)
    DAY_OF_WEEK=$(date +%u)  # 1=Monday ... 7=Sunday

    # Default: Arthur weekday daytime (8-18), Cara evenings/weekends
    DJ_NAME="cara"
    if [ "$DAY_OF_WEEK" -le 5 ] && [ "$CURRENT_HOUR" -ge 8 ] && [ "$CURRENT_HOUR" -lt 18 ]; then
        DJ_NAME="arthur"
    fi

    # Check schedule.json for Abi's work status (if Abi not working, Cara is on)
    if [ -f /config/schedule.json ]; then
        TODAY=$(date +%Y-%m-%d)
        ABI_STATUS=$(jq -r --arg d "$TODAY" '.[$d].abi // "working"' /config/schedule.json 2>/dev/null || echo "working")
        if [ "$ABI_STATUS" = "not-working" ] && [ "$DJ_NAME" = "arthur" ]; then
            DJ_NAME="cara"
        fi
    fi

    # Check for manual DJ override
    if [ -f /data/music/dj-override.json ]; then
        OVERRIDE_DJ=$(jq -r '.dj // empty' /data/music/dj-override.json 2>/dev/null || true)
        if [ -n "$OVERRIDE_DJ" ]; then
            DJ_NAME="$OVERRIDE_DJ"
        fi
    fi

    # Generate DJ line via LLM (OpenAI API, gpt-4o-mini)
    OPENAI_API_KEY="${OPENAI_API_KEY:-}"
    if [ -z "$OPENAI_API_KEY" ]; then
        echo "[announce-track] No OPENAI_API_KEY, skipping DJ commentary" >&2
        exit 0
    fi

    CURRENT_TIME=$(date +"%H:%M")
    DJ_DISPLAY_NAME=$(echo "$DJ_NAME" | sed 's/^./\U&/')  # Capitalize first letter

    SYSTEM_PROMPT="You are DJ ${DJ_DISPLAY_NAME} on Arthur Radio. Currently playing: ${PRETTY_NAME}. Time: ${CURRENT_TIME}. 1-2 sentences, natural radio DJ style. Reply with ONLY the line."

    LLM_RESPONSE=$(curl -sf --max-time 15 \
        -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${OPENAI_API_KEY}" \
        -d "$(jq -n \
            --arg sys "$SYSTEM_PROMPT" \
            '{
                model: "gpt-4o-mini",
                max_tokens: 100,
                temperature: 0.9,
                messages: [
                    {role: "system", content: $sys},
                    {role: "user", content: "Say something about this track."}
                ]
            }')" \
        "https://api.openai.com/v1/chat/completions" 2>/dev/null) || {
        echo "[announce-track] LLM call failed, skipping commentary" >&2
        exit 0
    }

    DJ_LINE=$(echo "$LLM_RESPONSE" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
    if [ -z "$DJ_LINE" ]; then
        echo "[announce-track] Empty LLM response, skipping commentary" >&2
        exit 0
    fi

    echo "[announce-track] DJ $DJ_DISPLAY_NAME says: $DJ_LINE"

    # Re-check track hasn't changed while LLM was generating
    if [ "$(cat /state/current-track-path 2>/dev/null)" = "$TRACK_PATH" ]; then
        /radio/dj-commentary.sh "$DJ_NAME" "$PRETTY_NAME" "$DJ_LINE" || {
            echo "[announce-track] TTS commentary failed, continuing" >&2
        }
    else
        echo "[announce-track] Track changed, skipping stale commentary" >&2
    fi
) &

exit 0
cho "[announce-track] TTS commentary failed, continuing" >&2
    }
) &

exit 0
