#!/usr/bin/env bash
# Host-level bootstrap for jupiter (Contabo VPS running the hermes agent).
#
# Installs the OS-level packages hermes needs that do NOT ship inside the
# hermes-agent npm/pip tree:
#   * kubectl             — for the socks-proxy port-forward user unit
#   * brave-browser       — real Brave binary for stealthy web browsing
#   * xvfb + xauth + fonts — virtual framebuffer so Brave can run "headed"
#                            (bot-detection evades headless fingerprints)
#   * x11-utils, dbus-x11 — Brave's runtime deps under Xvfb
#
# Idempotent. Needs passwordless sudo for apt (grant via sudoers.d:
# `hermes ALL=(root) NOPASSWD: /usr/bin/apt-get, /usr/bin/install, /usr/bin/tee, /usr/bin/curl, /usr/bin/gpg`).
#
# Run after hermes/bootstrap-env.sh:
#   cd ~/moonrepo && ./hermes/bootstrap-host.sh
set -euo pipefail

log() { echo "==> $*"; }
need_root() { [ "$(id -u)" -eq 0 ] || SUDO="sudo -n"; }
need_root
SUDO="${SUDO:-}"

# ----- apt prerequisites ----------------------------------------------------
log "Installing apt prerequisites"
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq curl gnupg ca-certificates apt-transport-https

# ----- kubectl --------------------------------------------------------------
# Pinned to v1.30 line — matches rke2 v1.30.x currently running on master.
# Using the community pkgs.k8s.io repo (not Google Cloud's legacy apt).
KUBECTL_MINOR="v1.30"
KUBECTL_KEYRING="/etc/apt/keyrings/kubernetes-apt-keyring.gpg"
KUBECTL_LIST="/etc/apt/sources.list.d/kubernetes.list"

if [ ! -s "$KUBECTL_KEYRING" ]; then
  log "Adding kubernetes apt signing key"
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://pkgs.k8s.io/core:/stable:/${KUBECTL_MINOR}/deb/Release.key" \
    | $SUDO gpg --dearmor -o "$KUBECTL_KEYRING"
  $SUDO chmod 0644 "$KUBECTL_KEYRING"
fi

EXPECTED_KUBECTL_LINE="deb [signed-by=${KUBECTL_KEYRING}] https://pkgs.k8s.io/core:/stable:/${KUBECTL_MINOR}/deb/ /"
if ! grep -qsxF "$EXPECTED_KUBECTL_LINE" "$KUBECTL_LIST" 2>/dev/null; then
  log "Writing kubernetes apt source (${KUBECTL_MINOR})"
  echo "$EXPECTED_KUBECTL_LINE" | $SUDO tee "$KUBECTL_LIST" >/dev/null
  $SUDO apt-get update -qq
fi

$SUDO apt-get install -y -qq kubectl

# ----- Brave ----------------------------------------------------------------
# Official Brave apt repo. Key rotates rarely; re-download if missing so
# the script self-heals.
BRAVE_KEYRING="/usr/share/keyrings/brave-browser-archive-keyring.gpg"
BRAVE_LIST="/etc/apt/sources.list.d/brave-browser-release.list"

if [ ! -s "$BRAVE_KEYRING" ]; then
  log "Adding Brave apt signing key"
  $SUDO curl -fsSLo "$BRAVE_KEYRING" \
    https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg
  $SUDO chmod 0644 "$BRAVE_KEYRING"
fi

EXPECTED_BRAVE_LINE="deb [signed-by=${BRAVE_KEYRING}] https://brave-browser-apt-release.s3.brave.com/ stable main"
if ! grep -qsxF "$EXPECTED_BRAVE_LINE" "$BRAVE_LIST" 2>/dev/null; then
  log "Writing Brave apt source"
  echo "$EXPECTED_BRAVE_LINE" | $SUDO tee "$BRAVE_LIST" >/dev/null
  $SUDO apt-get update -qq
fi

$SUDO apt-get install -y -qq brave-browser

# ----- Xvfb + runtime deps --------------------------------------------------
# Brave under Xvfb needs xauth for MIT-MAGIC-COOKIE, dbus for its IPC, and
# a base font set or pages render as tofu. `--no-install-recommends` keeps
# this under ~150MB on a bare VPS.
log "Installing Xvfb + X11 runtime deps"
$SUDO apt-get install -y -qq --no-install-recommends \
  xvfb xauth x11-utils dbus-x11 \
  fonts-liberation fonts-noto-color-emoji fonts-noto-cjk

log "Versions:"
kubectl version --client --output=yaml 2>/dev/null | grep -E "gitVersion|platform" || true
brave-browser --version 2>/dev/null || true
Xvfb -help 2>&1 | head -1 || true

log "Done. Next: restart hermes-socks-proxy.service and hermes."
