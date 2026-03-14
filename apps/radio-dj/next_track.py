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
import time
import re
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

GRAPH_FILE = "/data/radio-track-graph.json"
STATE_FILE = "/state/radio-selector-state.json"
QUEUE_FILE = "/state/radio-llm-queue.json"
MUSIC_DIR = "/data/music"
SCHEDULE_FILE = "/config/schedule.json"
DJ_OVERRIDE_FILE = "/data/music/dj-override.json"

# OpenAI API direct (avoids gateway defaulting to Sonnet)
GATEWAY_URL = "https://api.openai.com/v1/chat/completions"
GATEWAY_TOKEN = os.environ.get("OPENAI_API_KEY", "")
LLM_MODEL = "gpt-4o-mini"
LLM_TIMEOUT = 90  # seconds

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
                if track_name_lower in line.lower():
                    ts_str = line.strip().split("  ")[0]
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


def get_audience():
    """Determine who's listening based on schedule + time of day."""
    try:
        with open(SCHEDULE_FILE) as f:
            schedule = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"abi_home": False, "james_home": True}

    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    hour = now.hour

    # Schedule file format: {"schedule": [{"date": "...", "abi": {"status": "..."}}]}
    abi_status = "working"  # default weekday assumption
    schedule_list = schedule.get("schedule", [])
    if isinstance(schedule_list, list):
        for day in schedule_list:
            if day.get("date") == today:
                abi_status = day.get("abi", {}).get("status", "working")
                break
    else:
        # Legacy format: {"abi": {"2026-03-02": "not-working"}}
        abi_status = schedule.get("abi", {}).get(today, "working")

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
    """Load the pre-computed track graph."""
    try:
        with open(GRAPH_FILE) as f:
            return json.load(f)
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


# ─── LLM queue refill ───

SYSTEM_PROMPT = """You are a radio DJ AI selecting the next 25 tracks for a continuous radio stream.

Rules:
- Each track MUST appear in the previous track's "follow" list (these are beat-compatible transitions)
- No artist more than twice in your 25 picks
- Never pick a track from lastPlayed
- Consider: time of day, who's home, day of week
- If abiHome is true: lean toward shared electronic/dance, avoid obscure deep cuts
- If only jamesHome: trip hop, French house, big beat, downtempo are preferred
- Evening/night: lower energy, more atmospheric
- Morning/afternoon: building energy
- If seed is set, work that artist's tracks in within the first 5 picks
- DJ "arthur" = eclectic daytime, DJ "cara" = evening/weekend vibes

Output ONLY a JSON array of 25 track IDs. No explanation. Example: [102, 45, 67, ...]
Start from the last track in lastPlayed."""


def build_llm_context(graph, state):
    """Build the context object for the LLM."""
    now = datetime.now()
    audience = get_audience()

    # Map recent track paths to IDs
    path_to_id = {}
    for tid, path in graph.get("pathIndex", {}).items():
        path_to_id[path] = int(tid)

    last_played = []
    for path in state["recent_tracks"][-20:]:
        tid = path_to_id.get(path)
        if tid:
            last_played.append(tid)

    # Get recent artists
    recent_artists = list(set(state["recent_artists"][-10:]))

    context = {
        "now": now.strftime("%A %Y-%m-%d %H:%M GMT"),
        "day": now.strftime("%A").lower(),
        "abiHome": audience["abi_home"],
        "jamesHome": audience["james_home"],
        "currentDj": get_current_dj(),
        "lastPlayed": last_played[-20:],
        "recentArtists": recent_artists,
        "seed": state.get("seed"),
    }

    return context


