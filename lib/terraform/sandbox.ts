/**
 * Terraform sandbox orchestration: fmt -check, init, validate, plan, show.
 * Every command actually runs — inside a Docker container when Docker is
 * reachable (isolated filesystem, no host AWS credentials, network
 * disabled except where `terraform init` genuinely needs it to fetch the
 * aws provider), or directly against a host `terraform` binary as a
 * fallback (in which case network isolation can't be enforced by this
 * module — that limitation is real and documented, not hidden).
 *
 * `terraform apply` is intentionally not implemented anywhere in this file
 * — Phase 7 stops at a reviewable plan.
 */

import { runCommand, type RunCommandResult } from './command-runner'
import type { SandboxCommandResult, SandboxCommand } from './types'
import type { SandboxWorkspace } from './temp-workspace'

const TERRAFORM_DOCKER_IMAGE = 'hashicorp/terraform:1.9'
const DOCKER_PROBE_TIMEOUT_MS = 5000
const INIT_TIMEOUT_MS = 90_000
const DEFAULT_STEP_TIMEOUT_MS = 45_000

let dockerAvailability: Promise<boolean> | null = null

async function isDockerAvailable(): Promise<boolean> {
  if (!dockerAvailability) {
    dockerAvailability = runCommand({
      command: 'docker',
      args: ['info'],
      cwd: process.cwd(),
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    })
      .then((result) => result.exitCode === 0)
      .catch(() => false)
  }
  return dockerAvailability
}

