#!/usr/bin/env python3
"""
radio_tick.py — unified tool for the agentic Arthur Radio tick loop.

Subcommands:
  gate              exit 0 if Icecast has >0 listeners, else exit 1 (NO LLM if fails)
  context           print full markdown context for the tick LLM prompt
  speak  ...        air a DJ commentary clip (timing: asap | start | end | seam)
  queue  --ids ...  re-assert the next-N track lookahead (validated via follow graph)

Runs ON THE VPS. Reaches the k8s cluster via kubectl exec.
The LLM (hermes -z, radio-tick skill) calls `speak` and `queue` as its tools.
"""
import argparse
import json
import os
import subprocess  # nosec B404 - kubectl/curl orchestration; all calls use shell=False with fixed argv
import sys
import time
from datetime import datetime

NS = "radio-dj"
GRAPH_HOST = "/mnt/arthur/clawd/data/radio-track-graph.json"
QUEUE_FILE = "/state/radio-llm-queue.json"            # in-pod path
HISTORY_HOST = "/mnt/arthur/clawd/data/dj-recent-history.json"  # mirror; pod /state is canonical
# ─── Pending DJ-clip insertion points (kept together) ───────────────────────
# next_track.py airs these at the corresponding moment of the next track change.
#   end   — over the outro/tail of the ENDING track (back-announce)
#   start — over the intro of the NEW track (front-announce)
#   seam  — during the crossfade seam (alias of track-change, deeper default duck
#           to punch through the blend)
PENDING_END_FILE = "/state/dj-pending-end-of-song.json"   # in-pod: aired on next on_track
PENDING_START_FILE = "/state/dj-pending-start-of-song.json"  # in-pod: aired at new-track start
PENDING_SEAM_FILE = "/state/dj-pending-seam.json"         # in-pod: aired during the cross
# Tier-cap data (shared with next_track.py so the DJ's lookahead matches reality)
TRACK_TIERS_FILE = "/data/music/track-tiers.json"  # in-pod
PLAY_HISTORY_LOG = "/data/music/play-history.log"  # in-pod
SEAM_DEFAULT_DUCK = 0.1  # seam clips duck slightly deeper to cut through the blend
BUDGET_URL = "http://localhost:8877/budget"
WHO_HOME = "/mnt/arthur/.hermes/scripts/who-is-home.sh"
TICK_STATE = "/mnt/arthur/.hermes/data/radio-tick-state.json"
LOOKAHEAD_N = 5  # 3x avg tick (~5min) of runway

ARTHUR_VOICE = "b4e39673-3fec-446a-a965-6517b5e0ea52"
CARA_VOICE = "7c45223a-60a8-45e5-9c74-0339f354ca81"


def sh(args, timeout=20, check=False, stdin_bytes=None):
    """Run a command WITHOUT a shell. `args` is a list of argv tokens."""
    r = subprocess.run(args, shell=False, capture_output=True,  # nosec B603 - fixed argv, no shell, no untrusted input
                       input=stdin_bytes, timeout=timeout, check=False)
    out = r.stdout.decode(errors="replace") if isinstance(r.stdout, bytes) else (r.stdout or "")
    err = r.stderr.decode(errors="replace") if isinstance(r.stderr, bytes) else (r.stderr or "")
    if check and r.returncode != 0:
        sys.stderr.write(f"[radio_tick] cmd failed ({r.returncode}): {' '.join(args)}\n{err}\n")
    r.stdout, r.stderr = out, err
    return r


def kubectl_write(path, data, pod, container=None):
    """Write `data` (str) to `path` inside a pod by piping bytes via stdin —
    no shell, no base64, no quoting games."""
    cmd = ["kubectl", "exec", "-i", "-n", NS, pod]
    if container:
        cmd += ["-c", container]
    cmd += ["--", "sh", "-c", f"cat > {path}"]
    return sh(cmd, timeout=20, check=True, stdin_bytes=data.encode())


def liquidsoap_pod():
    """Return the running liquidsoap pod name in the radio-dj namespace."""
    r = sh(["kubectl", "get", "pod", "-n", NS, "-l", "app=liquidsoap",
            "-o", "jsonpath={.items[0].metadata.name}"])
    return r.stdout.strip()


