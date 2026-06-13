#!/usr/bin/env bash
# Arthur Radio — DIRECTOR. The SINGLE Hermes/Opus-4.8 call that plans the whole
# show: track playlist + timed DJ drops (with Hume acting instructions) + the
# presence/mood context blob. Replaces BOTH the old slow-loop context writer AND
# the per-track gpt-4o-mini selector.
#
# Trigger: first-listener edge OR every 15 min (both gated on listeners>0).
# no_agent cron target. stdout intentionally quiet on the no-op path.
set -uo pipefail

PY="$(command -v python3)"
TICK="/mnt/arthur/.hermes/scripts/radio-tick/radio_tick.py"
DIRECTOR_PY="/mnt/arthur/.hermes/scripts/radio-director/radio_set_playlist.py"
HERMES="/mnt/arthur/.local/bin/hermes"
LOG="/mnt/arthur/.hermes/data/radio-director.log"
export KUBECONFIG="${KUBECONFIG:-/mnt/arthur/.kube/config}"

log() { echo "[$(date '+%F %T')] $*" >>"$LOG"; }

# Single-flight: don't stack director runs.
LOCK="/tmp/radio-director.lock"
exec 9>"$LOCK"
flock -n 9 || exit 0

# ── Listener gate: no audience → no Opus call, ZERO tokens ──
if ! "$PY" "$TICK" gate 2>>"$LOG"; then
  log "gate: 0 listeners — skipping director"
  exit 0
fi

log "gate: listeners present — invoking Opus director"

PROMPT='You are the Arthur Radio DIRECTOR. In ONE pass, plan the next ~40 minutes
of radio for whoever is actually home right now, then SET it via the radio
playlist tool. Work in this order:

0. Read your OWN recent history — what you aired the last few ticks:
     python3 /mnt/arthur/.hermes/scripts/radio-director/radio_set_playlist.py recent
   This returns [] on the first run of a listening session, otherwise an array
   of past shows (newest last) each with {aired_at, ids, tracks, mood, note}.
   Use it to EVOLVE, not echo: do NOT repeat any track that appears in the most
   recent show, avoid reusing tracks from earlier shows where you can, and shift
   the energy/mood on naturally rather than re-running the same vibe.
1. Run the household-location skill to get LIVE presence (James, Abi, Milo).
2. Read /mnt/arthur/clawd/data/music/taste-profiles.json. For each HUMAN who is
   home, pull steer_genres / love_artists / avoid_genres. Blend everyone-home
   into a shared steer set (favour overlap; if tastes clash, lean to the
   broadest crowd-pleaser). Milo is a dog — ignore for taste. Pick a one-word
   mood and a short note naming who is home + the blend rationale.
3. Get the candidate pool:
     python3 /mnt/arthur/.hermes/scripts/radio-director/radio_set_playlist.py \
       candidates --steer "g1,g2,..." --avoid "g1,g2,..." --limit 300
   This returns [{id, track, genres, bpm, af}, ...] already filtered to taste.
4. From that pool choose ~12 tracks that flow well (vary energy, no same-artist
   back-to-back, honour the avoid list strictly). These are your playlist, in
   order.
5. Write a drops file and a context file to /tmp, then SET everything:
   - /tmp/director-drops.json : a JSON array of DJ drops. Add 2-4 drops across
     the 12 tracks (not every track). Each:
       {"after_track_id": <id from your playlist>, "dj": "cara" or "arthur",
        "position": "end",
        "utterances": [ {"text": "...", "description": "<hume acting note>",
                         "speed": 1.0}, ... ]}
     DJ choice: Cara (warm, cheeky, flirty) in the evening / when Abi is home;
     Arthur (measured, witty) otherwise. Keep each drop 1-2 short sentences.
     Use [pause] tokens for natural beats. Reference what just played or tease
     whats next — you KNOW the running order, so be specific.
   - /tmp/director-context.json :
       {"abi_home": <bool>, "james_home": <bool>, "steer_genres": [...],
        "avoid_genres": [...], "mood": "<word>", "note": "<short>"}
     (the tool stamps generated_at + ttl itself).
   Then call:
     python3 /mnt/arthur/.hermes/scripts/radio-director/radio_set_playlist.py \
       set --ids <id1,id2,...,id12> \
       --drops-file /tmp/director-drops.json \
       --context-file /tmp/director-context.json
6. The set command prints a JSON confirmation (queued count, first/last track,
   drops_staged). Read it and confirm the show was set. If queued is 0 or any
   IDs were dropped as invalid, fix the IDs and retry once.

Output a one-line summary of the show you set (who is home, mood, first/last
track, how many drops).'

NO_COLOR=1 "$HERMES" -z "$PROMPT" \
  --provider anthropic -m claude-opus-4-8 \
  -t terminal,file,homeassistant,skills \
  --skills household-location,radio-music-curation \
  --yolo >>"$LOG" 2>&1

log "director run complete"
exit 0
