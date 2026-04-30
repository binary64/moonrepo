# hermes/agent-browser.json — rationale

Committed config for the agent-browser CLI, symlinked into
`~/.hermes/agent-browser.json` by `bootstrap-env.sh`.

JSON doesn't support comments, so field rationale lives here.

| Field | Value | Why |
|-------|-------|-----|
| `executablePath` | `/usr/bin/brave-browser` | Use the real Brave binary over bundled Chromium. Same engine, but real Brave has a stealth-friendly user-agent and doesn't announce `HeadlessChrome`. Installed by `bootstrap-host.sh`. |
| `headed` | `true` | Avoid `--headless=new` fingerprint. Requires Xvfb :99 (see `infra/systemd/hermes-xvfb.service`). Headless Chromium is detectable via `navigator.webdriver`, missing WebGL extensions, and UA sniffing. |

## Proxy is set via env var, NOT this file

Both agent-browser's JSON `proxy` field and its `--proxy` flag **do** accept
`socks5://` URLs (they pass straight through to Playwright's Chromium launch
which speaks SOCKS5 via `--proxy-server`). The bundled `proxy-support.md`
only documents HTTP in examples, but SOCKS5 works — verified empirically
with `agent-browser --proxy socks5://... open ...` returning
`ERR_PROXY_CONNECTION_FAILED` against a closed port (i.e. the URL was
accepted and an outbound SOCKS5 handshake was attempted).

We still set the proxy via `ALL_PROXY` rather than the JSON field because:

1. It lives next to `NO_PROXY` (which only has an env-var interface), so
   bypass rules and proxy URL are configured in one place.
2. Changing the proxy endpoint doesn't require regenerating the JSON file —
   just edit `~/.hermes/.env` and restart hermes.
3. Keeps `hermes/agent-browser.json` minimal (two fields) so there's less
   moving parts in committed config.

```
ALL_PROXY=socks5://127.0.0.1:1080
NO_PROXY=localhost,127.0.0.0/8,10.43.0.0/16,10.42.0.0/16,.svc.cluster.local
```

`bootstrap-env.sh` writes both into `~/.hermes/.env` alongside `DISPLAY=:99`.
Loopback endpoint provided by `infra/systemd/hermes-socks-proxy.service`
(kubectl port-forward → `svc/socks-proxy` → master's residential IP).

Note: Chromium/Brave always resolves DNS through the proxy when launched
with `--proxy-server=socks5://...`, so no DNS leak (the `socks5h://` scheme
is curl-specific and not needed here).

Change policy: any edit here must be paired with either a Brave upgrade or a
change to `hermes-xvfb.service` / `hermes-socks-proxy.service`.
