# AWS CloudPilot — Implementation Audit

**Audit date:** 2026-07-15
**Scope:** Full repository at `C:\Users\Manus\OneDrive\Desktop\projecs\AWS-cloudpilot`
**Method:** Static inspection of every source file, `npm run build`, `npx tsc --noEmit`, `npx eslint .`, dependency and lockfile inspection. No destructive commands were run. No real AWS or Terraform execution was performed.

---

## 1. Executive Summary

CloudPilot today is a **UI prototype with one small, real, working slice** (a mock-data ReAct chat agent) and **two large, fully static UI shells** (the redesigned `/dashboard` and `/terraform-sandbox` pages) that were built by v0 to *look like* the target product. None of the LangGraph / Terraform / worker / database architecture described in the project vision exists yet — not partially, not stubbed, not scaffolded. It is 0%.

| Area | Completion | Evidence |
|---|---|---|
| UI (visual layer) | ~70% | Two polished, on-brand page shells exist (`/dashboard`, `/terraform-sandbox`) plus an older functional page (`/`). Visual gaps only. |
| Backend (business logic / services) | ~10% | One in-memory mock state module (`lib/mockAwsState.ts`) and one real streaming API route (`app/api/agent`). No services layer, no simulation tick engine. |
| LangGraph | **0%** | `@langchain/langgraph` is present in `node_modules` only as a transitive dependency of `langchain`. It is not in `package.json`, not imported anywhere, no graph/state/nodes exist. |
| Terraform runtime | **0%** | No `terraform` binary is ever invoked. `components/dashboard/terraform-sandbox.tsx` renders a hardcoded HCL string and hardcoded log lines. |
| Worker/queue infrastructure | **0%** | No BullMQ, no Redis client, no worker process, no queue definitions anywhere in source. |
| Database/persistence | **0%** | No Prisma schema, no ORM, no SQL, no migrations. All "state" is a `let` array in a module (`lib/mockAwsState.ts`) that resets on server restart and is not shared across serverless invocations. |
| Production readiness | **~5%** | No auth, no tests, no lint config, `next.config.mjs` sets `typescript.ignoreBuildErrors: true` which hides real, currently-failing type errors, and a live-looking API key is committed in a tracked `.env` file. |

**Overall implementation of the stated vision: ~12–15%.** The repo is best described as: *a nicely designed static dashboard mockup, wired to nothing, sitting next to a small working proof-of-concept chatbot that mutates an in-memory array.*

---

## 2. Current Architecture

What the code actually is, not what the docs say it is:

- **Next.js 16 App Router**, TypeScript, Tailwind v4, React 19. No `pages/` directory — App Router only.
- **Three independent, disconnected "apps" live in this one repo**:
  1. `app/page.tsx` (route `/`) — an older, simpler dashboard ("CloudPilot — AI-Powered Cloud Cost Optimization") that is the **only page with real data flow**: it calls a Next.js Server Action (`app/actions/simulation.ts`) that reads/mutates `lib/mockAwsState.ts`, and it embeds `components/agent-terminal.tsx`, which streams real SSE responses from `app/api/agent/route.ts` (a genuine ReAct loop calling the xAI Grok chat-completions API with tool-calling).
  2. `app/dashboard/page.tsx` (route `/dashboard`) — the new, visually-polished "aws CloudPilot" dashboard requested/refined in this conversation. **100% static.** Every card, log line, table row and metric in its child components (`components/dashboard/metrics-cards.tsx`, `cloudwatch-logs.tsx`, `infrastructure-table.tsx`, `agent-terminal-new.tsx`) is a literal array or literal JSX constant. Nothing here calls `lib/mockAwsState.ts`, `app/actions/simulation.ts`, or any API route.
  3. `app/terraform-sandbox/page.tsx` (route `/terraform-sandbox`) — a single static mockup of a Terraform console (`components/dashboard/terraform-sandbox.tsx`). No process spawning, no file I/O, no state store; every value is a literal.
- **No server/services/hooks/store/types/prisma directories exist.** `find` over the repo confirms only `app/`, `components/`, `lib/`, `public/` at the top level.
- **State management**: none beyond local `useState`/`useEffect` inside individual components. There is no shared client store (no Zustand/Redux/Context), no SWR/React Query.
- **Database layer**: none. `lib/mockAwsState.ts` is a module-scoped mutable array (`let mockInstances: AwsInstance[] = [...]`), i.e. process memory. It is reinitialized on every cold start/serverless invocation and shared only within one running Node process.
- **Agent/LangGraph layer**: none. The only "agent" is a hand-rolled `while` loop (`runReActLoop` in `app/api/agent/route.ts`) that calls `fetch('https://api.x.ai/openai/v1/chat/completions', …)` directly — no LangChain/LangGraph runtime object is constructed or executed anywhere.
- **Worker layer**: none.
- **Terraform layer**: none (UI text only).
- **Simulation layer**: a single deterministic mock-state module with manual mutation functions (`stopInstance`, `startInstance`, `terminateInstance`, `modifyInstanceType`) — no tick loop, no scheduler, no scenario injection, no persistence.
- **UI component system**: Tailwind + `class-variance-authority` + one shared `Button` primitive (`components/ui/button.tsx`) built on `@base-ui/react`. `components.json` indicates a shadcn-style setup, but only `button.tsx` exists under `components/ui`.
- **Deployment assumptions**: `DEPLOYMENT.md` describes a Vercel deployment with `XAI_API_KEY` as the only required secret. There is no Docker, no infrastructure-as-code for the app itself, no CI config found in the repo.
- **Authentication**: none. No login page, no session/cookie handling, no `next-auth`/`clerk`/`@auth` packages installed.

---

## 3. Existing Route Map

### Pages
| Route | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | Older functional dashboard: metrics grid + real agent terminal |
| `/dashboard` | `app/dashboard/page.tsx` | New static "aws CloudPilot" visual dashboard |
| `/terraform-sandbox` | `app/terraform-sandbox/page.tsx` | Static Terraform console mockup |

### API Routes
| Method | Route | File |
|---|---|---|
| `POST` | `/api/agent` | `app/api/agent/route.ts` |
| `GET` | `/api/metrics` | `app/api/metrics/route.ts` |
| `HEAD` | `/api/metrics` | `app/api/metrics/route.ts` (health check, line 304) |

### Server Actions
| Action | File |
|---|---|
| `resetInfrastructureAction` | `app/actions/simulation.ts:23` |
| `stopInstanceAction` | `app/actions/simulation.ts:37` |
| `startInstanceAction` | `app/actions/simulation.ts:66` |
| `getInfrastructureStateAction` | `app/actions/simulation.ts:95` |

