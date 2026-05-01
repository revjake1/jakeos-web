# jakeos-web

JakeOS dashboard at `https://jakeos.jakehallman.com`. Phase 3.1 of
[`jakeos-dashboard-v1`](https://github.com/revjake1/jakeos/tree/main/openspec/changes/jakeos-dashboard-v1).

## Stack

- Node 20 + [Hono](https://hono.dev) (small, fast HTTP framework)
- [HTMX](https://htmx.org) loaded from CDN; each section polls its own
  fragment endpoint (`hx-trigger="every Ns"`)
- Plain template-literal templating (no extra runtime deps)
- In-memory cache so an offline sidecar still renders last-known state

## Routes

| Path | Trigger | Body |
| --- | --- | --- |
| `GET /` | shell | full HTML |
| `GET /sections/{todos,emails,calendar,employment,briefings,captures,self-loop}` | HTMX poll | fragment |
| `GET /partials/offline` | HTMX poll (15s) | offline-banner fragment |
| `POST /cowork` | bottom input | classifies → `/todos` or `/ideas` on sidecar |
| `POST /todos/:id/complete` | section button | proxies to sidecar PATCH |
| `POST /self-loop/:id/review` | section button | proxies to sidecar POST `{action}` |
| `POST /ingest/rescan` | "Re-scan now" | proxies to sidecar |
| `GET /healthz`, `GET /livez` | docker healthcheck | bypass auth |

## Configuration

| env | default | meaning |
| --- | --- | --- |
| `PORT` | `3000` | listen port |
| `SIDECAR_BASE_URL` | `http://100.122.117.106:7843` | Mac sidecar tailnet URL |
| `SIDECAR_TIMEOUT_MS` | `4000` | per-request timeout |
| `JAKEOS_ALLOWED_EMAIL` | `jake.hallman@gmail.com` | belt-and-suspenders identity check |

## Auth

`oauth2-proxy` sits in front and is the source of truth for auth. We trust the
forwarded headers (`X-Forwarded-Email`, `X-Forwarded-User`,
`X-Forwarded-Access-Token` and the `X-Auth-Request-*` aliases) because the only
way into the container is through that proxy. We re-check the email matches
`JAKEOS_ALLOWED_EMAIL` and refuse with 403 if not.

The Google access token is forwarded to the sidecar as
`X-Google-Access-Token` on every request that may need Gmail/Calendar scope.

## Offline behavior

`src/sidecar.js` keeps a process-local cache of every successful `GET`. On a
failed call:

- `getCached` returns `{ value: <last cached>, stale: true, error }` (or
  `value: null` if nothing was cached yet)
- `post`/`patch` return `{ ok: false, error }`
- The shell renders an offline banner; section bodies show a "stale" tag;
  write controls disable.

## Build

```sh
docker build -t ghcr.io/revjake1/jakeos-web:latest .
docker push ghcr.io/revjake1/jakeos-web:latest
```

## Run locally

```sh
npm install
SIDECAR_BASE_URL=http://localhost:7843 \
JAKEOS_ALLOWED_EMAIL=jake.hallman@gmail.com \
node src/server.js
# then:
curl -H 'X-Forwarded-Email: jake.hallman@gmail.com' http://localhost:3000/
```
