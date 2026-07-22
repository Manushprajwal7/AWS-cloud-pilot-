'use client'

import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { useAnomalies } from '@/hooks/use-anomalies'
import { ChartErrorState, ChartLoadingState } from '@/components/monitoring/chart-states'
import { ConnectionStatusBadge } from '@/components/monitoring/connection-status-badge'
import type { AnomalySeverity } from '@/lib/anomalies/types'

const SEVERITY_CONFIG: Record<AnomalySeverity, { icon: typeof AlertCircle; color: string; bgColor: string; borderColor: string }> = {
  critical: { icon: AlertCircle, color: 'text-danger', bgColor: 'bg-danger-soft', borderColor: 'border-danger/25' },
  high: { icon: AlertCircle, color: 'text-danger', bgColor: 'bg-danger-soft', borderColor: 'border-danger/25' },
  medium: { icon: AlertTriangle, color: 'text-warn', bgColor: 'bg-warn-soft', borderColor: 'border-warn/25' },
  low: { icon: Info, color: 'text-info', bgColor: 'bg-info-soft', borderColor: 'border-info/25' },
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
  return `${hours}h ago`
}

export function AlertsPanel() {
  const { anomalies, status, reconnect } = useAnomalies()

  const sorted = [...anomalies].sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt))

  return (
    <div className="bg-panel border border-hairline shadow-sm p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-graphite">Recent Anomalies</h3>
        <ConnectionStatusBadge status={status} onReconnect={reconnect} />
      </div>

      {status === 'disconnected' ? (
        <ChartErrorState message="Unable to load anomalies — the anomaly stream is disconnected." onRetry={reconnect} heightClassName="h-40" />
      ) : status === 'connecting' && anomalies.length === 0 ? (
        <ChartLoadingState heightClassName="h-40" />
      ) : sorted.length === 0 ? (
        <div className="h-40 flex flex-col items-center justify-center gap-2 text-graphite">
          <CheckCircle2 className="w-7 h-7" strokeWidth={1.5} aria-hidden="true" />
          <p className="text-[13px]">No active anomalies detected.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto" role="list" aria-label="Active anomalies">
          {sorted.map((anomaly) => {
            const config = SEVERITY_CONFIG[anomaly.severity]
            const Icon = config.icon
            return (
              <div
                key={anomaly.id}
                role="listitem"
                className={`p-3 border-l-2 ${config.bgColor} ${config.borderColor} transition-colors`}
              >
                <div className="flex items-start gap-3">
                  <Icon className={`w-4 h-4 ${config.color} mt-0.5 flex-shrink-0`} strokeWidth={1.75} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-ink">{TYPE_LABEL[anomaly.type] ?? anomaly.type}</p>
                      <span className="text-[9px] uppercase font-mono font-semibold text-graphite">{anomaly.severity}</span>
                    </div>
                    <p className="text-[12px] text-graphite mt-1">{anomaly.evidence[0]?.description ?? 'Condition detected.'}</p>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-[11px] text-graphite font-mono">{anomaly.resourceId} · {timeAgo(anomaly.lastObservedAt)}</p>
                      {anomaly.financialImpact && (
                        <p className="text-[11px] font-mono font-medium text-warn">
                          ~${anomaly.financialImpact.estimatedWaste.monthlyUsd.toFixed(0)}/mo waste
                        </p>
                      )}
                    </div>
                    {anomaly.recommendation && (
                      <p className="text-[11px] text-ok bg-ok-soft border border-ok/20 rounded-sm px-2 py-1 mt-2 font-mono">
                        {anomaly.recommendation.kind === 'rightsizing' &&
                          `Rightsize ${anomaly.recommendation.currentInstanceType} → ${anomaly.recommendation.recommendedInstanceType}: save $${anomaly.recommendation.monthlySavings.toFixed(0)}/mo`}
                        {anomaly.recommendation.kind === 'scale_in' &&
                          `Scale in ${anomaly.recommendation.currentCapacity} → ${anomaly.recommendation.recommendedCapacity} tasks: save $${anomaly.recommendation.monthlySavings.toFixed(0)}/mo`}
                        {anomaly.recommendation.kind === 'scheduled_shutdown' &&
                          `Schedule ${anomaly.recommendation.offHoursPerDay}h/day shutdown: save $${anomaly.recommendation.monthlySavings.toFixed(0)}/mo`}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
