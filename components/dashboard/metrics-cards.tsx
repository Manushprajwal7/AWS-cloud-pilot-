'use client'

import { useMemo } from 'react'
import { AlertTriangle, DollarSign, Gauge, Server, ShieldCheck, Trash2 } from 'lucide-react'
import { useResourceList } from '@/hooks/use-resource-list'
import { useAnomalies } from '@/hooks/use-anomalies'

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function CardSkeleton() {
  return <div className="bg-white rounded-lg border border-gray-200 p-4 h-full min-h-60 animate-pulse" />
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
      <div className="grid grid-cols-6 gap-4 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (status === 'disconnected') {
    return (
      <div className="mb-8 bg-white rounded-lg border border-red-200 p-4 text-sm text-red-700">
        Unable to load live infrastructure metrics — the simulation stream is disconnected.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-6 gap-4 mb-8">
      {/* Total Monthly Spend */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 h-full min-h-60">
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-orange-600" />
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-1">Total Monthly Spend</p>
        <p className="text-2xl font-bold text-gray-900 mb-2">{formatUsd(summary.totalMonthlySpend)}</p>
        <p className="text-xs text-gray-500">Across {summary.totalCount} simulated resources</p>
      </div>

      {/* Estimated Monthly Waste */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 h-full min-h-60">
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-600" />
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-1">Estimated Monthly Waste</p>
        <p className="text-2xl font-bold text-gray-900 mb-2">{formatUsd(summary.estimatedMonthlyWaste)}</p>
        <p className="text-xs text-gray-500">From {summary.totalAnomalies} active anomal{summary.totalAnomalies === 1 ? 'y' : 'ies'} with a known cost impact</p>
      </div>

      {/* Active Anomalies */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 h-full min-h-60">
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-1">Active Anomalies</p>
        <p className="text-2xl font-bold text-gray-900 mb-3">{summary.totalAnomalies}</p>
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-block px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded">
            {summary.highSeverity} High
          </span>
          <span className="inline-block px-2 py-1 bg-orange-100 text-orange-700 text-xs font-semibold rounded">
            {summary.mediumSeverity} Medium
          </span>
          <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded">
            {summary.lowSeverity} Low
          </span>
        </div>
      </div>

      {/* Running Instances */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 h-full min-h-60">
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <Server className="w-5 h-5 text-blue-600" />
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-1">Running Resources</p>
        <p className="text-2xl font-bold text-gray-900 mb-3">
          {summary.runningCount}
          <span className="text-sm font-normal text-gray-500"> / {summary.totalCount}</span>
        </p>
        <div className="text-xs space-y-1 text-gray-600">
          {Object.entries(summary.byEnvironment).map(([env, count]) => (
            <div key={env} className="flex justify-between capitalize">
              <span>{env}</span>
              <span className="font-semibold">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Optimization Score */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 h-full min-h-60">
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
            <Gauge className="w-5 h-5 text-orange-600" />
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-3">Optimization Score</p>
        <div className="relative w-20 h-20 mx-auto mb-2">
          <svg viewBox="0 0 120 120" className="w-full h-full">
            <circle cx="60" cy="60" r="54" fill="none" stroke="#f3f4f6" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="#f97316"
              strokeWidth="8"
              strokeDasharray={`${(summary.optimizationScore / 100) * 2 * Math.PI * 54} ${2 * Math.PI * 54}`}
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
            />
            <text x="60" y="70" textAnchor="middle" className="text-2xl font-bold fill-gray-900">
              {summary.optimizationScore}%
            </text>
          </svg>
        </div>
        <p className="text-center text-xs text-gray-600 font-medium">
          {summary.optimizationScore >= 80 ? 'Excellent' : summary.optimizationScore >= 50 ? 'Fair' : 'Needs attention'}
        </p>
      </div>

      {/* Average CPU Utilization */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 h-full min-h-60">
        <div className="flex items-start justify-between mb-3">
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-green-600" />
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-1">Average CPU Utilization</p>
        <p className="text-2xl font-bold text-gray-900 mb-1">{summary.avgCpu.toFixed(1)}%</p>
        <p className="text-xs text-gray-500">Across all simulated resources</p>
      </div>
    </div>
  )
}
