#!/usr/bin/env python3
"""Arthur Radio speaker-sync watchdog.

Ensures the radio plays on ALL Nest speakers, not just one. The native
"All Speakers" cast group can lose a member when a speaker drops WiFi or is
rebooted; total-listener watchdogs miss this because the surviving speaker
keeps the listener count >= 1. This watchdog checks EACH speaker individually
via Home Assistant and re-casts the group when any expected member is not
playing our stream, so dropped speakers seamlessly rejoin.

Run via Hermes cron (no_agent), every 2 minutes. Cheap: pure HA API, no LLM.

Exit codes:
  0  all good (all speakers playing) OR recast issued OR intentionally skipped
  1  radio is off / paused — nothing to do
"""
import subprocess  # nosec B404 - controlled argv, shell=False, no untrusted input
import json
import os
import sys
import time

HA_NS = "home-assistant"
HA_POD = "home-assistant-0"
HA_USER_ID = "07ab952c7be649ce9b8695e7ab8b51d5"
STREAM_URL = "http://stream.brandwhisper.cloud/stream.mp3"
GROUP_ENTITY = "media_player.all_speakers"
# Speakers that MUST be playing when radio is on.
MEMBER_ENTITIES = ["media_player.nest_audio", "media_player.office_speaker"]
RADIO_NS = "radio-dj"
LIQ_LABEL = "app=liquidsoap"
LIQ_DEPLOY = "liquidsoap"
PAUSE_FILE = "/tmp/radio-paused"  # nosec B108 - shared flag with radio.sh, intentional

# ─── Scale-to-zero (mirror of the host radio-watchdog.sh logic) ───
# The host watchdog is the live scale-to-zero authority; this repo twin keeps
# the SAME logic in version control (the "sync functionality with moonrepo"
# requirement). When Icecast has reported 0 listeners for SCALE_DOWN_SECS
# continuous seconds we scale the liquidsoap Deployment to 0 (Icecast stays up).
# The timer is persisted to ZERO_SINCE_FILE so it survives across the discrete
# cron fires this script runs under. We only ever scale DOWN, never up — wake
# is owned by the wake paths (radio-cast.sh pre-warm + the nginx activator).
ICECAST_STATUS = (
    "http://icecast.radio-dj.svc.cluster.local:8100/status-json.xsl"
)
SCALE_DOWN_SECS = 600  # 10 continuous minutes at 0 listeners -> scale to 0
ZERO_SINCE_FILE = "/tmp/radio-zero-since"  # nosec B108 - timer state, non-secret


def kx(args, ns=HA_NS, pod=HA_POD, timeout=20):
    """Run a command inside a k8s pod, return stdout (empty on failure)."""
    try:
        r = subprocess.run(  # nosec B603 B607 - fixed kubectl argv, no shell
            ["kubectl", "exec", "-n", ns, pod, "--", *args],
            capture_output=True, text=True, timeout=timeout, check=False,
        )
        return r.stdout
    except (subprocess.SubprocessError, OSError):
        return ""


def kubectl(args, timeout=20):
    """Run a plain kubectl command, return stdout (empty on failure)."""
    try:
        r = subprocess.run(  # nosec B603 B607 - fixed kubectl argv, no shell
            ["kubectl", *args], capture_output=True, text=True,
            timeout=timeout, check=False,
        )
        return r.stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return ""


def get_access_token():
    """Exchange James's long-lived refresh token for a short-lived access token."""
    auth = kx(["cat", "/config/.storage/auth"])
    try:
        d = json.loads(auth)
        toks = [
            rt["token"] for rt in d["data"]["refresh_tokens"]
            if rt.get("user_id") == HA_USER_ID
            and rt.get("token_type") == "long_lived_access_token"
        ]
    except (ValueError, KeyError, TypeError):
        return ""
    if not toks:
        return ""
    body = "grant_type=refresh_token&refresh_token=" + toks[-1]
    resp = kx([
        "curl", "-s", "-X", "POST",
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-d", body, "http://localhost:8123/auth/token",
    ])
    try:
        return json.loads(resp).get("access_token", "")
    except (ValueError, TypeError):
        return ""


def ha_get_state(token, entity):
    """Return (state, media_content_id) for a media_player entity."""
    hdr = "Authorization: " + "Bearer " + token
    resp = kx([
        "curl", "-s", "-H", hdr,
        "http://localhost:8123/api/states/" + entity,
    ])
    try:
        d = json.loads(resp)
        return d.get("state", "unknown"), d.get("attributes", {}).get("media_content_id", "")
    except (ValueError, TypeError):
        return "unknown", ""


def ha_cast_group(token):
    """Cast the radio stream to the whole speaker group."""
    hdr = "Authorization: " + "Bearer " + token
    payload = json.dumps({
        "entity_id": GROUP_ENTITY,
        "media_content_id": STREAM_URL,
        "media_content_type": "audio/mpeg",
    })
    kx([
        "curl", "-s", "-X", "POST", "-H", hdr,
        "-H", "Content-Type: application/json", "-d", payload,
        "http://localhost:8123/api/services/media_player/play_media",
    ])


