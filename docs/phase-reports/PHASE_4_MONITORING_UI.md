# Phase 4 — Connect the CloudWatch/Prometheus UI

**Date:** 2026-07-16
**Scope:** Wire the dashboard to live simulation telemetry over `/api/simulation/stream`. No new backend work — this phase consumes what Phase 3 built.

**Process note:** You originally asked for Phase 4 directly, but it depends entirely on Phase 3 (`/api/simulation/stream`, the tick engine), which didn't exist yet. You chose to build Phase 3 first; this report covers Phase 4 only, built on top of it.

---

## 1. Audit of existing chart/dashboard components

Before writing anything, I read every component under `components/dashboard/`:

| Component | Before | Verdict |
|---|---|---|
| `metrics-cards.tsx` | 6 literal cards (`$2,345.67`, `3` anomalies, `24` instances, `89%` score, `2.4 tCO2e` carbon footprint) | Rewire — real aggregates |
| `infrastructure-table.tsx` | 8 hardcoded rows, fake "1–8 of 24" pagination, sort UI that didn't sort | Rewire — real resource list, real sort |
| `cloudwatch-logs.tsx` | 10 literal log lines | Out of scope — not one of the 7 required chart types; left untouched |
| `agent-terminal-new.tsx` | Fake Groq-agent transcript | Out of scope — belongs to the Phase 1 agent work, not simulation telemetry; left untouched |
| `spending-chart.tsx`, `alerts-panel.tsx`, `resource-table.tsx`, `simulation-controls.tsx`, `metrics-display.tsx` | Orphaned since Phase 0 (unreferenced by any page) | Left orphaned — none were on Phase 4's required list; noted below |

There were **no existing CPU/memory/network/request/latency/error-rate charts anywhere in the codebase** — `spending-chart.tsx` was the closest analog (a cost-only line chart) but was dead code. All 7 required charts were net-new.

---

## 2. New hooks

### `hooks/use-simulation-stream.ts`
Owns the **single** connection to `GET /api/simulation/stream` as a module-level external store (`useSyncExternalStore`, ref-counted subscribers) — any number of components can call the hook without opening N redundant SSE connections. Built on `fetch` + a manual `ReadableStream` reader (not `EventSource`) so reconnection is fully controlled rather than left to browser-default retry:

