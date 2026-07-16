/**
 * Small helpers shared by the four sandbox nodes (terraform-format.ts,
 * terraform-init.ts, terraform-validate.ts, terraform-plan.ts) so the
 * "reconstruct a SandboxWorkspace handle from the path carried in state"
 * and "render a SandboxCommandResult as a log block" logic isn't
 * duplicated four times.
 */

import type { SandboxCommandResult } from '@/lib/terraform/types'

export { workspaceFromPath } from '@/lib/terraform/temp-workspace'

export function renderCommandLog(result: SandboxCommandResult): string {
  const header = `$ terraform ${result.command} (exit ${result.exitCode ?? 'null'}, ${result.durationMs}ms${result.timedOut ? ', TIMED OUT' : ''})`
  return [header, result.stdout, result.stderr].filter(Boolean).join('\n')
}

export function appendExecutionLog(existing: string | null | undefined, addition: string): string {
  return existing ? `${existing}\n\n${addition}` : addition
}
