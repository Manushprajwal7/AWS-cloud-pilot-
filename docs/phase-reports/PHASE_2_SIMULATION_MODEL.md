# Phase 2 — Build the Simulation Domain Model

**Date:** 2026-07-16
**Scope:** A real, server-owned simulation domain model and store. No tick engine, no API routes, no UI wiring — those are explicitly Phase 3+. This phase produces the data model and the store that Phase 3's tick engine will drive.

**Process note:** Phase 3's spec arrived in the same message as this phase. Per the standing project rule ("build one phase at a time... do not continue to the next phase automatically"), only Phase 2 was implemented. Phase 3 is queued and will start on your next go-ahead.

---

## 1. New files

### `lib/simulation/types.ts`
The domain model, matching the project's stated spec exactly: `CloudService`, `CloudEnvironment`, `ResourceStatus`, `ScenarioType`, and `SimulatedCloudResource` (id/name/service/environment/region/status/configuration/metrics/cost/activeScenario/updatedAt). Added on top of the spec: `MetricSnapshot` (a timestamped metrics+cost record, for history) and a small `SimulationStoreEvent`/`SimulationStoreListener` pair for the subscribe API — both necessary to implement "save metric snapshot" and "subscribe to updates" as actual typed contracts rather than `unknown`.

### `lib/simulation/resources.ts`
- `calculateCost(service, configuration, metrics)` — pure function, hourly/daily/monthly cost. EC2/RDS/ElastiCache use a static base-rate table (plausible us-east-1 on-demand pricing); ECS is priced as Fargate (`taskCount × (vcpu × $/vcpu-hr + memoryGb × $/GB-hr)`); Lambda is priced from a GB-second rate driven by request volume, so cost genuinely changes with the resource's `requestsPerMinute` metric rather than being a fixed number. Daily is always `hourly × 24`, monthly always `hourly × 730` — enforced structurally by the function, not by convention.
- `createResource()` — factory that fills in baseline metrics, computes cost, and stamps `updatedAt`.
- `buildSeedResources()` — the 8 required resources, one call per store creation (returns fresh objects/timestamps each time, so `resetResource` can restore a true, independent seed copy rather than a shared mutable reference):

| id | name | service | environment | instance/config |
|---|---|---|---|---|
| res-ec2-dev-01 | dev-web-01 | EC2 | development | t3.small |
| res-ec2-staging-01 | staging-web-01 | EC2 | staging | m5.large |
| res-ec2-prod-01 | prod-web-01 | EC2 | production | m5.xlarge |
| res-rds-staging-01 | staging-orders-db | RDS | staging | db.t3.medium |
| res-rds-prod-01 | prod-orders-db | RDS | production | db.r5.xlarge |
| res-ecs-prod-01 | prod-checkout-service | ECS | production | 3 tasks × 1 vCPU/2GB, autoscale 2–8 |
| res-lambda-prod-01 | prod-image-resizer | LAMBDA | production | 512MB |
| res-elasticache-prod-01 | prod-session-cache | ELASTICACHE | production | cache.r6g.large |

### `lib/simulation/scenarios.ts`
`SCENARIO_DEFINITIONS` — one entry per `ScenarioType` (`NORMAL`, `CPU_SPIKE`, `IDLE_RESOURCE`, `MEMORY_LEAK`, `OVERPROVISIONED`, `COST_SPIKE`, `TRAFFIC_SURGE`), each with a label, description, the `ResourceStatus` it implies (e.g. `CPU_SPIKE` → `degraded`, `IDLE_RESOURCE` → `optimizing`), and a target `ResourceMetrics` baseline. This is the static reference table both the store's `activateScenario` and Phase 3's tick engine build on — Phase 3 owns *continuous progression toward* these targets (ramp-up, recovery), this module just owns *what the target state is*.

### `lib/simulation/metric-generator.ts`
`generateMetrics(scenario, options)` — pure, single-shot metric snapshot generation with **injectable randomness** (`options.random`, defaults to `Math.random`). Jitters ±8% around the scenario's target values, clamps percentages to `[0, 100]` and other fields to `>= 0`. `idleHours` is handled specially: it accumulates from `options.previousMetrics` rather than jittering around a fixed point, since "idle for 6 hours" shouldn't randomly reset to 1 between reads. The injectable-random design is what makes this — and Phase 3's tick engine, which will call it every tick — deterministic under test with a seeded source, satisfying the master spec's "Deterministic seeded randomness for tests" requirement a phase ahead of when it's due, since it's cheaper to build it into the generator now than retrofit it later.

### `lib/simulation/simulation-store.ts`
`createSimulationStore()` — factory returning an isolated store; `simulationStore` — the shared singleton API routes will use. Implements all 7 required operations:

