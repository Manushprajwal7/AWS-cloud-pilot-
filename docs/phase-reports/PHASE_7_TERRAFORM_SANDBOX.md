# Phase 7 — Terraform Generation, Static Security, and Sandboxed Planning

## Graph shape (extends Phase 6)

```
... planRemediation -> terraformGenerate -> staticSecurity
      -> [terraformFormat -> terraformInit -> terraformValidate -> terraformPlan] -> audit -> END
```

A security rejection or any node error short-circuits straight to `audit` (`lib/langgraph/routes.ts`), which now reports a distinct `'rejected'` status (not `'failed'`) when `state.securityValidation.passed === false`, and is also responsible for deleting the sandbox's temp workspace on every path (success, rejection, or failure), since it's the one node guaranteed to run.

## Terraform generation (`lib/terraform/{types,provider-allowlist,templates,code-normalizer,hashing,generator}.ts`)

The LLM never writes or sees HCL. `templates.ts` builds 100% of the code deterministically from the resource's real configuration plus `lib/financial/rightsizing.ts`'s recommendation (RIGHTSIZE, SCALE_IN) or a scheduling tag (STOP, SCHEDULE — Terraform has no declarative "stop this instance" primitive without a banned provisioner, so both are represented the way ops teams already do this without Terraform: a tag an external scheduler acts on). `generator.ts` asks Groq for a narrative `changeDescription` only, validated against a schema with **no `code`/`hcl` field at all** — there is no mechanism by which the model could inject Terraform even if it tried. `code-normalizer.ts` + `hashing.ts` produce the deterministic checksum stored on `TerraformArtifact.checksum`. `terraformGenerationAgent` (`lib/langgraph/nodes/terraform-generate.ts`) persists the artifact immediately.

`RemediationPlan` rows are now actually persisted (`plan-remediation.ts` was extended) — Phase 6 only kept the plan in graph state; Phase 7 needs the DB row as the FK for `TerraformArtifact`.

## Static security (`lib/terraform/{security-policy,static-validator}.ts`)

13 deterministic, regex-based policies (no provisioners, no local-exec/remote-exec, allowed-providers-only, no deletion directives, no IAM wildcards, no public ingress, no encryption/backup removal, no external data sources, no arbitrary file writes, no suspicious interpolation, no credential references). These are defense-in-depth — `templates.ts` already only emits allow-listed resource types with no provisioners, so nothing should fire in normal operation; the check exists to catch a future generation regression, not because generation is expected to fail it. `staticSecurityWorker` persists one `PolicyDecision` row per policy (not just per violation), and never calls an LLM, so there's no path for a model to talk its way past a rejection.

## Sandbox (`lib/terraform/{temp-workspace,command-runner,sandbox,plan-parser}.ts`)

Real command execution: `terraform fmt -check -diff`, `init`, `validate`, `plan -out=approved.tfplan`, `show -json approved.tfplan`. `command-runner.ts` enforces a strict timeout with real `SIGTERM`→`SIGKILL` termination, a 1MB-per-stream output cap, and an explicit environment allowlist (`PATH`/`HOME`/`TEMP`/`NODE_ENV` — nothing `AWS_*` is ever forwarded, so there are no host AWS credentials in the child process). `sandbox.ts` runs everything inside `docker run --rm hashicorp/terraform:1.9` when Docker is reachable (probed once via `docker info`), with `--network none` on every step except `init` (which genuinely needs the registry) — this environment has Docker available but no host `terraform` binary, so the Docker path is what actually executes here. A host-binary fallback exists for environments without Docker, with the honest caveat that network isolation can't be enforced in that mode. **`terraform apply` is not implemented anywhere in this codebase.**

Real stdout/stderr is streamed live, not buffered until a node finishes: `lib/langgraph/command-output-bus.ts` is a small leaf pub/sub (no dependency on `graph.ts`, avoiding a nodes→graph→run-registry→nodes cycle) that sandbox nodes publish to as `command-runner.ts`'s `onStdout`/`onStderr` fire, and that `run-registry.ts` subscribes to per-run, re-broadcasting as a new `command_output` SSE event type alongside the existing `node_event`/`run_completed`/`run_failed`.

`plan-parser.ts` validates the real `terraform show -json` output (Zod, only the fields CloudPilot uses) into a `PlanSummary` (creates/updates/deletes/no-ops + resource changes), persisted on `TerraformArtifact.planJson`.

## UI (`components/dashboard/terraform-sandbox.tsx`, `/terraform-sandbox`)

Every literal HCL string, mock execution log, and hardcoded cost figure was removed. The component now runs a real graph execution (same `POST /api/graph/run` + SSE pattern as `GraphTerminal`), renders the generated code once `terraformGenerate` completes, shows the static-security decision with real findings, streams real `terraform` stdout/stderr into the execution log panel, and computes cost-impact numbers from `resource.cost` and `remediationPlan.expectedMonthlySavingsUsd` — all sourced from the run's real final state. Apply is a disabled button with an explicit "not implemented this phase" label rather than a fake handler; Reject clears the reviewed plan from view (no backend rejection API was in scope).

## Verified

`tsc --noEmit`, `eslint .` (zero new warnings/errors), `next build` (all three `/api/graph/*` routes + both pages build), `vitest run` (171/171 pre-existing tests still pass), `prisma validate`.

## Known gaps

- No `terraform` binary is present on the host; sandbox execution was validated by code review and Docker being reachable (`docker info` succeeds), not by watching a live run through the full pipeline against a real Postgres/Redis-backed AgentRun — that requires the infra called out as a Phase 6 gap too.
- `terraform fmt -check` runs for real against `code-normalizer.ts`'s output, which is a pure-JS whitespace normalizer, not gofmt-equivalent (e.g. it doesn't align consecutive `=` signs the way real `terraform fmt` does). A generation that isn't already canonically formatted will legitimately fail `terraformFormatWorker` rather than being silently auto-fixed — auto-running `terraform fmt` (non-check) before the check, or improving the JS normalizer, is the natural follow-up.
- No automated tests were added for `lib/terraform/*` or the new nodes (same testing gap as Phase 6 — no Postgres/Redis/Docker test harness exists in this repo yet).
