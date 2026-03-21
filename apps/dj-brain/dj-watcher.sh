#!/bin/bash
# dj-watcher.sh — watches /state/new-track-event and triggers DJ commentary
# Polls every 5 seconds. When a new track event is detected (different path
# than last processed), runs commentary logic in the background.

set -e

EVENT_FILE="/state/new-track-event"
LAST_TRACK=""

echo "[dj-watcher] Started. Polling ${EVENT_FILE} every 5s..."

while true; do
    if [ -f "$EVENT_FILE" ]; then
        TRACK_PATH=$(jq -r '.path // empty' "$EVENT_FILE" 2>/dev/null || echo "")
        PRETTY_NAME=$(jq -r '.name // empty' "$EVENT_FILE" 2>/dev/null || echo "")

        if [ -n "$TRACK_PATH" ] && [ "$TRACK_PATH" != "$LAST_TRACK" ]; then
            LAST_TRACK="$TRACK_PATH"
            echo "[dj-watcher] New track detected: $PRETTY_NAME"

            # Run commentary in background — non-blocking
            (
                # 75% chance of commentary (25% skip)
                ROLL=$((RANDOM % 100))
                if [ "$ROLL" -ge 75 ]; then
                    echo "[dj-watcher] Skipping DJ commentary (roll=$ROLL)" >&2
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

                # Check schedule.json for Abi's work status
                if [ -f /config/schedule.json ]; then
                    TODAY=$(date +%Y-%m-%d)
                    ABI_STATUS=$(jq -r --arg d "$TODAY" '
                        if (.schedule? | type) == "array" then
                            ([.schedule[] | select(.date == $d) | .abi][0] // "working") | if type == "object" then .status // "working" else . end
                        else
                            .abi[$d] // .[$d].abi // "working"
                        end
                    ' /config/schedule.json 2>/dev/null || echo "working")
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
                    echo "[dj-watcher] No OPENAI_API_KEY, skipping DJ commentary" >&2
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
                    echo "[dj-watcher] LLM call failed, skipping commentary" >&2
                    exit 0
                }

                DJ_LINE=$(echo "$LLM_RESPONSE" | jq -r '.choices[0].message.content // empty' 2>/dev/null)
                if [ -z "$DJ_LINE" ]; then
                    echo "[dj-watcher] Empty LLM response, skipping commentary" >&2
                    exit 0
                fi

                echo "[dj-watcher] DJ $DJ_DISPLAY_NAME says: $DJ_LINE"

                # Re-check track hasn't changed while LLM was generating
                CURRENT_TRACK=$(jq -r '.path // empty' "$EVENT_FILE" 2>/dev/null || echo "")
                if [ "$CURRENT_TRACK" = "$TRACK_PATH" ]; then
                    /radio/dj-commentary.sh "$DJ_NAME" "$PRETTY_NAME" "$DJ_LINE" || {
                        echo "[dj-watcher] TTS commentary failed, continuing" >&2
                    }
                else
                    echo "[dj-watcher] Track changed, skipping stale commentary" >&2
                fi
            ) &
        fi
    fi

    sleep 5
done
