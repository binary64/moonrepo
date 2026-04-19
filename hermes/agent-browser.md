# hermes/agent-browser.json — rationale

Committed config for the agent-browser CLI, symlinked into
`~/.hermes/agent-browser.json` by `bootstrap-env.sh`.

JSON doesn't support comments, so field rationale lives here.

| Field | Value | Why |
|-------|-------|-----|
| `executablePath` | `/usr/bin/brave-browser` | Use the real Brave binary over bundled Chromium. Same engine, but real Brave has a stealth-friendly user-agent and doesn't announce `HeadlessChrome`. Installed by `bootstrap-host.sh`. |
| `headed` | `true` | Avoid `--headless=new` fingerprint. Requires Xvfb :99 (see `infra/systemd/hermes-xvfb.service`). Headless Chromium is detectable via `navigator.webdriver`, missing WebGL extensions, and UA sniffing. |

## Proxy is set via env var, NOT this file

agent-browser's `proxy` JSON field and `--proxy` CLI flag only accept
**HTTP/HTTPS** proxy URLs (documented in the bundled `proxy-support.md`).
For SOCKS5, the supported path is the `ALL_PROXY` env var:

```
ALL_PROXY=socks5://127.0.0.1:1080
```

`bootstrap-env.sh` writes this into `~/.hermes/.env` alongside
`DISPLAY=:99`. Loopback endpoint provided by
`infra/systemd/hermes-socks-proxy.service` (kubectl port-forward →
`svc/socks-proxy` → master's residential IP).

Note: `socks5h://` (DNS-via-proxy) is a curl-ism; Chromium/Brave always
resolves DNS through the proxy when `ALL_PROXY=socks5://...`, so no leak.

Change policy: any edit here must be paired with either a Brave upgrade or a
change to `hermes-xvfb.service` / `hermes-socks-proxy.service`.
