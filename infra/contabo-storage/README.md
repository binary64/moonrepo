# Contabo Storage VPS — Encrypted Remote Block Storage

Contabo Storage VPS 50 (1.4TB SSD, Portsmouth DC) provides encrypted remote storage for the NUC K8s cluster. The VPS joins the RKE2 cluster as a tainted worker node, exports raw block storage via NBD, and the NUC applies LUKS encryption + BTRFS + NFS to serve it on the LAN.

## Architecture

```
┌─────────────────────────────┐                                ┌─────────────────────────────┐
│       Contabo VPS           │       Internet (UFW locked)    │         NUC                 │
│   Portsmouth DC             │◄──────────────────────────────►│   192.168.1.201             │
│                             │                                │   RKE2 Control Plane        │
│   NBD Server (:10809)       │       NBD (port 10809)         │                             │
│   /srv/blockstore.img ──────┼────────────────────────────────►   NBD Client                │
│   (1.3T sparse file)        │     (LUKS encrypted blocks)    │   → LUKS2 (keyfile on NUC)  │
│                             │                                │   → BTRFS (zstd,noatime)    │
│   RKE2 Agent                │       RKE2 (:9345, TLS)        │   → /mnt/vault              │
│   (tainted: storage only)   │◄──────────────────────────────►│   → NFS export              │
│                             │                                │     192.168.1.0/24          │
│   UFW: home IP only         │                                │                             │
└─────────────────────────────┘                                └──────────────┬──────────────┘
                                                                              │ LAN
                                                                     ┌───────┴───────┐
                                                                 Desktop PC       Phone
                                                                 NFS mount      (later: Samba)
```

## Security Model

| Layer | Protection |
|-------|-----------|
| **Contabo disk** | LUKS2 encrypted — Contabo sees only noise |
| **NBD on wire** | Blocks are LUKS-encrypted, unreadable in transit |
| **RKE2 traffic** | TLS-encrypted natively |
| **UFW on Contabo** | Only your home IP can reach any port |
| **LUKS key** | `/root/.vault-key` on NUC only — never on Contabo |
| **NFS** | LAN only (192.168.1.0/24) |

## Setup

### Contabo VPS (one-time)

See [contabo/runbook.md](contabo/runbook.md) — covers SSH hardening, UFW, NBD server, and RKE2 agent join.

### NUC (one-time)

#### 1. Install packages

```bash
apt-get install -y nbd-client nfs-kernel-server cryptsetup btrfs-progs
echo "nbd" > /etc/modules-load.d/nbd.conf
echo "options nbd max_part=1" > /etc/modprobe.d/nbd.conf
modprobe nbd max_part=1
```

#### 2. Install vault-mount service

```bash
# Edit nuc/vault-mount.service — replace <CONTABO_IP> with the VPS public IP
cp nuc/vault-mount.service /etc/systemd/system/vault-mount.service
systemctl daemon-reload
```

#### 3. Configure NFS

```bash
cp nuc/exports /etc/exports    # or append if exports already has content
systemctl enable nfs-kernel-server
```

#### 4. Generate LUKS key and format volume

```bash
# Generate keyfile (one-time, stays on NUC forever)
dd if=/dev/urandom of=/root/.vault-key bs=4096 count=1
chmod 400 /root/.vault-key

# Connect NBD
nbd-client <CONTABO_IP> 10809 /dev/nbd0 -persist -name blockstore

# Encrypt and format
cryptsetup luksFormat --type luks2 --key-file /root/.vault-key /dev/nbd0
cryptsetup luksOpen --key-file /root/.vault-key /dev/nbd0 vault
mkfs.btrfs -L vault /dev/mapper/vault

# Clean up (service manages this going forward)
umount /mnt/vault 2>/dev/null; cryptsetup close vault; nbd-client -d /dev/nbd0
```

#### 5. Start and enable

```bash
systemctl enable --now vault-mount.service
systemctl start nfs-kernel-server
df -h /mnt/vault
showmount -e localhost
```

### Desktop PC

```bash
apt install -y nfs-common
mkdir -p /mnt/vault
echo '192.168.1.201:/mnt/vault  /mnt/vault  nfs  defaults,_netdev  0  0' >> /etc/fstab
mount /mnt/vault
```

---

## ⚠️ Back Up the LUKS Key

`/root/.vault-key` on the NUC is the **only** way to decrypt the volume. If lost, all data is irrecoverable.

```bash
gpg --symmetric --cipher-algo AES256 /root/.vault-key
# Store .vault-key.gpg in your password manager
```

## Boot Order

```
vault-mount.service → nbd-client → cryptsetup → btrfs mount → exportfs
    ↓
nfs-kernel-server.service
```

## Troubleshooting

| Problem | Check |
|---------|-------|
| NBD won't connect | `ss -tlnp \| grep 10809` on Contabo, UFW rules, `nbd-client -c /dev/nbd0` on NUC |
| LUKS won't open | `ls -la /root/.vault-key` (should be `-r--------`), `cryptsetup luksDump /dev/nbd0` |
| NFS not accessible | `exportfs -v`, `showmount -e 192.168.1.201`, check vault is mounted first |
| RKE2 agent won't join | `journalctl -u rke2-agent -f` on Contabo, check UFW allows 9345+6443 |
| Contabo node not Ready | `kubectl get nodes -o wide` on NUC, check token matches |
