# Phase 3 — Implement the Simulation Tick Engine

**Date:** 2026-07-16
**Scope:** Live telemetry generation on top of Phase 2's domain model/store, plus the `/api/simulation/*` routes. No UI wiring — that's Phase 4, which is why this phase was built first (see note below).

**Process note:** You originally asked for Phase 4 (connect the monitoring UI to `/api/simulation/stream`), but that endpoint — and the tick engine driving it — didn't exist yet; Phase 4 was unbuildable without it. You chose to build Phase 3 first, then Phase 4 as a separate phase. This report covers Phase 3 only; Phase 4 follows as its own phase/report.

---

## 1. New files

### `lib/simulation/scenario-runners.ts`
`stepResourceMetrics(current, scenario, { random, tickIntervalMs })` — pure, one-tick progression. Each field moves a fraction of the remaining distance toward its scenario's target (`APPROACH_RATE`, per scenario — e.g. `TRAFFIC_SURGE` closes 40%/tick, `MEMORY_LEAK` only 6%/tick so it visibly climbs over many ticks instead of jumping), plus small jitter (±3%, smaller than metric-generator's one-shot ±8% so a live series looks continuous, not noisy). `idleHours` accumulates by real elapsed time (`tickIntervalMs / 3,600,000`) while a scenario is idle-like (`IDLE_RESOURCE`, `OVERPROVISIONED`), and decays back toward 0 otherwise. Memory is capped at 99% during `MEMORY_LEAK` specifically (reads as "about to fail," not "pegged at the ceiling forever"); all percentage fields are clamped to `[0, 100]` regardless of scenario or jitter direction.

**Recovery is not a special case** — switching a resource's scenario to `NORMAL` and continuing to tick it uses the exact same `approach()` mechanism, just targeting the `NORMAL` baseline instead of a spike. This was a deliberate design simplification over building a separate "recovery" code path.

### `lib/simulation/tick-engine.ts`
`createTickEngine(store, options)` — `options.tickIntervalMs` (default 5000ms) and `options.random` (default `Math.random`, override with a seeded source for deterministic tests) are both configurable per the spec. Exposes:

