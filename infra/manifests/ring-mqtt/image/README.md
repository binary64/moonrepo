# ring-mqtt two-way-audio fork

Derived image: stock `tsightler/ring-mqtt:5.9.3` + a `speak` MQTT command that
plays audio out the doorbell speaker, using the two-way-audio primitives already
present in the bundled `@tsightler/ring-client-api`
(`activateCameraSpeaker()` + `transcodeReturnAudio()`).

## What it adds

A new per-camera command entity **`speak`** (HA `button` component). Publish an
audio source to its command topic:

```
ring/<location-id>/camera/<device-id>/speak/command
```

Payload is either:
- a bare URL or file path (e.g. `https://…/clip.wav`), or
- JSON: `{"audioUrl": "https://…/clip.wav", "maxSeconds": 20}`

> The entity is an HA `button` (only `button`/`switch`/etc. components get a
> command topic in `base-ring-device.js`). A bare button *press* publishes the
> default `PRESS` payload, which carries no audio source — those are ignored. To
> actually speak, publish a URL/path (or JSON) to the command topic directly.

`camera.js` acquires a fresh WebRTC signalling ticket (same endpoint as live
streaming) and dispatches a `speak` message to the livestream worker, which
opens its **own** short-lived session, activates the speaker, transcodes the
source to Opus RTP, plays it, and tears down. It runs independently of the
live/event viewer stream, with a hard ceiling (default 30s, max 60s) so a
stalled session can never wedge the worker.

> **`http(s)` sources are staged to a temp file first.** The library's
> `transcodeReturnAudio()` runs ffmpeg with `-protocol_whitelist
> pipe,udp,rtp,file,crypto` — it cannot read `http(s)`/`tcp`/`tls` directly.
> The worker therefore fetches a remote URL to a local temp file (15s timeout)
> and feeds ffmpeg the file path, cleaning the temp file up on teardown. Local
> paths / `file://` sources pass straight through.

## Files

- `Dockerfile` — `FROM tsightler/ring-mqtt:5.9.3` pinned by digest, COPYs the
  two patched files over the originals, runs `node --check` on both (build fails
  loudly if broken).
- `patched/camera.js`, `patched/camera-livestream.js` — full patched files
  (COPYed by the Dockerfile). All changes marked `two-way-audio patch (Arthur)`.
- `patches/*.patch` — unified diffs vs upstream 5.9.3, for review.

## Build & push

```bash
cd infra/manifests/ring-mqtt/image
TAG=ghcr.io/binary64/ring-mqtt:5.9.3-twoway-audio-2
docker build -t "$TAG" .
echo "$(gh auth token)" | docker login ghcr.io -u binary64 --password-stdin
docker push "$TAG"
# Package must be public (anonymous pull) — matches the other binary64 images.
```

The deployment pins the image **by digest** for immutability.

## Maintenance / upstream bumps

Pinned to upstream **5.9.3**. On a deliberate base bump:

1. Pull the new upstream files:
   `devices/camera.js`, `devices/camera-livestream.js`.
2. Re-apply the changes marked `two-way-audio patch (Arthur)`.
3. Regenerate `patches/` (`diff -u`), rebuild, bump the tag
   (`-twoway-audio-2`, …) and the digest in `../deployment.yaml`.

The image carries **no secrets** — the Ring refresh token lives in the pod's
`/data` hostPath, never in the image.