No `middleware.ts`, no other route groups, no dynamic segments exist.

---

## 4. Implemented Features (genuinely working)

| Feature | Evidence |
|---|---|
| In-memory mock AWS instance store with CRUD-like mutation | `lib/mockAwsState.ts` — `getInstances`, `stopInstance`, `startInstance`, `terminateInstance`, `modifyInstanceType`, `calculateTotalSpend`, `calculateEstimatedWaste`, `getAnomalies` all operate on real (if ephemeral) shared module state, not per-render fakes. |
| Server Actions bridging UI to mock state | `app/actions/simulation.ts` genuinely calls into `lib/mockAwsState.ts` and returns typed results; used by `components/metrics-grid.tsx` and `components/dashboard/resource-table.tsx` and `components/dashboard/simulation-controls.tsx` (the last two are currently unreferenced — see §6). |
| Real LLM ReAct loop with tool-calling and streaming | `app/api/agent/route.ts` — makes an actual `fetch` to `https://api.x.ai/openai/v1/chat/completions`, parses `tool_calls`, executes real tool functions, streams SSE events (`thought`, `action`, `observation`, `self_correction`, `summary`) back to the client. Connected end-to-end to `components/agent-terminal.tsx` on `/`. |
| Deterministic policy/validation checks for the 3 mutating tools | `lib/sandbox/validationSandbox.ts` — `validateStopInstance`, `validateModifyInstanceType`, `validateTerminateInstance` implement real, non-LLM rule checks (block stopping/terminating `Environment=production` instances, block "upsizing", warn on high-CPU instances) and feed structured errors back into the ReAct loop for self-correction. This is a legitimate, reusable prototype of the "deterministic policy engine" the vision calls for — it currently guards ad-hoc tool calls rather than a Terraform plan, but the pattern is sound. |
| SSE streaming plumbing | Both `app/api/agent/route.ts` and `app/api/metrics/route.ts` correctly implement `ReadableStream`+`text/event-stream` with abort-signal cleanup (`request.signal.addEventListener('abort', …)`, `app/api/metrics/route.ts:271`). |
| Client `EventSource`/fetch-stream consumption | `components/agent-terminal.tsx:49-127` correctly parses a chunked SSE body via `getReader()`/`TextDecoder`. This is real streaming code, not a mock. |

---

## 5. Partial Features

| Feature | Route/File | Status | Problem |
|---|---|---|---|
| `/api/metrics` anomaly + cost stream | `app/api/metrics/route.ts` | Partial | Uses real `lib/mockAwsState.ts` data for instance list and cost totals (real), but layers `Math.random()` variance directly into the response for CPU/memory/network figures (`route.ts:52-68`) and hardcodes the "previous month" trend as `totalCost * 0.95` (`route.ts:192`, comment literally says "Simulate 5% increase"). No caller in the current app actually reads this endpoint successfully (see §6 — `MetricsDisplay` is broken and unused). |
| Validation sandbox "critical instance" check | `lib/sandbox/validationSandbox.ts:47-56` | Partial/Broken | `isCriticalInstance` computes `const highCpu = instance.cpuUtilization > 70` (a boolean), then evaluates `(isProd && highCpu) || highCpu > 85`. `highCpu > 85` compares a **boolean to a number**, which `tsc` flags as a type error (`TS2365`, confirmed by `npx tsc --noEmit`, see §12). The intended check ("or CPU > 85%") never fires. |
| ReAct self-correction loop | `app/api/agent/route.ts:236-457` | Partial | The loop, correction counting, and iteration limits are real, but the "tools" it corrects against only mutate an in-memory array with 5 hardcoded instances — there is no real infrastructure, plan, or Terraform artifact behind any of it. |

---

## 6. UI-Only Features (visual, not connected to anything)

| Feature | Route/File | Data source |
|---|---|---|
| Metrics cards (`Total Monthly Spend`, `Estimated Monthly Waste`, `Active Anomalies`, `Running Instances`, `Optimization Score`, `Carbon Footprint`) | `components/dashboard/metrics-cards.tsx` | Literal JSX (`$2,345.67`, `$892.34`, `3`, `24`, `89%`, `2.4`) — no props, no fetch, no state. |
| Live CloudWatch Metrics log panel | `components/dashboard/cloudwatch-logs.tsx:6-17` | A literal `logEntries` array of 10 fixed strings, rendered once. "Live" and "Auto-scroll" are visual only — nothing appends new entries. |
| Infrastructure Resources table | `components/dashboard/infrastructure-table.tsx:6-15` | A literal `instances` array of 8 rows. Sorting UI exists (`sortBy`/`sortOrder` state) but is **never applied** — the array is rendered as-is regardless of sort state; there is no `.sort()` call anywhere in the file. Pagination footer ("1–8 of 24", page 2 button) is decorative — there are only 8 hardcoded rows total, not 24. |
| Agent Terminal (new) | `components/dashboard/agent-terminal-new.tsx:6-17` | A literal `terminalLogs` array; "Run Agent" button has no `onClick` handler at all. |
| Terraform Sandbox console | `components/dashboard/terraform-sandbox.tsx` | Entire HCL code block is a template literal (`terraformCode`, lines ~90-108). "Execution Logs" are a literal array with hardcoded per-line status. `Simulate`/`Stop`/`Apply` buttons only call `setStatus(...)` — a local enum with no effect on logs, code, or cost figures. `Reject` button has no handler. |
| Sidebar navigation | `components/dashboard/sidebar.tsx:23-34` | 9 of 10 nav items (`Cost Overview`, `Anomalies`, `Recommendations`, `Resources`, `Policies`, `Automation`, `Reports`, `Carbon Impact`, `Settings`) point to `href: '#'`. Only `Dashboard` and `Terraform Sandbox` resolve to real routes. |
| Header notification bell, theme toggle | `components/dashboard/header.tsx` | Badge count ("3") is a literal; the light/dark toggle flips local `isDark` state but no theme is ever applied to the DOM (no `dark:` classes are toggled anywhere, no `next-themes`). |
| Cost Impact / Savings cards on Terraform Sandbox | `components/dashboard/terraform-sandbox.tsx` | `$120/day → $36/day, $84/day savings (70%)` are all literals, unconnected to the (also fake) Terraform code shown above them. |

---

## 7. Mocked and Hardcoded Features

