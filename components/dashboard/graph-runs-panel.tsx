'use client'

/**
 * Lists real recent AgentRun rows (GET /api/graph/runs) and renders the
 * selected one with GraphVisualizer — the same persisted+streamed node
 * states used on the Terraform runtime page. Selecting a run here doesn't
 * fabricate anything: the visualizer fetches that run's actual
 * AgentNodeRun history and, if it's still running, subscribes to its real
 * SSE stream.
 */

import { useEffect, useState } from 'react'
import { GraphVisualizer } from '@/components/graph-visualizer'
import { ChartEmptyState, ChartErrorState, ChartLoadingState } from '@/components/monitoring/chart-states'

interface RunRow {
  runId: string
  status: string
  startedAt: string
  completedAt: string | null
  error: string | null
  input: { resourceId?: string } | null
}

type LoadState = 'loading' | 'ready' | 'error' | 'db_unavailable'

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  applied: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
  rejected: 'bg-red-100 text-red-700',
  rolled_back: 'bg-purple-100 text-purple-700',
  no_anomaly: 'bg-gray-100 text-gray-600',
  pending: 'bg-gray-100 text-gray-600',
}

export function GraphRunsPanel() {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const response = await fetch('/api/graph/runs?limit=10')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (cancelled) return
        if (!data.dbAvailable) {
          setState('db_unavailable')
          return
        }
        setRuns(data.runs)
        setState('ready')
        setSelected((prev) => prev ?? (data.runs.length > 0 ? data.runs[0].runId : null))
      } catch {
        if (!cancelled) setState('error')
      }
    }

    void load()
    const interval = setInterval(() => void load(), 15000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [refreshToken])

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-900 mb-3">Graph Runs</h3>
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 md:col-span-5">
          {state === 'loading' ? (
            <ChartLoadingState heightClassName="h-40" />
          ) : state === 'error' ? (
            <ChartErrorState message="Unable to load recent runs." onRetry={() => setRefreshToken((t) => t + 1)} heightClassName="h-40" />
          ) : state === 'db_unavailable' ? (
            <ChartErrorState message="Database unavailable — recent runs require Postgres to be configured." heightClassName="h-40" />
          ) : runs.length === 0 ? (
            <ChartEmptyState message="No graph runs yet. Trigger one from the Terraform Runtime page." heightClassName="h-40" />
          ) : (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {runs.map((run) => (
                <li key={run.runId}>
                  <button
                    onClick={() => setSelected(run.runId)}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                      selected === run.runId ? 'border-orange-300 bg-orange-50' : 'border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-gray-700">{run.runId.slice(0, 8)}</span>
                      <span className={`px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLOR[run.status] ?? 'bg-gray-100 text-gray-600'}`}>{run.status}</span>
                    </div>
                    <div className="mt-1 text-gray-500">
                      {run.input?.resourceId ?? 'unknown resource'} · {new Date(run.startedAt).toLocaleTimeString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="col-span-12 md:col-span-7 border-l border-gray-100 pl-4">
          <GraphVisualizer runId={selected} />
        </div>
      </div>
    </div>
  )
}
