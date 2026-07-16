# Phase 6 — LangGraph Orchestration, Persistence, and Background Processing

## What was built

**LangGraph** (`lib/langgraph/`)
- `state.ts` — shared `GraphStateAnnotation`, Zod schemas for `Diagnosis` and the remediation plan (structured LLM output).
- `graph.ts` — compiles `monitor -> detectAnomaly -> [diagnose -> calculateImpact -> planRemediation] -> audit`. Every node is wrapped by `withNodeInstrumentation`, which times it, persists an `AgentNodeRun` row, and converts a thrown error into `state.error` instead of crashing the run.
- `routes.ts` — conditional routing: no anomaly or any node error routes straight to `audit` then `END`; recursion limit (`DEFAULT_RECURSION_LIMIT = 25`) is enforced via graph config at invoke time.
- `nodes/*.ts` — one file per node. `diagnose.ts`/`plan-remediation.ts` are the only nodes that call an LLM (Groq JSON mode, validated via `structured-output.ts` with one retry on schema violation). All dollar figures in the remediation plan are overwritten with `lib/financial/rightsizing.ts`'s deterministic computation after generation — the LLM's own number is never trusted.
- `run-registry.ts` — in-memory broadcaster (same `subscribe()` shape as `simulationStore`/`anomalyDetector`) that runs the graph exactly once via `cloudPilotGraph.stream(..., { streamMode: 'values' })` and fans real per-node events out to SSE subscribers.

**API** (`app/api/graph/`)
- `POST /api/graph/run` — starts a run, returns `{ runId, status: 'running' }` immediately (202); the graph keeps executing in the background.
- `GET /api/graph/runs/:runId` — persisted `AgentRun` + `AgentNodeRun[]` from the database.
- `GET /api/graph/runs/:runId/stream` — SSE feed of `node_event` / `run_completed` / `run_failed`, sourced from `run-registry.ts`.
- `components/graph-terminal.tsx` — new terminal UI (mirrors `agent-terminal.tsx`'s style) wired to these three endpoints; mounted on `/` under "LangGraph Orchestration".

**Persistence** (`prisma/schema.prisma`, `lib/db/`)
- All twelve required models, each with the indexes called for (resource+timestamp, anomaly status+severity, agent-run status/runId, terraform-execution status, etc).
- `lib/db/client.ts` — `PrismaClient` singleton (globalThis-cached, same pattern as `simulationStore`).
- `lib/db/repositories/agent-run-repository.ts` — the only module that writes `AgentRun`/`AgentNodeRun` rows.
- In-memory stores (`simulationStore`, `anomalyDetector`) were **not** replaced — they remain the live simulation source of truth; Prisma is the system of record for graph runs, remediation, and the Terraform/audit trail, per the phase brief ("replace in-memory storage where appropriate").
- Prisma pinned to **6.19.3**, not the newly-released 7.x, because 7's default install crashed on this Windows/pnpm setup (`ERR_REQUIRE_ESM` in `@prisma/dev`) before a single command could run.

**Redis / BullMQ** (`lib/queue/`, `workers/`)
- `connection.ts` (singleton `ioredis`, `maxRetriesPerRequest: null` as BullMQ requires), `queues.ts` (six queues, default `attempts: 3` + exponential backoff, bounded `removeOnComplete`/`removeOnFail` so failed jobs are inspectable), `job-types.ts` (Zod schema per queue, enforced in `queues.ts#enqueue` before a job ever reaches Redis).
- `workers/terraform-worker.ts` runs three `Worker`s (validation, plan, execution — the execution one at `concurrency: 1` since applies against the same simulated resource must serialize) and is the only place a Terraform-shaped operation (simulated apply against `simulationStore`, since there's no real cloud account or `terraform` binary in this repo) runs — never inside a route handler.
- `workers/simulation-worker.ts`, `verification-worker.ts`, `audit-worker.ts` — one `Worker` each.
- Idempotency: `enqueueTerraformExecutionJob` defaults `jobId` to the caller's `idempotencyKey` (BullMQ dedups by job id); the execution worker also short-circuits if the `TerraformExecution` row is already terminal; the verification worker short-circuits if a result already exists for that execution.
- Graceful shutdown: `lib/queue/shutdown.ts#registerGracefulShutdown` closes all workers (waits for in-flight jobs) and the Redis connection on `SIGTERM`/`SIGINT`.

## Config

New env vars (`.env.example`): `DATABASE_URL` (Postgres, required by Prisma), `REDIS_URL` (defaults to `redis://localhost:6379` if unset).

New scripts: `prisma:generate`, `prisma:migrate`, `prisma:studio`, `worker:terraform`, `worker:simulation`, `worker:verification`, `worker:audit`.

## Verified

- `npx tsc --noEmit` — clean.
- `npx eslint .` (new files) — clean.
- `npx next build` — succeeds; all three `/api/graph/*` routes register as dynamic.
- `npx vitest run` — all 171 pre-existing tests still pass.
- `npx prisma validate` / `prisma generate` — schema is valid and the client generates.

## Not done / needs real infra to exercise

No `DATABASE_URL`/`REDIS_URL` were configured against a live Postgres/Redis in this environment, so `prisma migrate dev` and an actual end-to-end worker run were not executed — only validated statically (schema validation, typecheck, build). No new automated tests were added for the graph/queue code (the existing suite has no Postgres/Redis test harness); running a real migration and adding integration tests against a test database is the natural next step.
