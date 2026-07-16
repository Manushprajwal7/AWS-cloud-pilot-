# Phase 1 — Refactor the Existing Groq Agent Foundation

**Date:** 2026-07-16
**Scope:** Extract reusable Groq/prompt/schema/tool/streaming logic from `app/api/agent/route.ts` into `lib/ai/*`. Preserve existing ReAct agent functionality. No new product features, no LangGraph, no Terraform.

---

## 1. Objective

Turn the single 500+ line route handler into a thin HTTP adapter over a real service layer, so the same Groq client, prompts, tool registry, and ReAct loop can later be reused by the LangGraph workflow (Phase 4) instead of being copy-pasted.

---

## 2. A decision made before writing code

The existing `.env` held `XAI_API_KEY=gsk_...` — a Groq-format key (`gsk_` prefix, flagged by the Phase 0 audit) pointed at `https://api.x.ai`, which a Groq key cannot authenticate against. Since this phase's deliverable is literally `lib/ai/groq.ts`, I asked the user how to resolve this before wiring anything up. **Decision: switch to the real Groq API.** Concretely:

- Endpoint: `https://api.groq.com/openai/v1/chat/completions`
- Env var: renamed `XAI_API_KEY` → `GROQ_API_KEY` (in `.env` and `.env.example`)
- Added `GROQ_MODEL` (defaults to `llama-3.3-70b-versatile` if unset)
- Model name: `grok-beta` → `llama-3.3-70b-versatile`

This was verified against the real Groq API before considering the phase done (see §6).

---

## 3. New files

### `lib/ai/schemas.ts`
Zod schemas, all previously either duplicated or missing:
- `instanceIdSchema`, `modifyInstanceSchema`, `emptySchema` — tool argument schemas (moved from `lib/tools/cloudTools.ts`, which now imports them instead of defining its own copies).
- `agentRequestSchema` — validates the `POST /api/agent` body (`query`: optional string, 1–2000 chars after trimming). Previously the route did no validation at all (`body.query || defaultString`).
- `reActEventSchema` — the contract for every streamed SSE event. Previously this was only a TypeScript `interface`, unenforced at runtime.

### `lib/ai/groq.ts`
Centralized Groq client. Exports:
- `callGroqChat(options)` — the only place in the codebase that should ever call the Groq chat-completions endpoint.
- `getGroqApiKey()` / `hasGroqApiKey()` — key access, throws `GroqConfigError` if unset.
- `GroqConfigError`, `GroqRequestError` — typed errors so callers can distinguish "not configured" from "the API call failed."
- **Bounded retries**: `maxRetries` (default 2) with linear backoff (`retryDelayMs * attempt`, default 500ms). Retries only on `429` and `5xx`; a `4xx` other than `429` fails immediately. This is new — the original route had zero retry logic and would fail outright on any transient error.

### `lib/ai/prompts.ts`
`REACT_AGENT_SYSTEM_PROMPT`, moved verbatim from the route. One correctness fix bundled in: the original code sent this as a top-level `system` field in the JSON body (an Anthropic-Messages-API-shaped field), which is not part of the OpenAI-compatible chat-completions request format both xAI and Groq actually expose — it was silently ignored by the API. It's now sent correctly as `{ role: 'system', content: ... }`, the first message in the array.

### `lib/ai/tools.ts`
The AI-facing tool registry, distinct from `lib/tools/cloudTools.ts` (which owns the raw mock-AWS actions). Exports `toolMap`, `buildToolDefinitions()` (the Groq/OpenAI function-calling JSON schema for all 7 tools), and `executeTool()` (routes state-mutating tools through `validateToolExecution` from the deterministic validation sandbox before ever executing them — unchanged behavior, just relocated).

### `lib/ai/react-loop.ts`
`runReActLoop(userQuery, options?)` — the async-generator ReAct loop, moved out of the route with one necessary protocol fix: the original code fed tool results back to the model as a single `{ role: 'user', content: [{type: 'tool_use', ...}] }` message — an Anthropic content-block shape that is invalid input for an OpenAI/Groq-compatible `messages` array. It's now one `{ role: 'tool', tool_call_id, content }` message per tool call, and the assistant's `tool_calls` are preserved on its own message, matching what the real API requires to resolve tool calls in the next turn. Without this fix the multi-turn tool-calling loop would not work at all against a real endpoint (see §6 — this was verified live). `maxIterations` (default 5) and `maxCorrections` (default 5) are now configurable per call instead of hardcoded, which is what makes them independently testable.

---

## 4. `app/api/agent/route.ts` — now a thin controller

