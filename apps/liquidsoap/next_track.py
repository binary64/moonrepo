#!/usr/bin/env python3
"""
Arthur Radio — LLM-Powered Track Selector
Called by Liquidsoap via request.dynamic. Prints one file path to stdout.

Selection strategy:
1. Maintain a queue of ~25 tracks pre-selected by an LLM
2. LLM picks beat-compatible sequences from a pre-computed track graph
3. Queue refills when < 3 tracks remain (~once per hour)
4. Fallback: random walk on the graph if LLM fails
"""

import json
import glob
import os
import sys
import random
import re
import subprocess  # nosec B404 - airs pending DJ clips via dj-commentary.sh (fixed argv)
from datetime import datetime

GRAPH_FILE = "/data/radio-track-graph.json"
STATE_FILE = "/state/radio-selector-state.json"
QUEUE_FILE = "/state/radio-llm-queue.json"
MUSIC_DIR = "/data/music"
SCHEDULE_FILE = "/config/schedule.json"
DJ_OVERRIDE_FILE = "/data/music/dj-override.json"
# Slow-loop context: written every ~15 min by a Hermes agent cron job with full
# tools+skills (live HA presence, taste profiles, mood). Fast loop reads it here.
DJ_CONTEXT_FILE = "/data/music/dj-context.json"

# NOTE: per-track LLM selection has been REMOVED. The playlist is set out of
# band by the Hermes/Opus director (radio_set_playlist.py). This script is now
# a pure queue-popper + random-walk fallback. No OpenAI/gateway call remains.

# Tuning
TRACK_COOLDOWN = 100
ARTIST_COOLDOWN = 10
QUEUE_REFILL_THRESHOLD = 3
QUEUE_SIZE = 25

INDEX_DIR = "/data/music-index"
TIERS_FILE = "/data/music/track-tiers.json"
PLAY_HISTORY_LOG = "/data/music/play-history.log"

# Cooldown periods in days
TIER_COOLDOWNS = {
    "blacklist": float("inf"),  # never
    "ultra_rare": 365,          # once a year
    "rare": 30,                 # once a month
}

def load_tiers():
    """Load track tier assignments. Returns dict: {track_name_lower: tier}"""
    try:
        with open(TIERS_FILE) as f:
            data = json.load(f)
        result = {}
        for tier in ("blacklist", "ultra_rare", "rare"):
            for name in data.get(tier, []):
                result[name.lower()] = tier
        return result
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def get_last_played(track_name_lower):
    """Get last played timestamp for a track from play history log."""
    try:
        last = None
        with open(PLAY_HISTORY_LOG) as f:
            for line in f:
                # Format: "2026-02-20T17:43:52+00:00  Track Name  (filename.mp3)"
                parts = line.strip().split("  ")
                if len(parts) < 2:
                    continue
                log_track_name = parts[1].lower()
                if log_track_name != track_name_lower:
                    continue
                ts_str = parts[0]
                try:
                    ts = datetime.fromisoformat(ts_str)
                    if last is None or ts > last:
                        last = ts
                except ValueError:
                    continue
        return last
    except FileNotFoundError:
        return None

def is_christmas_track(track_name):
    """Check if a track is tagged as Christmas in its music index."""
    index_path = os.path.join(INDEX_DIR, f"{track_name}.json")
    try:
        with open(index_path) as f:
            return json.load(f).get("christmas", False)
    except (FileNotFoundError, json.JSONDecodeError):
        return False


def is_track_allowed(track_name, tiers):
    """Check if a track is allowed to play based on its tier and cooldown."""
    name_lower = track_name.lower()

    # Christmas tracks only play in December
    if is_christmas_track(track_name) and datetime.now().month != 12:
        return False

    tier = tiers.get(name_lower)
    if tier is None:
        return True  # no tier = normal rotation
    if tier == "blacklist":
        return False
    cooldown_days = TIER_COOLDOWNS.get(tier, 0)
    last_played = get_last_played(name_lower)
    if last_played is None:
        return True  # never played = allowed
    now = datetime.now(last_played.tzinfo) if last_played.tzinfo else datetime.now()
    days_since = (now - last_played).total_seconds() / 86400
    return days_since >= cooldown_days

