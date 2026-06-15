# go-hass-agent (desktop companion for Home Assistant)

[`go-hass-agent`](https://github.com/joshuar/go-hass-agent) (MIT) is the Linux
equivalent of the Home Assistant mobile **Companion App**: it runs on a
desktop/laptop and exposes that machine's sensors, controls, and events to Home
Assistant — and receives HA notifications back on the desktop.

## ⚠️ Where this runs

**On the daily-driver desktop whose sensors you want — NOT on the cluster/VPS.**
The interesting sensors (active app, MPRIS media state, mic/cam in-use, screen
lock, battery, desktop theme) only exist inside a real graphical session. On a
headless box they're empty. This is a **host-installed package**, not a k8s
workload — hence it lives under `apps/` as a versioned install script (mirroring
`apps/radio-tick` / `apps/radio-director`), not as an ArgoCD Application.

## What HA gets

- **Media:** Global MPRIS player state; webcam/mic in-use (Pipewire).
- **Desktop:** Focused app + running-app count; theme (dark/light), accent colour.
- **Power:** Battery level/state/power draw, power profile, suspend/on/off, screen-lock state.
- **System:** CPU load + per-core usage/freq, memory/swap, disk usage + IO rates, network state + Wi-Fi details + throughput, uptime/kernel/distro.
- **Events:** user login/logout (systemd-logind).
- **Notifications:** HA can push desktop notifications to the machine.
- **Controls (needs MQTT):** volume/mute, webcam, lock/unlock, suspend/hibernate/poweroff/reboot, arbitrary D-Bus commands.

## Install (run on the desktop)

```bash
# from a checkout of this repo, on the target desktop:
./apps/go-hass-agent/install.sh            # latest release for this arch
VERSION=14.12.0 ./apps/go-hass-agent/install.sh   # or pin a version
```

The script:
1. Detects arch (amd64 / arm64 / armv7 / armv6) and resolves the latest release tag.
2. Downloads the `.deb` + its Sigstore `.sig` bundle.
3. Verifies the signature with `cosign verify-blob` (keyless / GitHub Actions OIDC).
   Verification is **enforced** when `cosign` is present; if absent it warns and
   continues (install `cosign` and re-run to verify).
4. `sudo apt install`s the package.

## Register with Home Assistant

After install, as your normal desktop user inside the graphical session:

```bash
go-hass-agent register --server https://home.brandwhisper.cloud --token <LONG_LIVED_TOKEN>
# ...or run `go-hass-agent` and register via the web UI at http://localhost:8223
```

Create a token at **HA → Profile → Security → Long-Lived Access Tokens**.

Then start it (`go-hass-agent run` to watch logs first) and enable autostart via
your desktop's Startup Applications (a `.desktop` file is installed by the
package) or by copying it into `~/.config/autostart/`.

The device appears in HA under **Settings → Devices & Services → Mobile App**.

## Notes

- Signature verification was confirmed against **v14.12.0** (`Verified OK`). The
  upstream wiki's `cosign.pub` (key-based) instruction is stale — the release
  `.sig` is a keyless Sigstore bundle, so the script verifies against the
  signer's workflow identity instead.
- MQTT-based **controls** (not just sensors) require HA to be connected to an
  MQTT broker and `go-hass-agent` configured with the broker details — see the
  upstream wiki. Sensors/events work without MQTT.
