#!/usr/bin/env python3
"""
Arthur Radio — Director tool. The SINGLE Hermes/Opus call drives this to set the
whole show: the upcoming track playlist + timed DJ drops (with Hume acting
instructions) + the presence/mood context blob.

Runs ON THE VPS host. Reads the track graph from the host copy; writes the
queue + drop schedule INTO the liquidsoap pod via `kubectl exec` (same pattern
as radio_tick.py), and writes dj-context.json to the host dir that backs the
pod's /data/music.

Subcommands (Hermes calls these via the `terminal` toolset):
  candidates [--steer g,g] [--avoid g,g] [--limit N]
      Print a COMPACT candidate pool for Opus to choose from. Steer genres are
      boosted, avoid genres filtered out, results ranked by (affinity, steer
      match). Each line: id | "Artist - Title" | genres | bpm | af.
  set --ids 1,2,3,...  [--drops-file FILE] [--context-file FILE]
      Validate every ID exists in the graph, write the bare-int-ID queue into
      the pod, stage the DJ drops, and write the context blob. Prints a
      verifiable confirmation (counts + first/last track names) so Opus can
      confirm the side-effect landed.

Contract for --drops-file JSON (what Opus emits for the show's spoken bits):
  [ {"after_track_id": 1436, "dj": "cara",
     "position": "start|end|seam",
     "utterances": [ {"text": "...", "description": "warm, cheeky",
                      "speed": 1.0}, ... ]}, ... ]
Stored in-pod at /state/dj-drops-schedule.json keyed by track id; next_track.py
stages the matching drop into the pending-clip file when it pops that track.

Contract for --context-file JSON (presence/mood for the commentary + selector):
  {"generated_at": ISO8601 Z, "ttl_minutes": 30, "abi_home": bool,
   "james_home": bool, "steer_genres":[...], "avoid_genres":[...],
   "mood": str, "note": str}
"""
import argparse
import json
import os
import subprocess  # nosec B404 - kubectl orchestration, fixed argv, shell=False
import sys
from datetime import datetime, timezone

NS = "radio-dj"
GRAPH_HOST = "/mnt/arthur/clawd/data/radio-track-graph.json"
CONTEXT_HOST = "/mnt/arthur/clawd/data/music/dj-context.json"
RECENT_HOST = "/mnt/arthur/clawd/data/music/recent-shows.json"
RECENT_KEEP = 10  # how many past shows to feed back as anti-repeat memory (~2.5h)
QUEUE_POD = "/state/radio-llm-queue.json"
DROPS_POD = "/state/dj-drops-schedule.json"


def sh(args, timeout=20, stdin_bytes=None):
    r = subprocess.run(args, shell=False, capture_output=True,  # nosec B603
                       input=stdin_bytes, timeout=timeout, check=False)
    out = r.stdout.decode(errors="replace") if isinstance(r.stdout, bytes) else (r.stdout or "")
    err = r.stderr.decode(errors="replace") if isinstance(r.stderr, bytes) else (r.stderr or "")
    r.stdout, r.stderr = out, err
    return r


def liquidsoap_pod():
    r = sh(["kubectl", "get", "pod", "-n", NS, "-l", "app=liquidsoap",
            "-o", "jsonpath={.items[0].metadata.name}"])
    return r.stdout.strip()


def kubectl_write(path, data, pod):
    cmd = ["kubectl", "exec", "-i", "-n", NS, pod, "-c", "liquidsoap",
           "--", "sh", "-c", f"cat > {path}"]
    return sh(cmd, timeout=20, stdin_bytes=data.encode())


def load_graph():
    with open(GRAPH_HOST, encoding="utf-8") as f:
        return json.load(f)


def load_recent():
    """Return the list of recently-aired shows (newest last), or []. Tolerant
    of a missing/corrupt file — radio must never break on bad memory state."""
    try:
        with open(RECENT_HOST, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def append_recent(entry):
    """Append one aired show to recent-shows.json, keeping the last RECENT_KEEP.
    Best-effort: a write failure here must NOT fail the show that just aired."""
    try:
        shows = load_recent()
        shows.append(entry)
        shows = shows[-RECENT_KEEP:]
        with open(RECENT_HOST, "w", encoding="utf-8") as f:
            f.write(json.dumps(shows) + "\n")
        os.chmod(RECENT_HOST, 0o644)
        return True
    except OSError:
        return False


def _split(csv):
    return [s.strip().lower() for s in (csv or "").split(",") if s.strip()]


def _load_json_file(path):
    """Safely load a JSON file. Returns (data, ok). Never raises — a malformed
    optional input must not crash a show whose queue is already live."""
    if not path or not os.path.exists(path):
        return None, False
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f), True
    except (json.JSONDecodeError, OSError):
        return None, False


def cmd_candidates(args):
    graph = load_graph()
    tracks = graph["tracks"]
    steer = _split(args.steer)
    avoid = _split(args.avoid)

    rows = []
    for tid, t in tracks.items():
        genres = (t.get("g") or "").lower()
        # Hard filter: drop anything matching an avoid genre.
        if avoid and any(a in genres for a in avoid):
            continue
        af = t.get("af", {}) or {}
        # Rank score: affinity for whoever's home (both) + steer-genre matches.
        steer_hits = sum(1 for s in steer if s in genres)
        score = float(af.get("both", 0.0) or 0.0) + 2.0 * steer_hits
        rows.append((score, int(tid), t.get("n", ""), t.get("g", ""),
                     t.get("bpm", 0), af.get("both", 0.0)))

    # Highest score first; cap to keep the Opus payload lean.
    rows.sort(key=lambda r: r[0], reverse=True)
    rows = rows[: args.limit]

    out = [{"id": r[1], "track": r[2], "genres": r[3], "bpm": r[4], "af": r[5]}
           for r in rows]
    print(json.dumps(out, separators=(",", ":")))
    return 0


