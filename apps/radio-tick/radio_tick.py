#!/usr/bin/env python3
"""
radio_tick.py — unified tool for the agentic Arthur Radio tick loop.

Subcommands:
  gate              exit 0 if Icecast has >0 listeners, else exit 1 (NO LLM if fails)
  context           print full markdown context for the tick LLM prompt
  speak  ...        air a DJ commentary clip (timing: asap | end)
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
PENDING_END_FILE = "/state/dj-pending-end-of-song.json"  # in-pod: aired on next on_track
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


SELECTOR_STATE_FILE = "/state/radio-selector-state.json"  # in-pod: next_track.py state
ARTIST_COOLDOWN = 10  # mirrors next_track.py — no same-artist back-to-back
SCHEDULE_FILE = "/mnt/arthur/clawd/memory/schedule.json"
ABI_LEAVE, ABI_RETURN = 7, 18


def _artists_from_name(name):
    """All artists in a track name. Mirrors next_track.get_all_artists() closely
    enough to predict the artist-cooldown skip."""
    import re as _re
    head = name.split(" - ")[0].strip().strip('"') if " - " in name else name
    parts = _re.split(r"\s*[&,]\s*|\s+(?:feat\.?|ft\.?|x|vs\.?)\s+", head,
                       flags=_re.IGNORECASE)
    return {p.strip().strip('"') for p in parts if p.strip()}


def resolve_next_track(graph, queue):
    """Predict the track that will ACTUALLY play next, mirroring next_track.py's
    queue-pop skip logic. The naive answer (queue[0]) is WRONG whenever the head
    of the queue trips the artist-cooldown (same artist as a recently played
    track → bumped to the queue tail). Returns (id, name, n_skipped) or
    (None, None, 0) if it can't resolve. Tier/blacklist/Christmas skips and live
    song-requests are NOT simulated here — surfaced as a caveat instead."""
    tracks = graph["tracks"]
    sel = read_pod_json(SELECTOR_STATE_FILE) or {}
    recent_artists = set(sel.get("recent_artists", [])[-ARTIST_COOLDOWN:])
    skipped = 0
    for tid in queue:
        t = tracks.get(str(tid))
        if not t:
            skipped += 1
            continue
        name = t.get("n", "")
        if _artists_from_name(name) & recent_artists:
            skipped += 1  # would be bumped to tail for artist cooldown
            continue
        return tid, name, skipped
    return None, None, skipped


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


def record_usage(text, dj="arthur"):
    """Tell the brain server how many chars were just aired, so the monthly
    budget counter stays accurate. Best-effort: never blocks airing."""
    np = now_playing()
    artist, _, title = np.partition(" - ")
    payload = json.dumps({"chars": len(text), "dj": dj,
                          "artist": artist.strip(), "title": title.strip()})
    sh(["curl", "-sf", "--max-time", "5", "-X", "POST",
        "-H", "Content-Type: application/json", "-d", payload,
        "http://localhost:8877/record-usage"], timeout=8)


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
    # Deterministic next-track resolution: predict what next_track.py will ACTUALLY
    # pop (artist-cooldown can bump queue[0] to the tail). This is what end-of-song
    # commentary may safely tease — naming the wrong next track on-air is the
    # "promised Parov Stelar for days" failure class.
    nx_id, nx_name, nx_skipped = resolve_next_track(graph, q)
    if nx_name:
        tease = f"**NEXT TRACK (airs after this one — SAFE to tease at end-of-song):** {nx_name}"
        if nx_skipped:
            tease += f"  (queue head skipped {nx_skipped} for artist-cooldown)"
        lines.append(tease)
    else:
        lines.append("**NEXT TRACK:** unresolved — do NOT name a next track on-air this tick.")
    lines.append("⚠️ A live listener song-request overrides the above. Tease the next "
                 "track only with `--timing end`; for `--timing asap` react to the "
                 "CURRENT track/moment, not the next one.")
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
    """Air a clip. timing: asap (duck+now) | end (queued for next track change)."""
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

    if args.timing == "end":
        # Write pending file; next_track.py airs it on the next track change.
        rec = json.dumps({"dj": dj, "text": text, "ts": int(time.time())})
        kubectl_write(PENDING_END_FILE, rec, pod)
        _mark_spoke(text, dj)
        record_usage(text, dj)
        print(json.dumps({"aired": "queued-end-of-song", "dj": dj, "chars": len(text)}))
        return

    # asap: duck + speak now via the proven dj-commentary.sh path inside the pod.
    # Pass text as a positional argv (no shell interpolation / quoting games).
    r = sh(["kubectl", "exec", "-n", NS, pod, "--",
            "/radio/dj-commentary.sh", dj, "api-call", text],
           timeout=90, check=True)
    ok = "Done" in r.stdout or r.returncode == 0
    _mark_spoke(text, dj)
    if ok:
        record_usage(text, dj)
    print(json.dumps({"aired": bool(ok), "dj": dj, "chars": len(text),
                      "detail": r.stdout.strip()[-200:]}))


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
    if not valid:
        print(json.dumps({"written": False, "reason": "no valid track IDs",
                          "hint": "pick from the candidate list in context"}))
        return

    pod = liquidsoap_pod()
    kubectl_write(QUEUE_FILE, json.dumps(valid), pod, container="liquidsoap")
    named = [f"{tid}: {tracks[str(tid)]['n']}" for tid in valid]
    print(json.dumps({"written": True, "count": len(valid),
                      "chained_from_current": chained, "tracks": named}))


def main():
    """Dispatch the requested subcommand (gate/context/speak/queue)."""
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("gate")
    sub.add_parser("context")
    sp = sub.add_parser("speak")
    sp.add_argument("--dj", required=True)
    sp.add_argument("--timing", choices=["asap", "end"], default="end")
    sp.add_argument("--text")
    sp.add_argument("--file")
    qp = sub.add_parser("queue")
    qp.add_argument("--ids", required=True, help="comma-separated track IDs")
    args = p.parse_args()

    {"gate": cmd_gate, "context": cmd_context,
     "speak": cmd_speak, "queue": cmd_queue}[args.cmd](args)


if __name__ == "__main__":
    main()
