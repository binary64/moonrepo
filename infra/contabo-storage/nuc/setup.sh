#!/usr/bin/env bash
# NUC-side setup script for Contabo storage
# Installs: nbd-client, nfs-kernel-server (WireGuard assumed present)
# Creates: WireGuard config, vault-mount.service, NFS exports
#
# Usage: Edit placeholders below, then run as root on the NUC.

set -euo pipefail

# ============================================================================
# CONFIGURATION — Edit these before running
# ============================================================================
CONTABO_PUBLIC_KEY="<CONTABO_PUBLIC_KEY>"
NUC_PRIVATE_KEY="<NUC_PRIVATE_KEY>"
CONTABO_ENDPOINT=""  # Contabo VPS public IP (e.g., "1.2.3.4:51820")

# Fixed values
WG_INTERFACE="wg0"
WG_ADDRESS="10.10.0.1/24"
WG_PORT="51820"
MOUNT_POINT="/mnt/vault"
NBD_DEVICE="/dev/nbd0"
NBD_HOST="10.10.0.2"
NBD_PORT="10809"
LUKS_NAME="vault"
LUKS_KEYFILE="/root/.vault-key"

# ============================================================================
# Validation
# ============================================================================
if [[ "$CONTABO_PUBLIC_KEY" == "<CONTABO_PUBLIC_KEY>" ]]; then
    echo "ERROR: Replace <CONTABO_PUBLIC_KEY> with the Contabo VPS's WireGuard public key"
    exit 1
fi
if [[ "$NUC_PRIVATE_KEY" == "<NUC_PRIVATE_KEY>" ]]; then
    echo "ERROR: Replace <NUC_PRIVATE_KEY> with this machine's WireGuard private key"
    exit 1
fi

echo "=== NUC Storage Setup ==="
echo ""

# ============================================================================
# 1. Install packages
# ============================================================================
echo "[1/6] Installing packages..."
apt-get update
apt-get install -y nbd-client nfs-kernel-server cryptsetup btrfs-progs

# Install WireGuard if not present
if ! command -v wg &>/dev/null; then
    apt-get install -y wireguard
    echo "  WireGuard installed"
else
    echo "  WireGuard already present"
fi

# ============================================================================
# 2. WireGuard configuration
# ============================================================================
echo "[2/6] Configuring WireGuard..."
mkdir -p /etc/wireguard

if [[ -f /etc/wireguard/${WG_INTERFACE}.conf ]]; then
    echo "  WARNING: /etc/wireguard/${WG_INTERFACE}.conf already exists"
    echo "  Backing up to ${WG_INTERFACE}.conf.bak"
    cp /etc/wireguard/${WG_INTERFACE}.conf /etc/wireguard/${WG_INTERFACE}.conf.bak
fi

cat > /etc/wireguard/${WG_INTERFACE}.conf <<EOF
[Interface]
PrivateKey = ${NUC_PRIVATE_KEY}
Address = ${WG_ADDRESS}
ListenPort = ${WG_PORT}

[Peer]
PublicKey = ${CONTABO_PUBLIC_KEY}
AllowedIPs = 10.10.0.2/32
$([ -n "$CONTABO_ENDPOINT" ] && echo "Endpoint = ${CONTABO_ENDPOINT}")
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/${WG_INTERFACE}.conf

systemctl enable wg-quick@${WG_INTERFACE}
systemctl start wg-quick@${WG_INTERFACE} || true
echo "  WireGuard configured and started"

# ============================================================================
# 3. Load nbd kernel module
# ============================================================================
echo "[3/6] Configuring NBD kernel module..."
if ! grep -q "^nbd" /etc/modules-load.d/nbd.conf 2>/dev/null; then
    echo "nbd" > /etc/modules-load.d/nbd.conf
fi

if ! grep -q "nbd max_part=1" /etc/modprobe.d/nbd.conf 2>/dev/null; then
    echo "options nbd max_part=1" > /etc/modprobe.d/nbd.conf
fi

modprobe nbd max_part=1 || true
echo "  NBD module loaded with max_part=1"

# ============================================================================
# 4. Install vault-mount.service
# ============================================================================
echo "[4/6] Installing vault-mount.service..."
cat > /etc/systemd/system/vault-mount.service <<'UNIT'
[Unit]
Description=Mount encrypted vault from Contabo via NBD
After=wg-quick@wg0.service
Before=nfs-kernel-server.service
Requires=wg-quick@wg0.service
Wants=nfs-kernel-server.service

[Service]
Type=oneshot
RemainAfterExit=yes

ExecStartPre=/sbin/modprobe nbd max_part=1
ExecStart=/bin/bash -c '\
    nbd-client 10.10.0.2 10809 /dev/nbd0 -persist -name blockstore && \
    sleep 1 && \
    cryptsetup luksOpen --key-file /root/.vault-key /dev/nbd0 vault && \
    mkdir -p /mnt/vault && \
    mount -o compress=zstd,noatime /dev/mapper/vault /mnt/vault && \
    exportfs -ra \
'

ExecStop=/bin/bash -c '\
    exportfs -ua || true; \
    umount /mnt/vault || true; \
    cryptsetup close vault || true; \
    nbd-client -d /dev/nbd0 || true \
'

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
echo "  vault-mount.service installed"

# ============================================================================
# 5. Configure NFS exports
# ============================================================================
echo "[5/6] Configuring NFS exports..."
mkdir -p "${MOUNT_POINT}"

# Add export if not already present
if ! grep -q "${MOUNT_POINT}" /etc/exports 2>/dev/null; then
    echo "${MOUNT_POINT}  192.168.1.0/24(rw,sync,no_subtree_check,no_root_squash)" >> /etc/exports
    echo "  Added NFS export for ${MOUNT_POINT}"
else
    echo "  NFS export for ${MOUNT_POINT} already exists"
fi

systemctl enable nfs-kernel-server
echo "  NFS server enabled"

# ============================================================================
# 6. Summary
# ============================================================================
echo "[6/6] Setup complete"
echo ""
echo "=== NUC Storage Setup Complete ==="
echo ""
echo "Boot chain:"
echo "  wg-quick@wg0 → vault-mount.service → nfs-kernel-server"
echo ""
echo "Before first use, you must:"
echo "  1. Generate the LUKS keyfile:"
echo "     dd if=/dev/urandom of=${LUKS_KEYFILE} bs=4096 count=1"
echo "     chmod 400 ${LUKS_KEYFILE}"
echo ""
echo "  2. Format the volume (one-time):"
echo "     nbd-client ${NBD_HOST} ${NBD_PORT} ${NBD_DEVICE} -persist -name blockstore"
echo "     cryptsetup luksFormat --type luks2 --key-file ${LUKS_KEYFILE} ${NBD_DEVICE}"
echo "     cryptsetup luksOpen --key-file ${LUKS_KEYFILE} ${NBD_DEVICE} ${LUKS_NAME}"
echo "     mkfs.btrfs -L vault /dev/mapper/${LUKS_NAME}"
echo "     umount /mnt/vault 2>/dev/null; cryptsetup close ${LUKS_NAME}; nbd-client -d ${NBD_DEVICE}"
echo ""
echo "  3. Start the service chain:"
echo "     systemctl start vault-mount.service"
echo "     systemctl start nfs-kernel-server"
echo ""
echo "  4. ⚠️  BACK UP ${LUKS_KEYFILE} — loss means total data loss!"
