# Phase 10 — Security Hardening, Docker, and Reproducible Local Runtime

## Security audit results

Walked every item in the phase's requirement list against the actual codebase (grep sweeps + manual review), not from memory of what earlier phases intended:

| Requirement | Status | Evidence |
|---|---|---|
| No committed secrets | ✅ | `.env` is gitignored; repo has zero commits so far (`git log` confirms), so nothing has ever been committed regardless. `.env.example` contains no real values. |
| No client-exposed Groq key | ✅ | Zero `NEXT_PUBLIC_` references anywhere; no `'use client'` file imports `lib/ai/groq.ts` or reads `GROQ_API_KEY`. |
| No shell interpolation / arbitrary command execution | ✅ | The only `child_process.spawn` call (`lib/terraform/command-runner.ts`) uses `shell: false` and array-form args — never a concatenated string. No `exec`/`execSync` anywhere. |
| No host AWS credential access | ✅ | `command-runner.ts`'s environment allowlist never forwards `AWS_*` (or anything not explicitly listed). |
| No unrestricted Terraform providers | ✅ | `lib/terraform/provider-allowlist.ts` + `security-policy.ts`'s `allowed-providers-only` policy. |
| No path traversal | ✅ | Every filesystem path in `lib/terraform/temp-workspace.ts` is built from a server-generated `randomUUID()`, never a client-supplied value; no API route touches the filesystem at all (`grep` confirms). |
| No unbounded process execution | ✅ | `command-runner.ts`: fixed timeout with real `SIGTERM`→`SIGKILL`, 1MB/stream output cap. |
| No public destructive endpoints | ⚠️ accepted | `POST /api/simulation/reset`/`scenario` mutate only the in-memory *simulation* (never real infrastructure); real Terraform `apply` is never reachable directly, only via the hash-verified graph pipeline. This app has no auth system at all (true since Phase 0) — a full auth layer wasn't requested by any phase and is out of scope for a hardening pass; noted here rather than silently left undocumented. |
| No unsafe cross-user access | ⚠️ accepted | Same root cause: no multi-tenancy/auth exists. Run IDs are server-generated UUIDs (not enumerable), which is the practical mitigation available without inventing an auth system. |
| No fabricated monitoring/Terraform values, no hidden failures | ✅ | Structural, established since Phase 4 — every number traces to a deterministic calculation or a real command's output; failures set `error`/return non-2xx rather than being swallowed. |
| No TypeScript-error suppression | ✅ | `next.config.mjs` has no `ignoreBuildErrors`; zero `@ts-ignore`/`@ts-nocheck` anywhere; the two `@ts-expect-error` occurrences are in tests, deliberately exercising runtime validation of invalid input (not suppressing a real type error in shipped code). |
| No command execution / approval controlled by Groq | ✅ | `lib/terraform/generator.ts` and `self-correction.ts` never let Groq's response populate an executed code path; `auto-approval.ts#decideAutoApproval` has no LLM call in it or its dependency graph. |
| No Terraform apply inside Next.js request handlers | ✅ (see note) | `POST /api/graph/run`'s handler calls `startGraphRun` without awaiting it and returns immediately (202) — the handler itself never executes or blocks on apply. The graph (including `terraformApplyWorker`) still runs in the same Node process as the HTTP server, since there is no separate graph-execution worker process (unlike the BullMQ workers, which are separate processes). Fully decoupling graph execution into its own worker is a larger re-architecture (a job queue for graph runs, cross-process state/streaming) judged out of scope for a hardening pass — documented here rather than silently accepted. |
| No Terraform apply without immutable hash verification | ✅ | `terraformApplyWorker` re-derives the code/plan hash and compares against `PlanApproval` before running anything (Phase 8). |
| All external input validated with Zod | ✅ (gap closed this phase) | `GET /api/anomalies`, `GET /api/audit-events`, `GET /api/graph/runs` previously parsed query params with manual `Number()`/`includes()` checks — now use Zod (`app/api/anomalies/route.ts`, new `lib/api/pagination.ts` shared by the two list routes). |
| Strict TypeScript | ✅ | `tsconfig.json` already had `"strict": true`; confirmed no relaxation anywhere. |
| No `any` | ✅ | Zero occurrences (grep). |

## Fixes applied

