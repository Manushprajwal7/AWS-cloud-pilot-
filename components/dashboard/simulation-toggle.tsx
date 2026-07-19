'use client'

/**
 * Header control for the server-side tick engine. Starting the engine is what
 * makes every panel on the dashboard populate: the engine writes metric
 * snapshots into simulationStore, the store relays them over
 * /api/simulation/stream, and the panels render that stream.
 */

import { useState } from 'react'
import { Loader2, Play, Square } from 'lucide-react'
import { setSimulationEngineRunning, useSimulationStream } from '@/hooks/use-simulation-stream'

export function SimulationToggle() {
  const { engineRunning, status, error: streamError, reconnect } = useSimulationStream()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The store's initial status is also 'disconnected', so status alone can't tell
  // "gave up reconnecting" from "hasn't connected yet" — only the former records
  // an error. Without this the button renders "Reconnect" on its very first paint.
  const isDisconnected = status === 'disconnected' && streamError !== null

  async function handleClick(): Promise<void> {
    // If the stream dropped, we can't trust engineRunning, so reconnect and let
    // the fresh snapshot tell us the truth instead of guessing start vs stop.
    if (isDisconnected) {
      reconnect()
      return
    }

    const shouldStart = !engineRunning
    setIsPending(true)
    setError(null)

    try {
      const response = await fetch(shouldStart ? '/api/simulation/start' : '/api/simulation/stop', { method: 'POST' })
      if (!response.ok) {
        throw new Error(`Simulation ${shouldStart ? 'start' : 'stop'} failed with HTTP ${response.status}`)
      }
      const { running } = (await response.json()) as { running: boolean }
      setSimulationEngineRunning(running)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the simulation engine')
    } finally {
      setIsPending(false)
    }
  }

  const label = isDisconnected
    ? 'Reconnect'
    : isPending
      ? engineRunning
        ? 'Stopping...'
        : 'Starting...'
      : engineRunning
        ? 'Stop Simulation'
        : 'Start Simulation'

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={handleClick}
        disabled={isPending}
        title={error ?? undefined}
        className={`flex items-center gap-2 px-3.5 py-2 rounded-sm text-[13px] font-medium font-mono transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
          engineRunning && !isDisconnected
            ? 'bg-panel border border-hairline text-ink hover:bg-subtle'
            : 'bg-signal text-white hover:bg-signal/90'
        }`}
      >
        {isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : engineRunning && !isDisconnected ? (
          <Square className="w-3.5 h-3.5 fill-current" />
        ) : (
          <Play className="w-3.5 h-3.5 fill-current" />
        )}
        <span className="whitespace-nowrap uppercase tracking-wide">{label}</span>
      </button>

      {engineRunning && !isDisconnected && !isPending && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-ok ring-2 ring-panel animate-pulse" />
      )}

      {error && (
        <p className="absolute top-full left-0 mt-1 text-xs text-danger whitespace-nowrap">{error}</p>
      )}
    </div>
  )
}
