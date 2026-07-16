/**
 * Generic, safety-wrapped child-process execution. sandbox.ts is the only
 * caller and decides *what* to run (host `terraform` or a `docker run ...`
 * wrapper around it); this module only enforces *how* it's allowed to run:
 * a strict timeout with real process termination, a hard cap on captured
 * output, and a minimal, explicit environment allowlist so host AWS
 * credentials (or anything else in the parent process's env) can never
 * reach the child.
 */

import { spawn } from 'node:child_process'

export const DEFAULT_TIMEOUT_MS = 60_000
export const MAX_OUTPUT_BYTES = 1_000_000 // 1MB per stream

/**
 * Environment variable names that may be forwarded from the host process,
 * if present. Nothing AWS-credential-shaped (AWS_*, or any *_KEY/*_SECRET/
 * *_TOKEN pattern) is ever on this list — see also security-policy.ts's
 * no-credential-references check on the generated code itself.
 */
const ALLOWED_ENV_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'SystemRoot', 'NODE_ENV'] as const

export interface RunCommandOptions {
  command: string
  args: string[]
  cwd: string
  timeoutMs?: number
  maxOutputBytes?: number
  /** Extra env entries beyond the fixed allowlist, e.g. TF_IN_AUTOMATION. Never AWS_*. */
  extraEnv?: Record<string, string>
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export interface RunCommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

function buildRestrictedEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const forwarded: Record<string, string> = {}
  for (const key of ALLOWED_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) forwarded[key] = value
  }
  return { ...forwarded, ...extraEnv, NODE_ENV: process.env.NODE_ENV ?? 'production' }
}

class OutputCollector {
  private chunks: string[] = []
  private bytes = 0
  truncated = false

  constructor(private readonly limit: number) {}

  push(chunk: string): void {
    if (this.truncated) return
    this.bytes += Buffer.byteLength(chunk, 'utf8')
    if (this.bytes > this.limit) {
      this.truncated = true
      this.chunks.push('\n[output truncated: exceeded limit]')
      return
    }
    this.chunks.push(chunk)
  }

  toString(): string {
    return this.chunks.join('')
  }
}

/**
 * Runs one command to completion (or until it's killed for exceeding the
 * timeout). Never throws on a non-zero exit code or a timeout — both are
 * real, expected outcomes the caller (sandbox.ts) needs to inspect, not
 * exceptional conditions.
 */
export function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES
  const stdout = new OutputCollector(maxOutputBytes)
  const stderr = new OutputCollector(maxOutputBytes)
  const startedAt = Date.now()

  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: buildRestrictedEnv(options.extraEnv),
      shell: false,
      windowsHide: true,
    })

    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      // Give it a moment to exit gracefully before forcing termination.
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 3000)
    }, timeoutMs)

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString('utf8')
      stdout.push(text)
      options.onStdout?.(text)
      if (stdout.truncated) child.kill('SIGTERM')
    })

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString('utf8')
      stderr.push(text)
      options.onStderr?.(text)
      if (stderr.truncated) child.kill('SIGTERM')
    })

    child.on('error', (error) => {
      settled = true
      clearTimeout(timer)
      resolve({
        exitCode: null,
        stdout: stdout.toString(),
        stderr: `${stderr.toString()}\n[process error: ${error.message}]`,
        timedOut,
        durationMs: Date.now() - startedAt,
      })
    })

    child.on('close', (code) => {
      settled = true
      clearTimeout(timer)
      resolve({
        exitCode: code,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        timedOut,
        durationMs: Date.now() - startedAt,
      })
    })
  })
}