| Item | File:Line | Detail |
|---|---|---|
| CPU/memory/network jitter | `app/api/metrics/route.ts:52-68` | `Math.random()` used directly inside a route handler to fabricate `cpuUtilization`, `memoryUtilization`, `networkIn/Out`, `diskReadOps/WriteOps`. Not sourced from CloudWatch or any metrics store. |
| "Previous month" cost trend | `app/api/metrics/route.ts:192` | `previous: totalCost * 0.95` — comment reads `// Simulate 5% increase`. |
| 5 mock EC2 instances | `lib/mockAwsState.ts:20-80` | The entirety of "infrastructure" in the app is these 5 hardcoded objects (`dev-web-01`, `prod-api-01`, `prod-db-01`, `analytics-server`, `staging-app-01`). |
| 7-day spending trend chart | `components/dashboard/spending-chart.tsx:5-13` | Hardcoded `data` array (`Mon`..`Sun` with fixed `spend`/`waste` numbers) fed straight into Recharts. Not wired to any endpoint. (This component is also unused — see Technical Debt.) |
| Alerts panel | `components/dashboard/alerts-panel.tsx:13-42` | `mockAlerts` literal array with fabricated relative timestamps ("2 min ago", "5 min ago"). Also unused/orphaned. |
| Agent terminal log stream on `/dashboard` | `components/dashboard/agent-terminal-new.tsx:6-17` | Static array presented with terminal styling to look like a live agent trace; it is not connected to `/api/agent`. |
| Terraform HCL + execution log + cost impact | `components/dashboard/terraform-sandbox.tsx` | Entirely fabricated strings designed to look like a real Terraform run; see §11. |
| `console.log('[v0] …')` debug statements left in server code | `app/api/agent/route.ts:193,237,254,386,396,433,454-456`; `app/api/metrics/route.ts:276` | Development-time logging shipped in route handlers; several are informative (correction attempts) but none are gated behind an environment check. |

---

## 8. Broken Features

| Feature | File | Problem |
|---|---|---|
| `MetricsDisplay` component | `components/dashboard/metrics-display.tsx:18-24` | Calls `fetch('/api/metrics')` then `await response.json()`. But `/api/metrics` (`app/api/metrics/route.ts:161-168`) returns `Content-Type: text/event-stream`, an SSE stream, not a JSON body — `response.json()` will throw on the very first chunk. The component is also not imported anywhere (dead + broken). |
| `isCriticalInstance` policy check | `lib/sandbox/validationSandbox.ts:47-56` | Boolean-vs-number comparison bug described in §5; confirmed by `tsc` as `TS2365`. The "stop production instance with CPU > 85%" safety path silently misbehaves. |
| Tool schema typing in agent route | `app/api/agent/route.ts:50-66` | `toolMap` is typed with `schema?: Record<string, unknown>` but every tool in `lib/tools/cloudTools.ts` supplies a Zod `z.object(...)` schema, which is not structurally assignable to `Record<string, unknown>`. `tsc` reports 6 `TS2322` errors here. The app currently builds anyway only because `next.config.mjs` sets `typescript.ignoreBuildErrors: true` (see §12/§15) — i.e., this is a real type error being deliberately hidden from the build, not a false positive. |
| Infrastructure table sorting | `components/dashboard/infrastructure-table.tsx:18-67` | `sortBy`/`sortOrder` state and header click handlers exist and visually indicate direction, but no code ever reorders the `instances` array. Clicking a sort header changes only the arrow icon. |
| Pagination controls (dashboard table, terraform run history) | `components/dashboard/infrastructure-table.tsx` (page 2 button), `components/dashboard/terraform-sandbox.tsx` ("View Run History" button) | No `onClick` handlers; buttons are inert. |
| Sidebar links | `components/dashboard/sidebar.tsx:24-34` | `href: '#'` on 9 items — clicking scrolls to top of page and does nothing else; no corresponding routes exist under `app/`. |
| ESLint | `package.json:9` (`"lint": "eslint ."`) | Running it fails immediately: *"ESLint couldn't find an eslint.config.(js|mjs|cjs) file."* There is no `eslint.config.*` or `.eslintrc.*` anywhere in the repo. `npm run lint` is non-functional today. |

---

## 9. Missing Core Features

Everything below is required by the stated vision and **does not exist in any form** (not stubbed, not partially built):

- Simulation **tick engine** (interval/cron-driven state progression, scenario injection: CPU spikes, idle cycles, memory leaks, cost spikes).
- Deterministic **anomaly detection service** decoupled from a route handler (current logic is inlined in `app/api/metrics/route.ts` and re-implemented slightly differently again in the same file — two divergent anomaly definitions in one file, see Technical Debt).
- **LangGraph diagnosis agent**, or any LangGraph graph at all (no `StateGraph`, no annotations, no nodes, no compiled graph, no checkpointer).
- **Financial impact calculation service** as a distinct, testable unit (only ad-hoc arithmetic scattered in `lib/mockAwsState.ts` and `app/api/metrics/route.ts`).
- **Remediation planning agent**.
- **Terraform generation agent** (LLM-driven).
- **Static security validation** of generated Terraform (tfsec/Checkov-style or custom deterministic rule engine over a plan).
- **Terraform format/init/validate/plan workers** — no `terraform` binary is ever spawned (`child_process`, `execa`, etc. are absent from all dependencies and all source files).
- **Deterministic plan-policy evaluation** engine that inspects a real Terraform JSON plan (`terraform show -json`).
- **Automatic approval logic** (no plan hash, no policy score, no approval record of any kind).
- **Terraform apply worker**, stdout/stderr capture, timeouts, sandboxing, temp-dir cleanup.
- **Post-execution verification** and **rollback** logic.
- **Audit logging** (no persisted audit trail anywhere; `console.log` only).
- **Redis connection / BullMQ queues / worker processes** — package not installed, no client instantiated.
- **Prisma schema / PostgreSQL** — no ORM, no schema file, no migration, no `DATABASE_URL` handling.
- **Authentication/authorization** of any kind.
- **Settings page**, **Reports page**, **Policies page**, **Automation page**, **Carbon Impact page**, **Cost Overview page**, **Anomalies page**, **Recommendations page**, **Resources page** — all are sidebar entries with no backing route.
- **Notifications system** (the bell icon badge is a literal `3`).
- Any test suite (`*.test.ts`, `*.spec.ts` — zero files found).
- Any CI configuration.
- Any Docker/devcontainer setup.

---

## 10. LangGraph Audit

