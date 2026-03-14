# Systemd User Services

User-level systemd services for the VPS node.

## socks-proxy-forward.service

Persistent `kubectl port-forward` that exposes the cluster's SOCKS5 proxy
on `localhost:1080`.

**Why:** The VPS's datacenter IP is blocked by Cloudflare on sites like
ASDA and Coinbase. The SOCKS5 proxy runs on the master node (hostNetwork),
which has a residential broadband IP that isn't blocked.

**How:** A microsocks pod runs on the master with `hostNetwork: true`.
This service forwards `localhost:1080` to that pod via the k8s API tunnel.
The OpenClaw browser is configured to use `socks5://localhost:1080` via
`browser.extraArgs`.

**Setup:**

```bash
# 1. Deploy the socks-proxy manifests (or let ArgoCD sync)
kubectl apply -k infra/manifests/socks-proxy/

# 2. Install the port-forward service
cp socks-proxy-forward.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now socks-proxy-forward

# 3. Verify exit IP
curl --socks5-hostname localhost:1080 https://ifconfig.me
# Should return the master node's residential IP

# 4. Configure OpenClaw browser
openclaw config set browser.extraArgs '["--proxy-server=socks5://localhost:1080"]'

# 5. Restart gateway
openclaw gateway restart
```

**Architecture:**

```
VPS Node
├─ OpenClaw Gateway
│  └─ Brave Browser (headless)
│     └─ --proxy-server=socks5://localhost:1080
│        └─ kubectl port-forward (systemd)
│           └─ k8s API tunnel (flannel/VXLAN)
│              └─ socks-proxy pod (master, hostNetwork)
│                 └─ microsocks → residential broadband exit
```

No hardcoded IPs. Everything routes through the existing k8s cluster network.
