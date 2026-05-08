#!/bin/bash
set -e
EVENT_FILE="/state/new-track-event"
LAST_TRACK=""
echo "[dj-watcher] Started. Polling ${EVENT_FILE} every 5s..."


# Start Python API server in background
if [ -f /server/server.py ]; then
    echo "[dj-watcher] Starting Python API server..."
    python3 -B /server/server.py &
    sleep 1
else
    echo "[dj-watcher] WARNING: /server/server.py not found — API endpoint unavailable" >&2
fi

while true; do
    if [ -f "$EVENT_FILE" ]; then
        TRACK_PATH=$(cat "$EVENT_FILE")
        if [ -n "$TRACK_PATH" ] && [ "$TRACK_PATH" != "$LAST_TRACK" ]; then
            LAST_TRACK="$TRACK_PATH"
            ARTIST="$(basename "$(dirname "$TRACK_PATH")")"
            TITLE="$(basename "$TRACK_PATH" .mp3)"
            TITLE="$(basename "$TITLE")"
            echo "[dj-watcher] New track: $ARTIST - $TITLE"
            export ARTIST TITLE
            COMMENTARY=$(python3 - <<PY
import json, os, datetime
ARTIST = os.environ.get("ARTIST", "Unknown Artist")
TITLE = os.environ.get("TITLE", "Unknown Title")
context = "Arthur DJ Context \u2014 James & Abi\n\nJames: Technical, direct, loves details (PRs, k8s, infra, crypto, money).\nAbi: Practical, health-conscious, values clarity. PoTS 12 years, hypermobile, bereavement recovery (2y). \nCurrently 61.3kg, maintenance/strength phase. Carb rotation monthly (rice). Blood work good (Jan). \nMilo digestive: rice-sensitive, on tripe-only + sweet potato trial. Wales trip 30 May-1 Jun.\nTravel: Abi packs/logistics; James's readiness bottleneck. Service stops: Burger King/coffee for James + secure dog area for Milo.\nGarden: Sunny border complete (peony + 45 bulbs + 5 perennials). Broad beans planted. 11 weeks to early July.\nGoal: wellbeing, FI (new house+pool, 2 cars, 7 holidays/yr), longevity."
prompt = f"""You are Cara, Arthur's radio DJ — warm, witty, genuinely passionate about music.

Context:
{context}

Now: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}
Track: {ARTIST} — "{TITLE}"

Generate 1-2 sentence radio intro/outro that:
- Feels spontaneous & personalised to James & Abi
- References something relevant (garden, health, travel) if apt
- Matches Cara: upbeat, slightly cheeky, always welcoming
- NO generic 'here's a song' — talk to friends."""
import urllib.request
LITELLM_KEY = os.environ.get("LITELLM_MASTER_KEY", "")
if not LITELLM_KEY:
    print("[[skip]]")
    exit(0)
payload = json.dumps({
    "model": "gemini-3-flash-preview",
    "messages": [{"role": "user", "content": prompt}],
    "max_tokens": 150, "temperature": 0.8
}).encode()
req = urllib.request.Request(
    "http://litellm.litellm.svc.cluster.local:4000/v1/chat/completions",
    data=payload,
    headers={
        "Authorization": f"Bearer {LITELLM_KEY}",
        "Content-Type": "application/json"
    },
    method="POST"
)
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        result = json.loads(resp.read().decode())
        text = result["choices"][0]["message"]["content"].strip()
        text = text.replace('\n', ' ').strip()
        if text.startswith('"') and text.endswith('"'):
            text = text[1:-1]
        print(text)
except Exception as e:
    print(f"[[error:{e}]]")
PY
)
            if [ -n "$COMMENTARY" ] && [[ ! "$COMMENTARY" == *"[[skip]]"* ]] && [[ ! "$COMMENTARY" == *"[[error:"* ]]; then
                /radio/dj-commentary.sh "$ARTIST" "$TITLE" "$COMMENTARY"
            fi
        fi
    fi
    sleep 5
done
