/**
 * In-memory broadcaster for live graph runs, mirroring the subscribe()
 * pattern already used by lib/simulation/simulation-store.ts and
 * lib/anomalies/detector.ts. A run is actually executed exactly once here
 * (cloudPilotGraph.stream, streamMode: 'values') and every event broadcast
 * to subscribers is a real state snapshot taken right after a node
 * finished — nothing is synthesized on a timer. Recent events are buffered
 * per run so a client that connects to the SSE stream a moment after POST
 * /api/graph/run still sees everything that already happened.
 */

import { subscribeToCommandOutput } from './command-output-bus'
import { cloudPilotGraph, finalizeGraphRun, initializeGraphRun, type StartGraphRunOptions } from './graph'
import type { GraphNodeName, GraphState, NodeExecutionRecord } from './state'

export type GraphRunEvent =
  | { type: 'node_event'; runId: string; record: NodeExecutionRecord; status: GraphState['status']; currentNode: GraphNodeName | null }
  | { type: 'command_output'; runId: string; node: GraphNodeName; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'run_completed'; runId: string; finalState: GraphState }
  | { type: 'run_failed'; runId: string; error: string }

type Listener = (event: GraphRunEvent) => void

const listenersByRun = new Map<string, Set<Listener>>()
const eventBufferByRun = new Map<string, GraphRunEvent[]>()
const runPromises = new Map<string, Promise<GraphState>>()

const BUFFER_LIMIT = 200

function broadcast(runId: string, event: GraphRunEvent): void {
  const buffer = eventBufferByRun.get(runId) ?? []
  buffer.push(event)
  if (buffer.length > BUFFER_LIMIT) buffer.splice(0, buffer.length - BUFFER_LIMIT)
  eventBufferByRun.set(runId, buffer)

  for (const listener of listenersByRun.get(runId) ?? []) {
    listener(event)
  }
}

export function subscribeToRun(runId: string, listener: Listener): () => void {
  if (!listenersByRun.has(runId)) listenersByRun.set(runId, new Set())
  listenersByRun.get(runId)!.add(listener)

  for (const event of eventBufferByRun.get(runId) ?? []) {
    listener(event)
  }

  return () => {
    listenersByRun.get(runId)?.delete(listener)
  }
}

export function getRunPromise(runId: string): Promise<GraphState> | undefined {
  return runPromises.get(runId)
}

/**
 * Starts a real graph execution and returns immediately with the runId and
 * a promise that resolves to the final state. Callers that want to block
 * until completion (POST /api/graph/run) can await the promise; callers
 * that want live progress (the SSE stream route) can subscribeToRun.
 */
export async function startGraphRun(options: StartGraphRunOptions): Promise<{ runId: string; done: Promise<GraphState> }> {
  const { runId, initialState, config } = await initializeGraphRun(options)

  let lastExecutionCount = 0

  const unsubscribeCommandOutput = subscribeToCommandOutput(runId, (event) => {
    broadcast(runId, { type: 'command_output', runId, node: event.node, stream: event.stream, chunk: event.chunk })
  })

  const done = (async (): Promise<GraphState> => {
    let finalState: GraphState | null = null

    try {
      for await (const chunk of await cloudPilotGraph.stream(initialState, { ...config, streamMode: 'values' })) {
        const state = chunk as GraphState
        finalState = state

        const newRecords = state.nodeExecutions.slice(lastExecutionCount)
        lastExecutionCount = state.nodeExecutions.length

        for (const record of newRecords) {
          broadcast(runId, {
            type: 'node_event',
            runId,
            record,
            status: state.status,
            currentNode: state.currentNode,
          })
        }
      }

      if (!finalState) {
        throw new Error('graph run produced no state')
      }

      await finalizeGraphRun(runId, finalState)
      broadcast(runId, { type: 'run_completed', runId, finalState })
      return finalState
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown graph execution failure'
      await finalizeGraphRun(runId, {
        ...(finalState ?? ({} as GraphState)),
        runId,
        resourceId: options.resourceId,
        status: 'failed',
        error: message,
      } as GraphState).catch(() => undefined)
      broadcast(runId, { type: 'run_failed', runId, error: message })
      throw error
    } finally {
      unsubscribeCommandOutput()
      setTimeout(() => {
        listenersByRun.delete(runId)
        eventBufferByRun.delete(runId)
        runPromises.delete(runId)
      }, 60_000)
    }
  })()

  runPromises.set(runId, done)

  return { runId, done }
}
