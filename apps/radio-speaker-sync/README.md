# radio-speaker-sync — Multi-speaker cast watchdog

**Deployment target: the Jupiter VPS (NOT Kubernetes).** Runs as a Hermes cron
job (`no_agent`, every 2 minutes) on the VPS. This directory is the **source of
truth**; the live copy is deployed to `~/.hermes/scripts/radio/` on the VPS.

## Problem it solves

The radio plays to a native Google Cast group, `media_player.all_speakers`
(members: `nest_audio` lounge + `office_speaker`). When a speaker loses WiFi or
is rebooted, it drops out of the group and does **not** rejoin on its own.

The old `radio-watchdog.sh` only checked the **total** Icecast listener count —
so if one speaker survived, the count stayed ≥1 and the dropped speaker was
never recovered. This watchdog checks **each speaker individually** via Home
Assistant and re-casts the whole group whenever any expected member isn't
playing our stream.

## Files

| File | Deployed to (VPS) | Purpose |
|------|-------------------|---------|
| `speaker-sync-watchdog.py` | `~/.hermes/scripts/radio/speaker-sync-watchdog.py` | Per-speaker state check + group recast |

## How it works

1. Skip if radio is off (liquidsoap pod not Running) or paused (`/tmp/radio-paused`).
2. Get a short-lived HA access token from James's long-lived refresh token.
3. For each member entity, check `state == playing` AND it's serving our stream URL.
4. If any member is out of sync → `play_media` to `media_player.all_speakers`
   (atomic group recast), wait 10s, verify recovery.

## Guarantees

- **Zero tokens:** `no_agent` cron, pure HA REST API, no LLM.
- **Respects pause:** honours the same `/tmp/radio-paused` flag as radio.sh.
- **Idempotent:** when all speakers are fine it does nothing.

## Cron registration (VPS)

```
hermes cron create --name radio-speaker-sync --schedule "every 2m" \
  --no-agent --deliver local --script radio/speaker-sync-watchdog.py
```

## Config knobs (top of the script)

- `MEMBER_ENTITIES` — the speakers that must be playing. Add new Nest devices here.
- `STREAM_URL` — public stream URL (must be LAN-reachable by the Chromecasts).
- `RADIO_NS` / `LIQ_LABEL` — where the liquidsoap pod lives (`radio-dj`).
