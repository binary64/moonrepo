# radio-tick — Agentic Arthur Radio DJ loop

**Deployment target: the Jupiter VPS (NOT Kubernetes).** These scripts run as a
Hermes cron job on the VPS where the `hermes` CLI lives. This directory is the
**source of truth**; the live copies are deployed to `~/.hermes/` on the VPS.

## What it is

Replaces the old reactive DJ (track-event → commentary). Instead, a cron fires
every 4 minutes and runs one *agentic tick*: the LLM (as Arthur or Cara) decides
whether to speak, and re-asserts the next-5 track lookahead so the radio stays
curated even if ticks stop.

## Files

| File | Deployed to (VPS) | Purpose |
|------|-------------------|---------|
| `radio_tick.py` | `~/.hermes/scripts/radio-tick/radio_tick.py` | Engine: `gate`/`context`/`speak`/`queue` subcommands |
| `radio-tick-wrapper.sh` | `~/.hermes/scripts/radio-tick/radio-tick-wrapper.sh` | Cron target: flock no-clobber + listener gate + `hermes -z` |
| `radio-tick-skill.md` | `~/.hermes/skills/smart-home/radio-tick/SKILL.md` | The skill the tick LLM loads (persona, rizz, tool usage) |

## Guarantees

- **No LLM when empty:** wrapper runs the Icecast listener gate *before* any
  `hermes` call. 0 listeners → exit, zero tokens.
- **No clobber:** `flock -n` — if a tick overruns, the next fire exits in ~ms.
- **Self-healing queue:** every tick writes 5 follow-graph-validated track IDs to
  `/state/radio-llm-queue.json` (consumed by `apps/liquidsoap/next_track.py`).

## Cutover

The `dj-watcher.sh` reactive commentary is gated behind `REACTIVE_COMMENTARY`
(see `infra/manifests/radio-dj/dj-watcher-script-configmap.yaml`). Default
`false` = agentic tick owns the mic. Set `true` on the dj-brain deployment to
roll back to reactive mode.

## Deploy (VPS)

```bash
# From a moonrepo checkout on the VPS:
cp apps/radio-tick/radio_tick.py            ~/.hermes/scripts/radio-tick/
cp apps/radio-tick/radio-tick-wrapper.sh    ~/.hermes/scripts/radio-tick/
cp apps/radio-tick/radio-tick-skill.md      ~/.hermes/skills/smart-home/radio-tick/SKILL.md
chmod +x ~/.hermes/scripts/radio-tick/*.{py,sh}
# Cron is registered via: hermes cron (no_agent, every 4m, script=radio-tick/radio-tick-wrapper.sh)
```

## Cron registration

```
job: radio-tick
schedule: every 4m
no_agent: true        # script IS the job; no agent loop at cron level
script: radio-tick/radio-tick-wrapper.sh
deliver: local        # silent; no Telegram on no-op ticks
```