def djbrain_pod():
    """Return the running dj-brain pod name in the radio-dj namespace."""
    r = sh(["kubectl", "get", "pod", "-n", NS, "-l", "app=dj-brain",
            "-o", "jsonpath={.items[0].metadata.name}"])
    return r.stdout.strip()


def icecast_listeners():
    """Return the current /stream listener count from Icecast (0 on any error)."""
    pod = sh(["kubectl", "get", "pod", "-n", NS, "-l", "app=icecast",
              "-o", "jsonpath={.items[0].metadata.name}"]).stdout.strip()
    if not pod:
        return 0
    r = sh(["kubectl", "exec", "-n", NS, pod, "--", "curl", "-s",
            "http://localhost:8100/status-json.xsl"], timeout=15)
    try:
        data = json.loads(r.stdout)
        src = data["icestats"]["source"]
        srcs = src if isinstance(src, list) else [src]
        return sum(int(s.get("listeners", 0) or 0)
                   for s in srcs if "/stream" in str(s.get("listenurl", "")))
    except (ValueError, KeyError, TypeError):
        return 0


def load_graph():
    """Load the pre-computed track graph (tracks, follow edges, path index)."""
    with open(GRAPH_HOST, encoding="utf-8") as f:
        return json.load(f)


def now_playing():
    """Return the current track display string ('Artist - Title') from the pod."""
    pod = liquidsoap_pod()
    if not pod:
        return ""
    r = sh(["kubectl", "exec", "-n", NS, pod, "-c", "liquidsoap", "--",
            "cat", "/state/current-track-display.txt"], timeout=15)
    return r.stdout.strip()


def read_pod_json(path, pod=None, container="liquidsoap"):
    """Read and parse a JSON file from inside a pod; None if missing/invalid."""
    pod = pod or liquidsoap_pod()
    if not pod:
        return None
    r = sh(["kubectl", "exec", "-n", NS, pod, "-c", container, "--",
            "cat", path], timeout=15)
    try:
        return json.loads(r.stdout)
    except (ValueError, TypeError):
        return None


def _clean_title(rec):
    """Salvage a clean 'Artist - Title' from old corrupt records or new clean ones."""
    artist = (rec.get("artist") or "").strip()
    title = (rec.get("title") or "").strip()
    # New clean schema: artist + title both sensible
    if artist and artist.lower() != "music" and "{" not in title:
        return f"{artist} - {title}"
    # Old corrupt schema: title field has '<real title>.mp3",\n "bpm"...' garbage.
    # Take everything before the first '.mp3' and strip leading quotes/backslashes.
    raw = title.split(".mp3")[0]
    raw = raw.replace('\\"', '').replace('\\', '').strip().strip('"').strip()
    return raw or "?"


def recent_history(limit=50):
    """Last N aired commentaries — for anti-repetition. Handles legacy + clean schema."""
    data = read_pod_json("/state/dj-recent-history.json")
    if not isinstance(data, list):
        return []
    out = []
    for rec in data[-limit:]:
        out.append({
            "track": _clean_title(rec),
            "commentary": (rec.get("commentary") or "").replace("\n", " ").strip(),
        })
    return out


SCHEDULE_FILE = "/mnt/arthur/clawd/memory/schedule.json"
ABI_LEAVE, ABI_RETURN = 7, 18


def _audience():
    """Schedule-aware presence — mirrors next_track.py get_audience().
    James assumed home; Abi by schedule/time. Returns {abi_home, james_home}."""
    try:
        with open(SCHEDULE_FILE, encoding="utf-8") as f:
            schedule = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        schedule = {}
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    hour = now.hour
    abi = schedule.get("abi", {})
    abi_status = abi.get("status") if abi.get("date") == today else None
    is_weekend = now.weekday() >= 5
    if abi_status == "not-working" or is_weekend:
        abi_home = True
    elif abi_status == "working":
        abi_home = hour < ABI_LEAVE or hour >= ABI_RETURN
    else:
        abi_home = hour < ABI_LEAVE or hour >= ABI_RETURN
    return {"abi_home": abi_home, "james_home": True}


