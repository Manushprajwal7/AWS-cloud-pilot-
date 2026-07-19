'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { useAnomalies } from '@/hooks/use-anomalies'
import { Lightbulb, TrendingDown, Zap, Package, Filter, CheckCircle2, Loader2, ExternalLink } from 'lucide-react'

type ApplyState = 'idle' | 'starting' | 'started' | 'error'

const ICON_MAP: Record<string, typeof Lightbulb> = {
  rightsizing: Package,
  scale_in: TrendingDown,
  scheduled_shutdown: Zap,
}

export default function RecommendationsPage() {
  const { anomalies } = useAnomalies()
  const [filterBy, setFilterBy] = useState<'all' | 'rightsizing' | 'scale_in' | 'scheduled_shutdown'>('all')
  const [sortBy, setSortBy] = useState<'savings' | 'impact'>('savings')
  const [applyState, setApplyState] = useState<Record<string, ApplyState>>({})

  const applyRecommendation = async (id: string, resourceId: string) => {
    setApplyState((prev) => ({ ...prev, [id]: 'starting' }))
    try {
      const response = await fetch('/api/graph/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceId }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setApplyState((prev) => ({ ...prev, [id]: 'started' }))
    } catch {
      setApplyState((prev) => ({ ...prev, [id]: 'error' }))
    }
  }

  const recommendations = useMemo(() => {
    return anomalies
      .filter((a) => a.recommendation)
      .map((a) => ({
        id: a.id,
        type: a.recommendation!.kind as 'rightsizing' | 'scale_in' | 'scheduled_shutdown',
        resourceId: a.resourceId,
        anomalyType: a.type,
        monthlySavings: a.recommendation!.monthlySavings,
        recommendation: a.recommendation!,
        waste: a.financialImpact?.estimatedWaste.monthlyUsd ?? 0,
      }))
      .filter((r) => filterBy === 'all' || r.type === filterBy)
      .sort((a, b) => (sortBy === 'savings' ? b.monthlySavings - a.monthlySavings : b.waste - a.waste))
  }, [anomalies, filterBy, sortBy])

  const summary = useMemo(() => {
    const totalSavings = recommendations.reduce((sum, r) => sum + r.monthlySavings, 0)
    const byType: Record<string, number> = {}
    recommendations.forEach((r) => {
      byType[r.type] = (byType[r.type] ?? 0) + 1
    })
    return {
      totalRecommendations: recommendations.length,
      totalSavings,
      byType,
    }
  }, [recommendations])

  return (
    <div className="flex h-screen w-screen bg-paper overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-56 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto pt-16">
          <div className="w-full px-6 py-6 space-y-6">
            {/* Page Header */}
            <div>
              <h1 className="text-3xl font-bold text-ink">Recommendations</h1>
              <p className="text-graphite mt-1">Optimization recommendations based on detected anomalies</p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-6">
              <div className="bg-panel rounded-lg border border-hairline p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 bg-signal-soft rounded-lg flex items-center justify-center">
                    <Lightbulb className="w-5 h-5 text-signal" />
                  </div>
                </div>
                <p className="text-sm text-graphite mb-2">Total Recommendations</p>
                <p className="text-3xl font-bold text-ink">{summary.totalRecommendations}</p>
              </div>

              <div className="bg-panel rounded-lg border border-ok/25 bg-ok-soft p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 bg-ok-soft rounded-lg flex items-center justify-center">
                    <TrendingDown className="w-5 h-5 text-ok" />
                  </div>
                </div>
                <p className="text-sm text-ok font-medium mb-2">Total Monthly Savings</p>
                <p className="text-3xl font-bold text-ok">${summary.totalSavings.toFixed(0)}</p>
              </div>

              <div className="bg-panel rounded-lg border border-hairline p-6">
                <p className="text-sm text-graphite mb-2">Rightsizing</p>
                <p className="text-3xl font-bold text-ink">{summary.byType['rightsizing'] ?? 0}</p>
              </div>

              <div className="bg-panel rounded-lg border border-hairline p-6">
                <p className="text-sm text-graphite mb-2">Scale In</p>
                <p className="text-3xl font-bold text-ink">{summary.byType['scale_in'] ?? 0}</p>
              </div>
            </div>

            {/* Filters & Sort */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Filter className="w-5 h-5 text-graphite" />
                <div className="flex gap-2">
                  {(['all', 'rightsizing', 'scale_in', 'scheduled_shutdown'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setFilterBy(type)}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        filterBy === type
                          ? 'bg-signal text-white'
                          : 'bg-panel border border-hairline text-graphite hover:bg-subtle'
                      }`}
                    >
                      {type === 'all'
                        ? 'All'
                        : type === 'rightsizing'
                          ? 'Rightsizing'
                          : type === 'scale_in'
                            ? 'Scale In'
                            : 'Scheduled Shutdown'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                {(['savings', 'impact'] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => setSortBy(option)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      sortBy === option
                        ? 'bg-ink text-white'
                        : 'bg-panel border border-hairline text-graphite hover:bg-subtle'
                    }`}
                  >
                    {option === 'savings' ? 'Sort by Savings' : 'Sort by Impact'}
                  </button>
                ))}
              </div>
            </div>

            {/* Recommendations List */}
            {recommendations.length === 0 ? (
              <div className="bg-panel rounded-lg border border-hairline p-8 text-center">
                <CheckCircle2 className="w-12 h-12 text-ok mx-auto mb-3" />
                <p className="text-lg font-semibold text-ink">No recommendations</p>
                <p className="text-graphite mt-1">Your infrastructure is optimized</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {recommendations.map((rec) => {
                  const IconComp = ICON_MAP[rec.type] || Lightbulb
                  const typeLabel =
                    rec.type === 'rightsizing'
                      ? 'Rightsizing'
                      : rec.type === 'scale_in'
                        ? 'Scale In'
                        : 'Scheduled Shutdown'

                  return (
                    <div key={rec.id} className="bg-panel rounded-lg border border-hairline p-6 hover:border-signal/40 hover:shadow-md transition-all">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 bg-signal-soft rounded-lg flex items-center justify-center flex-shrink-0">
                          <IconComp className="w-6 h-6 text-signal" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <div>
                              <p className="text-lg font-semibold text-ink">{typeLabel}</p>
                              <p className="text-sm text-graphite mt-1">{rec.resourceId}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-2xl font-bold text-ok">${rec.monthlySavings.toFixed(0)}</p>
                              <p className="text-xs text-graphite">monthly savings</p>
                            </div>
                          </div>

                          {/* Recommendation Details */}
                          <div className="bg-subtle rounded-lg p-3 mt-3 mb-3">
                            {rec.type === 'rightsizing' && (
                              <p className="text-sm text-graphite">
                                <span className="font-semibold">Rightsize instance:</span> {(rec.recommendation as any).currentInstanceType} →{' '}
                                {(rec.recommendation as any).recommendedInstanceType}
                              </p>
                            )}
                            {rec.type === 'scale_in' && (
                              <p className="text-sm text-graphite">
                                <span className="font-semibold">Scale down tasks:</span> {(rec.recommendation as any).currentCapacity} →{' '}
                                {(rec.recommendation as any).recommendedCapacity} tasks
                              </p>
                            )}
                            {rec.type === 'scheduled_shutdown' && (
                              <p className="text-sm text-graphite">
                                <span className="font-semibold">Schedule shutdown:</span> {(rec.recommendation as any).offHoursPerDay} hours per day
                              </p>
                            )}
                          </div>

                          {/* Impact */}
                          <div className="flex items-center gap-4 text-xs text-graphite">
                            <span>
                              <span className="font-semibold">Annual Savings:</span> ${(rec.monthlySavings * 12).toFixed(0)}
                            </span>
                            <span>
                              <span className="font-semibold">Current Waste:</span> ${rec.waste.toFixed(0)}/mo
                            </span>
                          </div>
                        </div>

                        {(() => {
                          const state = applyState[rec.id] ?? 'idle'
                          if (state === 'started') {
                            return (
                              <Link
                                href="/dashboard"
                                className="px-4 py-2 bg-ok-soft border border-ok/25 text-ok rounded-lg font-medium transition-colors flex-shrink-0 flex items-center gap-1.5"
                              >
                                Run started
                                <ExternalLink className="w-3.5 h-3.5" />
                              </Link>
                            )
                          }
                          if (state === 'error') {
                            return (
                              <button
                                onClick={() => applyRecommendation(rec.id, rec.resourceId)}
                                className="px-4 py-2 bg-danger-soft border border-danger/25 text-danger hover:bg-danger-soft rounded-lg font-medium transition-colors flex-shrink-0"
                              >
                                Retry
                              </button>
                            )
                          }
                          return (
                            <button
                              onClick={() => applyRecommendation(rec.id, rec.resourceId)}
                              disabled={state === 'starting'}
                              className="px-4 py-2 bg-signal hover:bg-signal disabled:opacity-70 text-white rounded-lg font-medium transition-colors flex-shrink-0 flex items-center gap-1.5"
                            >
                              {state === 'starting' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              {state === 'starting' ? 'Starting…' : 'Apply'}
                            </button>
                          )
                        })()}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
