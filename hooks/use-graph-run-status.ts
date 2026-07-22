'use client'

/**
 * Loads a graph run's persisted per-node history (GET /api/graph/runs/:id),
 * then subscribes to its live SSE stream for real-time updates — the same
 * two data sources GraphTerminal/TerraformSandbox already use. Shared by
 * GraphVisualizer (compact list) and GraphPipelineRail (full pipeline
 * stepper) so there's exactly one place that turns a runId into node
 * statuses, not two disconnected notions of "graph state".
 */

import { useEffect, useRef, useState } from 'react'

export type VisualNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'rejected' | 'rolled_back' | 'skipped'

/** GraphStatus values (lib/langgraph/state.ts) that mean the run will never advance further — anything still 'pending' at that point was routed around, not merely delayed. */
export const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'no_anomaly', 'rejected', 'applied', 'rolled_back'])

export const NODE_ORDER = [
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

export const NODE_LABELS: Record<string, string> = {
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

export type ConnectionState = 'loading' | 'live' | 'disconnected' | 'error'

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

export interface UseGraphRunStatusResult {
  statuses: Record<string, VisualNodeStatus>
  connection: ConnectionState
  runStatus: string | null
  /** Resolves each node's effective status, filling in 'pending'/'skipped' for anything the server never reported. */
  resolveStatus(node: string): VisualNodeStatus
}

export function useGraphRunStatus(runId: string | null, onStatusChange?: (status: string | null) => void): UseGraphRunStatusResult {
  const [statuses, setStatuses] = useState<Record<string, VisualNodeStatus>>({})
  const [connection, setConnection] = useState<ConnectionState>('loading')
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()

    if (!runId) return

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

  function resolveStatus(node: string): VisualNodeStatus {
    const recorded = statuses[node]
    if (recorded) return recorded
    return runStatus && TERMINAL_RUN_STATUSES.has(runStatus) ? 'skipped' : 'pending'
  }

  return { statuses, connection, runStatus, resolveStatus }
}