| Operation | Behavior |
|---|---|
| `listResources()` | Returns all resources, sorted by id, as defensive deep copies |
| `getResource(id)` | Returns a copy, or `undefined` if not found (non-throwing lookup) |
| `updateResource(id, updates)` | Merges a partial update, throws `SimulationResourceNotFoundError` if the id doesn't exist |
| `activateScenario(id, scenario)` | Applies the scenario's target metrics/cost/status, throws `InvalidScenarioError` for a bad scenario value |
| `resetResource(id)` | Restores the resource to its original seed state and clears its metric history |
| `saveMetricSnapshot(id, metrics)` | Updates current metrics/cost and appends a capped (500 entries/resource) history record |
| `subscribe(listener)` | Registers a listener, returns an unsubscribe function; every mutating op notifies subscribers with a typed event |

Every getter returns `structuredClone`d data — callers (including a future React layer) can freely hold or mutate what they get back without corrupting store state. This is also what makes "do not use React component state as the source of truth" enforceable: the store is the only place state actually lives; anything else is a read-only snapshot.

`getMetricHistory(id)` was added beyond the literal required-operations list — it's the one-line accessor `saveMetricSnapshot`'s history needs to be observable/testable at all, not a scope expansion.

---

## 2. Tests (`vitest`)

**79 tests across 4 new files, all passing**, plus the 33 from Phase 1 (112 total):

| Requirement | Coverage |
|---|---|
| Resource initialization | 8 seeded resources, unique ids, all 5 service types present, all 3 environments present, EC2 present in all three environments, RDS in staging+production, every resource starts `NORMAL`/`running` with positive cost and a valid timestamp |
| Scenario activation | `CPU_SPIKE` drives `cpuPercent > 80` and `status: degraded`; `IDLE_RESOURCE` drives `cpuPercent < 10`, accumulates `idleHours`, and `status: optimizing`; cost recalculates; `updatedAt` advances; subscribers are notified with the right event shape |
| Resource reset | Restores `NORMAL`/`running`, restores original metrics and cost exactly, clears metric history, notifies subscribers |
| Cost calculations | daily = hourly×24 and monthly = hourly×730 structurally; larger EC2 instance costs more; ECS scales linearly with task count; Lambda cost rises with request volume; unknown instance types fall back to a default rate instead of throwing |
| Invalid resource handling | Every mutating store method throws `SimulationResourceNotFoundError` (carrying the offending id) for an unknown id; `getResource`/lookup-only paths return `undefined` instead of throwing; `activateScenario` throws `InvalidScenarioError` for a non-existent scenario value |

Also covered, adjacent to the required list: `metric-generator.ts`'s determinism under a fixed random source and clamping behavior under extreme jitter (this is what Phase 3's seeded-randomness requirement will lean on), and the store's defensive-copy semantics (mutating a returned resource doesn't affect the store), history capping at 500 entries, and subscribe/unsubscribe correctly stopping delivery.

---

## 3. Verification

```
npm run test        → 7 files, 112 tests, all passing (79 new + 33 from Phase 1)
npx tsc --noEmit      → 0 errors
npm run lint           → 0 errors (7 pre-existing warnings, unchanged from Phase 0/1)
npm run build            → succeeds, all 6 routes compile
```

No API routes, UI components, or existing files were touched in this phase — it's additive only under `lib/simulation/`.

---

## 4. Notes for Phase 3

- `metric-generator.ts` already accepts an injectable `random` source and a `previousMetrics` hint — the tick engine should reuse it per-tick rather than reimplementing jitter logic, supplying a seeded PRNG for deterministic tests and the resource's last known metrics for continuity (idle-hour accumulation, gradual memory-leak growth, etc.).
- `scenarios.ts`'s `targetMetrics` are the *destination* a scenario drives toward; Phase 3's "CPU spike progression," "memory leak progression," "recovery behaviour" etc. all need to interpolate from a resource's current metrics toward (or away from, on recovery) these targets over successive ticks — that interpolation logic belongs in the new `scenario-runners.ts`, not here.
- The store's `saveMetricSnapshot` already does exactly what a tick needs (recompute cost, update current state, append to a capped history) — the tick engine's job is to call it on an interval with the tick-generated metrics, not to duplicate its bookkeeping.
- `simulationStore` is an in-memory singleton and will not survive a server restart or serverless cold start, same limitation the Phase 0 audit flagged for `lib/mockAwsState.ts`. Persistence is out of scope for both this phase and (per the phase list so far) the next.

---

*Phase 2 complete. Stopping here per the "build one phase at a time" rule — do not proceed to Phase 3 without explicit instruction.*
