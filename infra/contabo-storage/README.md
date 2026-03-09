# Contabo Storage VPS — Encrypted Remote Block Storage

Adds a Contabo Storage VPS 50 (1.4TB SSD, Portsmouth DC) as encrypted remote storage for the NUC-based RKE2 cluster. The VPS joins the cluster as a tainted worker node over WireGuard, exports raw block storage via NBD, and the NUC applies LUKS encryption + BTRFS + NFS to serve it on the LAN.

## Architecture

```
┌─────────────────────────────┐        WireGuard Tunnel        ┌─────────────────────────────┐
│       Contabo VPS           │      (10.10.0.0/24, UDP 51820) │         NUC                 │
│   Portsmouth DC             │◄──────────────────────────────►│   192.168.1.201             │
│                             │                                 │   RKE2 Control Plane        │
│   10.10.0.2 (wg0)          │                                 │   10.10.0.1 (wg0)           │
│                             │                                 │                             │
│   NBD Server                │         NBD (port 10809)        │   NBD Client                │
│   /srv/blockstore.img ──────┼────────────────────────────────►│   → LUKS2 (keyfile)         │
│   (1.3T sparse file)        │       (encrypted blocks only)   │   → BTRFS (zstd,noatime)   │
│                             │                                 │   → /mnt/vault              │
│   RKE2 Agent                │                                 │   → NFS export              │
│   (tainted: storage only)   │                                 │     192.168.1.0/24          │
└─────────────────────────────┘                                 └─────────────────────────────┘
                                                                          │
                                                                    NFS Mount
                                                                          │
                                                                ┌─────────────────┐
                                                                │   Desktop PC    │
                                                                │  192.168.1.154  │
                                                                │  /mnt/vault     │
                                                                └─────────────────┘
```

## Security Model

- **Contabo sees only encrypted blocks** — LUKS key never leaves the NUC
- **WireGuard encrypts all traffic** in transit between NUC and Contabo
- **NBD listens only on WireGuard interface** (10.10.0.2), not public internet
- **LUKS2 with keyfile** — no passphrase, no interactive unlock needed

## Prerequisites

- [ ] Contabo Storage VPS 50 ordered (Portsmouth DC, Debian 12)
- [ ] SSH root access to the Contabo VPS
- [ ] NUC running RKE2 control plane at 192.168.1.201
- [ ] Router access to configure port forwarding

---

## Step 1: Generate WireGuard Keys

On **both machines**, generate key pairs:

```bash
wg genkey | tee /tmp/privatekey | wg pubkey > /tmp/publickey
cat /tmp/privatekey  # Save this
cat /tmp/publickey   # Share with the other machine
rm /tmp/privatekey /tmp/publickey
```

Note down:
- `NUC_PRIVATE_KEY` and `NUC_PUBLIC_KEY`
- `CONTABO_PRIVATE_KEY` and `CONTABO_PUBLIC_KEY`

## Step 2: Get RKE2 Join Token

On the **NUC**:

```bash
cat /var/lib/rancher/rke2/server/node-token
```

Note this as `RKE2_TOKEN`.

## Step 3: Port Forward on Router

Forward **UDP port 51820** on the router to **192.168.1.201** (NUC).

This allows the Contabo VPS to initiate the WireGuard tunnel to the NUC's public IP.

## Step 4: Run Contabo Setup

SSH into the Contabo VPS and run:

```bash
# Copy the setup script and nbd-server.conf to the VPS
scp contabo/setup.sh contabo/nbd-server.conf root@<contabo-ip>:/root/

# SSH in and run
ssh root@<contabo-ip>
chmod +x /root/setup.sh

# Edit setup.sh first — replace placeholders:
#   <NUC_PUBLIC_KEY>      → NUC's WireGuard public key
#   <CONTABO_PRIVATE_KEY> → Contabo's WireGuard private key
#   <RKE2_TOKEN>          → RKE2 join token from Step 2

# Also set NUC_ENDPOINT to your home IP (or DDNS hostname):
#   e.g., NUC_ENDPOINT="your-home-ip:51820"

./setup.sh
```

The script will:
1. Install WireGuard, nbd-server, and RKE2 agent
2. Create the WireGuard config (`/etc/wireguard/wg0.conf`)
3. Create the sparse blockstore file (`/srv/blockstore.img`, 1.3TB)
4. Configure NBD server (listen on 10.10.0.2 only)
5. Start WireGuard and NBD server
6. Join the RKE2 cluster with storage taint and zone label

## Step 5: Verify WireGuard Tunnel

On the **NUC**:

```bash
# Start WireGuard if not already up
wg-quick up wg0

# Check tunnel status
wg show

# Ping Contabo through the tunnel
ping -c 3 10.10.0.2
```

On **Contabo**:

```bash
ping -c 3 10.10.0.1
```

## Step 6: Run NUC Setup

On the **NUC**:

