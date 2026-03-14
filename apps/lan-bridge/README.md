# LAN Bridge

Lightweight API service that runs on the NUC (master node) with `hostNetwork: true`, giving cluster nodes access to home LAN devices (Chromecast, Nest speakers, Sony Bravia TV).

## Why

Jupiter (Contabo VPS) is an RKE2 agent node but can't reach home LAN devices (192.168.1.0/24). This bridge runs on the NUC which _is_ on the home LAN, and exposes device control via a simple REST API accessible through the flannel overlay network.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/cast` | Cast media/site to Chromecast |
| POST | `/tts` | Play audio on Nest speakers |
| POST | `/tv/on` | Turn TV on |
| POST | `/tv/off` | Turn TV off |
| GET | `/tv/status` | Check TV state |
| POST | `/exec` | Run allowlisted command (catt, curl, ping, ffmpeg, ffprobe) |
| GET | `/health` | Health check |

## Auth

Set `LAN_BRIDGE_TOKEN` env var. Requests must include `Authorization: Bearer <token>`.

## Device Aliases

- `Lounge TV` → 192.168.1.90 (Chromecast)
- `All Speakers` → Nest speaker group
- `TV Portal` → 192.168.1.187
- `Sony Bravia` → 192.168.1.101

## Usage from Jupiter

```bash
curl -X POST http://lan-bridge.lan-bridge.svc:3080/cast \
  -H "Authorization: Bearer $LAN_BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"device": "Lounge TV", "url": "http://example.com/image.png"}'
```