- Parses `data: {...}\n\n` frames into `snapshot` / `store_event` / `heartbeat` messages (matching Phase 3's stream shapes exactly).
- **Reconnection handling**: on any drop (network error, malformed response, or the server closing the stream), retries with exponential backoff (1s → 2s → 4s → 8s → 15s, capped) up to 6 attempts. After that, status becomes `disconnected` — a real terminal state, not silent infinite retry — and a `reconnect()` function is exposed to manually retry (resets the backoff counter).
- Status values: `connecting`, `live`, `paused`, `reconnecting`, `disconnected` — `live`/`paused` come directly from the `running` flag Phase 3's stream sends on every message, so "is the engine actually running" is never guessed client-side.

### `hooks/use-resource-list.ts` / `hooks/use-resource-metrics.ts`
Thin selectors over the shared stream: `useResourceList(filters?)` for the inventory/counters, `useResourceMetrics(resourceId)` for one resource's live state **plus a bounded client-side history window** (60 points, ~5 minutes at the default 5s tick). Phase 3's own notes flagged that there's no bulk-history REST endpoint yet — this hook is the deliberate answer: it builds history live from stream events for as long as it's mounted, resets cleanly when the watched resource changes, and never fabricates points that weren't actually observed.

---

## 3. New shared UI (`components/monitoring/`)

- **`connection-status-badge.tsx`** — the required Live/Paused/Disconnected (+ Connecting/Reconnecting) indicator. `role="status" aria-live="polite"` with a screen-reader description distinct from the visible label, plus a Reconnect action when disconnected.
- **`chart-states.tsx`** — shared `ChartLoadingState` (skeleton), `ChartEmptyState`, `ChartErrorState` (with retry) — every connected element in this phase uses these instead of improvising its own.
- **`metric-chart.tsx`** — one reusable, responsive, accessible time-series chart (Recharts `AreaChart`) parameterized by title/series/unit, used for all 7 metric charts rather than 7 near-duplicate components. Each chart is a `<figure>` with a visible title/latest-value and a `sr-only` text summary (the SVG itself is `aria-hidden` since it isn't independently meaningful to assistive tech) — satisfies "accessible labels" without faking a data table nobody asked for.
- **`resource-health-cards.tsx`** — a clickable grid of all resources (status icon, service/environment, CPU%, monthly cost), doubling as the resource selector for the detail charts below.
- **`telemetry-panel.tsx`** — composes the above: connection badge, Start/Stop/Reset controls (calling the Phase 3 API routes directly), health cards, an accessible `<select>` resource picker, and the 7 `MetricChart` instances (CPU%, Memory%, Network In/Out Mb, Requests/min, Latency ms, Error Rate%, Cost $/hr).

## 4. Rewired existing components

- **`metrics-cards.tsx`** — every number is now computed from `useResourceList()`: total monthly spend (sum), estimated waste (sum of cost for resources in `IDLE_RESOURCE`/`OVERPROVISIONED` scenarios — a real derived signal, not an invented percentage), anomaly counts by real `status`, running/total by environment, an optimization score (`% of resources currently in the NORMAL scenario`), and average CPU. The old **"Carbon Footprint" card was removed** — there is no real data source for it anywhere in the simulation model, and keeping a fabricated number would violate the phase's own "no fabricated values" requirement. Replaced with **Average CPU Utilization**, which is genuinely computable. Has its own loading skeleton and disconnected-state message.
- **`infrastructure-table.tsx`** — real resource rows, real sorting (Phase 0 had flagged that the sort UI never actually sorted; now that the data is real, sorting was wired up for real too — a direct, in-scope fix, not scope creep), a working search filter, the connection badge, and a real "Showing X of Y resources" footer. The old fake "1–8 of 24" pagination and inert page-2 button were removed outright rather than left pointing at data that doesn't exist.

---

## 5. Requirements checklist

| Requirement | How it's met |
|---|---|
| Loading states | `ChartLoadingState` (skeleton) everywhere data hasn't arrived yet; `metrics-cards`/`infrastructure-table` have their own skeleton variants |
| Empty states | `ChartEmptyState` when connected but no data points yet (e.g., a resource just reset) or a search yields no rows |
| Error states | `ChartErrorState` with a Retry button whenever `status === 'disconnected'` |
| Reconnection handling | Exponential backoff up to 6 attempts in `use-simulation-stream.ts`, then a terminal `disconnected` state with manual `reconnect()` |
| Limited history window | 60-point rolling buffer per resource in `use-resource-metrics.ts` |
| No fabricated values | Removed the Carbon Footprint card and the fake pagination; every remaining number traces to a real `SimulatedCloudResource` field or a documented derived aggregate |
| Responsive charts | `ResponsiveContainer` (Recharts) in every chart; grid layouts use Tailwind's responsive column classes |
| Correct units | Each chart carries its own unit (`%`, ` Mb`, ` req/min`, ` ms`, `/hr`) applied consistently to the axis, tooltip, and latest-value label |
| Accessible labels | `<figure>`/`<figcaption>`, `sr-only` summaries, `aria-label`s on health cards and sort buttons, `role="status" aria-live="polite"` on the connection badge |
| Live / Paused / Disconnected indicator | `ConnectionStatusBadge`, driven directly by the stream's own `running` flag, not inferred |

---

## 6. Verification

```
npx tsc --noEmit    → 0 errors
npm run lint          → 0 errors (7 pre-existing warnings, unchanged since Phase 0)
npm run test            → 16 files, 117 tests, all passing (no new tests — Phase 4's spec didn't request any; this phase was verified live instead, per below)
npm run build             → succeeds, all routes compile
```

**Live browser verification** (Playwright against the actual running dev server — installed Chromium locally for this since no project browser-driving skill existed yet):

1. Loaded `/dashboard` — real data rendered immediately: `Total Monthly Spend $922.64` (a real sum, not `$2,345.67`), 8 real resource health cards, connection badge correctly showing **Paused** (the tick engine wasn't running yet) before I touched anything.
2. Clicked **Start simulation** — badge switched to **Simulated Live**.
3. Clicked a different resource's health card — the 7 charts and "Viewing telemetry for" selector switched to it.
4. Waited through several real tick intervals — **this caught a real bug**: the Cost chart's Y-axis rendered nonsensical tick labels (`220/hr`, `165/hr`...) instead of the actual ~$0.02/hr scale. Root cause: Recharts' auto Y-domain degenerates when data is a single near-flat tiny value with no explicit lower bound. Fixed by anchoring every chart's Y-axis to `[0, 'auto']` by default instead of leaving both ends to `'auto'`. Re-verified — axis now correctly reads `.0000/hr` to `.0220/hr` against the real `$0.0208/hr` value, and confirmed the fix didn't disturb the CPU/Memory charts (which already had explicit `[0, 100]` domains).
5. Scrolled to the resource inventory table — real rows (`prod-orders-db`, `db.r5.xlarge`, `24.7%`, `$367.92`, `Running`, etc.), correct `Showing 8 of 8 resources` footer, zero console errors throughout.

This is the kind of bug that `tsc`/lint/build can never catch — it only showed up by actually watching the chart render against live, evolving data, which is why the live verification pass mattered here.

---

## 7. Notes / leftovers

- `cloudwatch-logs.tsx` and `agent-terminal-new.tsx` are still static/fake. Neither was on Phase 4's required list (logs aren't one of the 7 chart types; the agent terminal belongs to the Groq/LangGraph work, not simulation telemetry) — flagging again for whoever eventually wires them up.
- `spending-chart.tsx`, `alerts-panel.tsx`, `resource-table.tsx`, `simulation-controls.tsx`, `metrics-display.tsx` remain orphaned (unreferenced by any page), same as Phase 0 found them. `telemetry-panel.tsx`'s own Start/Stop/Reset controls now cover what `simulation-controls.tsx` was trying to do (against the old `mockAwsState` system), making that file redundant rather than merely unfinished — worth deleting explicitly in a future cleanup phase rather than leaving it to confuse the next person.
- No browser-driving project skill existed yet; verifying this phase required installing Playwright/Chromium ad hoc. Recommend `/run-skill-generator` to capture a reusable one, since Phase 9 (and any future UI phase) will need the same setup again.

---

*Phase 4 complete. Stopping here per the "build one phase at a time" rule.*
