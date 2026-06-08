#!/usr/bin/env python3
"""Wyoming-protocol TTS bridge to Hume Octave.

Exposes the in-house Arthur and Cara Hume custom voices as a first-class
Home Assistant TTS provider (``tts.hume``) via the Wyoming protocol, so both
voices appear in the HA voice dropdown and work everywhere ``tts.speak`` does
(Assist pipelines, automations, the media browser).

Flow per request:
  HA --Synthesize(text, voice)--> this server
  this server --POST /v0/tts--> Hume (returns base64 MP3)
  MP3 --ffmpeg--> raw s16le PCM @ 22050 Hz mono
  PCM --AudioStart/AudioChunk*/AudioStop--> HA

Voices are advertised in the Wyoming Info handshake; Arthur is listed first so
HA treats it as the default selection.
"""

import argparse
import asyncio
import base64
import json
import logging
import os
from functools import partial
from pathlib import Path

from wyoming.audio import AudioChunk, AudioStart, AudioStop
from wyoming.event import Event
from wyoming.info import Attribution, Describe, Info, TtsProgram, TtsVoice
from wyoming.server import AsyncEventHandler, AsyncServer
from wyoming.tts import Synthesize

_LOGGER = logging.getLogger("wyoming_hume")

# Hume custom-voice IDs (same as the radio DJ pipeline).
VOICES = {
    "Arthur": "b4e39673-3fec-446a-a965-6517b5e0ea52",
    "Cara": "7c45223a-60a8-45e5-9c74-0339f354ca81",
}
DEFAULT_VOICE = "Arthur"

# PCM output format handed to HA.
RATE = 22050
WIDTH = 2  # s16le -> 2 bytes
CHANNELS = 1
CHUNK_BYTES = 2048

HUME_TTS_URL = "https://api.hume.ai/v0/tts"


def _load_api_key() -> str:
    key = os.environ.get("HUME_API_KEY", "").strip()
    if key:
        return key
    key_file = Path.home() / ".config" / "hume" / "api_key"
    if key_file.is_file():
        return key_file.read_text(encoding="utf-8").strip()
    raise RuntimeError("HUME_API_KEY not set and ~/.config/hume/api_key not found")


def _build_info() -> Info:
    hume_attr = Attribution(name="Hume AI", url="https://hume.ai")
    voices = [
        TtsVoice(
            name=name,
            description=f"{name} (Hume Octave custom voice)",
            attribution=hume_attr,
            installed=True,
            version=None,
            languages=["en"],
        )
        # DEFAULT_VOICE first so HA selects it by default.
        for name in sorted(VOICES, key=lambda n: (n != DEFAULT_VOICE, n))
    ]
    return Info(
        tts=[
            TtsProgram(
                name="hume",
                description="Hume Octave (Arthur & Cara)",
                attribution=hume_attr,
                installed=True,
                version="1.0.0",
                voices=voices,
            )
        ]
    )


async def _hume_mp3(api_key: str, text: str, voice_id: str) -> bytes:
    """Call Hume TTS and return raw MP3 bytes (runs blocking HTTP in a thread)."""
    import urllib.error
    import urllib.request

    payload = json.dumps(
        {
            "utterances": [
                {"text": text, "voice": {"id": voice_id, "provider": "CUSTOM_VOICE"}}
            ],
            "format": {"type": "mp3"},
        }
    ).encode("utf-8")

    def _do() -> bytes:
        req = urllib.request.Request(
            HUME_TTS_URL,
            data=payload,
            headers={
                "X-Hume-Api-Key": api_key,
                "Content-Type": "application/json",
                # Hume sits behind Cloudflare, which 403s (error 1010) the default
                # urllib User-Agent. Present a normal UA so the request is allowed.
                "User-Agent": "wyoming-hume/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"Hume TTS HTTP {exc.code}: {detail}") from exc
        data = json.loads(body)
        gens = data.get("generations") or []
        if not gens or not gens[0].get("audio"):
            raise RuntimeError(f"Hume returned no audio: {json.dumps(data)[:300]}")
        return base64.b64decode(gens[0]["audio"])

    return await asyncio.to_thread(_do)


async def _mp3_to_pcm(mp3: bytes) -> bytes:
    """Decode MP3 -> raw s16le PCM @ RATE/CHANNELS via ffmpeg."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-ar",
        str(RATE),
        "-ac",
        str(CHANNELS),
        "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    pcm, err = await proc.communicate(input=mp3)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {err.decode('utf-8', errors='replace')[:300]}")
    return pcm


class HumeEventHandler(AsyncEventHandler):
    def __init__(self, wyoming_info: Info, api_key: str, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._wyoming_info_event = wyoming_info.event()
        self._api_key = api_key

    async def handle_event(self, event: Event) -> bool:
        if Describe.is_type(event.type):
            await self.write_event(self._wyoming_info_event)
            return True

        if not Synthesize.is_type(event.type):
            return True

        synth = Synthesize.from_event(event)
        text = (synth.text or "").strip()
        voice_name = synth.voice.name if synth.voice and synth.voice.name else DEFAULT_VOICE
        voice_id = VOICES.get(voice_name, VOICES[DEFAULT_VOICE])

        if not text:
            await self.write_event(AudioStart(rate=RATE, width=WIDTH, channels=CHANNELS).event())
            await self.write_event(AudioStop().event())
            return True

        _LOGGER.info("Synthesize: voice=%s chars=%d", voice_name, len(text))
        try:
            mp3 = await _hume_mp3(self._api_key, text, voice_id)
            pcm = await _mp3_to_pcm(mp3)
        except Exception:  # noqa: BLE001 - report cleanly, keep connection alive
            _LOGGER.exception("TTS generation failed")
            await self.write_event(AudioStart(rate=RATE, width=WIDTH, channels=CHANNELS).event())
            await self.write_event(AudioStop().event())
            return True

        await self.write_event(AudioStart(rate=RATE, width=WIDTH, channels=CHANNELS).event())
        for i in range(0, len(pcm), CHUNK_BYTES):
            await self.write_event(
                AudioChunk(
                    rate=RATE,
                    width=WIDTH,
                    channels=CHANNELS,
                    audio=pcm[i : i + CHUNK_BYTES],
                ).event()
            )
        await self.write_event(AudioStop().event())
        _LOGGER.info("Sent %d PCM bytes for voice=%s", len(pcm), voice_name)
        return True


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--uri", default=os.environ.get("WYOMING_URI", "tcp://0.0.0.0:10200"))
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.debug else logging.INFO)

    api_key = _load_api_key()
    wyoming_info = _build_info()

    _LOGGER.info("Wyoming Hume TTS starting on %s (voices: %s)", args.uri, ", ".join(VOICES))
    server = AsyncServer.from_uri(args.uri)
    await server.run(partial(HumeEventHandler, wyoming_info, api_key))


if __name__ == "__main__":
    asyncio.run(main())
