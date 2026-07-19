'use client'

/**
 * Drives a real LangGraph execution end-to-end: POST /api/graph/run starts
 * it, then this component opens the SSE stream at
 * /api/graph/runs/:runId/stream just to know when the run finishes (so the
 * button can re-enable) — progress and results are visible in
 * GraphRunsPanel/GraphVisualizer elsewhere on the dashboard.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Play, Trash2 } from 'lucide-react'

const DEFAULT_RESOURCE_ID = 'res-ec2-prod-01'

export function GraphTerminal() {
  const [isRunning, setIsRunning] = useState(false)
  const [resourceId, setResourceId] = useState(DEFAULT_RESOURCE_ID)

  async function runGraph(): Promise<void> {
    if (isRunning) return
    setIsRunning(true)

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
            if (event.type === 'run_completed' || event.type === 'run_failed') return
          } catch {
            // Malformed frame — skip it rather than tearing down the stream.
          }
        }
      }
    } finally {
      setIsRunning(false)
    }
  }

  const clearResourceId = () => setResourceId(DEFAULT_RESOURCE_ID)

  return (
    <div className="bg-panel border border-hairline flex flex-col h-full">
      <div className="p-5">
        <div className="mb-4">
          <label htmlFor="graph-resource-id" className="text-[10px] font-mono uppercase tracking-wider text-graphite mb-1.5 block">
            Resource ID
          </label>
          <input
            id="graph-resource-id"
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            disabled={isRunning}
            placeholder="res-ec2-prod-01"
            className="w-full bg-subtle border border-hairline rounded-sm px-3 py-2 text-[13px] font-mono text-ink placeholder-graphite/70 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-signal focus:bg-panel transition-all"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={runGraph} disabled={isRunning} className="gap-2 bg-signal hover:bg-signal/90 text-white rounded-sm uppercase text-[12px] tracking-wide font-mono" size="sm">
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            {isRunning ? 'Running graph...' : 'Run LangGraph'}
          </Button>
          <Button onClick={clearResourceId} disabled={isRunning} variant="outline" size="sm" className="gap-2 rounded-sm border-hairline text-ink hover:bg-subtle uppercase text-[12px] tracking-wide font-mono">
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            Clear
          </Button>
        </div>
      </div>
    </div>
  )
}