- **`lib/queue/connection.ts`**: the shared Redis connection had no `error`/`reconnecting` listeners — a down Redis would retry silently forever with nothing in the logs. Added `error`/`reconnecting`/`ready` handlers so connectivity failures are visible (confirmed: `next build` output now shows `[redis] connection error: ...` / `reconnecting in Nms...` when Redis isn't running).
- **Zod validation gap**: `app/api/anomalies/route.ts` rewritten with a proper schema; `lib/api/pagination.ts` added and used by `GET /api/audit-events` and `GET /api/graph/runs`.
- **Dead code removal**: `app/api/metrics/route.ts` (Phase-1 SSE route calling now-orphaned `lib/mockAwsState.ts` helpers; nothing has imported it since the components that called it were removed in Phase 9) — deleted, along with its last remaining lint warnings. `lib/tools/cloudTools.ts`'s four no-op `execute(_input)` tool methods had their unused parameter removed entirely (TypeScript's structural typing allows a zero-arg function where the shared `Tool.execute` interface expects one arg — verified type-safe).
- **`vitest.config.mts`**: added `testTimeout: 15000` (default 5000ms was flaking `app/api/agent/route.test.ts` under full-suite parallel runs now that cold-import cost across 21 test files — langgraph, prisma, bullmq, ioredis, etc. — routinely exceeds 5s; verified genuinely slow, not hung, by running the file in isolation where it passed in ~1s). This is a real-cost fix, not a suppression — confirmed with three consecutive full-suite runs (171/171 passing) after the change.

## Docker & reproducible runtime

- **`Dockerfile`** (multi-stage: `base → deps → builder → runner`) builds the Next.js app as `output: 'standalone'` (added to `next.config.mjs`), with a pinned Terraform CLI installed in the runtime stage and a defensive dereferencing copy of the generated Prisma client into the standalone `node_modules` (a known Next.js-standalone + Prisma gotcha — the trace-based pruning can miss the native query engine binary since it's loaded via a dynamic `require`).
- **`Dockerfile.worker`**: one image for all four BullMQ workers; `docker-compose.yml` runs four containers from it with different `command:` overrides — one process per container, matching local dev (`pnpm worker:<name>`).
- **`docker-compose.yml`**: `postgres` (16-alpine) + `redis` (7-alpine) with real health checks (`pg_isready` / `redis-cli ping`); a one-shot `migrate` service (`prisma migrate deploy`) that everything else waits on via `condition: service_completed_successfully` — not just `service_healthy` on postgres, since a reachable-but-unmigrated database isn't actually ready; `app` and the four `worker-*` services depend on both. Worker health checks use `pgrep` (no HTTP endpoint to probe); `app`'s uses the new `GET /api/health`.
- **`GET /api/health`**: independently probes Postgres (`SELECT 1`) and Redis (`PING`) with a 2s timeout each, returns real per-dependency status — never a fabricated "healthy."
- **Terraform sandbox isolation**: no Docker socket is mounted into `app` by default (mounting it would grant the container root-equivalent host access — a real privilege-escalation trade-off, not appropriate as a silent default in a *hardening* phase), so the containerized app automatically uses `sandbox.ts`'s host-binary fallback path (the pinned Terraform CLI baked into the image) rather than the Docker-isolated path. Documented in `docker-compose.yml`'s comments and `DEPLOYMENT.md`, including how to opt into the socket-mount if the stronger isolation is wanted.
- **`.env.example`**: extended with `POSTGRES_*`/`REDIS_PORT`/`APP_PORT`/per-worker concurrency vars, with explicit notes on which apply to `docker compose up` vs. `pnpm dev`/`pnpm worker` (same variable *names* either way — only the hostnames differ, per the phase's "consistent environment contracts" requirement).
- **`package.json`**: added `worker` (all four workers via `concurrently`, verified with a live run) and `prisma:migrate:deploy` (non-interactive, for the `migrate` compose service).
- **`DEPLOYMENT.md`**: fully rewritten — the previous version was Phase-0-era and actively wrong (referenced `XAI_API_KEY`, `mockAwsState.ts` as the persistence layer, Vercel-only deployment). Now documents both the Docker Compose and host-run paths accurately.

## Verified

`pnpm lint` (zero warnings/errors), `npx tsc --noEmit` (clean), `pnpm build` (clean, all 15 routes registered), `pnpm test` (171/171, three consecutive full-suite runs). `docker compose config` validates the compose file syntactically.

## Known gap

The Docker daemon was not reachable in this session (`docker info` failed to reach the Docker Desktop engine partway through this phase, after having worked in Phase 7) — `docker compose build`/`up` could not be executed end-to-end here. The Dockerfiles were reviewed carefully by hand (including the Prisma-standalone gotcha above) and the compose file's syntax was validated via `docker compose config`, but an actual image build and container startup were not observed in this environment. This is the same class of infra-unavailability gap called out honestly in every prior phase report (no live Postgres/Redis to exercise against either) — not a claim of success where none was verified.
