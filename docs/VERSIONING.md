# Versioning & Release Policy

## Principles

1. **Git is the source of truth** — every deployed state is a git commit
2. **No manual deploys** — CI builds, pins, and ArgoCD rolls out
3. **Immutable tags** — deployments reference short SHA, never `:latest`
4. **Semver for humans** — SHA for machines, semver for changelogs and discussion

## Image Tag Strategy

Every app in `apps/` with a `Dockerfile` gets three tags on each build:

| Tag | Example | Purpose |
|-----|---------|---------|
| `:<sha-short>` | `:399b0b4` | **Immutable reference** — used in k8s manifests |
| `:<semver>` | `:0.2.0` | Human-readable version from `package.json` |
| `:latest` | `:latest` | Convenience for local dev only — never used in manifests |

## Deployment Flow

```
1. Developer pushes to master (apps/ change)
         ↓
2. CI: docker.yml detects changed apps
         ↓
3. CI: Builds image, pushes 3 tags to GHCR
         ↓
4. CI: pin job updates infra/manifests/<app>/deployment.yaml
       with the new :<sha-short> tag
         ↓
5. CI: Commits "[skip ci] deploy(<app>): pin image to <sha>"
         ↓
6. ArgoCD: detects manifest change, rolls out new pods
```

No manual `kubectl rollout restart`. No `imagePullPolicy: Always` needed.

## Semver Convention

Version lives in `apps/<app>/package.json`:

- **patch** (0.1.1) — bug fixes, config changes, dependency bumps
- **minor** (0.2.0) — new features, UI changes, new endpoints
- **major** (1.0.0) — breaking changes, major redesign

Bump the version in the same commit as the code change.

## Third-Party Images

Third-party images are pinned to specific versions (not SHA):

```yaml
# ✅ Good — pinned to release version
image: hasura/graphql-engine:v2.48.13
image: jellyfin/jellyfin:10.11.6

# ❌ Bad — floating tag
image: nginx:alpine
image: busybox:latest
```

Renovate or manual PRs handle third-party version bumps.

## Commit Convention

The CI pin commit uses `[skip ci]` to prevent infinite loops:

```
deploy(radio-web): pin image to 399b0b4 [skip ci]
```

App code changes use conventional commits:

```
feat(radio-web): add skip button
fix(tts-server): handle timeout on Hume API
chore(ptt-server): bump dependencies
```

## Apps Managed

| App | GHCR Package | Manifest |
|-----|-------------|----------|
| `ptt-server` | `ghcr.io/binary64/ptt-server` | `infra/manifests/ptt-server/` |
| `radio-web` | `ghcr.io/binary64/radio-web` | `infra/manifests/radio-web/` |
| `tts-server` | `ghcr.io/binary64/tts-server` | `infra/manifests/tts-server/` |
| `watch-adb-discover` | `ghcr.io/binary64/watch-adb-discover` | `infra/manifests/watch-adb-discover/` |

## Adding a New App

1. Create `apps/<name>/` with `Dockerfile` and `package.json` (with `version` field)
2. Create `infra/manifests/<name>/deployment.yaml` with image `ghcr.io/binary64/<name>:initial`
3. Push to master — CI auto-builds and pins

## Manual Trigger

Rebuild a specific app without code changes:

```
gh workflow run docker.yml -f app=radio-web
```
