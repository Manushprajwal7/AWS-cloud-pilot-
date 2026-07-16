'use client'

/**
 * Renders one graph run's per-node execution state as a pipeline of
 * badges. Self-contained: given a runId, it loads the persisted
 * AgentNodeRun history (GET /api/graph/runs/:runId) for whatever already
 * happened, then subscribes to the live SSE stream for real-time updates —
 * the same two data sources GraphTerminal/TerraformSandbox already use, so
 * nothing here is a second, disconnected notion of "graph state".
 * No node's visual status is ever invented: it's either an actual
 * AgentNodeRun.status from the database or a real node_event/run_completed
 * SSE payload.
 */

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Circle, Loader2, RotateCcw, ShieldX, XCircle } from 'lucide-react'

export type VisualNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'rejected' | 'rolled_back'

const NODE_ORDER = [
  'monitor',
  'detectAnomaly',
  'diagnose',
  'calculateImpact',
  'planRemediation',
  'terraformGenerate',
  'staticSecurity',
  'terraformFormat',
  'terraformInit',
  'terraformValidate',
  'selfCorrection',
  'terraformPlan',
  'planPolicy',
  'autoApproval',
  'terraformApply',
  'verification',
  'rollback',
  'calculateRealizedSavings',
  'audit',
] as const

const NODE_LABELS: Record<string, string> = {
  monitor: 'monitorWorker',
  detectAnomaly: 'anomalyDetectionWorker',
  diagnose: 'diagnosisAgent',
  calculateImpact: 'financialImpactWorker',
  planRemediation: 'planningAgent',
  terraformGenerate: 'terraformGenerationAgent',
  staticSecurity: 'staticSecurityWorker',
  terraformFormat: 'terraformFormatWorker',
  terraformInit: 'terraformInitWorker',
  terraformValidate: 'terraformValidateWorker',
  selfCorrection: 'selfCorrectionAgent',
  terraformPlan: 'terraformPlanWorker',
  planPolicy: 'planPolicyWorker',
  autoApproval: 'autoApprovalWorker',
  terraformApply: 'terraformApplyWorker',
  verification: 'verificationWorker',
  rollback: 'rollbackWorker',
  calculateRealizedSavings: 'calculateRealizedSavingsWorker',
  audit: 'auditWorker',
}

type ConnectionState = 'loading' | 'live' | 'disconnected' | 'error'

interface GraphVisualizerProps {
  runId: string | null
  /** Called once with the run's overall status whenever it changes (e.g. so a parent can show a summary line). */
  onStatusChange?: (status: string | null) => void
}

function deriveOverrides(output: Record<string, unknown> | null | undefined): Record<string, VisualNodeStatus> {
  if (!output) return {}
  const overrides: Record<string, VisualNodeStatus> = {}

  const security = output.securityValidation as { passed: boolean } | null | undefined
  if (security && !security.passed) overrides.staticSecurity = 'rejected'

  const approval = output.approvalDecision as { decision: string } | null | undefined
  if (approval && approval.decision === 'rejected') overrides.autoApproval = 'rejected'

  const rollback = output.rollbackResult as { rolledBack: boolean } | null | undefined
  if (rollback?.rolledBack) overrides.rollback = 'rolled_back'

  return overrides
}

