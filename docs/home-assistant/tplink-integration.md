# TP-Link Smart Home Integration

## Devices

| Name | Model | Type | IP Address | Integration |
|------|-------|------|------------|-------------|
| Lounge 1 | Kasa KL130B | Colour bulb | YOUR_DEVICE_IP | `tplink` |
| Lounge 2 | Kasa KL130B | Colour bulb | TBD (auto-discover) | `tplink` |
| Smart Device | Tapo P304M(UK) | 4-way plug strip | TBD (auto-discover) | `tplink` |

## Prerequisites

- **TP-Link cloud account:** your-tplink-email@example.com
- Devices must be provisioned on the network via the **Kasa** or **Tapo** app first
- For the Tapo P304M: ensure "Third-Party Compatibility" is enabled in Tapo app under **Tapo Lab** settings

## Infrastructure Changes

### Host Networking

The HA pod requires `hostNetwork: true` to discover TP-Link devices on the LAN via UDP broadcast. This is configured in the Helm values in `application.yaml`:

```yaml
hostNetwork: true
dnsPolicy: ClusterFirstWithHostNet
```

- `hostNetwork: true` — allows HA to bind to the host's network interfaces, enabling LAN broadcast discovery
- `dnsPolicy: ClusterFirstWithHostNet` — ensures Kubernetes DNS still resolves (mosquitto, etc.) while on host networking

### Trusted Proxies

The your LAN subnet CIDR has been added to `trusted_proxies` since with host networking, traffic may arrive from the LAN subnet.

## Setup (via HA UI)

The TP-Link Smart Home integration is a **config flow** integration — it must be configured through the HA UI, not YAML.

### Auto-Discovery

After deploying with `hostNetwork: true`, HA should automatically discover TP-Link devices on the network. Check **Settings → Devices & Services → Discovered** for new devices.

### Manual Setup

If devices aren't auto-discovered:

1. Go to **Settings → Devices & Services**
2. Click **+ Add Integration**
3. Search for **TP-Link Smart Home**
4. Enter the device IP (e.g., `YOUR_DEVICE_IP` for Lounge 1)
5. When prompted, enter TP-Link cloud credentials:
   - **Username:** your-tplink-email@example.com
   - **Password:** (TP-Link cloud password)
6. Repeat for each device

### Expected Entities

After setup, the following entities should appear:

**Kasa KL130B Bulbs (Lounge 1 & 2):**
- `light.lounge_1` / `light.lounge_2` — on/off, brightness, colour temperature, RGB colour
- `sensor.lounge_1_current_consumption` — power usage (W)

**Tapo P304M Plug Strip:**
- `switch.smart_device` — master on/off
- `switch.smart_device_plug_1` through `switch.smart_device_plug_4` — individual socket control
- `sensor.smart_device_current_consumption` — power usage per socket

> **Note:** Entity names depend on the device names set in the Kasa/Tapo app.

## Post-Setup Script

A helper script is available to verify the integration is working:

```bash
# Port forward to HA
export KUBECONFIG=/home/user/clawd/kubeconfig.yaml
kubectl --context=prod -n home-assistant port-forward svc/home-assistant 8123:8123 &

# Check for TP-Link entities
HA_TOKEN=$(cat ~/.config/home-assistant/token)
curl -s http://localhost:8123/api/states \
  -H "Authorization: Bearer $HA_TOKEN" | \
  jq '[.[] | select(.entity_id | test("lounge|smart_device|tplink|tapo"))]'
```

## Troubleshooting

### Devices not discovered
- Verify `hostNetwork: true` is applied: `kubectl get pod home-assistant-0 -n home-assistant -o jsonpath='{.spec.hostNetwork}'`
- Ensure devices are on the same network (your LAN) as the k8s node
- Check HA logs: `kubectl logs -n home-assistant home-assistant-0 -c home-assistant | grep -i tplink`

### Authentication errors
- Kasa KL130B bulbs with newer firmware may require cloud credentials
- Tapo P304M always requires cloud credentials
- Verify credentials work in the Kasa/Tapo app first

### Istio interference
- With `hostNetwork: true`, the Istio ambient mesh (ztunnel) should still work
- If discovery fails, try annotating the pod with `sidecar.istio.io/inject: "false"`
- The namespace uses ambient mode (`istio.io/dataplane-mode: ambient`), which is compatible with host networking

## References

- [TP-Link Smart Home Integration Docs](https://www.home-assistant.io/integrations/tplink/)
- [python-kasa Supported Devices](https://python-kasa.readthedocs.io/en/stable/SUPPORTED.html)
- [pajikos HA Helm Chart](https://github.com/pajikos/home-assistant-helm-chart)