def who_home():
    """Return the list of people currently home (schedule-derived audience)."""
    a = _audience()
    home = []
    if a["james_home"]:
        home.append("james")
    if a["abi_home"]:
        home.append("abi")
    return home


def current_dj():
    """Cara when Abi is home, else Arthur. Mirrors next_track.py get_current_dj()."""
    return "cara" if _audience()["abi_home"] else "arthur"


def budget():
    """Return the TTS budget status dict from the brain server (empty on error)."""
    r = sh(["curl", "-sf", "--max-time", "5", BUDGET_URL], timeout=8)
    try:
        return json.loads(r.stdout)
    except (ValueError, TypeError):
        return {}


def tick_state():
    """Load persisted tick state (last spoke timestamp, spoke count)."""
    try:
        with open(TICK_STATE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"last_spoke_ts": 0, "spoke_count": 0}


def save_tick_state(st):
    """Persist tick state to disk."""
    os.makedirs(os.path.dirname(TICK_STATE), exist_ok=True)
    with open(TICK_STATE, "w", encoding="utf-8") as f:
        json.dump(st, f)


# ─────────────────────────── candidate tracks ───────────────────────────

def _find_seed(tracks, np):
    """Resolve the current track's ID from its now-playing display name."""
    if not np:
        return None
    target = np.strip()
    for tid, t in tracks.items():
        if t.get("n", "").strip() == target:
            return tid
    for tid, t in tracks.items():  # loose match fallback
        name = t.get("n", "")
        if target in name or name in target:
            return tid
    return None


def _affinity_key(audience):
    """Map the present audience to a track-affinity key (james/abi/both)."""
    if "abi" in audience and "james" in audience:
        return "both"
    if "abi" in audience:
        return "abi"
    if "james" in audience:
        return "james"
    return "both"


def _bfs_followers(follow, tracks, seed, cap=250):
    """Track IDs reachable within 3 follow-hops from seed."""
    ids, frontier, seen = [], [seed], {seed}
    for _hop in range(3):
        nxt = []
        for tid in frontier:
            for fid in follow.get(str(tid), []):
                fs = str(fid)
                if fs not in seen and fs in tracks:
                    seen.add(fs)
                    nxt.append(fs)
                    ids.append(fs)
        frontier = nxt
        if len(ids) > cap:
            break
    return ids


def candidate_tracks(graph, audience, limit=40):
    """Valid next-track picks: BFS from the current track via the follow-graph,
    ranked by affinity for who's home. These are the ONLY valid lookahead picks
    (they chain from the current track)."""
    tracks, follow = graph["tracks"], graph["follow"]
    seed = _find_seed(tracks, now_playing())
    afk = _affinity_key(audience)

    ids = _bfs_followers(follow, tracks, seed) if seed else []
    if not ids:
        ids = list(tracks.keys())[:250]

    out = []
    for tid in ids:
        t = tracks[tid]
        out.append({
            "id": int(tid), "n": t.get("n", ""), "g": t.get("g", ""),
            "bpm": t.get("bpm"), "e": t.get("e"),
            "af": (t.get("af") or {}).get(afk, 0.0),
        })
    out.sort(key=lambda x: x["af"], reverse=True)
    return out[:limit]


# ─────────────────────── tier-cap lookahead filter ──────────────────────
# The selector (next_track.py) enforces daily/weekly artist caps at PLAY TIME:
# if an artist already has a play within its cooldown window, the track is
# bumped and a DIFFERENT one airs. If the DJ teases such a track in its
# "upcoming" context, the announcement desyncs from the audio (e.g. "Fatboy
# Slim next" but Basement Jaxx actually plays). So we apply the SAME cap to the
# lookahead the DJ sees — never hand it a track the selector would skip.

def _artist_of(name):
    """Primary artist from an 'Artist - Title' display string (mirrors
    next_track.get_artist_from_name closely enough for cap matching)."""
    part = name.split(" - ")[0].strip().strip('"') if " - " in name else name
    for sep in (" & ", ", ", " feat.", " feat ", " ft.", " ft ", " x ", " X ", " vs ", " VS "):
        if sep in part:
            part = part.split(sep)[0].strip()
            break
    return part.lower()


