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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-2">
          <PiggyBank className="w-4 h-4 text-green-600" />
          <span className="text-sm text-gray-600">Potential Monthly Savings</span>
        </div>
        <p className="text-xl font-bold text-gray-900">{summary.dbAvailable ? formatUsd(summary.potentialMonthlySavingsUsd) : 'DB unavailable'}</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="w-4 h-4 text-blue-600" />
          <span className="text-sm text-gray-600">Realized Savings</span>
        </div>
        <p className="text-xl font-bold text-gray-900">{summary.dbAvailable ? formatUsd(summary.realizedMonthlySavingsUsd) : 'DB unavailable'}</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-2">
          <PlayCircle className="w-4 h-4 text-orange-600" />
          <span className="text-sm text-gray-600">Graph Runs</span>
        </div>
        {summary.dbAvailable ? (
          <p className="text-sm text-gray-900">
            <span className="font-bold text-orange-600">{summary.activeGraphRuns}</span> active ·{' '}
            <span className="font-bold text-red-600">{summary.failedGraphRuns}</span> failed ·{' '}
            <span className="font-bold text-green-600">{summary.completedGraphRuns}</span> completed
          </p>
        ) : (
          <p className="text-sm text-gray-500">Database unavailable</p>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Server className="w-4 h-4 text-purple-600" />
          <span className="text-sm text-gray-600">Workers</span>
        </div>
        {systemStatus.redisAvailable ? (
          <>
            <p className="text-sm text-gray-900">
              <span className="font-bold text-green-600">{onlineWorkers}</span> / {systemStatus.workers.length} online
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {systemStatus.workers.map((w) => (
                <span key={w.name} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${w.online ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {w.online ? <ListChecks className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />}
                  {w.name}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-500">Redis unavailable</p>
        )}
      </div>

      {systemStatus.redisAvailable && (
        <div className="col-span-2 md:col-span-4 bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <ListChecks className="w-4 h-4 text-blue-600" />
            <span className="text-sm text-gray-600">Queue Status</span>
            <span className="text-xs text-gray-400 ml-auto">
              {totalQueueDepth} queued/active · {totalFailedJobs} failed
            </span>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
            {Object.entries(systemStatus.queues).map(([name, counts]) => (
              <div key={name} className="rounded border border-gray-100 p-2">
                <div className="font-medium text-gray-700 truncate" title={name}>
                  {name.replace('cloudpilot-', '')}
                </div>
                <div className="text-gray-500">
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
