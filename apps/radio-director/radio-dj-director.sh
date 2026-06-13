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
1. Run the household-location skill to get LIVE presence (the householders + the
   dog).
2. Read /mnt/arthur/clawd/data/music/taste-profiles.json. For each HUMAN who is
   home, pull steer_genres / love_artists / avoid_genres. Blend everyone-home
   into a shared steer set (favour overlap; if tastes clash, lean to the
   broadest crowd-pleaser). The dog is a dog — ignore for taste. Pick a one-word
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

     ANGLE-FIRST: before writing each drop, commit to ONE angle, then write to
     it. Vary the angle across the show — do not run the same angle twice in a
     row. The six angles:
       1. Roast the music (the track/artist/genre just played or coming up).
       2. Roast ONE person who is home (light, affectionate — either householder).
       3. Roast BOTH (couple banter — weight this UP when both are home).
       4. Roast the dog (always fair game, never mean).
       5. An official Cara station-ident / quote (warm channel-branding beat).
       6. News & weather (quick, local, real — fetch via terminal if you want it
          current; otherwise skip rather than invent).

     REAL-LIFE AMMUNITION: the best drops carry a true nugget — artist
     gossip/scandal/lore, chart trivia, or a VH-1 Pop-Up-Video-style factoid
     about the track. HARD RULE: source it, do not invent it. Verify via a quick
     terminal/web lookup or graphiti before you state it as fact; if you cannot
     confirm it, PIVOT to a different angle rather than fabricate. Never invent
     facts about the householders or the dog either — only use what
     presence/taste/memory actually gives you.

     SIZING: usually 2-4 sentences (~40-80 words) per drop — enough for real
     personality, not a monologue. A pure station-ident (angle 5) can be one
     line. Use [pause] tokens for natural beats.

     DJ choice: Cara (warm, cheeky, flirty) in the evening / when the
     evening-leaning householder is home; Arthur (measured, witty) otherwise.

     Reference what just played or tease whats next — you KNOW the running order,
     so be specific.

     SAFETY RAILS (independent of any spice dial): never touch relationship
     tension or health anxiety on-air; keep couple banter affectionate, never
     barbed; keep dog jokes kind.
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

# Bound the call (timeout 12m < 15m cron cadence) so a hung Hermes can't hold
# the flock and starve every future fire. Capture + log the exit code rather
# than swallowing it — a failed run must not be logged as "complete".
NO_COLOR=1 timeout 720 "$HERMES" -z "$PROMPT" \
  --provider anthropic -m claude-opus-4-8 \
  -t terminal,file,web,homeassistant,skills \
  --skills household-location,radio-music-curation \
  --yolo >>"$LOG" 2>&1
rc=$?
if [ "$rc" -eq 124 ]; then
  log "director run TIMED OUT after 720s (rc=124)"
elif [ "$rc" -ne 0 ]; then
  log "director run FAILED (rc=$rc)"
else
  log "director run complete"
fi
exit 0