**Package status:** `@langchain/langgraph` (v1.4.7) exists inside `node_modules/@langchain/langgraph` **only as a transitive dependency of `langchain@1.5.3`** (confirmed via `package-lock.json:1349-1368`). It is **not** listed in `package.json` `dependencies`, and a full-repo search for `langgraph|StateGraph` across all `.ts`/`.tsx` source files returns **zero matches**. `@langchain/core` is a direct dependency but is unused as well — no file imports from `@langchain/core` or `langchain` anywhere in `app/`, `components/`, or `lib/`. The "agent" in `app/api/agent/route.ts` is a hand-written `fetch` call to xAI's OpenAI-compatible endpoint with a manual `while` loop — it uses neither LangChain nor LangGraph runtime primitives despite the extensive LangChain-branded documentation (`LANGCHAIN_TOOLS.md`, `TOOLS_CODE_REFERENCE.md`) describing it as if it did.

**Node-by-node status** (all target nodes from the vision):

| Node | Exists? | Notes |
|---|---|---|
| `monitorWorker` | ❌ | No worker process of any kind exists. |
| `anomalyDetectionWorker` | ❌ (logic exists, not as a worker) | Deterministic rules exist inline in `app/api/metrics/route.ts:76-135` (`detectAnomalies`) — reusable logic, but it runs inside a Next.js route handler on each SSE connection, not as a queued/standalone worker. |
| `diagnosisAgent` | ❌ | No agent reasons about *why* an anomaly occurred; `app/api/agent/route.ts` only responds to ad-hoc user chat queries. |
| `financialImpactWorker` | ❌ (logic exists, not as a worker) | `calculateTotalSpend`/`calculateEstimatedWaste` in `lib/mockAwsState.ts:225-244` do real arithmetic on the mock instances, but as plain functions, not a graph node. |
| `planningAgent` | ❌ | Not implemented. |
| `terraformGenerationAgent` | ❌ | The HCL text on `/terraform-sandbox` is a static template literal, never generated by any model call. |
| `staticSecurityWorker` | ❌ | Not implemented. |
| `terraformFormatWorker` | ❌ | Not implemented. |
| `terraformInitWorker` | ❌ | Not implemented. |
| `terraformValidateWorker` | ❌ | Not implemented. |
| `terraformPlanWorker` | ❌ | Not implemented. |
| `planPolicyWorker` | ⚠️ prototype only | `lib/sandbox/validationSandbox.ts` is a deterministic policy checker, but it validates ad-hoc tool calls (`stop_instance`, etc.) against tags/CPU, not a Terraform plan. Directionally correct pattern, wrong input domain. |
| `autoApprovalWorker` | ❌ | No concept of "approval" exists on the Terraform side. The closest analog is that `validateToolExecution` (`lib/sandbox/validationSandbox.ts:284-298`) implicitly "approves" a mock-state mutation by returning `valid: true` — this is deterministic (good), but it approves direct state mutation, not a Terraform apply. |
| `terraformApplyWorker` | ❌ | Not implemented. |
| `verificationWorker` | ❌ | Not implemented. |
| `selfCorrectionAgent` | ✅ prototype exists | `app/api/agent/route.ts:236-457` implements a real self-correction loop: policy violations are caught, fed back as `self_correction` events, and the LLM is asked to retry, bounded by `maxCorrections = 5` (`route.ts:249`). This is the single most complete piece of "agentic" behavior in the repo, but it corrects ad-hoc chat tool calls, not Terraform plan errors. |
| `rollbackWorker` | ❌ | Not implemented. |
| `auditWorker` | ❌ | Not implemented; only `console.log` breadcrumbs exist. |

**Human approval check:** No human-approval UI or gate exists anywhere in the code today (no "Approve"/"Deny" button tied to a pending-state record). The `terraform-sandbox.tsx` component does have `Apply`/`Reject` buttons, but they are inert (`onClick` only flips a local `status` enum, §6/§8) — they do not represent a functioning human-approval workflow, so there is nothing to remove to satisfy the "no human approval" requirement; the constraint is trivially satisfied only because the feature doesn't exist yet. This must be kept in mind when building §18 Phase 7 so a human-approval affordance isn't accidentally reintroduced via the `Apply`/`Reject` buttons' obvious visual invitation.

---

## 11. Terraform and Sandbox Audit

There is no Terraform runtime integration anywhere in this repository.

- No dependency on any process-execution library (`child_process`, `execa`, `node-pty`) in `package.json`.
- No `.tf` files exist in the repo.
- No temp-directory creation/cleanup code exists.
- No sandbox/container isolation code exists.
- `components/dashboard/terraform-sandbox.tsx`:
  - The "Generated Terraform" panel renders a fixed template string (`terraformCode`, starting `# Right-size staging RDS cluster to reduce costs`) with a custom-written client-side syntax highlighter (`highlightHclLine`, added in this conversation for visual fidelity) — cosmetic only, no relation to any real plan.
  - The "Execution Logs" panel renders a fixed array of 9 log lines with fixed `status` values (`completed`/`in-progress`/`pending`) — timed to *look* like a live terraform run but driven by nothing (no `setInterval`, no polling, no WebSocket).
  - `Simulate`, `Stop`, `Apply` buttons call `setStatus('running' | 'stopped' | 'completed')` — a purely cosmetic local enum that isn't read by the code panel, logs, or cost cards.
  - The Cost Impact numbers (`$120/day` → `$36/day`, `70%` savings) are literals with no arithmetic relationship to the HCL shown above.
- **None of the required commands are ever invoked**: `terraform fmt -check`, `terraform init`, `terraform validate`, `terraform plan -out=...`, `terraform show -json`, `terraform apply -auto-approve` — zero occurrences of the string `terraform` as a shell command anywhere in source.
- Terminal output on this page is **100% static sample text**, not real process output, not even simulated-with-timers output — it renders once and never changes.

---

## 12. Worker and Queue Audit

- `bullmq`, `ioredis`, `redis` — none present in `package.json` dependencies, and a full-repo grep found no source-code usage (only an incidental match inside `DEPLOYMENT.md`, itself just prose planning for future Redis-backed queues, not implemented code).
- No `worker` directory, no `queue` directory, no job processor files anywhere.
- No message about job retries, backoff, concurrency, idempotency, or dead-letter handling exists in code (only aspirationally in this prompt/vision).
- **Long-running work is not currently a problem in practice only because none of the "long-running" work (Terraform init/plan/apply) exists yet.** The one place that *does* do multi-second work — the ReAct loop in `app/api/agent/route.ts` — runs directly inside a Next.js Route Handler under the request/response lifecycle via a `ReadableStream`, which is an acceptable pattern for LLM streaming but would not be acceptable once real `terraform apply` calls (which can run for minutes) are introduced; those must move to a dedicated worker process per the vision.

