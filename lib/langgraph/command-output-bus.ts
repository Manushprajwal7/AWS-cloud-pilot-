/**
 * Leaf pub/sub for real-time terraform stdout/stderr, decoupled from both
 * the sandbox nodes and run-registry.ts so neither has to import the other
 * (nodes -> graph -> run-registry -> nodes would otherwise be circular).
 * Sandbox nodes publish chunks here as they're produced by the child
 * process (command-runner.ts's onStdout/onStderr); run-registry.ts
 * subscribes per-run and re-broadcasts as `command_output` SSE events.
 */

import type { GraphNodeName } from './state'

export interface CommandOutputEvent {
  runId: string
  node: GraphNodeName
  stream: 'stdout' | 'stderr'
  chunk: string
}

type Listener = (event: CommandOutputEvent) => void

const listenersByRun = new Map<string, Set<Listener>>()

export function emitCommandOutput(runId: string, node: GraphNodeName, stream: 'stdout' | 'stderr', chunk: string): void {
  for (const listener of listenersByRun.get(runId) ?? []) {
    listener({ runId, node, stream, chunk })
  }
}

export function subscribeToCommandOutput(runId: string, listener: Listener): () => void {
  if (!listenersByRun.has(runId)) listenersByRun.set(runId, new Set())
  listenersByRun.get(runId)!.add(listener)

  return () => {
    const set = listenersByRun.get(runId)
    set?.delete(listener)
    if (set && set.size === 0) listenersByRun.delete(runId)
  }
}
