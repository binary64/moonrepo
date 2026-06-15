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
# Idempotent.
#
# ## Privilege model
#
# This script must be run **as root** (typically via `sudo`), NOT as the
# hermes user with sudoers NOPASSWD shims. Granting NOPASSWD for the set of
# helpers this script needs (apt-get, curl, gpg, tee, install, chmod) is
# effectively passwordless root for the hermes user — worse than just
# running the script once with sudo at provisioning time.
#
# Run order on a fresh jupiter:
#   sudo ./hermes/bootstrap-host.sh          # installs kubectl, brave, xvfb (THIS SCRIPT)
#   ./hermes/bootstrap-env.sh                # as hermes, writes env + kubeconfig + systemd units
#   systemctl --user daemon-reload
#   systemctl --user enable --now hermes-xvfb hermes-socks-proxy
#
# hermes-xvfb.service MUST be active before the hermes agent itself is
# (re)started, otherwise Brave has no display to attach to.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: $0 must be run as root (try: sudo $0)" >&2
  exit 1
fi

log() { echo "==> $*"; }

# ----- apt prerequisites ----------------------------------------------------
log "Installing apt prerequisites"
apt-get update -qq
apt-get install -y -qq curl gnupg ca-certificates apt-transport-https

# ----- kubectl --------------------------------------------------------------
# Pinned to v1.30 line — matches rke2 v1.30.x currently running on master.
# Using the community pkgs.k8s.io repo (not Google Cloud's legacy apt).
# Binary lands at /usr/bin/kubectl (NOT /usr/local/bin/); the systemd unit
# references /usr/bin/kubectl accordingly.
KUBECTL_MINOR="v1.30"
KUBECTL_KEYRING="/etc/apt/keyrings/kubernetes-apt-keyring.gpg"
KUBECTL_LIST="/etc/apt/sources.list.d/kubernetes.list"

if [ ! -s "$KUBECTL_KEYRING" ]; then
  log "Adding kubernetes apt signing key"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://pkgs.k8s.io/core:/stable:/${KUBECTL_MINOR}/deb/Release.key" \
    | gpg --dearmor -o "$KUBECTL_KEYRING"
  chmod 0644 "$KUBECTL_KEYRING"
fi

EXPECTED_KUBECTL_LINE="deb [signed-by=${KUBECTL_KEYRING}] https://pkgs.k8s.io/core:/stable:/${KUBECTL_MINOR}/deb/ /"
if ! grep -qsxF "$EXPECTED_KUBECTL_LINE" "$KUBECTL_LIST" 2>/dev/null; then
  log "Writing kubernetes apt source (${KUBECTL_MINOR})"
  printf '%s\n' "$EXPECTED_KUBECTL_LINE" > "$KUBECTL_LIST"
  apt-get update -qq
fi

apt-get install -y -qq kubectl

# ----- Brave ----------------------------------------------------------------
# Official Brave apt repo. Key rotates rarely; re-download if missing so
# the script self-heals.
BRAVE_KEYRING="/usr/share/keyrings/brave-browser-archive-keyring.gpg"
BRAVE_LIST="/etc/apt/sources.list.d/brave-browser-release.list"

if [ ! -s "$BRAVE_KEYRING" ]; then
  log "Adding Brave apt signing key"
  curl -fsSLo "$BRAVE_KEYRING" \
    https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg
  chmod 0644 "$BRAVE_KEYRING"
fi

EXPECTED_BRAVE_LINE="deb [signed-by=${BRAVE_KEYRING}] https://brave-browser-apt-release.s3.brave.com/ stable main"
if ! grep -qsxF "$EXPECTED_BRAVE_LINE" "$BRAVE_LIST" 2>/dev/null; then
  log "Writing Brave apt source"
  printf '%s\n' "$EXPECTED_BRAVE_LINE" > "$BRAVE_LIST"
  apt-get update -qq
fi

apt-get install -y -qq brave-browser

# ----- Xvfb + runtime deps --------------------------------------------------
# Brave under Xvfb needs xauth for MIT-MAGIC-COOKIE, dbus for its IPC, and
# a base font set or pages render as tofu. `--no-install-recommends` keeps
# this under ~150MB on a bare VPS.
log "Installing Xvfb + X11 runtime deps"
apt-get install -y -qq --no-install-recommends \
  xvfb xauth x11-utils dbus-x11 \
  fonts-liberation fonts-noto-color-emoji fonts-noto-cjk

log "Versions:"
kubectl version --client --output=yaml 2>/dev/null | grep -E "gitVersion|platform" || true
brave-browser --version 2>/dev/null || true
Xvfb -help 2>&1 | head -1 || true

log "Done. Next: run hermes/bootstrap-env.sh as the hermes user, then"
log "       systemctl --user enable --now hermes-xvfb hermes-socks-proxy"
log "       (hermes-xvfb MUST be active before hermes itself is started)"
