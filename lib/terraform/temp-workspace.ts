/**
 * One isolated temp directory per sandbox run. Every run gets its own
 * workspace under os.tmpdir()/cloudpilot-terraform/<runId>/ containing
 * exactly one file (main.tf, the persisted artifact's HCL) — nothing else
 * from the host filesystem is exposed to it.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WORKSPACE_ROOT_NAME = 'cloudpilot-terraform'

export interface SandboxWorkspace {
  path: string
  mainTfPath: string
}

export function workspaceFromPath(path: string): SandboxWorkspace {
  return { path, mainTfPath: join(path, 'main.tf') }
}

export async function createSandboxWorkspace(runId: string, hcl: string): Promise<SandboxWorkspace> {
  const path = join(tmpdir(), WORKSPACE_ROOT_NAME, `${runId}-${randomUUID().slice(0, 8)}`)
  await mkdir(path, { recursive: true })

  const workspace = workspaceFromPath(path)
  await writeFile(workspace.mainTfPath, hcl, 'utf8')

  return workspace
}

/** Overwrites main.tf in an existing workspace (selfCorrectionAgent's retry loop) — the same temp dir, .terraform/ cache, and state are reused rather than starting a fresh workspace per attempt. */
export async function writeCorrectedCode(workspace: SandboxWorkspace, hcl: string): Promise<void> {
  await writeFile(workspace.mainTfPath, hcl, 'utf8')
}

export async function readWorkspaceCode(workspace: SandboxWorkspace): Promise<string> {
  return readFile(workspace.mainTfPath, 'utf8')
}

export async function removeSandboxWorkspace(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}