def cmd_recent(_args):
    """Print the last few aired shows so the director can avoid repeating
    tracks/moods and evolve the energy across ticks. Compact by design."""
    shows = load_recent()
    print(json.dumps(shows, separators=(",", ":")))
    return 0


def _validate_ids(raw, tracks):
    """Split the comma id list into (valid_int_ids, dropped_strs)."""
    valid, dropped = [], []
    for s in (x.strip() for x in raw.split(",") if x.strip()):
        (valid.append(int(s)) if s in tracks else dropped.append(s))
    return valid, dropped


def _build_drops(drops, tracks):
    """Turn a raw drops list into the keyed schedule, validating each entry's
    shape. Malformed entries are skipped — a bad drop must not crash the show."""
    keyed = {}
    if not isinstance(drops, list):
        return keyed
    for d in drops:
        if not isinstance(d, dict):
            continue
        tid = str(d.get("after_track_id"))
        if tid not in tracks:
            continue
        utterances = d.get("utterances", [])
        if not isinstance(utterances, list):
            utterances = []
        keyed[tid] = {"dj": d.get("dj", "arthur"),
                      "position": d.get("position", "end"),
                      "utterances": [u for u in utterances if isinstance(u, dict)]}
    return keyed


def _stage_drops(drops_file, tracks, pod):
    """Load + validate + write the drop schedule into the pod. Returns the count
    staged (0 if no/invalid drops). Never raises on bad input."""
    drops, ok = _load_json_file(drops_file)
    if not ok:
        if drops_file:
            print("WARN: drops file missing or malformed — skipping drops", file=sys.stderr)
        return 0
    keyed = _build_drops(drops, tracks)
    if not keyed:
        return 0
    rd = kubectl_write(DROPS_POD, json.dumps(keyed), pod)
    if rd.returncode != 0:
        print(f"WARN: drops write failed: {rd.stderr}", file=sys.stderr)
        return 0
    return len(keyed)


def _write_context(ctx):
    """Stamp + write the context blob to the host file backing pod /data/music.
    Returns True on success. Never raises on a write failure."""
    ctx.setdefault("ttl_minutes", 30)
    ctx["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        with open(CONTEXT_HOST, "w", encoding="utf-8") as f:
            f.write(json.dumps(ctx) + "\n")
        os.chmod(CONTEXT_HOST, 0o644)  # pod reads as uid 999; must be world-readable
        return True
    except OSError as e:
        print(f"WARN: context write failed: {e}", file=sys.stderr)
        return False


def cmd_set(args):
    graph = load_graph()
    tracks = graph["tracks"]
    pod = liquidsoap_pod()
    if not pod:
        print("ERROR: no liquidsoap pod found", file=sys.stderr)
        return 2

    # ── Validate the playlist IDs against the graph ──
    valid, dropped = _validate_ids(args.ids, tracks)
    if not valid:
        print(f"ERROR: no valid track IDs (dropped {len(dropped)})", file=sys.stderr)
        return 3

    # ── Write the queue into the pod (bare int-ID array) ──
    r = kubectl_write(QUEUE_POD, json.dumps(valid), pod)
    if r.returncode != 0:
        print(f"ERROR: queue write failed: {r.stderr}", file=sys.stderr)
        return 4

    # ── Stage DJ drops (tolerant of malformed input) ──
    n_drops = _stage_drops(args.drops_file, tracks, pod)

    # ── Read context once (reused for the pod write AND the history entry) ──
    ctx, ctx_ok = _load_json_file(args.context_file)
    if not isinstance(ctx, dict):
        ctx, ctx_ok = {}, False
    wrote_ctx = _write_context(ctx) if ctx_ok else False
    if not ctx_ok and args.context_file:
        print("WARN: context file missing or malformed — skipping context", file=sys.stderr)

    first = tracks[str(valid[0])].get("n", "")
    last = tracks[str(valid[-1])].get("n", "")

    # ── Append this aired show to the rolling history (anti-repeat memory) ──
    # Compact: track names + ids + mood/note so the next tick knows what just
    # played and can evolve rather than echo. Best-effort, never blocks.
    hist_entry = {
        "aired_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ids": valid,
        "tracks": [tracks[str(i)].get("n", "") for i in valid],
        "mood": ctx.get("mood", ""),
        "note": ctx.get("note", ""),
    }
    wrote_hist = append_recent(hist_entry)

    print(json.dumps({
        "ok": True, "queued": len(valid), "dropped_ids": dropped,
        "drops_staged": n_drops, "context_written": wrote_ctx,
        "history_written": wrote_hist,
        "first": first, "last": last,
    }))
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    pc = sub.add_parser("candidates")
    pc.add_argument("--steer", default="")
    pc.add_argument("--avoid", default="")
    pc.add_argument("--limit", type=int, default=300)
    pc.set_defaults(func=cmd_candidates)

    ps = sub.add_parser("set")
    ps.add_argument("--ids", required=True)
    ps.add_argument("--drops-file", default=None)
    ps.add_argument("--context-file", default=None)
    ps.set_defaults(func=cmd_set)

    pr = sub.add_parser("recent")
    pr.set_defaults(func=cmd_recent)

    args = ap.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