def radio_is_on():
    """True if the liquidsoap pod is Running (radio source is live)."""
    phase = kubectl([
        "get", "pod", "-n", RADIO_NS, "-l", LIQ_LABEL,
        "-o", "jsonpath={.items[0].status.phase}",
    ])
    return phase == "Running"


def icecast_listeners():
    """Total Icecast listeners on the source, or None if unreachable.

    A missing source mount (liquidsoap already at 0) means 0 listeners by
    definition, so we return 0 in that case rather than None.
    """
    try:
        r = subprocess.run(  # nosec B603 B607 - fixed curl argv, no shell
            ["curl", "-s", "--max-time", "5", ICECAST_STATUS],
            capture_output=True, text=True, timeout=10, check=False,
        )
        d = json.loads(r.stdout)
    except (subprocess.SubprocessError, OSError, ValueError):
        return None
    src = d.get("icestats", {}).get("source")
    if src is None:
        return 0
    if isinstance(src, list):
        return sum(int(s.get("listeners", 0) or 0) for s in src)
    try:
        return int(src.get("listeners", 0) or 0)
    except (TypeError, ValueError):
        return 0


def liq_replicas():
    """Current liquidsoap Deployment spec replicas, or None if unknown."""
    out = kubectl([
        "get", "deployment", LIQ_DEPLOY, "-n", RADIO_NS,
        "-o", "jsonpath={.spec.replicas}",
    ])
    try:
        return int(out)
    except (TypeError, ValueError):
        return None


def _read_zero_since():
    try:
        with open(ZERO_SINCE_FILE, encoding="utf-8") as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return None


def _write_zero_since(value):
    """Persist (int epoch) or clear (None) the 0-listener-since timestamp."""
    try:
        if value is None:
            if os.path.exists(ZERO_SINCE_FILE):
                os.remove(ZERO_SINCE_FILE)
        else:
            with open(ZERO_SINCE_FILE, "w", encoding="utf-8") as fh:
                fh.write(str(int(value)))
    except OSError:
        pass


def scale_down_tick():
    """Scale liquidsoap to 0 after SCALE_DOWN_SECS continuous 0-listener secs.

    Idempotent and DOWN-only: never scales up, so it can never fight a wake.
    Timer state persists in ZERO_SINCE_FILE across discrete cron fires.
    """
    listeners = icecast_listeners()
    if listeners is None:
        return  # transient Icecast blip — leave the timer untouched

    if listeners > 0:
        if _read_zero_since() is not None:
            print(f"scale: {listeners} listener(s) — reset scale-down timer")
        _write_zero_since(None)
        return

    replicas = liq_replicas()
    if not replicas:  # 0 or None -> already down / unknown, idle the timer
        _write_zero_since(None)
        return

    now = int(time.time())
    since = _read_zero_since()
    if since is None:
        _write_zero_since(now)
        print(f"scale: 0 listeners — starting {SCALE_DOWN_SECS}s countdown")
        return

    elapsed = now - since
    if elapsed >= SCALE_DOWN_SECS:
        print(
            f"scale: 0 listeners for {elapsed}s (>= {SCALE_DOWN_SECS}s) "
            f"-> scaling {LIQ_DEPLOY} to 0"
        )
        kubectl(["scale", "deployment", LIQ_DEPLOY, "-n", RADIO_NS,
                 "--replicas=0"])
        _write_zero_since(None)


def main():
    """Check each speaker; re-cast the group if any has dropped out of sync."""
    # Respect intentional pause.
    if os.path.exists(PAUSE_FILE):
        print("paused — skipping")
        return 1

    # Scale-to-zero runs FIRST, unconditionally (independent of speaker sync):
    # it must keep counting down even when the radio is "off" so the encoder
    # gets reclaimed. It only ever scales DOWN, never up.
    scale_down_tick()

    if not radio_is_on():
        print("radio off (liquidsoap not running) — skipping")
        return 1

    token = get_access_token()
    if not token:
        print("ERROR: could not obtain HA access token")
        return 0  # don't error-spam; transient

    bad = []
    for ent in MEMBER_ENTITIES:
        state, cid = ha_get_state(token, ent)
        ours = STREAM_URL.rsplit("//", maxsplit=1)[-1] in (cid or "")
        if state != "playing" or not ours:
            bad.append((ent, state, ours))

    if not bad:
        print("OK: all speakers playing the radio")
        return 0

    names = ", ".join(f"{e.rsplit('.', maxsplit=1)[-1]}({s})" for e, s, _ in bad)
    print(f"RECAST: {len(bad)} speaker(s) not in sync -> {names}")
    ha_cast_group(token)
    time.sleep(10)

    # Verify recovery.
    still_bad = []
    for ent in MEMBER_ENTITIES:
        state, cid = ha_get_state(token, ent)
        ours = STREAM_URL.rsplit("//", maxsplit=1)[-1] in (cid or "")
        if state not in ("playing", "buffering") or not ours:
            still_bad.append(ent.rsplit(".", maxsplit=1)[-1])
    if still_bad:
        print(f"WARN: still not playing after recast: {', '.join(still_bad)}")
    else:
        print("recovered: all speakers buffering/playing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
