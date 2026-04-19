# hermes/agent-browser.json — rationale

Committed config for the agent-browser CLI, symlinked into
`~/.hermes/agent-browser.json` by `bootstrap-env.sh`.

JSON doesn't support comments, so field rationale lives here.

| Field | Value | Why |
|-------|-------|-----|
| `executablePath` | `/usr/bin/brave-browser` | Use the real Brave binary over bundled Chromium. Same engine, but real Brave has a stealth-friendly user-agent and doesn't announce `HeadlessChrome`. Installed by `bootstrap-host.sh`. |
| `headed` | `true` | Avoid `--headless=new` fingerprint. Requires Xvfb :99 (see `infra/systemd/hermes-xvfb.service`). Headless Chromium is detectable via `navigator.webdriver`, missing WebGL extensions, and UA sniffing. |
| `proxy` | `socks5h://127.0.0.1:1080` | Loopback SOCKS5 supplied by `kubectl port-forward → svc/socks-proxy` (see `infra/systemd/hermes-socks-proxy.service`). `socks5h://` ensures DNS resolution goes **through** the proxy, so no DNS leak reveals that the request originated from the Contabo VPS. Egress lands on master's residential IP. |

Change policy: any edit here must be paired with either a Brave upgrade or a
change to `hermes-xvfb.service` / `hermes-socks-proxy.service`.