---

## 13. Data and Database Audit

- **No Prisma schema file exists** anywhere in the repo (`find . -iname prisma` returns nothing).
- **No SQL, no ORM, no `DATABASE_URL` handling** in `.env` or any config file.
- All "persisted" data is the module-level array in `lib/mockAwsState.ts:20-80`, which:
  - Resets to its hardcoded 5-instance default on every server restart (`resetInfrastructure()`, lines 162-220 — note this reset function's default data **differs slightly** from the initial `mockInstances` literal: the reset version drops all `tags` fields and changes `staging-app-01`'s `memoryUtilization` from 8 to 18 and `launchTime` offset from 7 to 45 days — an inconsistency between "initial" and "reset" state that will silently change anomaly/production-protection behavior after any reset).
  - Is **not** shared across serverless function instances or across the Node dev server's hot-reload boundary in a durable way — it is plain in-memory JS state, not a real datastore.
- Every Prisma model called for by the vision (Resources, ResourceMetrics, CostRecords, Anomalies, AgentRuns, GraphNodeRuns, TerraformArtifacts, TerraformPlans, Approvals, PolicyDecisions, ExecutionAttempts, CorrectionHistory, VerificationResults, RollbackRecords, AuditLogs) is **entirely absent** — there is nothing to report per-model because no schema exists.

---

## 14. API Audit

| Method | Route | Purpose | Auth | Validation | Real or Mocked | Consumer | Problems |
|---|---|---|---|---|---|---|---|
| `POST` | `/api/agent` | ReAct chat loop over mock AWS state | None | Only `body.query` existence check (falls back to a default string) — no Zod schema, no length/content limits | Real LLM call + real mock-state mutation | `components/agent-terminal.tsx` | No auth/rate-limiting means anyone with the URL can spend the (committed!) xAI API key's quota; no request size limits; errors from `fetch` are surfaced verbatim to the client (`route.ts:308-313`), which can leak upstream error detail. |
| `GET` | `/api/metrics` | SSE stream of fabricated metrics + real cost/anomaly data | None | None | Mixed (real instance list, fabricated per-tick jitter) | `components/dashboard/metrics-display.tsx` (broken consumer, see §8) | Response `Content-Type` mismatch vs. consumer expectations; unauthenticated; the `keepAlive` `setInterval` (`route.ts:266-268`) is cleared on abort but the outer 30s interval combined with Next.js's default route timeout on serverless platforms could be dropped without warning — no reconnection/backoff logic on the client. |
| `HEAD` | `/api/metrics` | Health check | None | N/A | Real (trivially) | None found | Not referenced by any monitoring config in the repo — dead code unless an external uptime checker calls it. |

General API findings:
- **No Zod validation on any request body** despite `zod` being a direct dependency and already used for tool schemas in `lib/tools/cloudTools.ts`.
- **No authentication or authorization** on any route.
- **No rate limiting** anywhere.
- **No consistent error-status usage**: `/api/agent` returns `500` for a missing key (`route.ts:464-468`, reasonable) but `400` for any other thrown error regardless of actual cause (`route.ts:501-504`).
- **Secret exposure risk**: `XAI_API_KEY` is read from `process.env` correctly (server-side only, never sent to the client) — this part is done right. The risk is that the key's *value* is committed to a tracked file (see §15 Security Findings, Critical #1), not that it leaks through the API.

---

## 15. Code Quality Findings

### `npx tsc --noEmit` (ran against the actual `tsconfig.json`)
7 real, currently-existing errors:
```
app/api/agent/route.ts(59,3): TS2322 — tool schema (ZodObject) not assignable to Record<string, unknown> [x4 similar, lines 59-65]
lib/sandbox/validationSandbox.ts(55,33): TS2365 — Operator '>' cannot be applied to types 'boolean' and 'number'
```
These are masked in production builds because `next.config.mjs:3-5` sets:
```js
typescript: { ignoreBuildErrors: true }
```
`npm run build` prints **"Skipping validation of types"** and completes "successfully" despite these real errors — this is a deliberate build-time cover-up, not a false alarm; the errors are genuine (confirmed independently via `tsc`) and currently ship to production undetected.

### `npm run build`
Succeeds (Turbopack, ~3s compile). All 3 pages + 2 API routes are correctly listed in the route manifest. Build success tells you nothing about type safety here because of the flag above.

### `npx eslint .`
**Fails immediately**: *"ESLint couldn't find an eslint.config.(js|mjs|cjs) file."* No `eslint.config.*` or legacy `.eslintrc.*` exists anywhere in the repo. The `"lint"` script in `package.json:9` is currently non-functional. (No fix was applied — flagged per audit scope, not corrected, since choosing a lint config/ruleset is a project decision, not a "small non-destructive fix.")

### `npm test`
No test script exists in `package.json`, and no test files (`*.test.ts(x)`, `*.spec.ts(x)`) exist anywhere in the repo.

