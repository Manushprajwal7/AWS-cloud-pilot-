'use client'

/**
 * Owns the single live connection to GET /api/simulation/stream and exposes
 * it as an external store (useSyncExternalStore), so any number of
 * components/hooks can read live simulation state without each opening its
 * own SSE connection. React state is never the source of truth here — this
 * module is; components only ever render a read-only snapshot of it.
 */

import { useSyncExternalStore } from 'react'
import type { SimulatedCloudResource, SimulationStoreEvent } from '@/lib/simulation/types'

export type SimulationConnectionStatus = 'connecting' | 'live' | 'paused' | 'reconnecting' | 'disconnected'

export interface SimulationStreamState {
  resources: SimulatedCloudResource[]
  status: SimulationConnectionStatus
  /** Whether the server-side tick engine is currently running (independent of our connection to it). */
  engineRunning: boolean
  lastEventAt: string | null
  lastEvent: SimulationStoreEvent | null
  error: string | null
}

type SnapshotMessage = { type: 'snapshot'; resources: SimulatedCloudResource[]; running: boolean }
type StoreEventMessage = { type: 'store_event'; event: SimulationStoreEvent; running: boolean }
type HeartbeatMessage = { type: 'heartbeat'; running: boolean; timestamp: string }
type StreamMessage = SnapshotMessage | StoreEventMessage | HeartbeatMessage

const STREAM_URL = '/api/simulation/stream'
const MAX_RECONNECT_ATTEMPTS = 6
const BASE_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 15000

const initialState: SimulationStreamState = {
  resources: [],
  status: 'disconnected',
  engineRunning: false,
  lastEventAt: null,
  lastEvent: null,
  error: null,
}

let state: SimulationStreamState = initialState
const listeners = new Set<() => void>()

let abortController: AbortController | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let subscriberCount = 0

function setState(patch: Partial<SimulationStreamState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function upsertResource(resources: SimulatedCloudResource[], next: SimulatedCloudResource): SimulatedCloudResource[] {
  const index = resources.findIndex((r) => r.id === next.id)
  if (index === -1) {
    return [...resources, next].sort((a, b) => a.id.localeCompare(b.id))
  }
  const copy = resources.slice()
  copy[index] = next
  return copy
}

function applyMessage(message: StreamMessage): void {
  const now = new Date().toISOString()
  const status: SimulationConnectionStatus = message.running ? 'live' : 'paused'

  if (message.type === 'snapshot') {
    setState({ resources: message.resources, engineRunning: message.running, status, lastEventAt: now, error: null })
    return
  }

  if (message.type === 'store_event') {
    setState({
      resources: upsertResource(state.resources, message.event.resource),
      engineRunning: message.running,
      status,
      lastEventAt: now,
      lastEvent: message.event,
      error: null,
    })
    return
  }

  // heartbeat
  setState({ engineRunning: message.running, status, lastEventAt: now })
}

function scheduleReconnect(errorMessage: string): void {
  reconnectAttempts += 1

  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    setState({ status: 'disconnected', error: errorMessage })
    return
  }

  setState({ status: 'reconnecting', error: errorMessage })
  const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** (reconnectAttempts - 1), MAX_RECONNECT_DELAY_MS)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (subscriberCount > 0) connect()
  }, delay)
}

async function connect(): Promise<void> {
  if (abortController) return

  const controller = new AbortController()
  abortController = controller
  setState({ status: reconnectAttempts > 0 ? 'reconnecting' : 'connecting', error: null })

  try {
    const response = await fetch(STREAM_URL, { signal: controller.signal })
    if (!response.ok || !response.body) {
      throw new Error(`Simulation stream responded with HTTP ${response.status}`)
    }

    reconnectAttempts = 0
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const line = frame.trim()
        if (!line.startsWith('data:')) continue

        try {
          const message = JSON.parse(line.slice('data:'.length).trim()) as StreamMessage
          applyMessage(message)
        } catch {
          // Malformed frame — skip it rather than tearing down the connection.
        }
      }
    }

    // The server closed the stream — treat like any other dropped connection.
    throw new Error('Simulation stream closed by the server')
  } catch (error) {
    if (controller.signal.aborted) {
      // Intentional close (unsubscribed, or a manual reconnect superseded this attempt).
      return
    }
    abortController = null
    scheduleReconnect(error instanceof Error ? error.message : 'Connection lost')
  }
}

function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (abortController) {
    abortController.abort()
    abortController = null
  }
}

/**
 * Apply the running flag returned by /api/simulation/start|stop, so the UI
 * reflects a click right away rather than waiting up to a heartbeat interval
 * for the stream to carry the same flag. Ignored while we have no live
 * connection, since we'd have no basis to claim the engine is live.
 */
export function setSimulationEngineRunning(running: boolean): void {
  if (state.status === 'disconnected' || state.status === 'reconnecting') return
  setState({ engineRunning: running, status: running ? 'live' : 'paused' })
}

/** Manually force a fresh connection attempt, resetting the backoff counter. */
export function reconnectSimulationStream(): void {
  reconnectAttempts = 0
  disconnect()
  connect()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  subscriberCount += 1

  if (subscriberCount === 1) {
    reconnectAttempts = 0
    connect()
  }

  return () => {
    listeners.delete(listener)
    subscriberCount -= 1
    if (subscriberCount === 0) {
      disconnect()
      setState({ status: 'disconnected' })
    }
  }
}

function getSnapshot(): SimulationStreamState {
  return state
}

function getServerSnapshot(): SimulationStreamState {
  return initialState
}

export interface UseSimulationStreamResult extends SimulationStreamState {
  reconnect: () => void
}

/**
 * Subscribe to the live simulation stream. Safe to call from any number of
 * components — they all share the same underlying connection.
 */
export function useSimulationStream(): UseSimulationStreamResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { ...snapshot, reconnect: reconnectSimulationStream }
}
