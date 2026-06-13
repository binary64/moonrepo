# radio-director — Single-call Opus director for Arthur Radio

**Deployment target: the Jupiter VPS (NOT Kubernetes).** These scripts run as
Hermes cron jobs on the VPS where the `hermes` CLI lives. This directory is the
**source of truth**; the live copies are deployed to `~/.hermes/scripts/` on the
VPS.

## What it is

The "director" is the single listener-gated Opus-4.8 call that plans the *whole*
show in one pass — the 12-track running order + the timed DJ drops (with per-line
Hume acting notes) + the presence/mood context blob. A dumb queue-popper
(`apps/liquidsoap/next_track.py`) airs whatever the director set. This replaced
the old two-brain design (slow-loop context writer + per-track gpt-4o-mini
selector); OpenAI is no longer in the radio path.

It runs **stateless per tick** (a fresh `hermes -z` session every fire — no
long-lived session to rot) but keeps a **persistent memory file**
(`recent-shows.json`) so it can evolve the show across ticks instead of echoing
itself. See "Anti-repeat memory" below.

## Files

| File | Deployed to (VPS) | Purpose |
|------|-------------------|---------|
| `radio-dj-director.sh` | `~/.hermes/scripts/radio-dj-director.sh` | Cron target (15-min). flock + listener gate + the Opus director prompt via `hermes -z`. |
| `radio_set_playlist.py` | `~/.hermes/scripts/radio-director/radio_set_playlist.py` | The tool Opus drives: `candidates` (taste-filtered pool), `set` (writes queue + drops + context into the liquidsoap pod, appends to history), `recent` (reads history). |
| `radio-listener-edge.sh` | `~/.hermes/scripts/radio-listener-edge.sh` | Cron target (1-min). Tune-in detector: fires the director ONCE on a 0→>0 listener edge so a fresh audience isn't steered by stale taste for up to 15 min. |

> **Note on paths:** `radio-dj-director.sh` and `radio-listener-edge.sh` deploy
> to the `scripts/` ROOT (that's where the cron `script:` field resolves them),
> while `radio_set_playlist.py` lives in the `scripts/radio-director/`
> subdirectory. The shell scripts reference the tool by its absolute subdir path.

## Cron jobs (on the VPS, `~/.hermes/cron/jobs.json`)

| Job id | Name | Schedule | script |
|--------|------|----------|--------|
| `171e527d4d51` | Arthur Radio — Opus director (15-min) | every 15m | `radio-dj-director.sh` |
| `7171dd859b28` | Arthur Radio — listener edge trigger | every 1m | `radio-listener-edge.sh` |

Both are `no_agent: true` (the script IS the job; stdout stays quiet on the
no-op path so there's no Telegram spam when nobody's listening).

## Guarantees

- **No LLM when empty:** both scripts run the Icecast listener gate
  (`radio_tick.py gate`) *before* any `hermes` call. 0 listeners → exit, zero
  tokens. The edge trigger only fires the director on a genuine 0→>0 tune-in,
  and the director re-gates itself, so it can never spend tokens with no
  audience.
- **No clobber:** `flock -n` single-flight on both — an overrunning run makes the
  next fire exit in ~ms.
- **Verifiable set:** `set` validates every track ID against the graph, writes
  the bare-int-ID queue + keyed drop schedule into the pod via `kubectl exec`,
  writes the context blob to the host dir backing the pod, and prints a JSON
  confirmation (queued count, dropped IDs, drops staged, first/last track) so
  Opus can confirm the side-effect landed.

## Anti-repeat memory (`recent-shows.json`)

The director is stateless per tick, so to avoid replaying the same tracks/vibe
every 15 minutes it reads and writes a rolling history file at
`~/clawd/data/music/recent-shows.json`:

- **Step 0 of every tick:** Opus runs `radio_set_playlist.py recent` and sees the
  last `RECENT_KEEP` shows it aired (track lists + mood + note).
- **On `set`:** the aired show is appended (ids + track names + mood + note),
  capped to the newest `RECENT_KEEP` (default **10** ≈ 2.5h of look-back).
- **Instruction:** *evolve, don't echo* — hard-avoid the most recent show's
  tracks, soft-avoid earlier ones where the candidate pool allows, and shift the
  energy on rather than re-running the same mood.

The read/append is best-effort and tolerant of a missing/corrupt file (returns
`[]`, never crashes the show). History ages out naturally: when nobody's
listening the gate skips the tick, so a fresh listening session starts with a
stale-but-harmless tail that gets pushed out as new shows land.

## Deploy / cutover

This dir is source-of-truth only — there's no image build. To deploy a change:

```bash
# from a checkout of this repo on the VPS
cp apps/radio-director/radio-dj-director.sh   ~/.hermes/scripts/radio-dj-director.sh
cp apps/radio-director/radio-listener-edge.sh ~/.hermes/scripts/radio-listener-edge.sh
cp apps/radio-director/radio_set_playlist.py  ~/.hermes/scripts/radio-director/radio_set_playlist.py
chmod +x ~/.hermes/scripts/radio-dj-director.sh ~/.hermes/scripts/radio-listener-edge.sh
```

No restart needed — the next cron fire picks up the new files.

## Related

- `apps/liquidsoap/next_track.py` — the queue-popper that airs what the director
  sets, and stages the matching DJ drop when it pops a track.
- `apps/radio-tick/` — the older agentic tick loop (gate/context/speak/queue
  engine); `radio_tick.py gate` is reused here as the listener gate.