### Other quality findings
- **Dead/orphaned components** (never imported by any page): `components/dashboard/resource-table.tsx`, `components/dashboard/alerts-panel.tsx`, `components/dashboard/simulation-controls.tsx`, `components/dashboard/spending-chart.tsx`, `components/dashboard/metrics-display.tsx`. Confirmed via grep — none of these five files are referenced from any file under `app/`.
- **Duplicate/competing implementations of the same concept**: two "agent terminal" components (`components/agent-terminal.tsx`, real; `components/dashboard/agent-terminal-new.tsx`, fake) and two "metrics grid" components (`components/metrics-grid.tsx`, real via server action; `components/dashboard/metrics-cards.tsx`, fake literals) coexist with no shared interface, no shared types, and opposite data-sourcing strategies. A future engineer cannot tell which is canonical without reading both.
- **Duplicate anomaly-detection logic**: `app/api/metrics/route.ts` defines `detectAnomalies` (lines 76-135, keyed on `type`/`severity`) while `lib/mockAwsState.ts` defines a differently-shaped `getAnomalies` (lines 249-266, returns raw instances, thresholds of `<5` and `>85` instead of the route's `<5`/`<20`/`>80`). These two functions disagree on thresholds for the same concept and neither calls the other.
- **`console.log` left in server code paths** tagged `[v0]` (a leftover from the original v0 generation tool, not a project convention) — see §7.
- **Unsafe `any`**: `MetricsResponse.data.instances: any[]` (`app/api/metrics/route.ts:31`), `ResourceTable`'s `useState<any[]>([])` (`components/dashboard/resource-table.tsx:8`), `getFirstDevInstance()` in `validationSandbox.ts:276-279` uses `require(...)` (a CommonJS call inside an ESM/TS file) and casts the result to `any`.
- **Two lockfiles committed simultaneously**: `package-lock.json` and `pnpm-lock.yaml` both exist, implying inconsistent package-manager usage across sessions; only one should be kept.
- **`next.config.mjs` also sets `images: { unoptimized: true }`**, disabling Next's image optimization pipeline entirely — reasonable for a prototype, but worth revisiting before production.

---

## 16. Security Findings

| Severity | Finding | File | Recommendation |
|---|---|---|---|
| **Critical** | A live-looking API key is stored in a **tracked, non-ignored** `.env` file (`XAI_API_KEY=gsk_…`). `.gitignore` only excludes `.env*.local` (`.gitignore:9`), not `.env` itself, so this file is committed as soon as anyone runs `git add .`/`git commit`. Note the key's `gsk_` prefix is the format used by Groq, not xAI — worth double-checking which provider it actually authenticates against. | `.env:1`, `.gitignore:9` | Rotate the key immediately, remove it from `.env`, add `.env` (not just `.env*.local`) to `.gitignore`, and load secrets via the deployment platform's secret manager instead. |
| **Critical** | `typescript.ignoreBuildErrors: true` silently hides real type errors (7 confirmed, §15) from every production build. | `next.config.mjs:3-5` | Remove the flag once the underlying type errors are fixed; never ship with it enabled. |
| **High** | No authentication/authorization on any API route or Server Action. `/api/agent` will execute arbitrary user-supplied `query` strings against a paid LLM API for any anonymous caller. | `app/api/agent/route.ts` | Add auth middleware and per-user/per-IP rate limiting before any real deployment. |
| **Medium** | `require('@/lib/mockAwsState')` used inside a TypeScript ES module (`getFirstDevInstance`, `validationSandbox.ts:277`) — works today only because of bundler interop, but is fragile and defeats static analysis/tree-shaking guarantees. | `lib/sandbox/validationSandbox.ts:276-279` | Replace with a normal `import`. |
| **Low** | Verbose upstream error text from the xAI API is passed straight through to the client (`route.ts:308-313`) on non-OK responses. | `app/api/agent/route.ts:307-313` | Return a generic client-facing message; log the detailed error server-side only. |
| **Informational** | No secrets, credentials, or Terraform state are at risk from sandbox escape today **because no sandbox/Terraform execution exists yet** — this is a "nothing to exploit yet" state, not a solved problem. All of §8 Safety and Policy Audit's concerns (IAM wildcards, public security groups, unrestricted providers, Docker socket exposure, host filesystem mounting) apply the moment Terraform execution is introduced and must be designed in from the start (see Phase 5 in the roadmap), not retrofitted. | n/a | Design the sandbox execution environment with these constraints from day one. |

No evidence was found of: SQL injection (no DB), command injection (no shell execution), path traversal (no filesystem access from user input), Docker socket exposure (no Docker usage), or excessive IAM permissions (no AWS SDK/credentials wired up at all).

---

## 17. Technical Debt

- Five fully-built, styled components are orphaned dead code (§15) — either delete them or resurrect them deliberately; leaving them invites future confusion about which "dashboard" is canonical.
- Two competing "eras" of UI (the original `/` dashboard with real data plumbing vs. the new `/dashboard` + `/terraform-sandbox` with zero data plumbing) currently coexist with no migration plan connecting them. The new UI is strictly prettier; the old UI is strictly more real. Neither is complete.
- Two divergent anomaly-detection implementations (§15) will need to be unified into one deterministic anomaly service before Phase 3 of the roadmap.
- Two lockfiles (`package-lock.json`, `pnpm-lock.yaml`) — pick one package manager and delete the other lockfile.
- Extensive markdown documentation (`DOCUMENTATION.md`, `IMPLEMENTATION_SUMMARY.md`, `LANGCHAIN_TOOLS.md`, `PHASE3_INDEX.md`, `PHASE3_SELF_CORRECTION.md`, `QUICK_START.md`, `REACT_LOOP_GUIDE.md`, `TOOLS_CODE_REFERENCE.md` — over 3,500 lines total) describes only the small ReAct/mock-state slice in great, sometimes marketing-toned detail ("The feature that gets you hired" — `PHASE3_SELF_CORRECTION.md:5`) and **never mentions** LangGraph, Terraform, Prisma, Redis, or workers — i.e., none of this documentation describes the actual target architecture in this prompt. It should be archived or clearly labeled "legacy prototype docs" so it isn't mistaken for current-state documentation of the vision.

---

## 18. Recommended Target Architecture

Preserve and build on:
- `lib/mockAwsState.ts` → evolve into the seed/fixture layer for a real simulation engine backed by Prisma, not a replacement for the DB.
- `lib/sandbox/validationSandbox.ts` → evolve its pattern (deterministic, structured `ValidationResult`/`PolicyViolationError`) into the real Terraform-plan policy engine (Phase 7) — the *shape* of this code is good; the *input* it validates needs to change from "tool name + instance id" to "parsed Terraform plan JSON".
- `app/api/agent/route.ts`'s self-correction loop concept (bounded retries, structured error feedback) → reused as the shape of the future `selfCorrectionAgent` LangGraph node, rewritten on top of an actual `StateGraph`.
- The visual design system already built in `components/dashboard/*` and `components/ui/button.tsx` → keep as the UI layer, but rewire every data-bearing component to consume real state (via React Query/SWR or Server Components reading from Prisma) instead of literals.
- `components/agent-terminal.tsx` + `app/actions/simulation.ts` → the only existing example of a full, real UI→action→state loop in the repo; use as the template for wiring the new dashboard.

Target layout (new, not yet present):
```
prisma/                     # schema.prisma + migrations
lib/
  db.ts                     # Prisma client singleton
  simulation/
    tickEngine.ts            # interval-driven state progression
    scenarios.ts              # CPU spike / idle / leak / cost-spike injectors
  langgraph/
    graph.ts                  # compiled StateGraph, entry/end, checkpointer
    nodes/*.ts                 # one file per node listed in §10
  terraform/
    runner.ts                  # spawns terraform in an isolated temp dir/sandbox
    policy.ts                   # deterministic plan-policy evaluation (evolve from validationSandbox.ts)
  queue/
    connection.ts                # Redis client
    queues.ts                     # BullMQ Queue definitions
    workers/*.ts                   # one worker per long-running job type
app/api/... (existing routes kept, but made thin — delegate to lib/*)
```

---

## 19. Build-Next Roadmap

### Phase 0 — Stabilise Current Codebase
- **Objective:** Make the existing code trustworthy before adding anything new.
- **Files to create:** `eslint.config.mjs`.
- **Files to modify:** `next.config.mjs` (remove `ignoreBuildErrors` once errors below are fixed), `app/api/agent/route.ts` (fix tool-map typing), `lib/sandbox/validationSandbox.ts` (fix `isCriticalInstance` boolean bug, replace `require` with `import`), `.gitignore` (add `.env`), `.env` (rotate/remove the committed key).
- **Existing code reused:** everything; this phase is fix-only.
- **Existing code to remove:** the five orphaned components (§17) — or explicitly re-integrate them if they're wanted, but do not leave them silently dead.
- **Dependencies:** none new.
- **Acceptance criteria:** `tsc --noEmit` reports 0 errors; `eslint .` runs and reports a real (possibly non-zero, but non-crashing) result; no secret values remain in tracked files.
- **Complexity:** Low.

### Phase 1 — Establish Data Models and Persistence
- **Objective:** Replace in-memory state with real persistence.
- **Files to create:** `prisma/schema.prisma` (Resource, ResourceMetric, CostRecord, Anomaly, AgentRun, GraphNodeRun, TerraformArtifact, TerraformPlan, PolicyDecision, ExecutionAttempt, VerificationResult, RollbackRecord, AuditLog models), `lib/db.ts`.
- **Files to modify:** `lib/mockAwsState.ts` → split into `lib/simulation/seed.ts` (fixture data) consumed by Prisma seeding, rather than being the runtime store itself.
- **Existing code reused:** the shape of `AwsInstance` becomes the `Resource` Prisma model's field list almost directly.
- **Dependencies:** `prisma`, `@prisma/client`, a running Postgres instance/connection string.
- **Acceptance criteria:** `npx prisma migrate dev` succeeds; a seed script populates the 5 example resources; `getInstances()`-equivalent reads from Postgres, not a `let` array.
- **Complexity:** Medium.

### Phase 2 — Build Simulation Tick Engine
- **Objective:** Real, persisted, scenario-driven metric progression.
- **Files to create:** `lib/simulation/tickEngine.ts`, `lib/simulation/scenarios.ts`.
- **Files to modify:** `app/api/metrics/route.ts` (read tick output from DB instead of generating `Math.random()` jitter inline).
- **Existing code reused:** `generateMetrics`'s variance/spike *shape* (§7) as the starting point for scenario definitions, now writing to Postgres each tick instead of only existing per-request.
- **Dependencies:** Phase 1 (Postgres).
- **Acceptance criteria:** metrics persist across requests and server restarts; a scenario (e.g. CPU spike) can be injected and observed in subsequent reads.
- **Complexity:** Medium.

### Phase 3 — Implement Deterministic Anomaly Detection
- **Objective:** One canonical, tested anomaly service.
- **Files to create:** `lib/anomalies/detect.ts`, `lib/anomalies/rules.ts`.
- **Files to modify:** `app/api/metrics/route.ts` (remove inline `detectAnomalies`), `lib/mockAwsState.ts` (remove `getAnomalies`, delegate to the new service).
- **Existing code reused:** merge the two divergent threshold sets identified in §15 into one rule set.
- **Dependencies:** Phase 1/2.
- **Acceptance criteria:** a unit test suite (new) proves each rule fires/doesn't fire at documented thresholds.
- **Complexity:** Low.

### Phase 4 — Implement LangGraph Workflow
- **Objective:** Real orchestration replacing the hand-rolled `while` loop.
- **Files to create:** `lib/langgraph/graph.ts`, `lib/langgraph/nodes/*.ts` (one per node in §10), `lib/langgraph/state.ts`.
- **Files to modify:** `app/api/agent/route.ts` (either retire in favor of a new `/api/graph/run` route, or become a thin wrapper invoking the compiled graph).
- **Existing code reused:** the self-correction loop's *logic* (bounded retries, structured error objects) becomes the `selfCorrectionAgent` node; `lib/sandbox/validationSandbox.ts`'s pattern becomes `planPolicyWorker`.
- **Dependencies:** add `@langchain/langgraph` as a **direct** dependency (it is already present transitively).
- **Acceptance criteria:** a compiled `StateGraph` runs end-to-end for at least `diagnosisAgent → financialImpactWorker → planningAgent` with real node transitions visible in execution history.
- **Complexity:** High.

### Phase 5 — Implement Terraform Sandbox
- **Objective:** Real Terraform execution, isolated.
- **Files to create:** `lib/terraform/runner.ts`, `lib/terraform/sandbox.ts` (temp dir + isolation), `lib/terraform/parsePlan.ts`.
- **Files to modify:** `components/dashboard/terraform-sandbox.tsx` (consume real generated code/logs instead of literals).
- **Existing code reused:** none directly (this is genuinely new); the custom HCL syntax highlighter added to `terraform-sandbox.tsx` in this session can be kept as-is for rendering real generated code.
- **Existing code to remove:** the static `terraformCode`/`executionLogs` literals.
- **Dependencies:** a `terraform` binary available in the execution environment; a process-isolation strategy (container or restricted subprocess).
- **Acceptance criteria:** `terraform init`/`validate`/`plan` run against a real, disposable working directory and produce a real JSON plan that the UI renders.
- **Complexity:** High.

### Phase 6 — Add Redis and Worker Queues
- **Objective:** Move long-running/queued work off the request/response cycle.
- **Files to create:** `lib/queue/connection.ts`, `lib/queue/queues.ts`, `lib/queue/workers/*.ts`.
- **Dependencies:** `bullmq`, `ioredis`, a running Redis instance.
- **Acceptance criteria:** a Terraform plan/apply job can be enqueued from an API route and processed by a separate worker process, with job status queryable.
- **Complexity:** Medium-High.

### Phase 7 — Implement Deterministic Auto-Approval
- **Objective:** Policy engine over real Terraform plans, no LLM approval.
- **Files to create:** `lib/terraform/policy.ts` (evolve from `lib/sandbox/validationSandbox.ts`).
- **Files to modify:** `components/dashboard/terraform-sandbox.tsx` (repurpose `Apply`/`Reject` buttons as *read-only status displays* of the deterministic decision, not manual triggers, per the "no human approval" requirement).
- **Acceptance criteria:** a plan with a disallowed change (e.g., IAM wildcard, prod resource deletion) is deterministically rejected without any model call; a safe plan is deterministically approved without any model call.
- **Complexity:** Medium.

### Phase 8 — Implement Apply, Verification, and Rollback
- **Objective:** Close the loop after approval.
- **Files to create:** `lib/terraform/apply.ts`, `lib/terraform/verify.ts`, `lib/terraform/rollback.ts`.
- **Acceptance criteria:** an approved plan is applied, verified against expected post-conditions, and automatically rolled back on verification failure — all logged to the `AuditLog` model from Phase 1.
- **Complexity:** High.

### Phase 9 — Connect UI to Real Execution State
- **Objective:** Retire every literal array in `components/dashboard/*`.
- **Files to modify:** `metrics-cards.tsx`, `cloudwatch-logs.tsx`, `infrastructure-table.tsx` (implement the already-present sort state for real), `agent-terminal-new.tsx`, `terraform-sandbox.tsx`.
- **Acceptance criteria:** reloading any dashboard page shows data that changes as the tick engine/graph progress, not fixed literals.
- **Complexity:** Medium.

### Phase 10 — Testing, Security, and Deployment
- **Objective:** Production readiness.
- **Files to create:** test suites for every service in Phases 1-8, `eslint.config.mjs` ruleset finalized, CI workflow.
- **Acceptance criteria:** `npm run lint`, `tsc --noEmit`, and a real test suite all pass in CI without `ignoreBuildErrors`.
- **Complexity:** Medium.

---

## 20. Immediate Next Five Tasks

1. **Fix the 7 real `tsc` errors and remove `ignoreBuildErrors` from `next.config.mjs`** (`app/api/agent/route.ts`, `lib/sandbox/validationSandbox.ts`) — small, independently verifiable, unblocks trustworthy CI later.
2. **Rotate the committed API key and fix `.gitignore`** (`.env`, `.gitignore`) — critical security fix, five-minute task.
3. **Add a minimal `eslint.config.mjs`** so `npm run lint` is functional again — small, unblocks Phase 0 acceptance criteria.
4. **Delete or consciously re-integrate the 5 orphaned components** (§15) — decide which "dashboard era" is canonical before building anything further on top of either.
5. **Unify the two divergent anomaly-detection implementations** into a single `lib/anomalies/` module (still using the in-memory store for now) — small, testable in isolation, and a direct prerequisite for Phase 3.

---

## 21. File-Level Action Plan

| File or Directory | Keep | Refactor | Replace | Delete | Reason |
|---|---|---|---|---|---|
| `app/page.tsx` | | ✅ | | | Real data flow; needs to be reconciled with `/dashboard`'s design instead of existing as a second, uglier competing home page. |
| `app/dashboard/page.tsx` + `components/dashboard/metrics-cards.tsx`, `cloudwatch-logs.tsx`, `infrastructure-table.tsx`, `agent-terminal-new.tsx` | | ✅ | | | Keep the visual design; replace every literal array with real data per Phase 9. |
| `app/terraform-sandbox/page.tsx` + `components/dashboard/terraform-sandbox.tsx` | | ✅ | | | Keep the visual design; replace literals with real Terraform output per Phase 5. |
| `components/dashboard/sidebar.tsx`, `header.tsx` | ✅ | | | | Solid, reusable chrome; just needs real routes behind the placeholder links eventually. |
| `lib/mockAwsState.ts` | | ✅ | | | Reuse as seed data; migrate runtime reads/writes to Prisma (Phase 1). |
| `lib/sandbox/validationSandbox.ts` | | ✅ | | | Fix the boolean bug now (Phase 0); evolve into Terraform plan-policy engine (Phase 7). |
| `lib/tools/cloudTools.ts` | ✅ | | | | Well-structured Zod-schema tool definitions; reusable as-is for the LangGraph tool layer. |
| `app/api/agent/route.ts` | | ✅ | | | Fix typing now (Phase 0); replace the hand-rolled loop with a real LangGraph invocation (Phase 4). |
| `app/api/metrics/route.ts` | | ✅ | | | Keep SSE plumbing; replace `Math.random()` jitter with tick-engine reads (Phase 2); fix `Content-Type` mismatch with any JSON consumer. |
| `app/actions/simulation.ts` | ✅ | | | | Clean Server Action pattern; keep, point at Prisma once Phase 1 lands. |
| `components/agent-terminal.tsx` | ✅ | | | | The one genuinely-working real-time UI piece; keep as the template for future streaming UIs. |
| `components/metrics-grid.tsx` | ✅ | | | | Real data via Server Action; keep. |
| `components/dashboard/resource-table.tsx` | | | | ✅ (or re-integrate) | Orphaned/unused; decide deliberately, don't leave silently dead. |
| `components/dashboard/alerts-panel.tsx` | | | | ✅ (or re-integrate) | Orphaned/unused. |
| `components/dashboard/simulation-controls.tsx` | | | | ✅ (or re-integrate) | Orphaned/unused. |
| `components/dashboard/spending-chart.tsx` | | | | ✅ (or re-integrate) | Orphaned/unused. |
| `components/dashboard/metrics-display.tsx` | | | | ✅ | Orphaned **and** broken (SSE/JSON mismatch); no reason to keep as-is. |
| `components/ui/button.tsx` | ✅ | | | | Solid shared primitive; keep. |
| `next.config.mjs` | | ✅ | | | Remove `ignoreBuildErrors` once Phase 0 type fixes land. |
| `.env` | | ✅ | | | Rotate key, stop tracking it, load via secret manager. |
| `pnpm-lock.yaml` **or** `package-lock.json` | | | | ✅ (pick one) | Two lockfiles for two different package managers is unnecessary drift. |
| `DEPLOYMENT.md`, `DOCUMENTATION.md`, `IMPLEMENTATION_SUMMARY.md`, `LANGCHAIN_TOOLS.md`, `PHASE3_INDEX.md`, `PHASE3_SELF_CORRECTION.md`, `QUICK_START.md`, `REACT_LOOP_GUIDE.md`, `TOOLS_CODE_REFERENCE.md` | | ✅ (re-label) | | | Accurate for the legacy ReAct prototype; should be clearly marked as documenting a **prior, smaller** system so they aren't mistaken for documentation of the LangGraph/Terraform vision. |

---

*No files were deleted, no destructive commands were run, and no Terraform or AWS operations were executed as part of producing this audit.*