# ─── Audience detection (carried over from original) ───

ABI_HOME_HOURS = {"work_leave": 7, "work_return": 18}


def load_dj_context():
    """Load the slow-loop DJ context if present and fresh.

    The slow loop (Hermes agent cron, ~every 15 min) writes:
      {"generated_at": ISO8601, "ttl_minutes": 30,
       "abi_home": bool, "james_home": bool,
       "steer_genres": [...], "avoid_genres": [...],
       "mood": str, "note": str}
    Returns the dict if fresh, else None (so we fall back to schedule).
    """
    try:
        with open(DJ_CONTEXT_FILE) as f:
            ctx = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
    try:
        gen = datetime.fromisoformat(ctx["generated_at"].replace("Z", "+00:00"))
        if gen.tzinfo is None:
            # Reject naive timestamps: freshness math would fall back to local
            # time and could mis-judge staleness across timezone offsets.
            print("dj-context generated_at missing timezone, ignoring",
                  file=sys.stderr)
            return None
        ttl = float(ctx.get("ttl_minutes", 30))
        age_min = (datetime.now(gen.tzinfo) - gen).total_seconds() / 60.0
        if age_min > ttl:
            print(f"dj-context stale ({age_min:.0f}m > {ttl:.0f}m), ignoring",
                  file=sys.stderr)
            return None
    except (KeyError, ValueError, TypeError) as e:
        print(f"dj-context unparseable timestamp: {e}", file=sys.stderr)
        return None
    return ctx


def get_audience():
    """Determine who's listening.

    Prefers the slow-loop dj-context (live HA presence). Falls back to the
    schedule file + time-of-day heuristics if context is missing or stale.
    """
    ctx = load_dj_context()
    if ctx is not None and "abi_home" in ctx and "james_home" in ctx:
        return {"abi_home": bool(ctx["abi_home"]),
                "james_home": bool(ctx["james_home"])}
    return _audience_from_schedule()


def _parse_abi_status(schedule, today):
    """Pull Abi's working status for `today` from any schedule file format."""
    schedule_list = schedule.get("schedule", [])
    if not isinstance(schedule_list, list):
        # Legacy format: {"abi": {"2026-03-02": "not-working"}}
        return schedule.get("abi", {}).get(today, "working")
    for day in schedule_list:
        if day.get("date") == today:
            abi_val = day.get("abi", "working")
            if isinstance(abi_val, dict):
                return abi_val.get("status", "working")
            return str(abi_val)
    return "working"  # default weekday assumption


def _audience_from_schedule():
    """Heuristic presence from schedule.json + time of day (fallback path)."""
    try:
        with open(SCHEDULE_FILE) as f:
            schedule = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"abi_home": False, "james_home": True}

    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    hour = now.hour
    abi_status = _parse_abi_status(schedule, today)
    is_weekend = now.weekday() >= 5

    if abi_status == "not-working" or is_weekend:
        abi_home = True
    else:
        abi_home = hour < ABI_HOME_HOURS["work_leave"] or hour >= ABI_HOME_HOURS["work_return"]

    return {"abi_home": abi_home, "james_home": True}


def get_current_dj():
    """Determine current DJ from override file or time-based logic."""
    try:
        with open(DJ_OVERRIDE_FILE) as f:
            override = json.load(f)
            if override.get("dj"):
                return override["dj"]
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    # Time-based: check if Abi is home (DJ Cara) or not (DJ Arthur)
    audience = get_audience()
    if audience["abi_home"]:
        return "cara"
    return "arthur"


# ─── State management ───

