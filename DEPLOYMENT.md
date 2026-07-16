# AWS CloudPilot — Local Runtime & Deployment Guide

This guide covers running the complete stack (Next.js app, LangGraph orchestration,
Postgres, Redis, BullMQ workers, and the Terraform sandbox) reproducibly, either
directly on the host or via Docker Compose.

## Prerequisites

- Node.js 20+
- pnpm (`corepack enable` if you don't have it)
- A [Groq API key](https://console.groq.com/) (`GROQ_API_KEY`)
- For the full stack: Docker (Docker Compose v2) — or a local PostgreSQL 16+ and Redis 7+
- Optional, for the real Terraform sandbox path: the `terraform` CLI on your PATH, or
  Docker (`lib/terraform/sandbox.ts` prefers running `terraform` inside a container
  when Docker is reachable, and falls back to a host binary otherwise — see
  `docs/phase-reports/PHASE_7_TERRAFORM_SANDBOX.md`)

## Option A — Docker Compose (recommended, full stack)

```bash
cp .env.example .env
# edit .env and set GROQ_API_KEY

docker compose up
```

This starts, in dependency order (via Compose health checks — see "Startup ordering" below):

1. `postgres` (PostgreSQL 16) and `redis` (Redis 7), until both report healthy
2. `migrate` — a one-shot container that runs `prisma migrate deploy`, then exits
3. `app` (the Next.js server, `http://localhost:3000`) and the four `worker-*`
   containers (`terraform`, `simulation`, `verification`, `audit`), once `migrate`
   has *succeeded* — not merely once Postgres is reachable

Tear down with `docker compose down` (add `-v` to also drop the Postgres/Redis volumes).

### What's in each image

- **`Dockerfile`** — the Next.js app, built as `output: 'standalone'` (a minimal,
  self-contained server bundle, not the full `node_modules` tree). Also has a pinned
  Terraform CLI installed, since the real Terraform sandbox pipeline
  (`lib/terraform/sandbox.ts`, invoked from `POST /api/graph/run`) runs inside this
  container's process, not a separate worker.
- **`Dockerfile.worker`** — the four BullMQ consumers (`workers/*.ts`, run via `tsx`,
  not pre-compiled). `docker-compose.yml` runs four containers from this one image,
  each with a different `command:` — one process per container, matching how they're
  run locally (`pnpm worker:<name>`).

### Startup ordering & health

Every service that depends on Postgres/Redis uses Compose's
`depends_on: <service>: condition: service_healthy` (backed by `pg_isready` /
`redis-cli ping`), and everything that depends on `migrate` uses
`condition: service_completed_successfully` — a *reachable-but-unmigrated* database is
never treated as ready. The `app` container exposes `GET /api/health` (used by its
own `HEALTHCHECK`), which independently probes both Postgres and Redis with a 2s
timeout and reports each as `ok` or a real error — never a fabricated "healthy" for a
dependency that was never actually checked. The four worker containers have no HTTP
endpoint, so their health checks use `pgrep` to confirm the process is still alive;
combined with the Redis heartbeat each worker writes every 10s
(`lib/queue/heartbeat.ts`, surfaced on the dashboard via
`GET /api/dashboard/system-status`), that gives both "is the container alive" and
"is it actually connected and processing."

### Terraform sandbox isolation in Docker

No Docker socket is mounted into the `app` container, so
`lib/terraform/sandbox.ts`'s Docker-isolated execution path (`docker run
hashicorp/terraform`) is unavailable there and it automatically falls back to the
pinned host-binary Terraform CLI baked into the image — network isolation can't be
enforced in that mode (documented in Phase 7). Mounting the host's Docker socket would
enable the stronger, network-isolated path, but grants the container
root-equivalent access to the host; this compose file deliberately does not do that
by default. If you need the isolated path, add
`- /var/run/docker.sock:/var/run/docker.sock` to the `app` service and install the
`docker` CLI in `Dockerfile`'s `runner` stage, understanding that trade-off.

## Option B — run directly on the host

```bash
cp .env.example .env
# edit .env: set GROQ_API_KEY, and point DATABASE_URL/REDIS_URL at your local
# Postgres/Redis (docker compose up postgres redis is a quick way to get both
# without running the whole stack)

pnpm install
pnpm prisma:migrate      # applies migrations, prompts for a name on first run
pnpm dev                 # Next.js app on http://localhost:3000
pnpm worker               # all four BullMQ workers, in one terminal
```

`pnpm worker` runs all four workers concurrently (via `concurrently`, one color-coded
stream per worker); `pnpm worker:terraform` / `worker:simulation` /
`worker:verification` / `worker:audit` run them individually if you want separate
terminals.

## Required package scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build (`next build`) |
| `pnpm start` | Serve a production build (`next start`) |
| `pnpm worker` | All four background workers, concurrently |
| `pnpm worker:<name>` | One worker (`terraform`\|`simulation`\|`verification`\|`audit`) |
| `pnpm prisma:migrate` | Interactive migration (local dev) |
| `pnpm prisma:migrate:deploy` | Non-interactive migration (Docker/CI) |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest |

## Environment variables

See `.env.example` for the full, documented list. Required: `GROQ_API_KEY`,
`DATABASE_URL`, `REDIS_URL`. Docker Compose builds `DATABASE_URL`/`REDIS_URL` itself
from `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` and the `postgres`/`redis`
service names — the same variable *names* are used in both `pnpm dev` and
`docker compose up`, only the host differs (`localhost` vs. the container network).

`GROQ_API_KEY` is a server-only secret: it's only ever imported by `lib/ai/groq.ts`
and `lib/langgraph/structured-output.ts` (both server modules), never referenced with
a `NEXT_PUBLIC_` prefix, and never sent to or read by any client component.

## Final validation

Before shipping a change, all three must pass clean — no suppressed errors:

```bash
pnpm lint
npx tsc --noEmit
pnpm build
```

## Further reading

- `docs/phase-reports/` — one report per build phase, including the honest gaps in
  each (what was verified vs. what requires infra not available in every environment)
- `docs/CLOUDPILOT_IMPLEMENTATION_AUDIT.md` — the original Phase 0 state-of-the-repo audit
