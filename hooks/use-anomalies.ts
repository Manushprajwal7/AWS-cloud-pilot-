'use client'

/**
 * Owns the single live connection to GET /api/anomalies/stream, exposed as
 * an external store (useSyncExternalStore) the same way
 * use-simulation-stream.ts does — one shared connection regardless of how
 * many components read anomaly data.
 */

import { useSyncExternalStore } from 'react'
import type { EnrichedAnomaly } from '@/app/api/anomalies/enrich'
import type { AnomalyEventType } from '@/lib/anomalies/types'

export type AnomaliesConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'disconnected'

export interface AnomaliesStreamState {
  /** Active anomalies only — resolved ones are removed from this list as their resolution event arrives. */
  anomalies: EnrichedAnomaly[]
  status: AnomaliesConnectionStatus
  lastEventAt: string | null
  error: string | null
}

type SnapshotMessage = { type: 'snapshot'; anomalies: EnrichedAnomaly[] }
type AnomalyEventMessage = { type: 'anomaly_event'; event: { type: AnomalyEventType; anomaly: EnrichedAnomaly } }
type HeartbeatMessage = { type: 'heartbeat'; timestamp: string }
type StreamMessage = SnapshotMessage | AnomalyEventMessage | HeartbeatMessage

const STREAM_URL = '/api/anomalies/stream'
const MAX_RECONNECT_ATTEMPTS = 6
const BASE_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 15000

const initialState: AnomaliesStreamState = {
  anomalies: [],
  status: 'disconnected',
  lastEventAt: null,
  error: null,
}

let state: AnomaliesStreamState = initialState
const listeners = new Set<() => void>()

let abortController: AbortController | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let subscriberCount = 0

function setState(patch: Partial<AnomaliesStreamState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function upsertActive(anomalies: EnrichedAnomaly[], anomaly: EnrichedAnomaly): EnrichedAnomaly[] {
  const withoutExisting = anomalies.filter((a) => a.id !== anomaly.id)
  return anomaly.status === 'active' ? [...withoutExisting, anomaly] : withoutExisting
}

function applyMessage(message: StreamMessage): void {
  const now = new Date().toISOString()

  if (message.type === 'snapshot') {
    setState({ anomalies: message.anomalies, status: 'live', lastEventAt: now, error: null })
    return
  }

  if (message.type === 'anomaly_event') {
    setState({ anomalies: upsertActive(state.anomalies, message.event.anomaly), status: 'live', lastEventAt: now, error: null })
    return
  }

  setState({ status: 'live', lastEventAt: now })
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
      throw new Error(`Anomalies stream responded with HTTP ${response.status}`)
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

    throw new Error('Anomalies stream closed by the server')
  } catch (error) {
    if (controller.signal.aborted) return
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

export function reconnectAnomaliesStream(): void {
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

function getSnapshot(): AnomaliesStreamState {
  return state
}

function getServerSnapshot(): AnomaliesStreamState {
  return initialState
}

export interface UseAnomaliesResult extends AnomaliesStreamState {
  reconnect: () => void
}

export function useAnomalies(): UseAnomaliesResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { ...snapshot, reconnect: reconnectAnomaliesStream }
}