def load_artist_tiers():
    """Read /data/music/track-tiers.json from the pod and return the daily +
    weekly artist-cap config: {tier: {artists:set(lower), cooldown_hours:float}}.
    Empty/missing → no caps."""
    data = read_pod_json(TRACK_TIERS_FILE) or {}
    out = {}
    for tier, default_hours in (("daily", 24.0), ("weekly", 168.0)):
        cfg = data.get(tier) or {}
        artists = {a.strip().lower() for a in cfg.get("artists", []) if a.strip()}
        hours = float(cfg.get("cooldown_hours", default_hours))
        out[tier] = {"artists": artists, "cooldown_hours": hours}
    return out


def get_artist_play_count_since(artist_lower, hours, history_lines):
    """Count plays of `artist_lower` within the last `hours` from the pod's
    play-history.log lines. Log format: 'ISO_TS  Artist - Title  (file.mp3)'."""
    cutoff = time.time() - hours * 3600
    count = 0
    for line in history_lines:
        parts = line.strip().split("  ")
        if len(parts) < 2:
            continue
        try:
            ts = datetime.fromisoformat(parts[0]).timestamp()
        except ValueError:
            continue
        if ts < cutoff:
            continue
        if _artist_of(parts[1]) == artist_lower:
            count += 1
    return count


def filter_capped_tracks(cands):
    """Drop any candidate whose artist is already at/over its daily/weekly cap —
    exactly what next_track.py would skip at play time. Keeps the DJ's lookahead
    in sync with what will actually air."""
    tiers = load_artist_tiers()
    capped = {a for t in tiers.values() for a in t["artists"]}
    if not capped:
        return cands  # no caps configured — nothing to filter
    pod = liquidsoap_pod()
    history_lines = []
    if pod:
        r = sh(["kubectl", "exec", "-n", NS, pod, "-c", "liquidsoap", "--",
                "cat", PLAY_HISTORY_LOG], timeout=15)
        history_lines = r.stdout.splitlines()
    kept = []
    for c in cands:
        artist = _artist_of(c.get("n", ""))
        skip = False
        for tier in tiers.values():
            if artist in tier["artists"] and \
                    get_artist_play_count_since(artist, tier["cooldown_hours"], history_lines) >= 1:
                skip = True
                break
        if not skip:
            kept.append(c)
    return kept


# ─────────────────────────── subcommands ───────────────────────────

def cmd_gate(_args):
    """Listener gate: exit 0 if anyone is tuned in, else exit 1 (no LLM)."""
    n = icecast_listeners()
    sys.stderr.write(f"[radio_tick] listeners={n}\n")
    sys.exit(0 if n > 0 else 1)


def cmd_context(_args):
    """Print the full markdown context block consumed by the tick LLM prompt."""
    graph = load_graph()
    audience = who_home()
    dj = current_dj()
    np = now_playing()
    q = read_pod_json(QUEUE_FILE) or []
    hist = recent_history(50)
    b = budget()
    cands = candidate_tracks(graph, audience)
    # Apply next_track.py's artist cap so the DJ never teases a track the
    # selector will bump at play time (prevents announce/audio desync).
    cands = filter_capped_tracks(cands)
    st = tick_state()
    since_spoke = int(time.time()) - st.get("last_spoke_ts", 0)

    tracks = graph["tracks"]
    # resolve queued ids to names
    q_named = [f"{tid}: {tracks.get(str(tid), {}).get('n', '?')}" for tid in q]

    lines = []
    lines.append(f"## Radio tick — {datetime.now().strftime('%A %Y-%m-%d %H:%M GMT')}")
    lines.append(f"**Active DJ:** {dj}")
    lines.append(f"**Listening now:** {', '.join(audience) if audience else 'unknown (someone is — listener gate passed)'}")
    lines.append(f"**Now playing:** {np or 'unknown'}")
    lines.append(f"**Seconds since DJ last spoke:** {since_spoke if st.get('last_spoke_ts') else 'never this session'}")
    lines.append("")
    if b:
        lines.append(f"**TTS budget:** {b.get('month_pct','?')}% of month used, "
                     f"daily_budget≈{b.get('daily_budget','?')} chars, "
                     f"{b.get('days_remaining','?')} days to reset. "
                     "Speak with impact, not constantly.")
        lines.append("")
    lines.append(f"### Current lookahead queue ({len(q)} tracks)")
    if q_named:
        lines.extend(f"- {x}" for x in q_named)
    else:
        lines.append("- (empty — engine will auto-pick)")
    lines.append("")
    lines.append(f"### Recent commentary — last {len(hist)} (DO NOT repeat these themes/jokes/track-teases)")
    for h in hist[-25:]:
        c = h.get("commentary", "")
        lines.append(f"- [{h.get('track','?')}] {c[:200]}")
    if not hist:
        lines.append("- (no history yet)")
    lines.append("")
    lines.append("### Candidate next tracks (valid follow-ons, ranked by affinity for who's home)")
    lines.append("Pick exactly 5 IDs from THIS list for the lookahead. They chain from the current track.")
    for c in cands:
        lines.append(f"- {c['id']}: {c['n']} | {c['g']} | {c['bpm']}bpm | energy {c['e']} | affinity {c['af']}")
    lines.append("")
    print("\n".join(lines))


