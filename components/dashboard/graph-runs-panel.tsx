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
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  GitBranch,
  Loader2,
  MinusCircle,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
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

const STATUS_STYLE: Record<string, { badge: string; icon: LucideIcon; iconClass: string; spin?: boolean }> = {
  running: { badge: 'bg-signal-soft text-signal', icon: Loader2, iconClass: 'text-signal', spin: true },
  awaiting_approval: { badge: 'bg-signal-soft text-signal', icon: AlertCircle, iconClass: 'text-signal' },
  completed: { badge: 'bg-ok-soft text-ok', icon: CheckCircle2, iconClass: 'text-ok' },
  applied: { badge: 'bg-info-soft text-info', icon: Sparkles, iconClass: 'text-info' },
  failed: { badge: 'bg-danger-soft text-danger', icon: XCircle, iconClass: 'text-danger' },
  rejected: { badge: 'bg-danger-soft text-danger', icon: ShieldAlert, iconClass: 'text-danger' },
  rolled_back: { badge: 'bg-warn-soft text-warn', icon: RotateCcw, iconClass: 'text-warn' },
  no_anomaly: { badge: 'bg-subtle text-graphite', icon: MinusCircle, iconClass: 'text-graphite' },
  pending: { badge: 'bg-subtle text-graphite', icon: Clock, iconClass: 'text-graphite' },
}

const DEFAULT_STATUS_STYLE = { badge: 'bg-subtle text-graphite', icon: Clock, iconClass: 'text-graphite' }

function formatRelativeTime(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime()
  const seconds = Math.max(0, Math.round(deltaMs / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function formatDuration(startedAt: string, completedAt: string | null): string | null {
  if (!completedAt) return null
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  if (ms < 1000) return `${ms}ms`
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
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
    <div className="bg-panel border border-hairline shadow-sm">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
        <div className="flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 text-graphite" strokeWidth={1.75} />
          <h3 className="text-[10px] font-mono uppercase tracking-wider text-graphite">Graph Runs</h3>
          {state === 'ready' && runs.length > 0 && (
            <span className="rounded-sm border border-hairline bg-subtle px-1.5 py-0.5 text-[10px] font-mono text-graphite">{runs.length}</span>
          )}
        </div>
        <button
          onClick={() => setRefreshToken((t) => t + 1)}
          className="flex items-center gap-1 text-[10px] font-mono text-graphite hover:text-ink transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
          refreshes every 15s
        </button>
      </div>

      <div className="grid grid-cols-12 gap-0 p-5">
        <div className="col-span-12 md:col-span-5 md:pr-4">
          {state === 'loading' ? (
            <ChartLoadingState heightClassName="h-40" />
          ) : state === 'error' ? (
            <ChartErrorState message="Unable to load recent runs." onRetry={() => setRefreshToken((t) => t + 1)} heightClassName="h-40" />
          ) : state === 'db_unavailable' ? (
            <ChartErrorState message="Database unavailable — recent runs require Postgres to be configured." heightClassName="h-40" />
          ) : runs.length === 0 ? (
            <ChartEmptyState message="No graph runs yet. Trigger one from the Terraform Runtime page." heightClassName="h-40" />
          ) : (
            <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {runs.map((run) => {
                const style = STATUS_STYLE[run.status] ?? DEFAULT_STATUS_STYLE
                const Icon = style.icon
                const isSelected = selected === run.runId
                const duration = formatDuration(run.startedAt, run.completedAt)
                return (
                  <li key={run.runId}>
                    <button
                      onClick={() => setSelected(run.runId)}
                      className={`group w-full text-left px-3 py-2.5 border-l-2 transition-colors ${
                        isSelected ? 'border-signal bg-signal-soft' : 'border-hairline hover:bg-subtle hover:border-graphite/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${style.iconClass} ${style.spin ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                          <span className="truncate text-[12px] font-mono font-medium text-ink">{run.runId.slice(0, 8)}</span>
                        </div>
                        <span className={`flex-shrink-0 px-1.5 py-0.5 rounded-sm font-medium uppercase text-[9px] font-mono tracking-wide ${style.badge}`}>
                          {run.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-graphite">
                        <span className="truncate font-mono">{run.input?.resourceId ?? 'unknown resource'}</span>
                        <span className="text-hairline">·</span>
                        <span className="flex-shrink-0 font-mono">{formatRelativeTime(run.startedAt)}</span>
                        {duration && (
                          <>
                            <span className="text-hairline">·</span>
                            <span className="flex-shrink-0 font-mono">{duration}</span>
                          </>
                        )}
                      </div>
                      {run.error && <p className="mt-1 truncate text-[10px] font-mono text-danger">{run.error}</p>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="col-span-12 md:col-span-7 border-t border-hairline pt-4 mt-4 md:border-t-0 md:border-l md:pt-0 md:mt-0 md:pl-4">
          <GraphVisualizer runId={selected} />
        </div>
      </div>
    </div>
  )
}
