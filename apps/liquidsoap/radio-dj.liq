#!/usr/bin/liquidsoap

# Arthur Radio — BPM-Aware DJ Transitions (Liquidsoap microservice)
# Uses BPM tags from bpm-tools for beat-aligned crossfades
# TTS injection via request queue with music ducking
# Icecast host configured via ICECAST_HOST env var

settings.server.telnet.set(true)
settings.server.telnet.port.set(1234)
# Binds to 0.0.0.0 — dj-brain runs in a separate pod and pushes TTS clips
# to queue_arthur/queue_cara via telnet. announce-track.sh (same container)
# also uses telnet at 127.0.0.1:1234. The k8s Service routes dj-brain →
# liquidsoap:1234.
# TODO: add NetworkPolicy to restrict telnet port 1234 to dj-brain pod only
settings.server.telnet.bind_addr.set("0.0.0.0")

# Separate voice queues — Arthur and Cara have independent volume
queue_arthur = request.queue(id="queue_arthur")
queue_cara = request.queue(id="queue_cara")

# Smart track selector — BPM corridors, genre clustering, energy arcs
music = request.dynamic(id="music", fun () -> begin
  result = process.read("/usr/bin/python3 /radio/next_track.py")
  path = string.trim(result)
  if path != "" then
    log("SELECTOR: #{path}")
    request.create(path)
  else
    log("SELECTOR: fallback to silence")
    request.create("")
  end
end)

# Silence fallback
silence = blank(id="silence")

# Current song title ref — updated by on_metadata, read by insert_metadata
current_song = ref("Arthur Radio")

# ─── Track announcements + Icecast metadata update ───
music = source.on_metadata(music, fun (m) -> begin
  fn = m["filename"]
  bpm = m["tbpm"]
  actual_bpm = if bpm != "" then bpm else m["bpm"] end
  artist = m["artist"]
  title = m["title"]

  if fn != "" then
    log("TRACK: #{fn} (BPM: #{actual_bpm})")
    file.write(data=fn, "/state/current-track-path")
    file.write(data=actual_bpm, "/state/current-track-bpm")
    ignore(process.run("/radio/announce-track.sh &"))
  end

  # Build display title from ID3 tags, filtering bad artist tags
  display = if artist != "" and artist != "beat" and title != "" then
    "#{artist} - #{title}"
  elsif title != "" then
    title
  else
    ""
  end
  if display != "" then
    log("META UPDATE: #{display}")
    current_song := display
  end
end)

# ─── Beat-Aware Crossfade (no silence gaps) ───
def beat_crossfade(a, b)
  bpm_a_str = if a.metadata["tbpm"] != "" then a.metadata["tbpm"] else a.metadata["bpm"] end
  bpm_b_str = if b.metadata["tbpm"] != "" then b.metadata["tbpm"] else b.metadata["bpm"] end

  bpm_a = float_of_string(default=120., bpm_a_str)
  bpm_b = float_of_string(default=120., bpm_b_str)

  diff = abs(bpm_a - bpm_b)
  half_diff = abs(bpm_a - (bpm_b * 2.))
  double_diff = abs((bpm_a * 2.) - bpm_b)
  effective_diff = min(diff, min(half_diff, double_diff))

  beat_dur_a = 60. / bpm_a

  if effective_diff < 8. then
    fade_dur = beat_dur_a * 16.
    log("DJ: Smooth blend #{fade_dur}s (#{bpm_a} → #{bpm_b} BPM, diff: #{effective_diff})")
    add(normalize=false, [
      fade.out(type="sin", duration=fade_dur, a.source),
      fade.in(type="sin", duration=fade_dur * 0.75, b.source)
    ])
  elsif effective_diff < 20. then
    fade_dur = beat_dur_a * 8.
    log("DJ: Crossfade #{fade_dur}s (#{bpm_a} → #{bpm_b} BPM, diff: #{effective_diff})")
    add(normalize=false, [
      fade.out(type="sin", duration=fade_dur, a.source),
      fade.in(type="sin", duration=fade_dur * 0.75, b.source)
    ])
  else
    fade_out_dur = beat_dur_a * 4.
    beat_dur_b = 60. / bpm_b
    fade_in_dur = beat_dur_b * 4.
    log("DJ: Beat-cut crossfade out=#{fade_out_dur}s in=#{fade_in_dur}s (#{bpm_a} → #{bpm_b} BPM, diff: #{effective_diff})")
    add(normalize=false, [
      fade.out(type="sin", duration=fade_out_dur, a.source),
      fade.in(type="sin", duration=fade_in_dur, b.source)
    ])
  end
end

# Apply beat-aware transitions
music_crossed = cross(duration=8., minimum=4., beat_crossfade,
  fallback(track_sensitive=false, [music, silence]))

# ReplayGain normalization on music only (→ -20 LUFS) then -3dB for headroom
music_normalized = amplify(1., override="replay_gain", music_crossed)
music_quiet = amplify(0.7, music_normalized)  # -3dB = 10^(-3/20) ≈ 0.7 → -23 LUFS

# ─── TTS Voice Boost (per-DJ) ───
arthur_boosted = amplify(3.0, queue_arthur)
cara_boosted = amplify(2.5, queue_cara)

# Merge both voice queues
voices = add(normalize=false, [arthur_boosted, cara_boosted])

# Music ducks when DJ speaks — fast fade (0.3s) so ducking kicks in immediately
radio = smooth_add(
  duration=0.3,
  normal=music_quiet,
  special=voices,
  p=0.15
)

# ─── Re-inject metadata lost by cross/smooth_add ───
radio = insert_metadata(id="Arthur_Radio_meta", radio)
last_pushed = ref("")

# Register a server command to push metadata updates
server.register("meta.update", usage="meta.update <title>", description="Update stream metadata", fun (s) -> begin
  radio.insert_metadata([("title", s), ("song", s)])
  "OK: #{s}"
end)

# Song request — skip current track to trigger crossfade into requested song
server.register("request.song", usage="request.song <path>", description="Request a song (crossfades immediately)", fun (path) -> begin
  # Escape backslashes and double-quotes to produce valid JSON
  escaped = string.replace(pattern="\\\\", fun (_) -> "\\\\\\\\", path)
  escaped = string.replace(pattern="\"", fun (_) -> "\\\\\"", escaped)
  file.write(data='{"path": "' ^ escaped ^ '"}', "/state/radio-request.json")
  source.skip(music)
  "OK: Requesting #{path}"
end)

# Output to Icecast
output.icecast(
  %mp3(bitrate=192),
  host=environment.get(default="icecast.radio-dj.svc.cluster.local", "ICECAST_HOST"),
  port=8100,
  password=environment.get(default="changeme", "ICECAST_SOURCE_PASSWORD"),
  mount="/stream",
  name="Arthur Radio",
  description="Beat-Aware DJ Transitions",
  genre="Mixed",
  fallible=true,
  encoding="UTF-8",
  radio
)
