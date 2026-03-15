# Contabo VPS — First Login Runbook

One-time setup after ordering. You start with root + password over SSH.

---

## 1. SSH Hardening

```bash
# Copy your SSH key from your local machine first:
# ssh-copy-id root@<CONTABO_IP>

# Then on the VPS:
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

Verify you can still SSH in with your key before closing the session.

## 2. UFW — Allow Only Your Home IP

```bash
apt-get update && apt-get install -y ufw

# Default deny everything inbound
ufw default deny incoming
ufw default allow outgoing

# Allow SSH + NBD only from your home IP
ufw allow from <YOUR_HOME_IP> to any port 22 proto tcp
ufw allow from <YOUR_HOME_IP> to any port 10809 proto tcp
ufw allow from <YOUR_HOME_IP> to any port 9345 proto tcp   # RKE2 join
ufw allow from <YOUR_HOME_IP> to any port 6443 proto tcp   # k8s API

ufw enable
ufw status
```

### Adding IPs Later

```bash
# Allow a new IP
ufw allow from <NEW_IP> to any port 22 proto tcp
ufw allow from <NEW_IP> to any port 10809 proto tcp

# Remove an old IP
ufw delete allow from <OLD_IP> to any port 22 proto tcp
ufw delete allow from <OLD_IP> to any port 10809 proto tcp

# Check current rules
ufw status numbered
```

If your home IP changes (dynamic ISP), update the rules or consider a DDNS-based approach.

## 3. Install Packages

```bash
apt-get install -y nbd-server unzip htop curl wget ripgrep
```

## 4. Create Sparse Blockstore

```bash
truncate -s 1T /srv/blockstore.img
ls -lh /srv/blockstore.img
```


## 6. Join RKE2 Cluster

```bash
# Get the join token from the NUC first:
#   ssh root@192.168.1.201 cat /var/lib/rancher/rke2/server/node-token

curl -sfL https://get.rke2.io | INSTALL_RKE2_TYPE="agent" sh -

mkdir -p /etc/rancher/rke2
cat > /etc/rancher/rke2/config.yaml <<EOF
server: https://<YOUR_HOME_IP>:9345
token: <RKE2_TOKEN>
node-label:
  - "topology.kubernetes.io/zone=contabo-portsmouth"
  - "node.kubernetes.io/storage=true"
node-taint:
  - "node.kubernetes.io/storage=true:NoSchedule"
EOF

systemctl enable --now rke2-agent
journalctl -u rke2-agent -f   # watch it join
```

## 7. Verify

```bash
# On the NUC:
kubectl get nodes -o wide
# Should show the Contabo node as Ready with storage taint
```

---

## Notes

- NBD traffic is unencrypted on the wire, but the blocks are LUKS-encrypted — wire sniffers see noise
- RKE2 agent ↔ control plane traffic is TLS-encrypted
- The storage taint prevents random pods scheduling on Contabo
- If your home IP is dynamic, you'll need to update UFW rules when it changes
