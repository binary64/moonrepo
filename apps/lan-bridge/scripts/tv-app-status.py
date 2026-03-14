#!/usr/bin/env python3
"""Query Chromecast Android TV Remote API for current app state.
Uses certs from ~/.config/androidtv-remote/ (copied from HA pod).
Dependencies: androidtvremote2 (installed in Docker image)
"""
import asyncio, sys, os

HOST = sys.argv[1] if len(sys.argv) > 1 else "192.168.1.90"
CERT_DIR = os.path.expanduser("~/.config/androidtv-remote")

async def main():
    from androidtvremote2 import AndroidTVRemote
    client = AndroidTVRemote("ArthurTV",
        f"{CERT_DIR}/cert.pem", f"{CERT_DIR}/key.pem", HOST)
    await client.async_connect()
    print(f"app={client.current_app}")
    print(f"on={client.is_on}")
    client.disconnect()

asyncio.run(main())