```bash
# Copy files
# Edit nuc/setup.sh — replace placeholders:
#   <CONTABO_PUBLIC_KEY> → Contabo's WireGuard public key
#   <NUC_PRIVATE_KEY>    → NUC's WireGuard private key

chmod +x nuc/setup.sh
sudo ./nuc/setup.sh
```

The script will:
1. Install nbd-client and nfs-kernel-server (WireGuard should already be present)
2. Create the WireGuard config (`/etc/wireguard/wg0.conf`)
3. Install the `vault-mount.service` systemd unit
4. Configure NFS exports
5. Load the `nbd` kernel module

## Step 7: Generate LUKS Key and Format Volume

On the **NUC** (one-time setup):

```bash
# Generate a random 4096-byte keyfile
dd if=/dev/urandom of=/root/.vault-key bs=4096 count=1
chmod 400 /root/.vault-key

# Bring up WireGuard
systemctl start wg-quick@wg0

# Connect NBD client
modprobe nbd max_part=1
nbd-client 10.10.0.2 10809 /dev/nbd0 -persist -name blockstore

# Format with LUKS2
cryptsetup luksFormat --type luks2 --key-file /root/.vault-key /dev/nbd0

# Open and format with BTRFS
cryptsetup luksOpen --key-file /root/.vault-key /dev/nbd0 vault
mkfs.btrfs -L vault /dev/mapper/vault

# Mount
mkdir -p /mnt/vault
mount -o compress=zstd,noatime /dev/mapper/vault /mnt/vault

# Verify
df -h /mnt/vault
btrfs filesystem show /mnt/vault

# Clean up (the service will manage this going forward)
umount /mnt/vault
cryptsetup close vault
nbd-client -d /dev/nbd0
```

## Step 8: Start the Service Chain

```bash
# Enable and start the full chain
systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0
systemctl enable vault-mount.service
systemctl start vault-mount.service
systemctl enable nfs-kernel-server
systemctl start nfs-kernel-server

# Verify
systemctl status vault-mount.service
showmount -e localhost
df -h /mnt/vault
```

## Step 9: Mount NFS on Desktop PC

On the **Desktop PC** (192.168.1.154):

```bash
# Install NFS client
sudo apt install -y nfs-common

# Create mount point
sudo mkdir -p /mnt/vault

# Test mount
sudo mount -t nfs 192.168.1.201:/mnt/vault /mnt/vault
ls /mnt/vault

# Add to /etc/fstab for persistent mount
echo '192.168.1.201:/mnt/vault  /mnt/vault  nfs  defaults,_netdev  0  0' | sudo tee -a /etc/fstab
```

## Step 10: Verify RKE2 Node

On the **NUC**:

```bash
kubectl get nodes -o wide
# Should show Contabo node with:
#   - Status: Ready
#   - Taint: node-role.kubernetes.io/storage=true:NoSchedule
#   - Label: topology.kubernetes.io/zone=contabo-portsmouth
```

---

## ⚠️ CRITICAL: Back Up the LUKS Key

The file `/root/.vault-key` on the NUC is the **only** way to decrypt the volume. If lost, **all data on the Contabo VPS is irrecoverable**.

Back it up to at least two secure locations:
```bash
# Example: encrypt and store in a password manager
gpg --symmetric --cipher-algo AES256 /root/.vault-key
# Store the resulting .vault-key.gpg somewhere safe
```

**Do NOT store the key on the Contabo VPS.** The entire security model depends on the key never leaving the NUC.

---

## Service Boot Order

```
wg-quick@wg0.service          (WireGuard tunnel)
    ↓
vault-mount.service            (NBD → LUKS → BTRFS → /mnt/vault)
    ↓
nfs-kernel-server.service      (NFS export)
```

## Troubleshooting

### WireGuard tunnel not coming up
```bash
# Check WireGuard status
wg show
journalctl -u wg-quick@wg0

# Verify port forwarding (from external machine)
nc -uzv <your-home-ip> 51820
```

### NBD connection fails
```bash
# Check NBD server on Contabo
systemctl status nbd-server
ss -tlnp | grep 10809

# Check NBD client on NUC
lsmod | grep nbd
nbd-client -c /dev/nbd0
```

### LUKS won't open
```bash
# Verify keyfile exists and has correct permissions
ls -la /root/.vault-key
# Should be: -r-------- 1 root root 4096

# Test manual open
cryptsetup luksOpen --key-file /root/.vault-key /dev/nbd0 vault
```

### NFS not accessible
```bash
# Check exports
exportfs -v
showmount -e localhost

# Check NFS server status
systemctl status nfs-kernel-server
```

### RKE2 agent won't join
```bash
# On Contabo, check RKE2 agent logs
journalctl -u rke2-agent -f

# Verify tunnel is up and control plane reachable
ping 10.10.0.1
curl -k https://10.10.0.1:9345
```
