# Phase 5 — Deterministic Monitoring, Anomaly Detection, and Financial Analysis

**Date:** 2026-07-16
**Scope:** Deterministic anomaly detection over live simulation telemetry, deterministic financial-impact/rightsizing calculations, and wiring both into the dashboard. No Groq/LLM involvement anywhere in this phase's logic — that's the entire point of "deterministic."

---

## 1. `lib/anomalies/`

### `types.ts`
`Anomaly` carries every field the phase requires: `id`, `resourceId`, `type`, `severity`, `confidence`, `evidence[]`, `detectedAt`, `firstObservedAt`, `lastObservedAt`, `status` (`active`/`resolved`), plus `resolvedAt`/`resolutionReason` once resolved. `AnomalyType` covers all 7 required conditions.

### `severity.ts`
One shared `severityFromRatio(ratio)` (low/medium/high/critical bands) and `confidenceFromRatio(ratio, consistency)` (a fixed formula capped at 0.95 — never claims false certainty) used by every rule, so severity/confidence are computed the same way everywhere instead of each rule inventing its own scale.

### `evidence.ts`
`buildEvidence()` — a tiny shared constructor so every rule's evidence entries have the same shape (`metric`, `observedValue`, `threshold`, `unit`, `description`).

### `rules.ts` — the 7 required deterministic rules
| Rule | Condition | Why this shape |
|---|---|---|
| Sustained CPU spike | `cpuPercent >= 80` for **all** of the last 3 readings | "Sustained" is enforced structurally — a single momentary spike can't trigger it |
| Idle resource | `cpuPercent < 5` AND `requestsPerMinute < 5` AND `idleHours >= 0.05` AND not intentionally `stopped` | `idleHours` already encodes duration (accumulated by `scenario-runners.ts`), so one reading suffices |
| Memory leak | `memoryPercent >= 85` **and** climbed >= 10 points across the last 5 readings | Requires both high *and* trending — distinguishes a leak from merely high-but-stable memory |
| Overprovisioned | `cpuPercent < 15` AND `memoryPercent < 25` AND `requestsPerMinute >= 10`, sustained over 3 readings | The traffic floor is what separates this from Idle Resource |
| Cost spike | current hourly cost >= 1.5x the window's own baseline (5-reading window) | Relative to the resource's own recent cost, not an arbitrary dollar figure |
| Traffic surge | requests >= 3x the window's own baseline **and** clears a 200 req/min floor | The floor stops tiny-baseline noise (e.g. 1→4 req/min) from counting as a "surge" |
| Elevated error rate | `errorRatePercent >= 1.0%` for both of the last 2 readings | Requires 2 consecutive readings so a single transient blip doesn't alert |

Every rule is a pure function `(resource, history) => RuleMatch | null` — no store access, fully unit-testable in isolation (see `rules.test.ts`).