The route does exactly four things, in order:
1. **Validate config** — `hasGroqApiKey()`, else `500` with a structured `{ error }` body.
2. **Validate input** — parses JSON (`400` on malformed JSON), then `agentRequestSchema.safeParse` (`400` with `{ error, details }` on failure, `details` being Zod's field-level errors).
3. **Call the agent service** — `runReActLoop(userQuery)`.
4. **Stream results / return structured errors** — same SSE `ReadableStream` wrapper as before; errors thrown mid-stream are caught and emitted as a `type: 'error'` event before closing, same as the original.

Nothing else lives in the route now — no prompt text, no tool definitions, no fetch calls.

---

## 5. Tests (`vitest`)

No test runner existed before this phase. Added `vitest` + `@vitest/coverage-v8`, `npm run test` / `npm run test:watch`, and `vitest.config.mts` (named `.mts` rather than `.ts` — the project doesn't set `"type": "module"` in `package.json`, so a plain `.ts` config loads as CommonJS and vitest's own dependency chain requires ESM, exactly the same constraint that already led `next.config.mjs`/`postcss.config.mjs` to use explicit `.mjs`).

**33 tests across 4 files, all passing:**

| Requirement | File | Coverage |
|---|---|---|
| Missing Groq key | `lib/ai/groq.test.ts`, `app/api/agent/route.test.ts` | `hasGroqApiKey`/`getGroqApiKey` behavior when unset; route returns `500` with a message mentioning `GROQ_API_KEY` and never calls `fetch`. |
| Invalid request input | `lib/ai/schemas.test.ts`, `app/api/agent/route.test.ts` | Empty/oversized/non-string `query` rejected by the schema; route returns `400` for malformed JSON, empty query, non-string query; a request with no `query` at all is accepted (falls back to the default). |
| Maximum retry enforcement | `lib/ai/groq.test.ts`, `lib/ai/react-loop.test.ts` | Network layer: 5xx/429 retried up to `maxRetries` then throws, exact call count asserted (never more than budgeted); non-retryable 4xx fails on the first attempt; a transient failure followed by success is recovered within budget. Loop layer: self-correction stops at exactly `maxCorrections` attempts (asserted `attempt` sequence `[1, 2]`, never `[1, 2, 3]`); iteration count is capped at `maxIterations` even when the model keeps requesting tool calls. |
| Tool output validation | `lib/ai/schemas.test.ts` | `instanceIdSchema`/`modifyInstanceSchema` accept valid payloads and reject missing/empty `instance_id` and invalid `new_type` enum values. |
| Streaming event structure | `lib/ai/react-loop.test.ts` | Every event yielded by `runReActLoop` in a full mocked run (thought → action → observation → thought → complete → summary) is validated against `reActEventSchema`; same check for the no-message and thrown-error paths. |

`lib/ai/groq.ts` and `lib/ai/tools.ts` are mocked with `vi.mock` in `react-loop.test.ts` so the loop's control flow is tested in isolation from the network and from the mock AWS state; `route.test.ts` stubs `fetch` for the one test that lets the real loop start, so no test hits the network.

---

## 6. Verification

```
npm run test        → 4 files, 33 tests, all passing
npx tsc --noEmit      → 0 errors
npm run lint          → 0 errors (7 pre-existing warnings, unchanged from Phase 0: unused
                         _input placeholders, calculateCostBreakdown, state/existingAnomalies
                         in metrics/route.ts — all intentionally inert pending later phases)
npm run build          → succeeds, all 6 routes compile
```

**Live smoke test** (against the user's dev server, real Groq API, not mocked): `POST /api/agent` with `{"query":"List my instances"}` correctly streamed `action` → `observation` (get_instances, 5 real mock instances) → `action` → `observation` (get_anomalies, 3 anomalies) → then a real `429` rate-limit from Groq surfaced as a clean `type: "error"` SSE event, followed by `summary` and `[DONE]`. This confirms the endpoint switch, the tool-calling protocol fix, and the bounded-retry path all work against production — not just against mocks.

---

## 7. Notes for later phases

- The `429` seen during the smoke test is expected on Groq's free/on-demand tier under this model's TPM limit — not a bug, just worth knowing the account is close to that ceiling if load-testing later phases.
- `components/agent-terminal.tsx` (the UI consumer) parses SSE payloads looking for `content` strings prefixed with `[THOUGHT]`/`[ACTION]`/etc. — the backend has never emitted those prefixes (events use a `type` field instead), so today the terminal UI classifies almost everything as `observation` regardless of its real type. This mismatch predates this phase and lives entirely in a component, not the route, so it was out of scope here — flagging again for whichever phase touches the dashboard UI.
- `lib/ai/tools.ts` vs `lib/tools/cloudTools.ts`: kept as two layers deliberately — `cloudTools.ts` owns the mock-AWS action implementations (will eventually point at Prisma instead of the in-memory store per the Phase 1/2 roadmap in the audit), `lib/ai/tools.ts` owns the AI-facing registry/schema/execution-with-policy-check layer on top of it. This separation is what Phase 4's LangGraph nodes will import from directly.

---

*Phase 1 complete. Stopping here per the "build one phase at a time" rule — do not proceed to Phase 2 without explicit instruction.*
