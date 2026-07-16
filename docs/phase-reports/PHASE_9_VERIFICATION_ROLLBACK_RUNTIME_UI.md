# Phase 9 — Verification, Rollback, and Complete Runtime UI

## Graph shape (extends Phase 8)

```
... terraformApply -> verification -> [rollback | calculateRealizedSavings] -> audit -> END
```

`verification` always runs after `terraformApply` was actually attempted — including when apply failed, since "terraform apply fails" is itself one of the conditions it checks (`routeAfterTerraformApply`: only the immutable-plan hash-mismatch case, where nothing was ever applied, skips straight to `audit`).

## What "apply" actually mutates now

Phase 8 built the real `terraform apply` sandbox invocation but never connected it to anything to verify — this environment has no AWS credentials, so a real apply legitimately fails at the provider's own auth step. For verification/rollback to have real substance, `terraformApplyWorker` (`lib/langgraph/nodes/terraform-apply.ts`) was extended: a snapshot of the resource is captured (`lib/rollback/rollback-plan.ts#captureRollbackSnapshot`) before anything runs, and **only on a real exit-0 apply** does it mutate `simulationStore` to match the approved action (STOP → status change; RIGHTSIZE/SCALE_IN → recompute configuration+cost via the same deterministic recommendation functions generation used). SCHEDULE/SCALE_OUT/NO_ACTION have no immediate mutation (SCHEDULE is a future/external trigger, not an in-place change). This means in this environment, the ordinary path is genuinely "apply fails at auth → verification's `terraform_apply_succeeded` check fails → rollback runs and finds nothing to restore" — an honest, real outcome, not a fabricated success.

## Verification (`lib/verification/{health-checks,anomaly-checks,cost-checks}.ts` + `verificationWorker`)

Eight deterministic checks, all against the resource's real current simulated state: `terraform_apply_succeeded`, `resource_health`, `resource_availability`, `error_rate` (vs. the pre-apply baseline), `cpu_utilization`, `memory_utilization`, `no_unexpected_side_effects` (identity fields unchanged), and `original_anomaly_resolved` (re-runs `anomalyDetector.evaluateResource` — it doesn't auto-fire on a plain `updateResource()` call, only on `metric_snapshot_saved`/`resource_reset`, so this has to trigger re-evaluation explicitly) plus `cost_within_approved_estimate`. Every check is persisted as a real `VerificationResult` row (Phase 6 schema, unused until now).

## Rollback (`lib/rollback/rollback-plan.ts` + `rollbackWorker`)

Only reached when verification found a failing check. Restores the resource to the **exact** pre-apply snapshot via `simulationStore.updateResource(id, {...snapshot minus id})` — not a best-effort partial undo. Persists a real `RollbackRecord` (Phase 6 schema, also unused until now) with the concrete failing-check reasons.

## Realized savings (`calculateRealizedSavingsWorker`)

Only reached when verification passed (the change stuck). Compares the pre-apply snapshot's cost against the resource's real current cost using the same pricing model used everywhere else, and persists it on `RemediationPlan.realizedMonthlySavingsUsd` (new nullable column).

## Terraform Runtime UI (`components/dashboard/terraform-sandbox.tsx`)

Now surfaces everything the phase asked for from real GraphState: individual fmt/init/validate/plan/apply exit-code badges (`sandboxCommandResults`), itemized policy violations (not just the joined reason string), a verification-checks list, a rollback panel, and realized savings in the cost-impact card. The stale "apply is not implemented this phase" copy and the disabled Apply button were removed (Phase 8 already implemented apply — leaving that message was actively wrong). The "Reject" button was removed outright — it only ever cleared local view state, but its label read as a human override control, which the phase explicitly forbids; auto-approval's decision is now presented as final. Added three new real, functional actions: **Start Scenario** (`POST /api/simulation/scenario`), **Reset Simulation** (`POST /api/simulation/reset`), and **Open Resource Details** (`GET /api/simulation/resources/:id`, rendered as real JSON). The graph itself is rendered live via the new `GraphVisualizer`.

## Graph execution visualizer (`components/graph-visualizer.tsx`)

Self-contained: given a `runId`, loads the persisted `AgentNodeRun` history (`GET /api/graph/runs/:runId`) for whatever already happened, then subscribes to the live SSE stream for real-time updates. Node status is one of pending/running/completed/failed, with `rejected` and `rolled_back` derived from real fields (`securityValidation.passed`, `approvalDecision.decision`, `rollbackResult.rolledBack`) rather than invented states. Handles loading, error, and stream-disconnected states explicitly.

## Dashboard (`app/dashboard/page.tsx` and new components)

- **`GET /api/dashboard/summary`**: total spend/waste (already real, from Phase 4/5's in-memory stores) plus potential/realized savings and active/failed/completed graph-run counts from Postgres — with `dbAvailable: false` (not a fabricated zero) if the database isn't reachable, guarded by a 3s timeout race so a down database can't hang the request.
- **`GET /api/dashboard/system-status`**: real BullMQ `getJobCounts()` per queue and real worker liveness via a new Redis-heartbeat mechanism (`lib/queue/heartbeat.ts` — each of the 4 workers SETs a 30s-TTL key every 10s; a worker that was never started, crashed, or lost its Redis connection simply has no fresh key). Same timeout-race guard for a down Redis.
- **`GET /api/graph/runs`** / **`GET /api/audit-events`**: new list endpoints backing the dashboard's recent-runs and recent-activity panels.
- **Removed**: `agent-terminal-new.tsx` and `cloudwatch-logs.tsx` (both 100% hardcoded arrays with inert buttons, rendered on the real `/dashboard` page) were deleted and replaced with the real `GraphTerminal` and a new `RecentActivity` component (polls `GET /api/audit-events`). Also deleted three fully orphaned mock-only files nothing imported (`spending-chart.tsx`, `resource-table.tsx`, `simulation-controls.tsx`) and one broken-and-unused one (`metrics-display.tsx`, which called `.json()` on an SSE endpoint).
- **Added**: `SystemSummary` (savings/runs/worker/queue cards) and `GraphRunsPanel` (recent-runs list + `GraphVisualizer`), both with explicit loading/error/empty states via the existing `ChartLoadingState`/`ChartErrorState`/`ChartEmptyState` components.

## A note on React's new `set-state-in-effect` lint rule

`eslint-plugin-react-hooks` v7 (React Compiler rules) flags calling a function *reference* declared outside `useEffect`'s body from inside the effect, even when that function is async and every `setState` call inside it happens after an `await`. All three new polling components define their fetch/`setState` logic **inside** the effect body instead, with a `refreshToken` state bump to trigger manual re-fetches (Retry/Refresh buttons) — the idiomatic fix, not a suppression.

## Verified

`tsc --noEmit`, `eslint .` (zero new warnings/errors — the 7 pre-existing warnings are untouched files from earlier phases), `next build` (all new routes registered, exit 0 despite expected Redis-connection-refused noise since no Redis is running here), `vitest run` (171/171 pre-existing tests still pass), `prisma validate`.

## Known gaps

- No live end-to-end run was exercised against a real Postgres/Redis-backed `AgentRun` (same infra gap as Phases 6–8) — verification/rollback/realized-savings logic was validated by code review and type-checking, not by watching a full run land in the database.
- No automated tests were added for `lib/verification/*` or `lib/rollback/*` (same testing-harness gap noted in every prior phase report).
- The dashboard's worker/queue status and graph-run counts will show "unavailable" in this sandboxed environment since neither Postgres nor Redis is configured here — that's the correct, honest behavior for those endpoints, not a bug.
