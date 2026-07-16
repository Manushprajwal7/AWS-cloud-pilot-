# Phase 0 — Stabilize and Secure the Existing Repository

**Date:** 2026-07-16
**Scope:** Fix-only. No new product features, no new architecture, no LangGraph/Terraform/worker work (that begins in later phases).

---

## 1. Objective

Make the existing repository a trustworthy build baseline before any new architecture (simulation engine, LangGraph workflow, Terraform runtime, workers, database) is introduced, per `docs/CLOUDPILOT_IMPLEMENTATION_AUDIT.md`.

---

## 2. Changes Made

### 2.1 Fixed real `tsc` type errors (7 confirmed by the audit)

- **`app/api/agent/route.ts`** — `toolMap`'s `schema` field was typed `Record<string, unknown>`, which the real Zod `ZodObject` schemas in `lib/tools/cloudTools.ts` are not structurally assignable to. Retyped as `ZodTypeAny` (imported as a type-only import). Also added a proper `ChatCompletionResponse` / `ChatCompletionToolCall` interface to replace an `as any` cast on the xAI chat-completions JSON response.
- **`lib/tools/cloudTools.ts`** — Each tool's `execute` method previously took a tool-specific parameter shape (`z.infer<typeof instanceIdSchema>`, etc.) that was not contravariantly compatible with the shared `toolMap` execute signature (`string | Record<string, unknown>`). Normalized every tool's `execute` to accept `string | Record<string, unknown>` and parse/validate the fields it needs internally (`instance_id`, `new_type`). `modify_instance_type` now validates `new_type` against the schema's own enum at runtime before calling `modifyInstanceType`, instead of relying on the type system to make an untrusted string a literal union.
- **`lib/sandbox/validationSandbox.ts`** — `isCriticalInstance` compared a boolean (`highCpu`) to a number (`85`), a `TS2365` error, which silently broke the "or CPU > 85%" branch of the critical-instance check. Fixed to compare `instance.cpuUtilization > 85` directly. Also replaced the CommonJS `require('@/lib/mockAwsState')` call inside `getFirstDevInstance` with a normal ES `import`, removing an `any`-typed interop hazard.
- **`app/api/metrics/route.ts`** — Replaced `any[]` parameters (`generateMetrics`, `detectAnomalies`, `calculateCostBreakdown`) and the `MetricsResponse.data.instances: any[]` field with the real `AwsInstance[]` type from `lib/mockAwsState.ts`.
- **`components/dashboard/resource-table.tsx`** — Replaced `useState<any[]>([])` with `useState<AwsInstance[]>([])`, and fixed two latent field-name bugs this `any` was masking: the component read `instance.monthlyCost` and `instance.isAnomaly`, neither of which exist on `AwsInstance`. Now derives `monthlyCost` from `hourlyRate * 730` and `isAnomaly` from the same CPU thresholds (`>85` / `<5`) used by `lib/mockAwsState.ts`'s `getAnomalies()`.

`npx tsc --noEmit` now reports **0 errors**.

### 2.2 Removed `typescript.ignoreBuildErrors` from `next.config.mjs`

This flag was silently hiding the 7 errors above from every production build. Removed now that the underlying errors are fixed. `npm run build` runs a real TypeScript check as part of the build.

### 2.3 Added a working ESLint flat config

No `eslint.config.*` existed; `npm run lint` previously failed immediately. Installed `eslint`, `eslint-config-next`, and `@eslint/eslintrc` as dev dependencies and added `eslint.config.mjs`, which imports `eslint-config-next`'s pre-built flat-config arrays (`core-web-vitals`, `typescript`) directly — this Next.js version ships ESLint-9-native flat configs, not legacy `.eslintrc` exports, so `FlatCompat` is not needed.

Running `npm run lint` surfaced real, pre-existing bugs, which were fixed rather than suppressed:
- `app/page.tsx`, `components/agent-terminal.tsx` — unescaped `'`/`"` in JSX text (`react/no-unescaped-entities`).
- `components/agent-terminal.tsx` — unused `catch (e)` binding.
- `components/dashboard/infrastructure-table.tsx` — a `SortHeader` sub-component was being defined **inside** `InfrastructureTable`'s render body, so it was recreated (and its identity reset) on every render (`react-hooks/static-components`). Hoisted `SortHeader` to a module-level component that takes `sortBy`/`sortOrder`/`onSort` as props; the click handler was likewise hoisted into a `handleSort` callback. No behavior change — the sort buttons still only toggle local state, since actual row sorting is unimplemented pending Phase 9 (`components/dashboard/infrastructure-table.tsx` renders a fully static instance list; wiring it to sort is out of scope for a fix-only phase).
- `lib/tools/cloudTools.ts` — `let report` never reassigned (`prefer-const`), unused `startInstance` import.

`npm run lint` now exits **0** (8 remaining items are all warnings — unused-variable warnings on scaffolding that's intentionally inert pending later phases, e.g. `_input` placeholder parameters and `calculateCostBreakdown`, which is unused but was left in place since it's real, correct logic that a future phase will wire up rather than dead-and-broken code).

### 2.4 Environment file hygiene

- `.gitignore` only excluded `.env*.local`, not `.env` itself. Added `.env` to `.gitignore`.
- Added `.env.example` documenting the required `XAI_API_KEY` variable with no value, for onboarding.
- **Did not modify or delete the working local `.env`** — it contains the developer's actual working key and deleting it would break local development. **No commits exist yet in this repository** (`git log` reports "does not have any commits yet"), so the key has not been pushed anywhere; the risk described in the audit (a committed secret) has not yet materialized. See §4 for a recommendation on this.

### 2.5 Orphaned components (audit §15/§17)

The audit flagged five components as unreferenced by any page: `resource-table.tsx`, `alerts-panel.tsx`, `simulation-controls.tsx`, `spending-chart.tsx`, `metrics-display.tsx`, and suggested deleting or consciously re-integrating them. Per the top-level project instructions ("rebuilt incrementally without discarding reusable existing UI"), none were deleted. `resource-table.tsx` was fixed (see §2.1) since it's real, working code (a genuine `useEffect` polling loop against the real server action) — it was broken by an `any`-typed field mismatch, not by design. The other four had no lint/type errors and were left untouched. `metrics-display.tsx` remains genuinely broken (`response.json()` against an SSE endpoint) but is out of scope for a fix-only phase since fixing its actual purpose requires the Phase 2/3 metrics architecture — flagging it again here for whoever picks up Phase 9.

---

## 3. Verification

All three Phase 0 acceptance-criteria commands were run against the final state:

```
npm run lint       → exit 0 (8 warnings, 0 errors)
npx tsc --noEmit    → exit 0 (0 errors)
npm run build       → succeeds, real TypeScript checking enabled, all 6 routes compile
```

---

## 4. Notes / Follow-ups for the User

- **Rotate the `XAI_API_KEY` in `.env`.** It wasn't committed (no git history exists in this repo), so nothing has leaked externally, but the value was sitting in plaintext and its prefix (`gsk_`) suggests it's actually a Groq key, not an xAI key — worth confirming which provider it authenticates against before relying on it further.
- `components/dashboard/metrics-display.tsx` is dead and broken (SSE/JSON content-type mismatch) — decide in a later phase whether to delete it or rebuild it against the real metrics API.
- No behavior changes were made to the working Groq/xAI ReAct agent loop or the dashboard/terraform-sandbox UI beyond the lint/type fixes listed above.

---

*Phase 0 complete. Stopping here per the "build one phase at a time" rule — do not proceed to Phase 1 without explicit instruction.*
