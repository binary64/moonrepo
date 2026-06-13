#!/usr/bin/env bash
# Arthur Radio — listener EDGE trigger (the "tune-in detector").
#
# Problem this solves: the slow-loop context builder runs on a 15-min timer.
# So when you say "radio on" and the Nest group connects, the DJ might not
# notice WHO just tuned in for up to 15 minutes — stale taste/mood steering.
#
# This watcher runs frequently (every ~1 min, NO LLM) and fires the context
# builder ONCE the instant listeners cross 0 -> >0. While listeners stay
# present, the normal 15-min cadence takes over (we don't re-fire on every
# tick). When listeners drop back to 0, we just reset the edge and stay silent.
#
# Cheap: a single Icecast listener count per run (~0.5s). The expensive Hermes
# call only happens on a genuine tune-in edge, and even then radio-dj-context.sh
# re-checks the gate itself, so this can never spend tokens with 0 listeners.
#
# no_agent cron target. stdout intentionally empty on no-op (no Telegram spam).
set -uo pipefail

STATE="/mnt/arthur/.hermes/data/radio-listener-edge.json"
CONTEXT_SH="/mnt/arthur/.hermes/scripts/radio-dj-director.sh"  # fire the Opus director on tune-in
LOG="/mnt/arthur/.hermes/data/radio-listener-edge.log"
PY="$(command -v python3)"
export KUBECONFIG="${KUBECONFIG:-/mnt/arthur/.kube/config}"

log() { echo "[$(date '+%F %T')] $*" >>"$LOG"; }

# Single-flight: if a previous edge fire is still running, skip.
LOCK="/tmp/radio-listener-edge.lock"
exec 9>"$LOCK"
flock -n 9 || exit 0

# Current listener count via the SAME proven path the gate uses.
# RADIO_EDGE_FORCE_LISTENERS overrides for testing only.
if [ -n "${RADIO_EDGE_FORCE_LISTENERS:-}" ]; then
  NOW="$RADIO_EDGE_FORCE_LISTENERS"
else
  NOW="$("$PY" -c "import sys; sys.path.insert(0,'/mnt/arthur/.hermes/scripts/radio-tick'); import radio_tick as r; print(r.icecast_listeners())" 2>>"$LOG" || echo 0)"
fi
[ -z "$NOW" ] && NOW=0

# Previous count from state (default 0 on first run / missing file).
PREV="$("$PY" -c "import json;print(json.load(open('$STATE')).get('listeners',0))" 2>/dev/null || echo 0)"
[ -z "$PREV" ] && PREV=0

# Persist current count for next run.
printf '{"listeners":%s,"ts":"%s"}\n' "$NOW" "$(date -u +%FT%TZ)" > "$STATE"

# Edge: nobody -> somebody. Fire the context builder immediately.
if [ "$PREV" -eq 0 ] && [ "$NOW" -gt 0 ]; then
  log "EDGE 0->$NOW listeners — firing context builder now"
  # radio-dj-context.sh re-gates internally, so this is safe & idempotent.
  bash "$CONTEXT_SH" >>"$LOG" 2>&1 || log "context builder returned nonzero"
  log "edge fire complete"
fi

exit 0