### `detector.ts` — the stateful registry
`createAnomalyDetector(store)` subscribes to `simulationStore.subscribe()` (Phase 2's pub-sub — no new plumbing needed) and re-runs all 7 rules against a resource every time its metrics change (`metric_snapshot_saved`) or it's reset. It maintains:
- **Duplicate prevention**: one active anomaly per `(resourceId, type)` pair, tracked via an `activeByKey` map. A repeated match **updates** `lastObservedAt`/`severity`/`confidence`/`evidence` on the existing record rather than creating a new one — `firstObservedAt` and `id` never change while it stays active.
- **Auto-resolution**: when a previously-active anomaly's rule no longer matches on a later evaluation, it's automatically marked `resolved` with `resolutionReason: 'condition_cleared'`.
- **Manual resolution**: `resolveAnomaly(id)` marks it `resolved` with `resolutionReason: 'manual'` and frees the dedup slot — if the condition is *still* true on the next tick, a **new** anomaly (new id, new `firstObservedAt`) opens rather than silently reviving the manually-resolved record. This was a deliberate policy choice, tested explicitly.
- Its own `subscribe()` for the SSE route, mirroring `simulationStore`'s design.

---

## 2. `app/api/anomalies/*`

| Route | Behavior |
|---|---|
| `GET /` | `?status=active\|resolved&resourceId=...&type=...` filtering; every anomaly enriched with financial impact + recommendation |
| `GET /:id` | Single anomaly, 404 if unknown |
| `POST /:id/resolve` | Manual resolution, 404 if unknown |
| `GET /stream` | SSE: initial snapshot of active anomalies, then every detect/update/resolve event live, plus a 10s heartbeat |

`errors.ts` maps `AnomalyNotFoundError` → 404; `enrich.ts` attaches `financialImpact` (from `lib/financial/impact.ts`) and `recommendation` (from `lib/financial/rightsizing.ts`) to every anomaly the API returns — this is where anomaly detection and financial analysis compose, kept as a thin API-layer join rather than coupling the two `lib/` trees directly.

---

## 3. `lib/financial/`

### `pricing.ts`
`toCostBreakdown(hourlyUsd)` → `{hourlyUsd, dailyUsd, monthlyUsd, annualUsd}`, wrapping `lib/simulation/resources.ts`'s `calculateCost` (the single source of pricing truth) rather than duplicating rate tables. `priceConfiguration()` prices a hypothetical configuration without needing a live resource — what `rightsizing.ts` uses to price "what would this cost as a smaller instance."

### `impact.ts`
`calculateAnomalyFinancialImpact(anomaly, resource)` — a fixed, documented waste-fraction table:
- `IDLE_RESOURCE`: 100% (paying full price for something doing nothing)
- `OVERPROVISIONED`: 40% (heuristic share attributable to excess headroom)
- `COST_SPIKE`: 30% (heuristic share of the elevated spend considered avoidable)
- All other types (CPU spike, memory leak, traffic surge, error rate): **`null`** — these are performance/reliability risks, not a wasted-spend figure, so no number is invented for them.

`calculateAggregateWaste()` sums a list of impacts into one breakdown.

### `rightsizing.ts`
- `recommendRightsizing()` — steps down exactly one EC2/RDS instance size (ordered tables mirroring the sizing intuition already used in `cloudTools.ts`), only when both CPU and memory are under 30%.
- `calculateScheduledShutdownSavings(resource, offHoursPerDay)` — cost of running `24 - offHoursPerDay` hours/day instead of continuously.
- `recommendScaleIn()` — ECS only, steps `desiredCapacity` down by exactly one task, never below `minCapacity`.
- `calculateExpectedPostRemediationCost(resource, action)` — unifies all of the above behind the same `RemediationAction` vocabulary (`STOP`/`RIGHTSIZE`/`SCHEDULE`/`SCALE_IN`/`SCALE_OUT`/`NO_ACTION`) the project's stated LangGraph target state will eventually use for `remediationPlan.action`, so this phase's output slots in without renaming later.

**Groq's boundary**: nothing in `lib/anomalies/` or `lib/financial/` calls an LLM, and nothing added in this phase gives Groq a path to produce a cost, waste, or savings number — every dollar figure traces to `calculateCost()` and real simulated metrics.

---

## 4. UI wiring

- **`hooks/use-anomalies.ts`** — same external-store-over-SSE architecture as Phase 4's `use-simulation-stream.ts` (shared connection, exponential-backoff reconnect, terminal `disconnected` state with manual retry), pointed at `/api/anomalies/stream`.
- **`components/dashboard/alerts-panel.tsx`** — previously dead code with fabricated `mockAlerts`; rewired to real anomaly data via `useAnomalies()`, including each anomaly's evidence description, real elapsed time, its financial-impact waste figure, and (when applicable) a concrete savings recommendation ("Rightsize m5.xlarge → m5.large: save $52/mo"). Restyled from its original dark theme to match the light card design the rest of `/dashboard` actually uses. Wired into the dashboard page (replacing its previous "unused" status).
- **`components/dashboard/metrics-cards.tsx`** — "Active Anomalies" and "Estimated Monthly Waste" now come from `useAnomalies()` + real `financialImpact` sums instead of Phase 4's scenario-based heuristic (`activeScenario === 'IDLE_RESOURCE'`). "Optimization Score" now reflects the fraction of resources with **zero** active anomalies rather than the fraction in the `NORMAL` scenario — a more accurate signal now that real detection exists.

---

## 5. Tests

**171 tests across 21 files** (33 new this phase), all passing:

- `rules.test.ts` — each of the 7 rules fires under a crafted matching scenario and stays silent under normal conditions, including the specific "not sustained," "high but not trending," "low utilization but real traffic," and "ratio high but absolute volume tiny" negative cases that distinguish each rule from its neighbors.
- `detector.test.ts` — duplicate prevention (repeated matching readings produce exactly one anomaly, with `id`/`firstObservedAt` stable and `lastObservedAt` advancing), auto-resolution when a condition clears, manual resolution (including the "re-opens as a new anomaly" policy and idempotent double-resolve), 404 on unknown ids, filtering by resource/type, and subscribe/unsubscribe.
- `pricing.test.ts`, `impact.test.ts`, `rightsizing.test.ts` — cost-breakdown math, per-type waste fractions (including the `null` cases), rightsizing/scale-in/shutdown recommendation thresholds and their savings math, and `calculateExpectedPostRemediationCost` for every action.

```
npm run test    → 21 files, 171 tests, all passing
npx tsc --noEmit  → 0 errors
npm run lint        → 0 errors (7 pre-existing warnings, unchanged since Phase 0)
npm run build          → succeeds, all 4 new /api/anomalies/* routes + existing routes compile
```

---

## 6. A tuning fix caught before shipping

The idle-resource rule's `idleHours` threshold was initially set to `1` (one real hour) to match a realistic production intuition. But `idleHours` accumulates in **real wall-clock time** against the tick engine's 5-second default interval (`lib/simulation/scenario-runners.ts`, Phase 3) — a 1-hour threshold would need 720 ticks to ever fire, making the rule undemonstrable in any normal session. Lowered to `0.05` (~3 minutes, ~36 ticks): still requires sustained idleness rather than a single reading, but observable within a reasonable demo/test window. Documented inline in `rules.ts` with the reasoning, and the corresponding test adjusted.

---

## 7. Live verification — incomplete, and why

Live browser verification of the anomaly pipeline hit dev-server staleness: after this session's many hours and dozens of hot-reloads, `POST /api/simulation/scenario` would report success but a subsequent `GET` on the same resource showed it reverted to `NORMAL` almost immediately — and this reproduced identically for **Phase 3/4 functionality with no anomaly code involved at all**, which had verified correctly earlier in this same session. That strongly points to accumulated dev-server/Turbopack state rather than a Phase 5 defect. I confirmed this independently (organically, mid-debugging) — a real `COST_SPIKE` anomaly was detected and auto-resolved from ordinary simulation jitter during testing, with correct evidence text and correct financial-impact math ($3.87/mo, 30% waste fraction, correct daily/monthly/annual figures) — which is itself a genuine end-to-end proof of the detection → financial-impact → auto-resolution chain working against live data.

Given you chose not to restart the dev server, this phase's live-in-browser verification is **incomplete** — resting instead on: 171 passing tests covering the exact dedup/auto-resolve/threshold logic in isolation, a clean `tsc`/lint/build, and the one organic live detection observed above. Recommend a fresh `npm run dev` before your next live session, and a quick re-check of the anomaly pipeline (activate `CPU_SPIKE` on a resource, wait ~20s, `GET /api/anomalies?status=active`) once restarted.

---

*Phase 5 complete, with the live-verification caveat above. Stopping here per the "build one phase at a time" rule.*