def load_state():
    """Load selector state."""
    default = {
        "recent_tracks": [],
        "recent_artists": [],
        "session_position": 0,
        "last_bpm": None,
        "last_genres": [],
        "last_energy": None,
        "seed": None,
    }
    try:
        with open(STATE_FILE) as f:
            state = json.load(f)
            for k, v in default.items():
                if k not in state:
                    state[k] = v
            return state
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_state(state):
    """Persist selector state."""
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


def emit_random_fallback(mp3s, state=None):
    """Pick a random file for any fallback path, but RESPECT the track cooldown
    and RECORD the pick in state.

    Historically every fallback branch did a bare `random.choice(mp3s)` that
    (a) ignored recent_tracks — so a song that just played could be re-picked
    moments later (observed gap=2 repeats in play-history) — and (b) never
    appended the chosen path to recent_tracks, so the cooldown set never learned
    about fallback plays, compounding the problem. This centralises both fixes:
    filter out the last TRACK_COOLDOWN paths, then persist the pick.
    """
    if not mp3s:
        return False
    if state is None:
        state = load_state()
    recent = set(state.get("recent_tracks", [])[-TRACK_COOLDOWN:])
    fresh = [m for m in mp3s if m not in recent]
    pool = fresh if fresh else mp3s  # if everything's on cooldown, allow repeats
    chosen = random.choice(pool)
    artist = get_artist_from_name(os.path.splitext(os.path.basename(chosen))[0])
    state["recent_tracks"].append(chosen)
    state["recent_tracks"] = state["recent_tracks"][-TRACK_COOLDOWN:]
    state["recent_artists"].append(artist)
    state["recent_artists"] = state["recent_artists"][-ARTIST_COOLDOWN:]
    save_state(state)
    print(chosen)
    return True


