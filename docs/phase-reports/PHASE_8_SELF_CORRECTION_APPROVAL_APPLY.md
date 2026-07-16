# Phase 8 — Self-Correction, Plan Policy, Auto-Approval, and Terraform Apply

## Graph shape (extends Phase 7)

```
... staticSecurity
  -> [terraformFormat <-> terraformInit <-> terraformValidate <-> selfCorrection]*   (bounded loop, max 3 attempts)
  -> terraformPlan -> planPolicy -> autoApproval -> terraformApply -> audit -> END
```

`MAX_CORRECTION_ATTEMPTS = 3` (`lib/langgraph/state.ts`). Recursion limit raised from 25 to 60 to give the bounded loop headroom (`DEFAULT_RECURSION_LIMIT`, `lib/langgraph/graph.ts`).

## A Phase 7 bug this phase had to fix first

`terraformFormat`/`Init`/`Validate`/`Plan` used to `throw` on a command failure. `withNodeInstrumentation` discards a thrown node's return value, so on a *first-attempt* failure `sandboxWorkspacePath`/`terraformExecutionId` never made it into state — `selfCorrectionAgent` would have had nothing to locate the workspace with. All four nodes now **return normally with `error` set** instead of throwing; `graph.ts`'s wrapper was updated to treat a returned `error` field the same as a thrown one for `AgentNodeRun`/`nodeExecutions` bookkeeping, while still merging the rest of the node's return value into state.

## Self-correction (`lib/terraform/self-correction.ts` + `lib/langgraph/nodes/self-correction.ts`)

Which of two strategies runs is decided by reading `state.nodeExecutions`' last `'failed'` entry (not a separate state field — the existing instrumentation already records exactly which node failed and why):

- **`terraformFormat` failed** → deterministic fix: real `terraform fmt` (mutating, not `-check`) reformats the file. No LLM — formatting a syntactically-valid file is a pure, always-correct operation (`sandbox.ts#runTerraformFmtFix`).
- **`terraformInit`/`terraformValidate` failed** → bounded LLM fix. The prompt explicitly enumerates what may and may not be touched (syntax/missing-args/attribute-names/provider-schema/references — never provisioners, providers, new resource types, or security-relevant arguments). The corrected code is **always** re-run through `static-validator.ts` (the same engine `staticSecurityWorker` uses) before it's accepted; a violation rejects the correction outright rather than looping to relax the check.

Every attempt — corrected, rejected, or failed — is persisted as a `TerraformCorrectionAttempt` row (attempt number, previous/corrected code hash, trigger error, result, timestamp) **before** the node decides how to route. A successful correction creates a **new** `TerraformArtifact` row (not a mutation of the original) and loops back to `terraformFormat`; anything else stops the run at `audit`. Attempt detail (strategy, hashes, result) is pushed to the terminal over the same `command_output` SSE channel real `terraform` stdout/stderr already streams over — no new event type needed, and `GraphTerminal` was fixed to actually render `command_output` events (it silently dropped them before this phase).

## Plan policy, risk score, environment policy (`lib/terraform/{plan-policy,risk-score,environment-policy,auto-approval}.ts`)

`plan-policy.ts` turns the real `PlanSummary` into counts (create/update/delete/replacement/affected), cost change (`-remediationPlan.expectedMonthlySavingsUsd`), a 0–100 `risk-score.ts` score (delete/replacement/update-weighted, +20 for production, +15 for any cost increase), and a `violations` list combining `environment-policy.ts` (deletions, replacements, `requiresApproval`, any cost increase — all hard-rejected) with a provider-allowlist recheck against the plan's own resource types (covers "unsupported resources" and "unapproved providers" in one check, since every allowed type is `aws_*`).

`auto-approval.ts#decideAutoApproval` is a pure function: reject if security didn't pass, reject if any violation, reject if risk score > 30, else approve. **No Groq call anywhere in this file, its caller, or anything it depends on.** `autoApprovalWorker` persists a `PlanApproval` row with the code hash, plan hash (`hashJson` of the plan summary — `lib/terraform/hashing.ts`), all the counts, risk score, decision, reason, and `approvedAt`.

## Terraform apply (`lib/langgraph/nodes/terraform-apply.ts`)

Re-derives `currentCodeHash`/`currentPlanHash` from state and compares them against `approvalDecision.codeHash`/`.planHash` (the `PlanApproval` row) before touching anything — a mismatch halts with an error, `terraform apply` is never invoked. On a match, runs exactly `terraform apply -auto-approve approved.tfplan` (`sandbox.ts#runTerraformApply`) against the **same workspace and plan file** `terraformPlanWorker` produced — no fresh plan is generated. A new `TerraformExecution` row (`operation: 'apply'`) captures status, start/completion timestamps, exit code, full stdout/stderr, and the applied code/plan hashes (`TerraformExecution.appliedCodeHash`/`.appliedPlanHash`, new nullable columns). `auditNode` now reports `'applied'` as a distinct final status and only cleans up the sandbox workspace after apply has had its chance to run.

No AWS credentials are ever forwarded to the child process (`command-runner.ts`'s environment allowlist, unchanged since Phase 7), so in this environment `terraform apply` will legitimately fail at the provider's own auth step — that's correct, honest behavior, not a bug to paper over.

## Schema additions

`TerraformCorrectionAttempt` (attempt tracking) and `PlanApproval` (plan analysis + approval decision) are new models; `TerraformExecution` gained `appliedCodeHash`/`appliedPlanHash`. All additive — no existing model changed shape.

## Verified

`tsc --noEmit`, `eslint .` (zero new warnings/errors — the 7 pre-existing warnings are untouched files from earlier phases), `next build`, `vitest run` (171/171 pre-existing tests still pass), `prisma validate`.

## Known gaps

- No live end-to-end run was exercised against a real Postgres/Redis-backed `AgentRun` (same infra gap as Phases 6–7).
- `terraform apply` will fail on AWS authentication in this environment by design (no credentials are ever forwarded) — the apply *pipeline* (hash verification, execution, persistence, streaming) is real and complete, but a successful apply against real AWS has not been observed here.
- "Failure details" for `TerraformExecution` are folded into `logs` (combined stdout/stderr) rather than a dedicated column, consistent with how Phase 7 already recorded sandbox command failures.
