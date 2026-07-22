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
  running: 'bg-signal-soft text-signal',
  completed: 'bg-ok-soft text-ok',
  applied: 'bg-info-soft text-info',
  failed: 'bg-danger-soft text-danger',
  rejected: 'bg-danger-soft text-danger',
  rolled_back: 'bg-warn-soft text-warn',
  no_anomaly: 'bg-subtle text-graphite',
  pending: 'bg-subtle text-graphite',
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
    <div className="bg-panel border border-hairline shadow-sm p-5">
      <h3 className="text-[10px] font-mono uppercase tracking-wider text-graphite mb-3">Graph Runs</h3>
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
                    className={`w-full text-left px-3 py-2 border-l-2 text-[11px] font-mono transition-colors ${
                      selected === run.runId ? 'border-signal bg-signal-soft' : 'border-hairline hover:bg-subtle'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-ink">{run.runId.slice(0, 8)}</span>
                      <span className={`px-1.5 py-0.5 rounded-sm font-medium uppercase text-[9px] ${STATUS_COLOR[run.status] ?? 'bg-subtle text-graphite'}`}>{run.status}</span>
                    </div>
                    <div className="mt-1 text-graphite">
                      {run.input?.resourceId ?? 'unknown resource'} · {new Date(run.startedAt).toLocaleTimeString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="col-span-12 md:col-span-7 border-l border-hairline pl-4">
          <GraphVisualizer runId={selected} />
        </div>
      </div>
    </div>
  )
}