def load_queue():
    """Load the LLM-generated track queue."""
    try:
        with open(QUEUE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_queue(queue):
    """Persist the track queue."""
    with open(QUEUE_FILE, "w") as f:
        json.dump(queue, f)


# ─── Graph loading ───

def load_graph():
    """Load the pre-computed track graph and rewrite paths to container mounts."""
    try:
        with open(GRAPH_FILE) as f:
            graph = json.load(f)

        # Rewrite host paths to container paths
        HOST_PREFIX = "/home/user/clawd/data/music/"
        CONTAINER_PREFIX = MUSIC_DIR + "/"
        if "pathIndex" in graph:
            for tid, path in graph["pathIndex"].items():
                if path.startswith(HOST_PREFIX):
                    graph["pathIndex"][tid] = CONTAINER_PREFIX + path[len(HOST_PREFIX):]

        return graph
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Error loading graph: {e}", file=sys.stderr)
        return None


# ─── Artist extraction ───

def get_artist_from_name(name):
    """Extract primary artist from 'Artist - Title' format."""
    if " - " in name:
        artist_part = name.split(" - ")[0].strip().strip('"')
    else:
        artist_part = name
    # Split on common separators to get primary artist
    for sep in [" & ", ", ", " feat.", " feat ", " ft.", " ft ", " x ", " X ", " vs ", " VS "]:
        if sep in artist_part:
            artist_part = artist_part.split(sep)[0].strip()
            break
    return artist_part


def get_all_artists(name):
    """Extract ALL artists from a track name (for cooldown matching)."""
    if " - " in name:
        artist_part = name.split(" - ")[0].strip().strip('"')
    else:
        artist_part = name
    artists = set()
    # Split on all separators
    parts = re.split(r'\s*[&,]\s*|\s+(?:feat\.?|ft\.?|x|vs\.?)\s+', artist_part, flags=re.IGNORECASE)
    for p in parts:
        p = p.strip().strip('"')
        if p:
            artists.add(p)
    return artists


# ─── DJ-drops staging (set by the Opus director via radio_set_playlist.py) ───

DROPS_SCHEDULE_FILE = "/state/dj-drops-schedule.json"
# position -> the pending-clip file next_track.py already airs at that moment
DROP_POSITION_FILES = {
    "start": "/state/dj-pending-start-of-song.json",
    "end": "/state/dj-pending-end-of-song.json",
    "seam": "/state/dj-pending-seam.json",
}


def stage_drop_for(track_id):
    """If the director staged a DJ drop keyed to this track, write it into the
    matching pending-clip file so the existing air_pending_clip() machinery
    plays it at the right seam. Joins multi-utterance drops into one text blob
    (dj-commentary.sh renders sequentially). Best-effort; never blocks music."""
    try:
        with open(DROPS_SCHEDULE_FILE) as f:
            sched = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return
    drop = sched.get(str(track_id))
    if not isinstance(drop, dict):
        return
    utt = drop.get("utterances", [])
    if not isinstance(utt, list):
        return
    text = " ".join(
        u.get("text", "").strip()
        for u in utt
        if isinstance(u, dict) and u.get("text")
    )
    if not text:
        return
    pos = drop.get("position", "end")
    pending = DROP_POSITION_FILES.get(pos, DROP_POSITION_FILES["end"])
    rec = {"dj": drop.get("dj", "arthur"), "text": text, "duck": 0.15}
    try:
        with open(pending, "w") as f:
            json.dump(rec, f)
        # Consume it from the schedule so it airs once.
        del sched[str(track_id)]
        with open(DROPS_SCHEDULE_FILE, "w") as f:
            json.dump(sched, f)
        print(f"DROP: staged {pos} clip for track {track_id} (dj={rec['dj']})",
              file=sys.stderr)
    except OSError as e:
        print(f"DROP: failed to stage: {e}", file=sys.stderr)

def validate_queue(track_ids, graph, state):
    """Validate and filter the LLM's track picks."""
    tracks = graph["tracks"]
    follow = graph["follow"]

    # Build set of recent track IDs for filtering
    path_to_id = {}
    for tid, path in graph.get("pathIndex", {}).items():
        path_to_id[path] = int(tid)

    recent_ids = set()
    for path in state["recent_tracks"]:
        tid = path_to_id.get(path)
        if tid:
            recent_ids.add(tid)

    valid = []
    prev_id = None

    # Get the last played track as starting point
    last_played_ids = []
    for path in state["recent_tracks"][-5:]:
        tid = path_to_id.get(path)
        if tid:
            last_played_ids.append(tid)

    if last_played_ids:
        prev_id = last_played_ids[-1]

    for tid in track_ids:
        tid_str = str(tid)

        # Must exist
        if tid_str not in tracks:
            print(f"  Skip {tid}: not in tracks", file=sys.stderr)
            continue

        # Must not be recently played
        if tid in recent_ids:
            print(f"  Skip {tid}: recently played", file=sys.stderr)
            continue

        # Must follow from previous (if we have a previous)
        if prev_id is not None:
            follow_list = follow.get(str(prev_id), [])
            if tid not in follow_list:
                print(f"  Skip {tid}: not in follow list of {prev_id}", file=sys.stderr)
                continue

        valid.append(tid)
        prev_id = tid

    print(f"Validated {len(valid)}/{len(track_ids)} tracks from LLM", file=sys.stderr)
    return valid


def refill_queue(graph, state):
    """Refill the track queue.

    The queue is normally set OUT OF BAND by the Hermes/Opus director
    (radio_set_playlist.py writes /state/radio-llm-queue.json directly). This
    function is now ONLY the resilience fallback: when the director queue has
    drained and no fresh show has been set, keep music flowing with a
    beat-matched random walk. No per-track LLM call happens here any more —
    that path (and its model cost + mismatched-prompt bug) is gone.
    """
    print("Queue empty, no director show staged — random-walk fallback",
          file=sys.stderr)
    return fallback_walk(graph, state)


def fallback_walk(graph, state, count=15):
    """Random walk on the graph as fallback."""
    tracks = graph["tracks"]
    follow = graph["follow"]
    path_to_id = {}
    for tid, path in graph.get("pathIndex", {}).items():
        path_to_id[path] = int(tid)

    recent_ids = set()
    for path in state["recent_tracks"]:
        tid = path_to_id.get(path)
        if tid:
            recent_ids.add(tid)

    # Start from last played or random
    current = None
    for path in reversed(state["recent_tracks"]):
        tid = path_to_id.get(path)
        if tid and str(tid) in follow:
            current = tid
            break

    if current is None:
        all_ids = [int(k) for k in tracks.keys()]
        current = random.choice(all_ids) if all_ids else None

    if current is None:
        return []

    result = []
    recent_artists = set(state["recent_artists"][-ARTIST_COOLDOWN:])
    artist_counts = {}

    for _ in range(count * 3):  # Try more times to fill count
        if len(result) >= count:
            break

        candidates = follow.get(str(current), [])
        if not candidates:
            # Dead end — jump to random track
            all_ids = [int(k) for k in tracks.keys()]
            current = random.choice(all_ids)
            continue

        random.shuffle(candidates)
        # Artist of the track we're branching FROM — used to block the most
        # audible violation (back-to-back same artist) in the relaxed fallback.
        prev_artist = get_artist_from_name(tracks.get(str(current), {}).get("n", ""))
        picked = False
        for cid in candidates:
            cid_str = str(cid)
            if cid in recent_ids:
                continue
            if cid in result:
                continue

            # Artist check — skip if in recent cooldown OR already 2+ in this queue
            t = tracks.get(cid_str, {})
            artist = get_artist_from_name(t.get("n", ""))
            if artist in recent_artists:
                continue
            if artist_counts.get(artist, 0) >= 2:
                continue

            result.append(cid)
            artist_counts[artist] = artist_counts.get(artist, 0) + 1
            current = cid
            picked = True
            break

        if not picked:
            # Relaxed fallback: the strict artist-cooldown set was too tight to
            # fill from this neighbourhood. Still refuse the worst case — playing
            # the SAME artist back-to-back — and keep artist_counts honest so the
            # 2+-in-queue guard isn't silently bypassed. Only fully relax (any
            # non-recent track) if every candidate would repeat prev_artist.
            for cid in candidates:
                if cid in recent_ids or cid in result:
                    continue
                artist = get_artist_from_name(tracks.get(str(cid), {}).get("n", ""))
                if artist == prev_artist:
                    continue
                if artist_counts.get(artist, 0) >= 2:
                    continue
                result.append(cid)
                artist_counts[artist] = artist_counts.get(artist, 0) + 1
                current = cid
                picked = True
                break

        if not picked:
            # Last resort: any non-recent candidate (even same artist) so the
            # queue still fills; record the artist so counts stay consistent.
            for cid in candidates:
                if cid not in recent_ids and cid not in result:
                    artist = get_artist_from_name(tracks.get(str(cid), {}).get("n", ""))
                    result.append(cid)
                    artist_counts[artist] = artist_counts.get(artist, 0) + 1
                    current = cid
                    picked = True
                    break

        if not picked:
            current = random.choice(candidates)

    return result


# ─── Legacy index loading (fallback if graph doesn't exist) ───

def load_index():
    """Load all track metadata from JSON sidecars (legacy fallback)."""
    tracks = []
    for f in glob.glob(os.path.join(INDEX_DIR, "*.json")):
        if os.path.basename(f).startswith("_"):
            continue
        try:
            with open(f) as fh:
                d = json.load(fh)
                path = d.get("_path", "")
                if path and os.path.exists(path):
                    tracks.append(d)
        except (json.JSONDecodeError, OSError):
            continue
    return tracks


# ─── Main ───

REQUEST_FILE = "/state/radio-request.json"

# ─── Pending DJ-commentary clips (written by radio_tick.py speak) ────────────
# These are aired at the corresponding moment of THIS track change so the DJ's
# timed commentary lands where intended. Each record is JSON:
#   {"dj": "...", "text": "...", "duck": 0.15, "ts": ...}
# We air via /radio/dj-commentary.sh (the dj-brain helper, present in that
# image) passing the persisted duck level as the 4th positional arg.
PENDING_END_FILE = "/state/dj-pending-end-of-song.json"     # over outro/tail
PENDING_START_FILE = "/state/dj-pending-start-of-song.json"  # over the new intro
PENDING_SEAM_FILE = "/state/dj-pending-seam.json"           # during the crossfade seam
DJ_COMMENTARY_SH = "/radio/dj-commentary.sh"


def air_pending_clip(pending_file):
    """If `pending_file` exists, air it via dj-commentary.sh then remove it.
    Mirrors the record schema written by radio_tick.py cmd_speak; the duck
    level is passed as the 4th positional arg (default 0.15 if absent)."""
    try:
        if not os.path.exists(pending_file):
            return
        with open(pending_file) as f:
            rec = json.load(f)
        os.remove(pending_file)
    except (OSError, json.JSONDecodeError) as e:
        print(f"PENDING: error reading {pending_file}: {e}", file=sys.stderr)
        return
    dj = str(rec.get("dj", "arthur"))
    text = str(rec.get("text", "")).strip()
    duck = str(rec.get("duck", "0.15"))
    if not text:
        return
    if not os.path.exists(DJ_COMMENTARY_SH):
        print(f"PENDING: {DJ_COMMENTARY_SH} not found, cannot air clip", file=sys.stderr)
        return
    try:
        # Fire-and-forget so track selection is never blocked by TTS render.
        subprocess.Popen(  # nosec B603 - fixed argv, no shell, values from our own record
            [DJ_COMMENTARY_SH, dj, "api-call", text, duck],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"PENDING: aired {os.path.basename(pending_file)} (dj={dj} duck={duck})",
              file=sys.stderr)
    except OSError as e:
        print(f"PENDING: failed to air clip: {e}", file=sys.stderr)


def check_request():
    """Check if there's a pending song request. Returns path or None."""
    try:
        if os.path.exists(REQUEST_FILE):
            with open(REQUEST_FILE) as f:
                data = json.load(f)
            os.remove(REQUEST_FILE)
            path = data.get("path", "")
            if path and os.path.exists(path):
                print(f"REQUEST: Playing requested track: {os.path.basename(path)}", file=sys.stderr)
                return path
            else:
                print(f"REQUEST: File not found: {path}", file=sys.stderr)
    except Exception as e:
        print(f"REQUEST: Error reading request file: {e}", file=sys.stderr)
        try:
            os.remove(REQUEST_FILE)
        except OSError:
            pass
    return None


def main():
    graph = load_graph()

    # ─── Air timed DJ commentary for THIS track change ───
    # next_track.py runs once per track change. The ENDING track's back-announce
    # (end) and the crossfade-seam clip air now, as the cross begins.
    air_pending_clip(PENDING_END_FILE)
    air_pending_clip(PENDING_SEAM_FILE)

    if not graph:
        # Fallback: random from music dir
        print("No graph available, falling back to random", file=sys.stderr)
        mp3s = glob.glob(os.path.join(MUSIC_DIR, "*.mp3"))
        emit_random_fallback(mp3s)
        return

    state = load_state()

    # Check for song request FIRST — overrides queue
    requested = check_request()
    if requested:
        # Update state so next track is based off this one
        state["recent_tracks"].append(requested)
        state["recent_tracks"] = state["recent_tracks"][-TRACK_COOLDOWN:]
        artist = get_artist_from_name(os.path.splitext(os.path.basename(requested))[0])
        state["recent_artists"].append(artist)
        state["recent_artists"] = state["recent_artists"][-ARTIST_COOLDOWN:]
        # Flush the queue so next picks are based off the requested track
        save_queue([])
        save_state(state)
        print(requested)
        return

    queue = load_queue()

    # Check if queue needs refilling
    if len(queue) < QUEUE_REFILL_THRESHOLD:
        new_queue = refill_queue(graph, state)
        if new_queue:
            queue = new_queue
            save_queue(queue)
        elif not queue:
            # Total fallback: random file
            mp3s = glob.glob(os.path.join(MUSIC_DIR, "*.mp3"))
            emit_random_fallback(mp3s, state)
            return

    if not queue:
        mp3s = glob.glob(os.path.join(MUSIC_DIR, "*.mp3"))
        emit_random_fallback(mp3s, state)
        return

    # Pop next track from queue, skipping blacklisted/cooldown tracks AND recent artists
    tiers = load_tiers()
    recent_artists = set(state.get("recent_artists", [])[-ARTIST_COOLDOWN:])
    track_id = None
    skipped_for_artist = []
    while queue:
        candidate = queue.pop(0)
        candidate_str = str(candidate)
        candidate_path = graph["pathIndex"].get(candidate_str, "")
        candidate_name = os.path.splitext(os.path.basename(candidate_path))[0] if candidate_path else ""
        if not is_track_allowed(candidate_name, tiers):
            tier = tiers.get(candidate_name.lower(), "unknown")
            print(f"Skipping ({tier}): {candidate_name}", file=sys.stderr)
            continue
        # Enforce artist cooldown — no back-to-back same artist (checks all artists in collabs)
        candidate_artists = get_all_artists(candidate_name)
        overlap = candidate_artists & recent_artists
        if overlap:
            print(f"Skipping (artist cooldown): {candidate_name} [{', '.join(overlap)}]", file=sys.stderr)
            skipped_for_artist.append(candidate)
            continue
        track_id = candidate
        break
    # Re-add artist-skipped tracks to end of queue (they'll play later)
    queue.extend(skipped_for_artist)
    save_queue(queue)

    if track_id is None:
        mp3s = [m for m in glob.glob(os.path.join(MUSIC_DIR, "*.mp3"))
                if is_track_allowed(os.path.splitext(os.path.basename(m))[0], tiers)]
        emit_random_fallback(mp3s, state)
        return

    track_id_str = str(track_id)
    path = graph["pathIndex"].get(track_id_str, "")

    if not path or not os.path.exists(path):
        print(f"Track {track_id} path not found: {path}", file=sys.stderr)
        # Try next track in queue (loop instead of recursion)
        while queue:
            next_id = queue.pop(0)
            next_id_str = str(next_id)
            next_path = graph["pathIndex"].get(next_id_str, "")
            if next_path and os.path.exists(next_path):
                track_id = next_id
                track_id_str = next_id_str
                path = next_path
                save_queue(queue)
                break
            print(f"Track {next_id} path not found: {next_path}", file=sys.stderr)
        else:
            save_queue(queue)
            mp3s = glob.glob(os.path.join(MUSIC_DIR, "*.mp3"))
            emit_random_fallback(mp3s, state)
            return

    # Update state
    track_info = graph["tracks"].get(track_id_str, {})
    artist = get_artist_from_name(track_info.get("n", ""))

    state["recent_tracks"].append(path)
    state["recent_tracks"] = state["recent_tracks"][-TRACK_COOLDOWN:]

    state["recent_artists"].append(artist)
    state["recent_artists"] = state["recent_artists"][-ARTIST_COOLDOWN:]

    state["last_bpm"] = track_info.get("bpm") or state["last_bpm"]
    state["last_genres"] = track_info.get("g", "").split(", ") if track_info.get("g") else state["last_genres"]
    state["last_energy"] = track_info.get("e") or state["last_energy"]
    state["session_position"] = state.get("session_position", 0) + 1

    save_state(state)

    # If the Opus director staged a DJ drop for this track, stage it into the
    # matching pending-clip file so air_pending_clip() plays it at the seam.
    stage_drop_for(track_id)

    # The new track is chosen and about to begin — air any "start" clip so it
    # lands over the intro of this new track (front-announce).
    air_pending_clip(PENDING_START_FILE)

    # Output path for Liquidsoap
    print(path)


if __name__ == "__main__":
    main()
