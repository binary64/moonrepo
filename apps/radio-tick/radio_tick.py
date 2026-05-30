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
import subprocess
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


def sh(cmd, timeout=20, check=False):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        sys.stderr.write(f"[radio_tick] cmd failed ({r.returncode}): {cmd}\n{r.stderr}\n")
    return r


def liquidsoap_pod():
    r = sh(f"kubectl get pod -n {NS} -l app=liquidsoap "
           "-o jsonpath='{.items[0].metadata.name}'")
    return r.stdout.strip()


def djbrain_pod():
    r = sh(f"kubectl get pod -n {NS} -l app=dj-brain "
           "-o jsonpath='{.items[0].metadata.name}'")
    return r.stdout.strip()


def icecast_listeners():
    pod = sh(f"kubectl get pod -n {NS} -l app=icecast "
             "-o jsonpath='{.items[0].metadata.name}'").stdout.strip()
    if not pod:
        return 0
    r = sh(f"kubectl exec -n {NS} {pod} -- curl -s "
           "http://localhost:8100/status-json.xsl", timeout=15)
    try:
        data = json.loads(r.stdout)
        src = data["icestats"]["source"]
        srcs = src if isinstance(src, list) else [src]
        return sum(int(s.get("listeners", 0) or 0)
                   for s in srcs if "/stream" in str(s.get("listenurl", "")))
    except Exception:
        return 0


def load_graph():
    with open(GRAPH_HOST) as f:
        return json.load(f)


def now_playing():
    pod = liquidsoap_pod()
    if not pod:
        return ""
    r = sh(f"kubectl exec -n {NS} {pod} -c liquidsoap -- "
           "cat /state/current-track-display.txt", timeout=15)
    return r.stdout.strip()


def read_pod_json(path, pod=None, container="liquidsoap"):
    pod = pod or liquidsoap_pod()
    if not pod:
        return None
    r = sh(f"kubectl exec -n {NS} {pod} -c {container} -- cat {path}", timeout=15)
    try:
        return json.loads(r.stdout)
    except Exception:
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
        with open(SCHEDULE_FILE) as f:
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
    r = sh(f"curl -sf --max-time 5 {BUDGET_URL}", timeout=8)
    try:
        return json.loads(r.stdout)
    except Exception:
        return {}


def tick_state():
    try:
        with open(TICK_STATE) as f:
            return json.load(f)
    except Exception:
        return {"last_spoke_ts": 0, "spoke_count": 0}


def save_tick_state(st):
    os.makedirs(os.path.dirname(TICK_STATE), exist_ok=True)
    with open(TICK_STATE, "w") as f:
        json.dump(st, f)


# ─────────────────────────── candidate tracks ───────────────────────────

def candidate_tracks(graph, audience, limit=40):
    """BFS from current track via follow-graph, ranked by affinity for who's home.

    Returns list of dicts: {id, n, g, bpm, e, af_score}. These are the ONLY
    valid next-5 picks (they chain from the current track)."""
    tracks = graph["tracks"]
    follow = graph["follow"]
    path_index = graph.get("pathIndex", {})

    # Find current track id from now-playing display name
    np = now_playing()
    seed = None
    if np:
        for tid, t in tracks.items():
            if t.get("n", "").strip() == np.strip():
                seed = tid
                break
        if not seed:
            # match by display "Artist - Title" loosely
            for tid, t in tracks.items():
                if np.strip() in t.get("n", "") or t.get("n", "") in np:
                    seed = tid
                    break

    # affinity key
    if "james" in audience and "abi" in audience:
        afk = "both"
    elif "abi" in audience:
        afk = "abi"
    elif "james" in audience:
        afk = "james"
    else:
        afk = "both"

    ids = []
    if seed:
        frontier = [seed]
        seen = {seed}
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
            if len(ids) > 250:
                break
    if not ids:
        ids = list(tracks.keys())[:250]

    out = []
    for tid in ids:
        t = tracks[tid]
        af = (t.get("af") or {}).get(afk, 0.0)
        out.append({
            "id": int(tid), "n": t.get("n", ""), "g": t.get("g", ""),
            "bpm": t.get("bpm"), "e": t.get("e"), "af": af,
        })
    out.sort(key=lambda x: x["af"], reverse=True)
    return out[:limit], seed


