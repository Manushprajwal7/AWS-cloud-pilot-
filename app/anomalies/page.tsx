'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { useAnomalies } from '@/hooks/use-anomalies'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Filter } from 'lucide-react'
import type { AnomalySeverity } from '@/lib/anomalies/types'

const SEVERITY_CONFIG: Record<AnomalySeverity, { icon: typeof AlertCircle; color: string; bgColor: string; borderColor: string; label: string }> = {
  critical: { icon: AlertCircle, color: 'text-danger', bgColor: 'bg-danger-soft', borderColor: 'border-danger/25', label: 'Critical' },
  high: { icon: AlertCircle, color: 'text-danger', bgColor: 'bg-danger-soft', borderColor: 'border-danger/25', label: 'High' },
  medium: { icon: AlertTriangle, color: 'text-signal', bgColor: 'bg-signal-soft', borderColor: 'border-signal/25', label: 'Medium' },
  low: { icon: Info, color: 'text-info', bgColor: 'bg-info-soft', borderColor: 'border-info/25', label: 'Low' },
}

const TYPE_LABEL: Record<string, string> = {
  SUSTAINED_CPU_SPIKE: 'Sustained CPU Spike',
  IDLE_RESOURCE: 'Idle Resource',
  MEMORY_LEAK: 'Memory Leak',
  OVERPROVISIONED: 'Overprovisioned',
  COST_SPIKE: 'Cost Spike',
  TRAFFIC_SURGE: 'Traffic Surge',
  ELEVATED_ERROR_RATE: 'Elevated Error Rate',
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function AnomaliesPage() {
  const { anomalies } = useAnomalies()
  const [severityFilter, setSeverityFilter] = useState<AnomalySeverity | 'all'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    const hashId = window.location.hash.slice(1)
    if (!hashId) return
    setExpandedId(hashId)
    setSeverityFilter('all')
    const el = document.getElementById(hashId)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const filtered = useMemo(() => {
    return severityFilter === 'all'
      ? anomalies
      : anomalies.filter((a) => a.severity === severityFilter)
  }, [anomalies, severityFilter])

  const summary = useMemo(() => {
    return {
      total: anomalies.length,
      critical: anomalies.filter((a) => a.severity === 'critical').length,
      high: anomalies.filter((a) => a.severity === 'high').length,
      medium: anomalies.filter((a) => a.severity === 'medium').length,
      low: anomalies.filter((a) => a.severity === 'low').length,
      totalWaste: anomalies.reduce((sum, a) => sum + (a.financialImpact?.estimatedWaste.monthlyUsd ?? 0), 0),
    }
  }, [anomalies])

  return (
    <div className="flex h-screen w-screen bg-paper overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-60 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto pt-16">
          <div className="w-full px-6 py-6 space-y-6">
            {/* Page Header */}
            <div>
              <h1 className="text-3xl font-bold text-ink">Anomalies</h1>
              <p className="text-graphite mt-1">Detected infrastructure anomalies and cost optimization opportunities</p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-5 gap-4">
              <div className="bg-panel rounded-lg border border-hairline shadow-sm p-4">
                <p className="text-sm text-graphite mb-2">Total Anomalies</p>
                <p className="text-2xl font-bold text-ink">{summary.total}</p>
              </div>
              <div className="bg-panel rounded-lg border border-danger/25 bg-danger-soft shadow-sm p-4">
                <p className="text-sm text-danger font-medium mb-2">Critical</p>
                <p className="text-2xl font-bold text-danger">{summary.critical}</p>
              </div>
              <div className="bg-panel rounded-lg border border-danger/25 shadow-sm p-4">
                <p className="text-sm text-graphite mb-2">High</p>
                <p className="text-2xl font-bold text-danger">{summary.high}</p>
              </div>
              <div className="bg-panel rounded-lg border border-signal/25 shadow-sm p-4">
                <p className="text-sm text-graphite mb-2">Medium</p>
                <p className="text-2xl font-bold text-signal">{summary.medium}</p>
              </div>
              <div className="bg-panel rounded-lg border border-hairline shadow-sm p-4">
                <p className="text-sm text-graphite mb-2">Estimated Waste</p>
                <p className="text-lg font-bold text-ink">${summary.totalWaste.toFixed(0)}/mo</p>
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3">
              <Filter className="w-5 h-5 text-graphite" />
              <div className="flex gap-2">
                {(['all', 'critical', 'high', 'medium', 'low'] as const).map((severity) => (
                  <button
                    key={severity}
                    onClick={() => setSeverityFilter(severity)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors capitalize ${
                      severityFilter === severity
                        ? 'bg-signal text-ink font-semibold'
                        : 'bg-panel border border-hairline text-graphite hover:bg-subtle'
                    }`}
                  >
                    {severity}
                  </button>
                ))}
              </div>
            </div>

            {/* Anomalies List */}
            {filtered.length === 0 ? (
              <div className="bg-panel rounded-lg border border-hairline shadow-sm p-8 text-center">
                <CheckCircle2 className="w-12 h-12 text-ok mx-auto mb-3" />
                <p className="text-lg font-semibold text-ink">No anomalies detected</p>
                <p className="text-graphite mt-1">Your infrastructure is operating normally</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map((anomaly) => {
                  const config = SEVERITY_CONFIG[anomaly.severity]
                  const Icon = config.icon
                  const isExpanded = expandedId === anomaly.id

                  return (
                    <div
                      key={anomaly.id}
                      id={anomaly.id}
                      className={`rounded-lg border shadow-sm transition-all ${config.bgColor} ${config.borderColor} overflow-hidden scroll-mt-20`}
                    >
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : anomaly.id)}
                        className="w-full px-6 py-4 text-left hover:opacity-80 transition-opacity"
                      >
                        <div className="flex items-start gap-4">
                          <Icon className={`w-5 h-5 ${config.color} mt-0.5 flex-shrink-0`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <p className="text-sm font-semibold text-ink">
                                {TYPE_LABEL[anomaly.type] ?? anomaly.type}
                              </p>
                              <span className={`text-xs uppercase font-bold px-2.5 py-1 rounded-full ${config.bgColor} ${config.color}`}>
                                {config.label}
                              </span>
                            </div>
                            <p className="text-sm text-graphite mb-2">
                              {anomaly.evidence[0]?.description ?? 'Condition detected.'}
                            </p>
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-graphite font-mono">{anomaly.resourceId}</p>
                              <span className="text-xs text-graphite">{timeAgo(anomaly.lastObservedAt)}</span>
                            </div>
                          </div>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-current border-opacity-20 px-6 py-4 bg-panel bg-opacity-50 space-y-3">
                          {anomaly.financialImpact && (
                            <div className="bg-panel rounded border border-hairline p-3">
                              <p className="text-xs font-semibold text-graphite mb-2">Financial Impact</p>
                              <p className="text-lg font-bold text-signal">
                                ${anomaly.financialImpact.estimatedWaste.monthlyUsd.toFixed(0)}/month waste
                              </p>
                            </div>
                          )}

                          {anomaly.evidence.length > 0 && (
                            <div className="bg-panel rounded border border-hairline p-3">
                              <p className="text-xs font-semibold text-graphite mb-2">Evidence</p>
                              <ul className="space-y-1">
                                {anomaly.evidence.map((ev, idx) => (
                                  <li key={idx} className="text-xs text-graphite">
                                    • {ev.description}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {anomaly.recommendation && (
                            <div className="bg-ok-soft rounded border border-ok/25 p-3">
                              <p className="text-xs font-semibold text-ok mb-2">Recommendation</p>
                              <p className="text-sm text-ok font-medium">
                                {anomaly.recommendation.kind === 'rightsizing' &&
                                  `Rightsize ${anomaly.recommendation.currentInstanceType} → ${anomaly.recommendation.recommendedInstanceType}: save $${anomaly.recommendation.monthlySavings.toFixed(0)}/mo`}
                                {anomaly.recommendation.kind === 'scale_in' &&
                                  `Scale in ${anomaly.recommendation.currentCapacity} → ${anomaly.recommendation.recommendedCapacity} tasks: save $${anomaly.recommendation.monthlySavings.toFixed(0)}/mo`}
                                {anomaly.recommendation.kind === 'scheduled_shutdown' &&
                                  `Schedule ${anomaly.recommendation.offHoursPerDay}h/day shutdown: save $${anomaly.recommendation.monthlySavings.toFixed(0)}/mo`}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
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
