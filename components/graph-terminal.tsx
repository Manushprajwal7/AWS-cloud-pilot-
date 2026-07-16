'use client'

/**
 * Drives a real LangGraph execution end-to-end: POST /api/graph/run starts
 * it, then this component opens the SSE stream at
 * /api/graph/runs/:runId/stream and renders each node_event as it actually
 * happens. Every line here corresponds to a real completed graph node —
 * nothing is simulated client-side.
 */

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Play, Trash2, Loader, CheckCircle, AlertCircle, GitBranch } from 'lucide-react'

interface GraphLogEntry {
  type: 'status' | 'node' | 'error' | 'final'
  content: string
  timestamp: Date
}

const DEFAULT_RESOURCE_ID = 'res-ec2-prod-01'

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
  audit: 'auditWorker',
}

export function GraphTerminal() {
  const [logs, setLogs] = useState<GraphLogEntry[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [resourceId, setResourceId] = useState(DEFAULT_RESOURCE_ID)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  function appendLog(entry: Omit<GraphLogEntry, 'timestamp'>): void {
    setLogs((prev) => [...prev, { ...entry, timestamp: new Date() }])
  }

  async function runGraph(): Promise<void> {
    if (isRunning) return
    setIsRunning(true)
    setLogs([{ type: 'status', content: `Starting LangGraph run for '${resourceId}'...`, timestamp: new Date() }])

    try {
      const startResponse = await fetch('/api/graph/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceId }),
      })

      if (!startResponse.ok) {
        const body = await startResponse.json().catch(() => ({ error: startResponse.statusText }))
        throw new Error(body.error || `Failed to start run: HTTP ${startResponse.status}`)
      }

      const { runId } = (await startResponse.json()) as { runId: string }
      appendLog({ type: 'status', content: `Run started: ${runId}` })

      const streamResponse = await fetch(`/api/graph/runs/${runId}/stream`)
      if (!streamResponse.ok || !streamResponse.body) {
        throw new Error(`Stream responded with HTTP ${streamResponse.status}`)
      }

      const reader = streamResponse.body.getReader()
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

          try {
            const event = JSON.parse(line.slice('data:'.length).trim())

            if (event.type === 'node_event') {
              const label = NODE_LABELS[event.record.node] ?? event.record.node
              appendLog({
                type: event.record.status === 'failed' ? 'error' : 'node',
                content: `[${label}] ${event.record.status}${event.record.error ? ` — ${event.record.error}` : ''}`,
              })
            } else if (event.type === 'command_output') {
              const label = NODE_LABELS[event.node] ?? event.node
              for (const outLine of String(event.chunk).split('\n').filter(Boolean)) {
                appendLog({ type: event.stream === 'stderr' ? 'error' : 'node', content: `[${label}] ${outLine}` })
              }
            } else if (event.type === 'run_completed') {
              const state = event.finalState
              const parts: string[] = []
              if (state.anomaly) {
                parts.push(`anomaly=${state.anomaly.type}`, `action=${state.remediationPlan?.action ?? 'n/a'}`)
              } else {
                parts.push('no active anomaly found')
              }
              if (state.correctionAttempts > 0) parts.push(`correctionAttempts=${state.correctionAttempts}`)
              if (state.approvalDecision) parts.push(`approval=${state.approvalDecision.decision} (risk=${state.approvalDecision.analysis.riskScore})`)
              if (state.applySucceeded) parts.push('applied=true')
              appendLog({ type: 'final', content: `Run completed (${state.status}): ${parts.join(' ')}` })
              return
            } else if (event.type === 'run_failed') {
              appendLog({ type: 'error', content: `Run failed: ${event.error}` })
              return
            }
          } catch {
            // Malformed frame — skip it rather than tearing down the stream.
          }
        }
      }
    } catch (error) {
      appendLog({ type: 'error', content: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setIsRunning(false)
    }
  }

  const clearLogs = () => setLogs([])

  const styleFor = (type: GraphLogEntry['type']) => {
    switch (type) {
      case 'node':
        return { icon: <GitBranch className="w-4 h-4" />, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' }
      case 'error':
        return { icon: <AlertCircle className="w-4 h-4" />, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' }
      case 'final':
        return { icon: <CheckCircle className="w-4 h-4" />, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' }
      default:
        return { icon: <Loader className="w-4 h-4" />, color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' }
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg flex flex-col h-full">
      <div className="border-b border-slate-200 p-4">
        <div className="mb-4">
          <label htmlFor="graph-resource-id" className="text-sm font-medium text-slate-700 mb-2 block">
            Resource ID
          </label>
          <input
            id="graph-resource-id"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            disabled={isRunning}
            placeholder="res-ec2-prod-01"
            className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 placeholder-slate-400 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={runGraph} disabled={isRunning} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white" size="sm">
            <Play className="w-4 h-4" aria-hidden="true" />
            {isRunning ? 'Running graph...' : 'Run LangGraph'}
          </Button>
          <Button onClick={clearLogs} disabled={isRunning} variant="outline" size="sm" className="gap-2">
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            Clear
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 min-h-96 bg-gradient-to-b from-slate-50 to-slate-100"
        role="log"
        aria-live="polite"
        aria-label="LangGraph execution log"
      >
        {logs.length === 0 ? (
          <div className="text-slate-500 text-center py-12">
            <p className="text-sm">Graph terminal ready. Click &quot;Run LangGraph&quot; to execute the orchestration pipeline.</p>
          </div>
        ) : (
          logs.map((log, idx) => {
            const style = styleFor(log.type)
            return (
              <article key={idx} className={`${style.bg} border ${style.border} rounded-lg p-3 whitespace-pre-wrap break-words text-sm`}>
                <div className={`flex items-center gap-2 font-semibold ${style.color} mb-1`}>
                  {style.icon}
                  <span className="uppercase text-xs">{log.type}</span>
                  <time className="text-xs font-normal text-slate-500 ml-auto">{log.timestamp.toLocaleTimeString()}</time>
                </div>
                <div className="text-slate-700 ml-6">{log.content}</div>
              </article>
            )
          })
        )}
      </div>
    </div>
  )
}