def cmd_speak(args):
    """Air a clip. timing: asap (duck+now) | start (over next intro) |
    end (over outro/tail) | seam (during the crossfade)."""
    dj = args.dj.lower()
    if dj not in ("arthur", "cara"):
        sys.stderr.write("speak: dj must be arthur|cara\n")
        sys.exit(2)

    # budget guard
    b = budget()
    if b and b.get("month_pct", 0) >= 95:
        print(json.dumps({"aired": False, "reason": "budget exhausted (>=95%)"}))
        return

    if args.text:
        text = args.text
    elif args.file:
        with open(args.file, encoding="utf-8") as f:
            payload = json.load(f)
        if isinstance(payload, dict) and "utterances" in payload:
            text = " ".join(u.get("text", "") for u in payload["utterances"])
        elif isinstance(payload, list):
            text = " ".join(u.get("text", "") for u in payload)
        else:
            text = str(payload)
    else:
        sys.stderr.write("speak: need --text or --file\n")
        sys.exit(2)

    text = text.strip()
    if not text:
        print(json.dumps({"aired": False, "reason": "empty text"}))
        return

    pod = djbrain_pod()
    if not pod:
        print(json.dumps({"aired": False, "reason": "no dj-brain pod"}))
        return

    # Duck depth for this clip (1.0=full music, lower=deeper duck). Validate range.
    duck = args.duck
    if not 0.0 <= duck <= 1.0:
        duck = 0.15

    # Non-asap timings write a pending record that next_track.py airs at the
    # corresponding moment of the next track change. We persist the duck level in
    # every record so the airing side annotates the clip identically.
    #   end   → over outro/tail (back-announce)
    #   start → over the intro of the new track (front-announce)
    #   seam  → during the crossfade seam (deeper default duck to cut through)
    pending = {
        "end": (PENDING_END_FILE, "queued-end-of-song"),
        "start": (PENDING_START_FILE, "queued-start-of-song"),
        "seam": (PENDING_SEAM_FILE, "queued-seam"),
    }
    if args.timing in pending:
        path, status = pending[args.timing]
        # seam punches through the blend — default slightly deeper unless the
        # caller explicitly set --duck away from the asap default.
        clip_duck = duck
        if args.timing == "seam" and duck == 0.15:
            clip_duck = SEAM_DEFAULT_DUCK
        rec = json.dumps({"dj": dj, "text": text, "duck": clip_duck,
                          "ts": int(time.time())})
        kubectl_write(path, rec, pod)
        _mark_spoke(text, dj)
        print(json.dumps({"aired": status, "dj": dj, "duck": clip_duck,
                          "chars": len(text)}))
        return

    # asap: duck + speak now via the proven dj-commentary.sh path inside the pod.
    # Pass text as a positional argv (no shell interpolation / quoting games).
    # 4th positional arg = duck depth.
    r = sh(["kubectl", "exec", "-n", NS, pod, "--",
            "/radio/dj-commentary.sh", dj, "api-call", text, str(duck)],
           timeout=90, check=True)
    ok = "Done" in r.stdout or r.returncode == 0
    _mark_spoke(text, dj)
    print(json.dumps({"aired": bool(ok), "dj": dj, "chars": len(text),
                      "duck": duck, "detail": r.stdout.strip()[-200:]}))