- `start()` / `stop()` / `isRunning()` — wraps `setInterval`/`clearInterval`; `start()` is idempotent (won't stack timers if called twice).
- `tick()` — advances every resource in the store by exactly one step and calls `store.saveMetricSnapshot()` per resource (which both updates current state and appends bounded history — Phase 2 already built this, Phase 3 just drives it on a schedule). Exposed publicly so tests and any manual-control caller don't need to wait on real timers.
- `setTickIntervalMs(ms)` — live-reconfigurable; restarts the underlying timer with the new interval if currently running; rejects `<= 0`.
- `setResourceScenario(id, scenario)` — **the key design decision this phase made**: unlike `simulationStore.activateScenario` (Phase 2, still available, still snaps metrics instantly — used for out-of-band/manual control), this only updates `activeScenario`/`status` immediately and leaves `metrics` untouched. Subsequent ticks then carry the resource's *current* metrics toward the new target via `stepResourceMetrics`, which is what produces a visible ramp-up (or ramp-down, i.e. recovery) instead of a snap. This is what `POST /api/simulation/scenario` calls. Verified live against the running dev server (see §4) — CPU stayed at 12% the instant the scenario was set, then rose to 41.3% after the next real tick.

`tickEngine` — the shared singleton bound to `simulationStore`, used by the API routes.

---

## 2. API routes (`app/api/simulation/*`, all `export const runtime = 'nodejs'`)

| Route | Behavior |
|---|---|
| `GET /resources` | `{ resources: [...] }` — all resources via `simulationStore.listResources()` |
| `GET /resources/:id` | `{ resource }` or a structured `404` with `{ error, resourceId }` |
| `POST /start` | Starts the tick engine; `{ running, tickIntervalMs }` |
| `POST /stop` | Stops it; `{ running }` |
| `POST /reset` | Body `{ resourceId? }` — resets one resource, or every resource if omitted; Zod-validated, `404` for an unknown id |
| `POST /scenario` | Body `{ resourceId, scenario }` — Zod-validated (scenario must be one of the 7 real values); calls `tickEngine.setResourceScenario` (progressive, see above); `404`/`400` via a shared `handleSimulationError()` helper |
| `GET /stream` | SSE. Sends a `snapshot` message on connect (all resources + engine running state), then relays every `simulationStore.subscribe()` event — including the ones the tick engine produces every tick — plus a `heartbeat` every 5s carrying `running: boolean`. Cleans up its subscription and interval on `request.signal` abort. |

`app/api/simulation/errors.ts` centralizes mapping `SimulationResourceNotFoundError` → 404 and `InvalidScenarioError` → 400 across the routes that need it (not a route itself — no HTTP method export, so Next.js doesn't register it as one).

The `stream` route deliberately does **not** implement its own pub-sub — it's a thin SSE relay over the store's `subscribe()` from Phase 2, which already fires for every tick-driven `saveMetricSnapshot` call. This is what lets the "live telemetry" requirement fall out of Phase 2 + Phase 3 composing correctly rather than needing new plumbing.

---

## 3. Tests (`vitest`)

**117 tests across 16 files, all passing** (4 files/33 tests from Phase 1 + 3 files/79 tests from Phase 2 carried forward + 9 new files this phase: `scenario-runners.test.ts`, `tick-engine.test.ts`, and one test file per API route). New in this phase:

| Requirement | Coverage |
|---|---|
| Tick progression | `stepResourceMetrics` is deterministic under a fixed random source; a single tick moves partway toward the target, never snaps to it |
| CPU spike behaviour | `cpuPercent` converges toward the `CPU_SPIKE` target over ~10 ticks and moves monotonically closer each tick |
| Idle-hour accumulation | `idleHours` increases by the correct amount per tick (using a 1-hour tick interval for a readable assertion) while `IDLE_RESOURCE` is active, and decays back toward 0 once the scenario is no longer idle-like |
| Memory leak growth | `memoryPercent` climbs slowly (a single tick moves only modestly, not most of the way), keeps climbing over many ticks, and never exceeds the 99%/100% ceiling even under maximal jitter for 200 consecutive ticks |
| Scenario recovery | After 15 ticks of `CPU_SPIKE` then switching to `NORMAL` and ticking again, metrics move back down toward baseline — and a single recovery tick only moves partway, confirming it's gradual, not instantaneous |
| Start and stop behaviour | `isRunning()` false until `start()`; fake-timer-driven ticks accumulate history while running and stop advancing after `stop()`; calling `start()` twice doesn't double the tick rate; `stop()` when not running is a no-op |
| Maximum metric bounds | Every percentage field stays in `[0, 100]` across all 7 scenarios under alternating minimal/maximal jitter for 100 ticks each; non-percentage fields never go negative |

Also covered: `setResourceScenario`'s progressive (non-snapping) semantics and its error paths (`InvalidScenarioError`, `SimulationResourceNotFoundError`), `setTickIntervalMs` reconfiguring a running timer and rejecting non-positive values, and smoke tests for all 7 API routes (happy path + the 400/404 error paths each route can produce). The `stream` route test reads the first SSE message and asserts it's a `snapshot` containing all 8 resources and a boolean `running` flag.

```
npm run test    → 16 files, 117 tests, all passing
```

---

## 4. Verification

```
npx tsc --noEmit    → 0 errors
npm run lint          → 0 errors (7 pre-existing warnings, unchanged since Phase 0)
npm run build           → succeeds, all 7 /api/simulation/* routes + existing routes compile
```

**Live smoke test** against the user's running dev server (real HTTP, not mocked):
1. `GET /api/simulation/resources` → 8 resources, `res-ec2-dev-01` at baseline (`cpuPercent: 12`).
2. `POST /api/simulation/start` → `{"running":true,"tickIntervalMs":5000}`.
3. `POST /api/simulation/scenario` with `{resourceId: "res-ec2-dev-01", scenario: "CPU_SPIKE"}` → resource immediately shows `activeScenario: "CPU_SPIKE"`, `status: "degraded"`, but `cpuPercent` is still `12` — confirming the progressive (non-snapping) design.
4. Waited ~6s (one tick), re-fetched the resource → `cpuPercent: 41.3`, `memoryPercent: 38.5`, `requestsPerMinute: 213` — all visibly moved toward their `CPU_SPIKE` targets after exactly one real tick.
5. `POST /api/simulation/stop` → `{"running":false}`.

This confirms the whole chain — engine timer, scenario progression, store persistence, and the API surface — works against a real running server, not just against mocks.

---

## 5. Notes for Phase 4

- `GET /api/simulation/stream` message shapes: `{type: 'snapshot', resources, running}` on connect, `{type: 'store_event', event: {type, resourceId, resource}, running}` on every store mutation, `{type: 'heartbeat', running, timestamp}` every 5s. The `running` boolean on every message is what Phase 4's UI needs for the "Simulated live / Paused / Disconnected" indicator — "disconnected" itself is a client-side concern (the `EventSource`/fetch-stream connection state), not something the server emits.
- `simulationStore.activateScenario` (instant snap) and `tickEngine.setResourceScenario` (progressive) both still exist and do different things — Phase 4's UI should call the API route (`POST /api/simulation/scenario`, which uses the progressive path) for any user-facing "simulate this scenario" control, not reach for an instant-snap affordance.
- Metric history for charts is available via `simulationStore.getMetricHistory(id)` (capped at 500 points/resource, Phase 2) — there's no dedicated `GET .../history` route yet; Phase 4 should decide whether the initial `snapshot` + live `store_event` stream is sufficient to backfill a chart's window client-side, or whether a history endpoint is needed.
- The tick engine is a singleton bound to the shared `simulationStore` singleton — same in-memory, server-restart-ephemeral limitation flagged in Phase 0/2. Starting the engine via `POST /start` on one server instance won't be visible to another (relevant for any future multi-instance deployment, not for local dev).

---

*Phase 3 complete. Stopping here per the "build one phase at a time" rule — Phase 4 (connecting the UI) is next, per your explicit go-ahead.*
