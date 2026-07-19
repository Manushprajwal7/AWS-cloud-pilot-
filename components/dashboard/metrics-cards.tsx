'use client'

import { useMemo, type ReactNode } from 'react'
import { AlertTriangle, DollarSign, Gauge, Server, ShieldCheck, Trash2 } from 'lucide-react'
import { useResourceList } from '@/hooks/use-resource-list'
import { useAnomalies } from '@/hooks/use-anomalies'

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function CardSkeleton() {
  return <div className="bg-panel border border-hairline p-4 h-full min-h-52 animate-pulse" />
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-mono uppercase tracking-wider text-graphite mb-1.5">{children}</p>
}

export function MetricsCards() {
  const { resources, isLoading, status } = useResourceList()
  const { anomalies } = useAnomalies()

  const summary = useMemo(() => {
    const totalMonthlySpend = resources.reduce((sum, r) => sum + r.cost.projectedMonthlyUsd, 0)

    // Deterministic, from lib/anomalies + lib/financial — not a scenario heuristic.
    const estimatedMonthlyWaste = anomalies.reduce(
      (sum, a) => sum + (a.financialImpact?.estimatedWaste.monthlyUsd ?? 0),
      0,
    )

    const highSeverity = anomalies.filter((a) => a.severity === 'high' || a.severity === 'critical').length
    const mediumSeverity = anomalies.filter((a) => a.severity === 'medium').length
    const lowSeverity = anomalies.filter((a) => a.severity === 'low').length

    const runningCount = resources.filter((r) => r.status === 'running').length
    const byEnvironment = resources.reduce<Record<string, number>>((acc, r) => {
      acc[r.environment] = (acc[r.environment] ?? 0) + 1
      return acc
    }, {})

    const resourcesWithAnomalies = new Set(anomalies.map((a) => a.resourceId)).size
    const optimizationScore =
      resources.length > 0 ? Math.round(((resources.length - resourcesWithAnomalies) / resources.length) * 100) : 0

    const avgCpu =
      resources.length > 0 ? resources.reduce((sum, r) => sum + r.metrics.cpuPercent, 0) / resources.length : 0

    return {
      totalMonthlySpend,
      estimatedMonthlyWaste,
      highSeverity,
      mediumSeverity,
      lowSeverity,
      totalAnomalies: anomalies.length,
      runningCount,
      totalCount: resources.length,
      byEnvironment,
      optimizationScore,
      avgCpu,
    }
  }, [resources, anomalies])

  if (isLoading) {
    return (
      <div className="grid grid-cols-6 gap-px bg-hairline border border-hairline mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (status === 'disconnected') {
    return (
      <div className="mb-6 bg-panel border border-danger/40 p-4 text-[13px] text-danger">
        Unable to load live infrastructure metrics — the simulation stream is disconnected.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-6 gap-px bg-hairline border border-hairline mb-6">
      {/* Total Monthly Spend */}
      <div className="bg-panel p-4 h-full min-h-52 flex flex-col">
        <div className="flex items-start justify-between mb-4">
          <DollarSign className="w-4 h-4 text-graphite" strokeWidth={1.75} />
        </div>
        <Eyebrow>Total Monthly Spend</Eyebrow>
        <p className="text-2xl font-display font-semibold text-ink mb-2 tabular-nums">{formatUsd(summary.totalMonthlySpend)}</p>
        <p className="text-[11px] text-graphite mt-auto font-mono">Across {summary.totalCount} simulated resources</p>
      </div>

      {/* Estimated Monthly Waste */}
      <div className="bg-panel p-4 h-full min-h-52 flex flex-col">
        <div className="flex items-start justify-between mb-4">
          <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
        </div>
        <Eyebrow>Estimated Monthly Waste</Eyebrow>
        <p className="text-2xl font-display font-semibold text-danger mb-2 tabular-nums">{formatUsd(summary.estimatedMonthlyWaste)}</p>
        <p className="text-[11px] text-graphite mt-auto font-mono">From {summary.totalAnomalies} active anomal{summary.totalAnomalies === 1 ? 'y' : 'ies'}</p>
      </div>

      {/* Active Anomalies */}
      <div className="bg-panel p-4 h-full min-h-52 flex flex-col">
        <div className="flex items-start justify-between mb-4">
          <ShieldCheck className="w-4 h-4 text-info" strokeWidth={1.75} />
        </div>
        <Eyebrow>Active Anomalies</Eyebrow>
        <p className="text-2xl font-display font-semibold text-ink mb-3 tabular-nums">{summary.totalAnomalies}</p>
        <div className="flex flex-wrap gap-1.5 mt-auto">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-danger-soft text-danger text-[10px] font-mono font-semibold rounded-sm">
            {summary.highSeverity} HIGH
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-warn-soft text-warn text-[10px] font-mono font-semibold rounded-sm">
            {summary.mediumSeverity} MED
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-info-soft text-info text-[10px] font-mono font-semibold rounded-sm">
            {summary.lowSeverity} LOW
          </span>
        </div>
      </div>

      {/* Running Instances */}
      <div className="bg-panel p-4 h-full min-h-52 flex flex-col">
        <div className="flex items-start justify-between mb-4">
          <Server className="w-4 h-4 text-graphite" strokeWidth={1.75} />
        </div>
        <Eyebrow>Running Resources</Eyebrow>
        <p className="text-2xl font-display font-semibold text-ink mb-3 tabular-nums">
          {summary.runningCount}
          <span className="text-sm font-normal text-graphite font-mono"> / {summary.totalCount}</span>
        </p>
        <div className="text-[11px] space-y-1 text-graphite font-mono mt-auto">
          {Object.entries(summary.byEnvironment).map(([env, count]) => (
            <div key={env} className="flex justify-between capitalize">
              <span>{env}</span>
              <span className="font-semibold text-ink">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Optimization Score */}
      <div className="bg-panel p-4 h-full min-h-52 flex flex-col items-center">
        <div className="flex items-start justify-between mb-4 w-full">
          <Gauge className="w-4 h-4 text-signal" strokeWidth={1.75} />
        </div>
        <Eyebrow>Optimization Score</Eyebrow>
        <div className="relative w-20 h-20 mx-auto my-2">
          <svg viewBox="0 0 120 120" className="w-full h-full">
            <circle cx="60" cy="60" r="54" fill="none" stroke="#E1DED3" strokeWidth="7" />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="#C2410C"
              strokeWidth="7"
              strokeDasharray={`${(summary.optimizationScore / 100) * 2 * Math.PI * 54} ${2 * Math.PI * 54}`}
              strokeLinecap="butt"
              transform="rotate(-90 60 60)"
            />
            <text x="60" y="68" textAnchor="middle" className="text-xl font-mono font-semibold fill-ink">
              {summary.optimizationScore}%
            </text>
          </svg>
        </div>
        <p className="text-center text-[11px] text-graphite font-mono uppercase tracking-wide mt-auto">
          {summary.optimizationScore >= 80 ? 'Excellent' : summary.optimizationScore >= 50 ? 'Fair' : 'Needs attention'}
        </p>
      </div>

      {/* Average CPU Utilization */}
      <div className="bg-panel p-4 h-full min-h-52 flex flex-col">
        <div className="flex items-start justify-between mb-4">
          <AlertTriangle className="w-4 h-4 text-ok" strokeWidth={1.75} />
        </div>
        <Eyebrow>Average CPU Utilization</Eyebrow>
        <p className="text-2xl font-display font-semibold text-ink mb-1 tabular-nums">{summary.avgCpu.toFixed(1)}%</p>
        <p className="text-[11px] text-graphite mt-auto font-mono">Across all simulated resources</p>
      </div>
    </div>
  )
}