export function GraphVisualizer({ runId, onStatusChange }: GraphVisualizerProps) {
  const [statuses, setStatuses] = useState<Record<string, VisualNodeStatus>>({})
  const [connection, setConnection] = useState<ConnectionState>('loading')
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()

    if (!runId) {
      // The render path below already handles `runId === null` directly —
      // nothing to fetch or subscribe to, so there's no state to set here.
      return
    }

    const currentRunId = runId
    const controller = new AbortController()
    abortRef.current = controller
    let cancelled = false

    async function load(): Promise<void> {
      setConnection('loading')
      try {
        const response = await fetch(`/api/graph/runs/${currentRunId}`, { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const { run } = await response.json()
        if (cancelled) return

        const base: Record<string, VisualNodeStatus> = {}
        for (const nodeRun of run.nodeRuns ?? []) {
          base[nodeRun.node] = nodeRun.status === 'completed' ? 'completed' : nodeRun.status === 'failed' ? 'failed' : 'running'
        }
        const overrides = deriveOverrides(run.output)
        setStatuses({ ...base, ...overrides })
        setRunStatus(run.status)
        onStatusChange?.(run.status)

        if (run.status === 'running' || run.status === 'pending') {
          await streamLive(currentRunId, controller.signal)
        } else {
          setConnection('live')
        }
      } catch {
        if (controller.signal.aborted) return
        setConnection('error')
      }
    }

    async function streamLive(id: string, signal: AbortSignal): Promise<void> {
      try {
        const response = await fetch(`/api/graph/runs/${id}/stream`, { signal })
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        setConnection('live')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''

          for (const frame of frames) {
            const line = frame.trim()
            if (!line.startsWith('data:')) continue
            const event = JSON.parse(line.slice('data:'.length).trim())

            if (event.type === 'node_event') {
              setStatuses((prev) => ({ ...prev, [event.record.node]: event.record.status === 'failed' ? 'failed' : 'completed' }))
            } else if (event.type === 'run_completed') {
              const overrides = deriveOverrides(event.finalState)
              setStatuses((prev) => ({ ...prev, ...overrides }))
              setRunStatus(event.finalState.status)
              onStatusChange?.(event.finalState.status)
            } else if (event.type === 'run_failed') {
              setRunStatus('failed')
              onStatusChange?.('failed')
            }
          }
        }
      } catch {
        if (!signal.aborted) setConnection('disconnected')
      }
    }

    void load()

    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  if (!runId) {
    return <div className="text-sm text-gray-500 text-center py-8">No graph run selected yet.</div>
  }

  if (connection === 'loading' && Object.keys(statuses).length === 0) {
    return <div className="text-sm text-gray-500 text-center py-8 animate-pulse">Loading run state…</div>
  }

  if (connection === 'error') {
    return <div className="text-sm text-red-600 text-center py-8">Failed to load run {runId}.</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-mono text-gray-500">run {runId.slice(0, 8)}</span>
        <div className="flex items-center gap-2 text-xs">
          {connection === 'disconnected' && <span className="text-red-600 font-medium">Stream disconnected</span>}
          {runStatus && <span className="font-semibold text-gray-700 uppercase">{runStatus}</span>}
        </div>
      </div>
      <ol className="space-y-1.5">
        {NODE_ORDER.map((node) => {
          const status = statuses[node] ?? 'pending'
          return (
            <li key={node} className="flex items-center gap-2 text-sm">
              <StatusIcon status={status} />
              <span className={status === 'pending' ? 'text-gray-400' : 'text-gray-800'}>{NODE_LABELS[node]}</span>
              <span className={`ml-auto text-xs font-medium uppercase ${statusColor(status)}`}>{status.replace('_', ' ')}</span>
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
      return 'text-green-600'
    case 'running':
      return 'text-orange-600'
    case 'failed':
      return 'text-red-600'
    case 'rejected':
      return 'text-red-500'
    case 'rolled_back':
      return 'text-purple-600'
    default:
      return 'text-gray-400'
  }
}

function StatusIcon({ status }: { status: VisualNodeStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
    case 'running':
      return <Loader2 className="w-4 h-4 text-orange-600 flex-shrink-0 animate-spin" />
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
    case 'rejected':
      return <ShieldX className="w-4 h-4 text-red-500 flex-shrink-0" />
    case 'rolled_back':
      return <RotateCcw className="w-4 h-4 text-purple-600 flex-shrink-0" />
    default:
      return <Circle className="w-4 h-4 text-gray-300 flex-shrink-0" />
  }
}
