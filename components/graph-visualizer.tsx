'use client'

/**
 * Renders one graph run's per-node execution state as a compact list of
 * badges. No node's visual status is ever invented: it's either an actual
 * AgentNodeRun.status from the database or a real node_event/run_completed
 * SSE payload — see hooks/use-graph-run-status.ts for the data source this
 * and GraphPipelineRail both share.
 */

import { CheckCircle2, Circle, Loader2, MinusCircle, RotateCcw, ShieldX, XCircle } from 'lucide-react'
import { NODE_LABELS, NODE_ORDER, useGraphRunStatus, type VisualNodeStatus } from '@/hooks/use-graph-run-status'

interface GraphVisualizerProps {
  runId: string | null
  /** Called once with the run's overall status whenever it changes (e.g. so a parent can show a summary line). */
  onStatusChange?: (status: string | null) => void
}

export function GraphVisualizer({ runId, onStatusChange }: GraphVisualizerProps) {
  const { statuses, connection, runStatus, resolveStatus } = useGraphRunStatus(runId, onStatusChange)

  if (!runId) {
    return <div className="text-[13px] text-graphite text-center py-8">No graph run selected yet.</div>
  }

  if (connection === 'loading' && Object.keys(statuses).length === 0) {
    return <div className="text-[13px] text-graphite text-center py-8 animate-pulse">Loading run state…</div>
  }

  if (connection === 'error') {
    return <div className="text-[13px] text-danger text-center py-8">Failed to load run {runId}.</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-mono text-graphite">run {runId.slice(0, 8)}</span>
        <div className="flex items-center gap-2 text-[11px] font-mono">
          {connection === 'disconnected' && <span className="text-danger font-medium">Stream disconnected</span>}
          {runStatus && <span className="font-semibold text-ink uppercase">{runStatus}</span>}
        </div>
      </div>
      <ol className="space-y-1.5">
        {NODE_ORDER.map((node) => {
          const status = resolveStatus(node)
          return (
            <li key={node} className="flex items-center gap-2 text-[12px] font-mono">
              <StatusIcon status={status} />
              <span className={status === 'pending' || status === 'skipped' ? 'text-graphite' : 'text-ink'}>{NODE_LABELS[node]}</span>
              <span className={`ml-auto text-[10px] font-medium uppercase ${statusColor(status)}`}>{status.replace('_', ' ')}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function statusColor(status: VisualNodeStatus): string {
  switch (status) {
    case 'completed':
      return 'text-ok'
    case 'running':
      return 'text-signal'
    case 'failed':
      return 'text-danger'
    case 'rejected':
      return 'text-danger'
    case 'rolled_back':
      return 'text-warn'
    case 'skipped':
      return 'text-graphite'
    default:
      return 'text-graphite'
  }
}

function StatusIcon({ status }: { status: VisualNodeStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-ok flex-shrink-0" />
    case 'running':
      return <Loader2 className="w-4 h-4 text-signal flex-shrink-0 animate-spin" />
    case 'failed':
      return <XCircle className="w-4 h-4 text-danger flex-shrink-0" />
    case 'rejected':
      return <ShieldX className="w-4 h-4 text-danger flex-shrink-0" />
    case 'rolled_back':
      return <RotateCcw className="w-4 h-4 text-warn flex-shrink-0" />
    case 'skipped':
      return <MinusCircle className="w-4 h-4 text-hairline flex-shrink-0" />
    default:
      return <Circle className="w-4 h-4 text-hairline flex-shrink-0" />
  }
}
