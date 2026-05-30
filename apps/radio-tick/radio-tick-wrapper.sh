#!/usr/bin/env bash
# radio-tick-wrapper.sh — the no_agent cron target for the agentic radio loop.
#
# Guarantees:
#  1. flock non-blocking → if a previous tick is still running, exit immediately
#     (no clobber, no queue build-up). Schedule stays clean.
#  2. Listener gate runs BEFORE any LLM call. 0 listeners → exit silently,
#     ZERO tokens spent. This is enforced at the process level, not the LLM's.
#  3. Only when listeners>0 do we build context + shell out to `hermes -z`
#     loading the radio-tick skill.
#
# stdout is intentionally empty on the no-op paths so the no_agent cron stays
# silent (no Telegram spam). Real work logs to stderr / the tick log.

set -uo pipefail

LOCK="/run/lock/radio-tick.lock"
[ -w /run/lock ] || LOCK="/tmp/radio-tick.lock"
TICK="/mnt/arthur/.hermes/scripts/radio-tick/radio_tick.py"
LOG="/mnt/arthur/.hermes/data/radio-tick.log"
HERMES="/mnt/arthur/.local/bin/hermes"
PY="$(command -v python3)"

exec 9>"$LOCK"
if ! flock -n 9; then
  # Previous tick still running — skip this fire entirely.
  exit 0
fi

log() { echo "[$(date '+%F %T')] $*" >>"$LOG"; }

export KUBECONFIG="${KUBECONFIG:-/mnt/arthur/.kube/config}"

# ── Gate: no listeners → no LLM, no cost ──
if ! "$PY" "$TICK" gate 2>>"$LOG"; then
  log "gate: no listeners — skipping LLM"
  exit 0
fi

log "gate: listeners present — building context + invoking hermes"

CTX="$("$PY" "$TICK" context 2>>"$LOG")"
if [ -z "$CTX" ]; then
  log "context empty — aborting"
  exit 0
fi

PROMPT="You are running one radio tick. Load and follow the radio-tick skill.

$CTX

Decide, in character as the active DJ, whether to speak this tick. You do NOT
have to speak — silence is valid and saves budget. If you DO speak, you MUST
call the speak tool (via the radio_tick.py speak subcommand described in the
skill). Then ALWAYS re-assert the next-5 lookahead with the queue subcommand,
picking 5 IDs from the candidate list above."

# NO_COLOR strips ANSI; -z one-shot; skill loaded explicitly; terminal toolset
# gives it the ability to run radio_tick.py speak/queue.
NO_COLOR=1 "$HERMES" -z "$PROMPT" \
  --provider anthropic -m claude-opus-4-6 \
  -t terminal \
  --skills radio-tick \
  >>"$LOG" 2>&1

log "tick complete"
exit 0