# ─────────────────────────── subcommands ───────────────────────────

def cmd_gate(_args):
    n = icecast_listeners()
    sys.stderr.write(f"[radio_tick] listeners={n}\n")
    sys.exit(0 if n > 0 else 1)


def cmd_context(_args):
    graph = load_graph()
    audience = who_home()
    dj = current_dj()
    np = now_playing()
    q = read_pod_json(QUEUE_FILE) or []
    hist = recent_history(50)
    b = budget()
    cands, seed = candidate_tracks(graph, audience)
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
    lines.extend(f"- {x}" for x in q_named) if q_named else lines.append("- (empty — engine will auto-pick)")
    lines.append("")
    lines.append(f"### Recent commentary — last {len(hist)} (DO NOT repeat these themes/jokes/track-teases)")
    for h in hist[-25:]:
        c = h.get("commentary", "")
        lines.append(f"- [{h.get('track','?')}] {c[:200]}")
    if not hist:
        lines.append("- (no history yet)")
    lines.append("")
    lines.append(f"### Candidate next tracks (valid follow-ons, ranked by affinity for who's home)")
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
        with open(args.file) as f:
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
        b64 = subprocess.run(f"printf %s {json_quote(rec)} | base64 -w0",
                             shell=True, capture_output=True, text=True).stdout.strip()
        sh(f"kubectl exec -n {NS} {pod} -- sh -c "
           f"\"echo {b64} | base64 -d > {PENDING_END_FILE}\"", timeout=20, check=True)
        _mark_spoke(text, dj)
        print(json.dumps({"aired": "queued-end-of-song", "dj": dj, "chars": len(text)}))
        return

    # asap: duck + speak now via the proven dj-commentary.sh path inside the pod
    text_b64 = subprocess.run(f"printf %s {json_quote(text)} | base64 -w0",
                              shell=True, capture_output=True, text=True).stdout.strip()
    r = sh(f"kubectl exec -n {NS} {pod} -- sh -c "
           f"'/radio/dj-commentary.sh {dj} api-call \"$(echo {text_b64} | base64 -d)\"'",
           timeout=90, check=True)
    ok = "Done" in r.stdout or r.returncode == 0
    _mark_spoke(text, dj)
    print(json.dumps({"aired": bool(ok), "dj": dj, "chars": len(text),
                      "detail": r.stdout.strip()[-200:]}))


def _mark_spoke(text, dj="arthur"):
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
        payload = json.dumps(existing)
        b64 = subprocess.run(f"printf %s {json_quote(payload)} | base64 -w0",
                             shell=True, capture_output=True, text=True).stdout.strip()
        sh(f"kubectl exec -n {NS} {pod} -c liquidsoap -- sh -c "
           f"\"echo {b64} | base64 -d > /state/dj-recent-history.json\"", timeout=20)


def json_quote(s):
    import shlex
    return shlex.quote(s)


def cmd_queue(args):
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

    valid, prev = [], seed
    for tid in want:
        ts = str(tid)
        if ts not in tracks:
            continue
        if prev is not None:
            if tid not in follow.get(str(prev), []):
                # allow if no follow info, else skip non-chaining
                if follow.get(str(prev)):
                    continue
        valid.append(tid)
        prev = tid

    valid = valid[:LOOKAHEAD_N]
    if not valid:
        print(json.dumps({"written": False, "reason": "no valid chaining tracks",
                          "hint": "pick from the candidate list in context"}))
        return

    pod = liquidsoap_pod()
    payload = json.dumps(valid)
    b64 = subprocess.run(f"printf %s {json_quote(payload)} | base64 -w0",
                         shell=True, capture_output=True, text=True).stdout.strip()
    sh(f"kubectl exec -n {NS} {pod} -c liquidsoap -- sh -c "
       f"\"echo {b64} | base64 -d > {QUEUE_FILE}\"", timeout=20, check=True)
    named = [f"{tid}: {tracks[str(tid)]['n']}" for tid in valid]
    print(json.dumps({"written": True, "count": len(valid), "tracks": named}))


def main():
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
