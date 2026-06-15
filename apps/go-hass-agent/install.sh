#!/usr/bin/env bash
# Install go-hass-agent on a Linux DESKTOP (the machine whose sensors you want
# in Home Assistant). Downloads the release .deb, verifies its cosign signature,
# installs it, and prints next steps for registration.
#
# Run this ON THE DESKTOP, not on the VPS/cluster — the agent reports desktop
# sensors (active app, MPRIS media, mic/cam, screen lock, battery, notifications)
# which only make sense on the machine you actually use.
#
# Usage:
#   ./install.sh                 # install latest release for this arch
#   VERSION=14.12.0 ./install.sh # pin a specific version
#
# Source of truth: https://github.com/joshuar/go-hass-agent (MIT)
set -euo pipefail

REPO="joshuar/go-hass-agent"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# --- resolve arch -> deb suffix ------------------------------------------------
case "$(dpkg --print-architecture 2>/dev/null || uname -m)" in
  amd64|x86_64)   ARCH="amd64" ;;
  arm64|aarch64)  ARCH="arm64" ;;
  armv7l|armv7)   ARCH="armv7" ;;
  armv6l|armv6)   ARCH="armv6" ;;
  *) echo "Unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

# --- resolve version -----------------------------------------------------------
if [[ -z "${VERSION:-}" ]]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep -oP '"tag_name":\s*"v\K[^"]+')"
fi
echo ">> go-hass-agent v$VERSION ($ARCH)"

BASE="https://github.com/$REPO/releases/download/v$VERSION"
DEB="go-hass-agent_${VERSION}_${ARCH}.deb"

# --- download package + signature ----------------------------------------------
echo ">> downloading $DEB"
curl -fsSL "$BASE/$DEB"     -o "$WORKDIR/$DEB"
curl -fsSL "$BASE/$DEB.sig" -o "$WORKDIR/$DEB.sig"

# --- verify signature with cosign (keyless / sigstore bundle) ------------------
# Releases are signed in CI via Sigstore keyless signing (GitHub Actions OIDC).
# The .sig is a sigstore bundle embedding the signing certificate — verified
# against the signer's workflow identity, no public key needed. (Verified working
# against v14.12.0 with cosign verify-blob -> "Verified OK".)
# If cosign is not installed we WARN rather than hard-fail, so the install still
# works on a clean desktop — installing cosign and re-running is recommended.
if command -v cosign >/dev/null 2>&1; then
  echo ">> verifying Sigstore signature with cosign"
  if cosign verify-blob \
    --certificate-identity-regexp "^https://github.com/$REPO/" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    --bundle "$WORKDIR/$DEB.sig" \
    "$WORKDIR/$DEB"; then
    echo ">> signature OK"
  else
    echo "!! signature verification FAILED — aborting" >&2
    exit 1
  fi
else
  echo "!! cosign not found — skipping signature verification"
  echo "   install it (e.g. 'go install github.com/sigstore/cosign/v2/cmd/cosign@latest'"
  echo "   or grab the binary from github.com/sigstore/cosign/releases) and re-run to verify."
fi

# --- install -------------------------------------------------------------------
echo ">> installing (sudo apt install)"
sudo apt install -y "$WORKDIR/$DEB"

cat <<EOF

✅ go-hass-agent v$VERSION installed.

Next steps (run as your normal desktop user, inside your graphical session):

  1. Register with Home Assistant. Either:
       go-hass-agent register --server https://home.brandwhisper.cloud --token <LONG_LIVED_TOKEN>
     ...or run 'go-hass-agent' and open http://localhost:8223 to register in the browser.

  2. Start it:
       go-hass-agent run        # foreground, to watch logs first
     then enable autostart (a .desktop file is installed) via your DE's
     Startup Applications, or copy it into ~/.config/autostart/.

  3. In Home Assistant: Settings -> Devices & Services -> 'Mobile App' will show
     this desktop as a new device with its sensors.

Create a token at: https://home.brandwhisper.cloud/profile/security (Long-Lived Access Tokens).
EOF
