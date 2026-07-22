'use client'

/**
 * The sandbox's signature element: every real node in the LangGraph
 * pipeline, grouped into the same six phases app/automation/page.tsx
 * documents statically (Sense / Reason / Generate·verify / Gate·apply /
 * Confirm / Close out) — except here the status per node is live, driven by
 * hooks/use-graph-run-status.ts's real AgentNodeRun/SSE data, not a
 * described topology. Watching this update node-by-node as monitor →
 * detectAnomaly → … → audit actually executes is the most characteristic
 * thing this page does.
 */

import { useGraphRunStatus, type VisualNodeStatus } from '@/hooks/use-graph-run-status'
import { CheckCircle2, Circle, Loader2, MinusCircle, RotateCcw, ShieldX, XCircle, type LucideIcon } from 'lucide-react'

interface PhaseGroup {
  eyebrow: string
  nodes: { id: string; label: string }[]
}

const PHASES: PhaseGroup[] = [
  { eyebrow: 'Sense', nodes: [{ id: 'monitor', label: 'monitor' }, { id: 'detectAnomaly', label: 'detectAnomaly' }] },
  {
    eyebrow: 'Reason',
    nodes: [
      { id: 'diagnose', label: 'diagnose' },
      { id: 'calculateImpact', label: 'calculateImpact' },
      { id: 'planRemediation', label: 'planRemediation' },
    ],
  },
  {
    eyebrow: 'Generate · verify',
    nodes: [
      { id: 'terraformGenerate', label: 'terraformGenerate' },
      { id: 'staticSecurity', label: 'staticSecurity' },
      { id: 'terraformFormat', label: 'terraformFormat' },
      { id: 'terraformInit', label: 'terraformInit' },
      { id: 'terraformValidate', label: 'terraformValidate' },
      { id: 'selfCorrection', label: 'selfCorrection' },
      { id: 'terraformPlan', label: 'terraformPlan' },
    ],
  },
  {
    eyebrow: 'Gate · apply',
    nodes: [
      { id: 'planPolicy', label: 'planPolicy' },
      { id: 'autoApproval', label: 'autoApproval' },
      { id: 'terraformApply', label: 'terraformApply' },
    ],
  },
  {
    eyebrow: 'Confirm',
    nodes: [
      { id: 'verification', label: 'verification' },
      { id: 'rollback', label: 'rollback' },
      { id: 'calculateRealizedSavings', label: 'calculateRealizedSavings' },
    ],
  },
  { eyebrow: 'Close out', nodes: [{ id: 'audit', label: 'audit' }] },
]

const STATUS_ICON: Record<VisualNodeStatus, LucideIcon> = {
  pending: Circle,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  rejected: ShieldX,
  rolled_back: RotateCcw,
  skipped: MinusCircle,
}

const STATUS_STYLE: Record<VisualNodeStatus, { chip: string; icon: string; dot: string }> = {
  pending: { chip: 'border-hairline bg-panel text-graphite', icon: 'text-hairline', dot: 'bg-hairline' },
  running: { chip: 'border-signal bg-signal-soft text-ink', icon: 'text-signal animate-spin', dot: 'bg-signal animate-pulse' },
  completed: { chip: 'border-ok/30 bg-ok-soft text-ink', icon: 'text-ok', dot: 'bg-ok' },
  failed: { chip: 'border-danger/40 bg-danger-soft text-ink', icon: 'text-danger', dot: 'bg-danger' },
  rejected: { chip: 'border-danger/40 bg-danger-soft text-ink', icon: 'text-danger', dot: 'bg-danger' },
  rolled_back: { chip: 'border-warn/40 bg-warn-soft text-ink', icon: 'text-warn', dot: 'bg-warn' },
  skipped: { chip: 'border-hairline bg-subtle text-graphite/70', icon: 'text-graphite/50', dot: 'bg-graphite/40' },
}

export function GraphPipelineRail({ runId, onStatusChange }: { runId: string | null; onStatusChange?: (status: string | null) => void }) {
  const { connection, runStatus, resolveStatus } = useGraphRunStatus(runId, onStatusChange)

  return (
    <div className="border border-hairline bg-panel shadow-sm">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-graphite">Pipeline</span>
          {runId ? (
            <span className="text-[11px] font-mono text-graphite">run {runId.slice(0, 8)}</span>
          ) : (
            <span className="text-[11px] font-mono text-graphite/70">no run selected</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono">
          {connection === 'disconnected' && <span className="text-danger font-medium">Stream disconnected</span>}
          {runStatus && <span className="font-semibold uppercase text-ink">{runStatus.replace(/_/g, ' ')}</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-stretch gap-x-1 gap-y-4 px-5 py-5">
        {PHASES.map((phase, phaseIdx) => (
          <div key={phase.eyebrow} className="flex items-stretch">
            <div className="min-w-[168px] pr-4">
              <div className="text-[10px] font-mono font-semibold uppercase tracking-[0.14em] text-graphite">{phase.eyebrow}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {phase.nodes.map((node) => {
                  const status = runId ? resolveStatus(node.id) : 'pending'
                  const Icon = STATUS_ICON[status]
                  const style = STATUS_STYLE[status]
                  return (
                    <div
                      key={node.id}
                      title={`${node.label} — ${status.replace('_', ' ')}`}
                      className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] font-mono transition-colors ${style.chip}`}
                    >
                      <Icon className={`h-3 w-3 flex-shrink-0 ${style.icon}`} strokeWidth={2} />
                      <span className="truncate">{node.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            {phaseIdx < PHASES.length - 1 && <div className="mx-3 hidden w-px self-stretch bg-hairline lg:block" aria-hidden="true" />}
          </div>
        ))}
      </div>
    </div>
  )
}
