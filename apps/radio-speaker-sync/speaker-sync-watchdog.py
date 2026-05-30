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
import subprocess
import json
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
PAUSE_FILE = "/tmp/radio-paused"


def kx(args, ns=HA_NS, pod=HA_POD, timeout=20):
    """Run a command inside a k8s pod, return stdout (empty on failure)."""
    try:
        r = subprocess.run(
            ["kubectl", "exec", "-n", ns, pod, "--", *args],
            capture_output=True, text=True, timeout=timeout,
        )
        return r.stdout
    except (subprocess.SubprocessError, OSError):
        return ""


def kubectl(args, timeout=20):
    """Run a plain kubectl command, return stdout (empty on failure)."""
    try:
        r = subprocess.run(
            ["kubectl", *args], capture_output=True, text=True, timeout=timeout,
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


def main():
    # Respect intentional pause.
    import os
    if os.path.exists(PAUSE_FILE):
        print("paused — skipping")
        return 1

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
        ours = STREAM_URL.split("//")[-1] in (cid or "")
        if state != "playing" or not ours:
            bad.append((ent, state, ours))

    if not bad:
        print("OK: all speakers playing the radio")
        return 0

    names = ", ".join(f"{e.split('.')[-1]}({s})" for e, s, _ in bad)
    print(f"RECAST: {len(bad)} speaker(s) not in sync -> {names}")
    ha_cast_group(token)
    time.sleep(10)

    # Verify recovery.
    still_bad = []
    for ent in MEMBER_ENTITIES:
        state, cid = ha_get_state(token, ent)
        ours = STREAM_URL.split("//")[-1] in (cid or "")
        if state not in ("playing", "buffering") or not ours:
            still_bad.append(ent.split(".")[-1])
    if still_bad:
        print(f"WARN: still not playing after recast: {', '.join(still_bad)}")
    else:
        print("recovered: all speakers buffering/playing")
    return 0


if __name__ == "__main__":
    sys.exit(main())