def _mark_spoke(text, dj="arthur"):
    """Record that the DJ spoke: update tick state + append a clean history record."""
    st = tick_state()
    st["last_spoke_ts"] = int(time.time())
    st["spoke_count"] = st.get("spoke_count", 0) + 1
    save_tick_state(st)
    # Append a CLEAN history record so future ticks get accurate anti-repetition.
    np = now_playing()  # "Artist - Title"
    artist, _, title = np.partition(" - ")
    rec = {"artist": artist.strip() or "?", "title": title.strip() or np,
           "dj": dj, "commentary": text, "ts": int(time.time())}
    pod = liquidsoap_pod()
    if pod:
        existing = read_pod_json("/state/dj-recent-history.json") or []
        if not isinstance(existing, list):
            existing = []
        existing.append(rec)
        existing = existing[-100:]  # persist 100
        kubectl_write("/state/dj-recent-history.json", json.dumps(existing),
                      pod, container="liquidsoap")


def cmd_queue(args):
    """Re-assert the next-N track lookahead from LLM-picked IDs (validated)."""
    graph = load_graph()
    tracks = graph["tracks"]
    follow = graph["follow"]
    np = now_playing()

    raw = [x.strip() for x in args.ids.split(",") if x.strip()]
    try:
        want = [int(x) for x in raw]
    except ValueError:
        print(json.dumps({"written": False, "reason": "ids must be integers"}))
        sys.exit(2)

    # seed = current track id
    seed = None
    for tid, t in tracks.items():
        if t.get("n", "").strip() == np.strip():
            seed = int(tid)
            break

    # Accept any track IDs that exist in the graph. We do NOT enforce strict
    # follow-chaining here: next_track.py handles transitions, and the candidate
    # list in the tick context is already affinity/follow-ranked. Strict chaining
    # was dropping valid picks and leaving the lookahead too thin. We DO surface
    # how many picks would have chained, as a soft quality signal.
    valid, chained, prev = [], 0, seed
    for tid in want:
        if str(tid) not in tracks:
            continue
        if prev is not None and follow.get(str(prev)) and tid in follow[str(prev)]:
            chained += 1
        valid.append(tid)
        prev = tid

    valid = valid[:LOOKAHEAD_N]
    # Drop any pick the selector would bump at play time (daily/weekly artist
    # cap) so the lookahead the DJ teases matches what actually airs.
    capped_cands = filter_capped_tracks(
        [{"id": tid, "n": tracks.get(str(tid), {}).get("n", "")} for tid in valid])
    kept_ids = {c["id"] for c in capped_cands}
    dropped = [tid for tid in valid if tid not in kept_ids]
    valid = [tid for tid in valid if tid in kept_ids]
    if not valid:
        print(json.dumps({"written": False, "reason": "no valid track IDs",
                          "hint": "pick from the candidate list in context"}))
        return

    pod = liquidsoap_pod()
    kubectl_write(QUEUE_FILE, json.dumps(valid), pod, container="liquidsoap")
    named = [f"{tid}: {tracks[str(tid)]['n']}" for tid in valid]
    print(json.dumps({"written": True, "count": len(valid),
                      "chained_from_current": chained,
                      "dropped_artist_cap": dropped, "tracks": named}))


def main():
    """Dispatch the requested subcommand (gate/context/speak/queue)."""
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("gate")
    sub.add_parser("context")
    sp = sub.add_parser("speak")
    sp.add_argument("--dj", required=True)
    sp.add_argument("--timing", choices=["asap", "start", "end", "seam"], default="end")
    sp.add_argument("--duck", type=float, default=0.15,
                    help="music duck depth 0.0-1.0 (1.0=full music, lower=deeper)")
    sp.add_argument("--text")
    sp.add_argument("--file")
    qp = sub.add_parser("queue")
    qp.add_argument("--ids", required=True, help="comma-separated track IDs")
    args = p.parse_args()

    {"gate": cmd_gate, "context": cmd_context,
     "speak": cmd_speak, "queue": cmd_queue}[args.cmd](args)


if __name__ == "__main__":
    main()
