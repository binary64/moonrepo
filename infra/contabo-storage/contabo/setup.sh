#!/usr/bin/env bash
# Contabo Storage VPS provisioning script
# Installs: WireGuard, nbd-server, RKE2 agent
# Creates: WireGuard config, NBD config, sparse blockstore, systemd services
#
# Usage: Edit placeholders below, then run as root on the Contabo VPS.

set -euo pipefail

# ============================================================================
# CONFIGURATION — Edit these before running
# ============================================================================
NUC_PUBLIC_KEY="<NUC_PUBLIC_KEY>"
CONTABO_PRIVATE_KEY="<CONTABO_PRIVATE_KEY>"
NUC_ENDPOINT="<YOUR_HOME_PUBLIC_IP>:51820"
RKE2_TOKEN="<RKE2_TOKEN>"

# Fixed values
WG_INTERFACE="wg0"
WG_ADDRESS="10.10.0.2/24"
WG_PORT="51820"
NBD_LISTEN="10.10.0.2"
BLOCKSTORE="/srv/blockstore.img"
BLOCKSTORE_SIZE="1300G"  # 1.3TB sparse

# ============================================================================
# Validation
# ============================================================================
if [[ "$NUC_PUBLIC_KEY" == "<NUC_PUBLIC_KEY>" ]]; then
    echo "ERROR: Replace <NUC_PUBLIC_KEY> with the NUC's WireGuard public key"
    exit 1
fi
if [[ "$CONTABO_PRIVATE_KEY" == "<CONTABO_PRIVATE_KEY>" ]]; then
    echo "ERROR: Replace <CONTABO_PRIVATE_KEY> with this machine's WireGuard private key"
    exit 1
fi
if [[ "$RKE2_TOKEN" == "<RKE2_TOKEN>" ]]; then
    echo "ERROR: Replace <RKE2_TOKEN> with the RKE2 join token from the NUC"
    exit 1
fi

echo "=== Contabo Storage VPS Setup ==="
echo ""

# ============================================================================
# 1. Install packages
# ============================================================================
echo "[1/6] Installing packages..."
apt-get update
apt-get install -y wireguard nbd-server

# ============================================================================
# 2. WireGuard configuration
# ============================================================================
echo "[2/6] Configuring WireGuard..."
mkdir -p /etc/wireguard
cat > /etc/wireguard/${WG_INTERFACE}.conf <<EOF
[Interface]
PrivateKey = ${CONTABO_PRIVATE_KEY}
Address = ${WG_ADDRESS}
ListenPort = ${WG_PORT}

[Peer]
PublicKey = ${NUC_PUBLIC_KEY}
AllowedIPs = 10.10.0.1/32
Endpoint = ${NUC_ENDPOINT}
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/${WG_INTERFACE}.conf

systemctl enable wg-quick@${WG_INTERFACE}
systemctl start wg-quick@${WG_INTERFACE} || true
echo "  WireGuard configured and started"

# ============================================================================
# 3. Create sparse blockstore file
# ============================================================================
echo "[3/6] Creating sparse blockstore..."
if [[ ! -f "$BLOCKSTORE" ]]; then
    truncate -s "$BLOCKSTORE_SIZE" "$BLOCKSTORE"
    echo "  Created ${BLOCKSTORE} (${BLOCKSTORE_SIZE} sparse)"
else
    echo "  ${BLOCKSTORE} already exists, skipping"
fi

# ============================================================================
# 4. NBD server configuration
# ============================================================================
echo "[4/6] Configuring NBD server..."
cp /root/nbd-server.conf /etc/nbd-server/config 2>/dev/null || \
cat > /etc/nbd-server/config <<EOF
[generic]
listenaddr = ${NBD_LISTEN}
allowlist = true
port = 10809

[blockstore]
exportname = ${BLOCKSTORE}
allowlist = true
authfile = /etc/nbd-server/allow
EOF

# Allowlist: only the NUC can connect
mkdir -p /etc/nbd-server
echo "10.10.0.1" > /etc/nbd-server/allow

systemctl enable nbd-server
systemctl restart nbd-server
echo "  NBD server configured and started"

# ============================================================================
# 5. Install RKE2 agent
# ============================================================================
echo "[5/6] Installing RKE2 agent..."
if ! command -v rke2 &>/dev/null; then
    curl -sfL https://get.rke2.io | INSTALL_RKE2_TYPE="agent" sh -
fi

mkdir -p /etc/rancher/rke2
cat > /etc/rancher/rke2/config.yaml <<EOF
server: https://10.10.0.1:9345
token: ${RKE2_TOKEN}
node-label:
  - "topology.kubernetes.io/zone=contabo-portsmouth"
  - "node-role.kubernetes.io/storage=true"
node-taint:
  - "node-role.kubernetes.io/storage=true:NoSchedule"
node-ip: 10.10.0.2
EOF

systemctl enable rke2-agent
systemctl start rke2-agent || true
echo "  RKE2 agent configured and started"

# ============================================================================
# 6. Verify
# ============================================================================
echo "[6/6] Verifying..."
echo ""
echo "WireGuard status:"
wg show ${WG_INTERFACE} 2>/dev/null || echo "  (not yet connected — NUC side needed)"
echo ""
echo "NBD server:"
ss -tlnp | grep 10809 || echo "  WARNING: NBD not listening on port 10809"
echo ""
echo "Blockstore:"
ls -lh "$BLOCKSTORE"
echo ""
echo "RKE2 agent:"
systemctl is-active rke2-agent || echo "  (may need WireGuard tunnel up first)"
echo ""
echo "=== Contabo setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Note this machine's WireGuard public key: $(wg show ${WG_INTERFACE} public-key 2>/dev/null || echo 'run: wg pubkey < /etc/wireguard/private.key')"
echo "  2. Run nuc/setup.sh on the NUC with the Contabo public key"
echo "  3. Verify tunnel: ping 10.10.0.1"
