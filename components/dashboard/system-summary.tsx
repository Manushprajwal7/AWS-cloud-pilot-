'use client'

/**
 * Real savings, graph-run, and background-processing figures — the
 * pieces of the dashboard MetricsCards doesn't cover (that component
 * already handles spend/waste/anomalies/CPU from the in-memory stores).
 * Everything here comes from GET /api/dashboard/summary and
 * GET /api/dashboard/system-status; a database or Redis that isn't
 * reachable is shown as exactly that, not zeroed out silently.
 */

import { useEffect, useState } from 'react'
import { DollarSign, PiggyBank, PlayCircle, XCircle, Server, ListChecks } from 'lucide-react'
import { ChartErrorState, ChartLoadingState } from '@/components/monitoring/chart-states'

interface Summary {
  dbAvailable: boolean
  potentialMonthlySavingsUsd: number | null
  realizedMonthlySavingsUsd: number | null
  activeGraphRuns: number | null
  failedGraphRuns: number | null
  completedGraphRuns: number | null
}

interface WorkerStatus {
  name: string
  online: boolean
  lastHeartbeatAt: string | null
}

interface SystemStatus {
  redisAvailable: boolean
  queues: Record<string, { waiting: number; active: number; completed: number; failed: number; delayed: number }>
  workers: WorkerStatus[]
}

type LoadState = 'loading' | 'ready' | 'error'

const POLL_INTERVAL_MS = 15000

function formatUsd(value: number | null): string {
  if (value === null) return '—'
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function SystemSummary() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const [summaryRes, statusRes] = await Promise.all([fetch('/api/dashboard/summary'), fetch('/api/dashboard/system-status')])
        if (!summaryRes.ok || !statusRes.ok) throw new Error('HTTP error')
        const [summaryJson, statusJson] = await Promise.all([summaryRes.json(), statusRes.json()])
        if (cancelled) return
        setSummary(summaryJson)
        setSystemStatus(statusJson)
        setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    }

    void load()
    const interval = setInterval(() => void load(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [refreshToken])

  if (state === 'loading') {
    return <ChartLoadingState heightClassName="h-32" />
  }
  if (state === 'error' || !summary || !systemStatus) {
    return <ChartErrorState message="Unable to load system status." onRetry={() => setRefreshToken((t) => t + 1)} heightClassName="h-32" />
  }

  const totalQueueDepth = Object.values(systemStatus.queues).reduce((sum, q) => sum + q.waiting + q.active, 0)
  const totalFailedJobs = Object.values(systemStatus.queues).reduce((sum, q) => sum + q.failed, 0)
  const onlineWorkers = systemStatus.workers.filter((w) => w.online).length

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-hairline border border-hairline">
      <div className="bg-panel p-4">
        <div className="flex items-center gap-2 mb-2">
          <PiggyBank className="w-3.5 h-3.5 text-ok" strokeWidth={1.75} />
          <span className="text-[10px] font-mono uppercase tracking-wider text-graphite">Potential Monthly Savings</span>
        </div>
        <p className="text-lg font-display font-semibold text-ink tabular-nums">{summary.dbAvailable ? formatUsd(summary.potentialMonthlySavingsUsd) : 'DB unavailable'}</p>
      </div>

      <div className="bg-panel p-4">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="w-3.5 h-3.5 text-info" strokeWidth={1.75} />
          <span className="text-[10px] font-mono uppercase tracking-wider text-graphite">Realized Savings</span>
        </div>
        <p className="text-lg font-display font-semibold text-ink tabular-nums">{summary.dbAvailable ? formatUsd(summary.realizedMonthlySavingsUsd) : 'DB unavailable'}</p>
      </div>

      <div className="bg-panel p-4">
        <div className="flex items-center gap-2 mb-2">
          <PlayCircle className="w-3.5 h-3.5 text-signal" strokeWidth={1.75} />
          <span className="text-[10px] font-mono uppercase tracking-wider text-graphite">Graph Runs</span>
        </div>
        {summary.dbAvailable ? (
          <p className="text-[13px] text-ink font-mono">
            <span className="font-semibold text-signal">{summary.activeGraphRuns}</span> active ·{' '}
            <span className="font-semibold text-danger">{summary.failedGraphRuns}</span> failed ·{' '}
            <span className="font-semibold text-ok">{summary.completedGraphRuns}</span> completed
          </p>
        ) : (
          <p className="text-[13px] text-graphite">Database unavailable</p>
        )}
      </div>

      <div className="bg-panel p-4">
        <div className="flex items-center gap-2 mb-2">
          <Server className="w-3.5 h-3.5 text-graphite" strokeWidth={1.75} />
          <span className="text-[10px] font-mono uppercase tracking-wider text-graphite">Workers</span>
        </div>
        {systemStatus.redisAvailable ? (
          <>
            <p className="text-[13px] text-ink font-mono">
              <span className="font-semibold text-ok">{onlineWorkers}</span> / {systemStatus.workers.length} online
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {systemStatus.workers.map((w) => (
                <span key={w.name} className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-mono font-medium ${w.online ? 'bg-ok-soft text-ok' : 'bg-subtle text-graphite'}`}>
                  {w.online ? <ListChecks className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
                  {w.name}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-[13px] text-graphite">Redis unavailable</p>
        )}
      </div>

      {systemStatus.redisAvailable && (
        <div className="col-span-2 md:col-span-4 bg-panel p-4">
          <div className="flex items-center gap-2 mb-2">
            <ListChecks className="w-3.5 h-3.5 text-info" strokeWidth={1.75} />
            <span className="text-[10px] font-mono uppercase tracking-wider text-graphite">Queue Status</span>
            <span className="text-[11px] font-mono text-graphite ml-auto">
              {totalQueueDepth} queued/active · {totalFailedJobs} failed
            </span>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
            {Object.entries(systemStatus.queues).map(([name, counts]) => (
              <div key={name} className="border border-hairline p-2">
                <div className="font-medium text-ink truncate font-mono text-[11px]" title={name}>
                  {name.replace('cloudpilot-', '')}
                </div>
                <div className="text-graphite text-[11px] font-mono">
                  {counts.waiting + counts.active} active · {counts.failed} failed
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