def build_user_message(graph, context):
    """Build the user message with track graph subset and context.
    
    Keeps the payload compact by limiting to tracks reachable in 2 hops
    from the starting track, capped at ~300 tracks.
    """
    last_played = context.get("lastPlayed", [])
    seed_id = last_played[-1] if last_played else None

    tracks = graph["tracks"]
    follow = graph["follow"]

    # BFS from seed: collect tracks reachable in 3 hops
    relevant_ids = set()
    if seed_id:
        seed_str = str(seed_id)
        frontier = {seed_str}
        for hop in range(3):
            next_frontier = set()
            for tid in frontier:
                relevant_ids.add(tid)
                for fid in follow.get(tid, []):
                    fid_str = str(fid)
                    if fid_str not in relevant_ids:
                        next_frontier.add(fid_str)
                        relevant_ids.add(fid_str)
            frontier = next_frontier

    # If no seed or too few, start from random tracks
    if len(relevant_ids) < 50:
        all_ids = list(tracks.keys())
        random.shuffle(all_ids)
        for tid in all_ids[:100]:
            relevant_ids.add(tid)
            for fid in follow.get(tid, []):
                relevant_ids.add(str(fid))

    # Build COMPACT subset: only track name + follow list (no genre/bpm/energy per track)
    # This keeps the payload small enough for a free LLM
    compact_tracks = {}
    subset_follow = {}
    for tid in relevant_ids:
        if tid in tracks:
            compact_tracks[tid] = tracks[tid]["n"]  # Just the name
        if tid in follow:
            subset_follow[tid] = follow[tid]

    msg = f"""Context: {json.dumps(context)}

Tracks (id: "Artist - Title"):
{json.dumps(compact_tracks, separators=(',', ':'))}

Follow lists (each track's beat-compatible next tracks):
{json.dumps(subset_follow, separators=(',', ':'))}

Pick 25 tracks. Start from track {seed_id if seed_id else 'any track'}."""

    return msg


def call_llm(graph, state):
    """Call the LLM to get a track queue."""
    context = build_llm_context(graph, state)
    user_msg = build_user_message(graph, context)

    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        "max_tokens": 512,
        "temperature": 0.9,
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        GATEWAY_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {GATEWAY_TOKEN}",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        content = result["choices"][0]["message"]["content"].strip()
        print(f"LLM response: {content[:200]}", file=sys.stderr)

        # Extract JSON array from response (may have markdown fences or extra text)
        # Strip markdown code fences first
        content = re.sub(r'```(?:json)?\s*', '', content).strip()
        match = re.search(r'\[[\d\s,]+\]', content)
        if not match:
            print("LLM response didn't contain a JSON array", file=sys.stderr)
            return None

        track_ids = json.loads(match.group())
        return track_ids

    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError,
            KeyError, TimeoutError, OSError) as e:
        print(f"LLM call failed: {e}", file=sys.stderr)
        return None


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
    """Refill the track queue using LLM or fallback."""
    print("Refilling queue...", file=sys.stderr)

    # Try LLM
    track_ids = call_llm(graph, state)
    if track_ids:
        valid = validate_queue(track_ids, graph, state)
        if valid:
            # Clear seed after use
            if state.get("seed"):
                state["seed"] = None
                save_state(state)
            return valid

    # Fallback: random walk on graph
    print("Using fallback random walk", file=sys.stderr)
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
            # Accept any non-recent candidate
            for cid in candidates:
                if cid not in recent_ids and cid not in result:
                    result.append(cid)
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
        except:
            pass
    return None


def main():
    graph = load_graph()

    if not graph:
        # Fallback: random from music dir
        print("No graph available, falling back to random", file=sys.stderr)
        mp3s = glob.glob(os.path.join(MUSIC_DIR, "*.mp3"))
        if mp3s:
            print(random.choice(mp3s))
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
            if mp3s:
                print(random.choice(mp3s))
            return

    if not queue:
        mp3s = glob.glob(os.path.join(MUSIC_DIR, "*.mp3"))
        if mp3s:
            print(random.choice(mp3s))
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
        if mp3s:
            print(random.choice(mp3s))
        return

    track_id_str = str(track_id)
    path = graph["pathIndex"].get(track_id_str, "")

    if not path or not os.path.exists(path):
        print(f"Track {track_id} path not found: {path}", file=sys.stderr)
        # Try next in queue recursively
        if queue:
            save_queue(queue)
            return main()
        mp3s = glob.glob(os.path.join(MUSIC_DIR, "*.mp3"))
        if mp3s:
            print(random.choice(mp3s))
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

    # Output path for Liquidsoap
    print(path)


if __name__ == "__main__":
    main()