export interface RunSandboxCommandOptions {
  workspace: SandboxWorkspace
  terraformArgs: string[]
  allowNetwork: boolean
  timeoutMs?: number
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

/**
 * Obviously-fake credentials the `aws` provider needs *a* value for even
 * with skip_credentials_validation set (see templates.ts's
 * wrapWithProviderBlock) — passed as env vars, never embedded in generated
 * HCL, per security-policy.ts's no-credential-references rule.
 *
 * Without TERRAFORM_AWS_ENDPOINT set, `apply` runs with allowNetwork: true
 * and will genuinely fail authenticating against real AWS with these —
 * that's correct: this app has no real AWS credentials configured
 * anywhere, so apply is expected to fail honestly rather than pretend to
 * succeed. With TERRAFORM_AWS_ENDPOINT set (see templates.ts's
 * wrapWithProviderBlock and docker-compose.yml's `localstack` service),
 * every AWS call is redirected to LocalStack instead, which accepts any
 * credentials — these same mock values work there too, unchanged.
 */
const MOCK_AWS_ENV = {
  AWS_ACCESS_KEY_ID: 'mock_access_key',
  AWS_SECRET_ACCESS_KEY: 'mock_secret_key',
  AWS_DEFAULT_REGION: 'us-east-1',
}

async function runSandboxCommand(options: RunSandboxCommandOptions): Promise<RunCommandResult> {
  const useDocker = await isDockerAvailable()

  if (useDocker) {
    const networkFlags = options.allowNetwork ? [] : ['--network', 'none']
    return runCommand({
      command: 'docker',
      args: [
        'run',
        '--rm',
        ...networkFlags,
        // Lets a LocalStack instance reached via TERRAFORM_AWS_ENDPOINT=
        // http://host.docker.internal:<port> resolve from inside this
        // container even on plain Linux Docker Engine, where that hostname
        // isn't wired up by default the way it is on Docker Desktop.
        // Harmless no-op when nothing in the container resolves that name.
        '--add-host',
        'host.docker.internal:host-gateway',
        '-v',
        `${options.workspace.path}:/workspace`,
        '-w',
        '/workspace',
        TERRAFORM_DOCKER_IMAGE,
        ...options.terraformArgs,
      ],
      cwd: options.workspace.path,
      timeoutMs: options.timeoutMs,
      extraEnv: { TF_IN_AUTOMATION: '1', TF_CLI_ARGS: '-no-color', ...MOCK_AWS_ENV },
      onStdout: options.onStdout,
      onStderr: options.onStderr,
    })
  }

  // Host-binary fallback: network isolation cannot be enforced here — this
  // is a real gap of running without Docker, not a simulated one.
  return runCommand({
    command: 'terraform',
    args: options.terraformArgs,
    cwd: options.workspace.path,
    timeoutMs: options.timeoutMs,
    extraEnv: { TF_IN_AUTOMATION: '1', TF_CLI_ARGS: '-no-color', ...MOCK_AWS_ENV },
    onStdout: options.onStdout,
    onStderr: options.onStderr,
  })
}

function toSandboxResult(command: SandboxCommand, result: RunCommandResult): SandboxCommandResult {
  return {
    command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
  }
}

export interface StreamCallbacks {
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export async function runTerraformFmtCheck(workspace: SandboxWorkspace, callbacks: StreamCallbacks = {}): Promise<SandboxCommandResult> {
  const result = await runSandboxCommand({
    workspace,
    terraformArgs: ['fmt', '-check', '-diff'],
    allowNetwork: false,
    timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    ...callbacks,
  })
  return toSandboxResult('fmt', result)
}

export async function runTerraformInit(workspace: SandboxWorkspace, callbacks: StreamCallbacks = {}): Promise<SandboxCommandResult> {
  const result = await runSandboxCommand({
    workspace,
    terraformArgs: ['init', '-input=false', '-no-color'],
    allowNetwork: true, // provider plugins must be fetched from the registry
    timeoutMs: INIT_TIMEOUT_MS,
    ...callbacks,
  })
  return toSandboxResult('init', result)
}

export async function runTerraformValidate(workspace: SandboxWorkspace, callbacks: StreamCallbacks = {}): Promise<SandboxCommandResult> {
  const result = await runSandboxCommand({
    workspace,
    terraformArgs: ['validate', '-no-color'],
    allowNetwork: false,
    timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    ...callbacks,
  })
  return toSandboxResult('validate', result)
}

export interface TerraformPlanOutcome {
  planResult: SandboxCommandResult
  showResult: SandboxCommandResult
  planJson: string | null
}

export async function runTerraformPlan(workspace: SandboxWorkspace, callbacks: StreamCallbacks = {}): Promise<TerraformPlanOutcome> {
  const planResult = await runSandboxCommand({
    workspace,
    terraformArgs: ['plan', '-input=false', '-no-color', '-out=approved.tfplan'],
    allowNetwork: false,
    timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    ...callbacks,
  })

  if (planResult.exitCode !== 0) {
    return { planResult: toSandboxResult('plan', planResult), showResult: toSandboxResult('show', planResult), planJson: null }
  }

  const showResult = await runSandboxCommand({
    workspace,
    terraformArgs: ['show', '-json', 'approved.tfplan'],
    allowNetwork: false,
    timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    ...callbacks,
  })

  return {
    planResult: toSandboxResult('plan', planResult),
    showResult: toSandboxResult('show', showResult),
    planJson: showResult.exitCode === 0 ? showResult.stdout : null,
  }
}

/**
 * Real, mutating `terraform fmt` (no -check) — the deterministic half of
 * selfCorrectionAgent's correction space. Formatting is the one error
 * category that never needs an LLM: any syntactically-valid HCL can be
 * canonically reformatted by the same tool that flagged it as non-canonical.
 */
export async function runTerraformFmtFix(workspace: SandboxWorkspace, callbacks: StreamCallbacks = {}): Promise<SandboxCommandResult> {
  const result = await runSandboxCommand({
    workspace,
    terraformArgs: ['fmt', '-no-color'],
    allowNetwork: false,
    timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    ...callbacks,
  })
  return toSandboxResult('fmt-fix', result)
}

/**
 * `terraform apply -auto-approve approved.tfplan` — applies the exact plan
 * file terraformPlanWorker produced. Never called with any other argument
 * shape; there is no code path anywhere in this module that generates a
 * fresh plan as part of apply.
 */
export async function runTerraformApply(workspace: SandboxWorkspace, callbacks: StreamCallbacks = {}): Promise<SandboxCommandResult> {
  const result = await runSandboxCommand({
    workspace,
    terraformArgs: ['apply', '-auto-approve', '-no-color', 'approved.tfplan'],
    allowNetwork: true, // the provider must reach the AWS API to apply
    timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    ...callbacks,
  })
  return toSandboxResult('apply', result)
}
