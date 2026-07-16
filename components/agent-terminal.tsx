'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Play, Trash2, MessageSquare, Zap, CheckCircle, AlertCircle, Loader } from 'lucide-react'

interface LogEntry {
  type: 'thought' | 'action' | 'observation' | 'error' | 'status' | 'final'
  content: string
  timestamp: Date
}

export function AgentTerminal() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [query, setQuery] = useState('Analyze our cloud infrastructure and find cost optimization opportunities')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  const startAgent = async () => {
    if (isRunning) return

    setIsRunning(true)
    setLogs([
      {
        type: 'status',
        content: 'Starting FinOps Agent...',
        timestamp: new Date(),
      },
    ])

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)

            if (data === '[DONE]') {
              setLogs((prev) => [
                ...prev,
                {
                  type: 'final',
                  content: 'Analysis complete',
                  timestamp: new Date(),
                },
              ])
              continue
            }

            try {
              const parsed = JSON.parse(data)

              if (parsed.error) {
                setLogs((prev) => [
                  ...prev,
                  {
                    type: 'error',
                    content: `Error: ${parsed.error}`,
                    timestamp: new Date(),
                  },
                ])
              } else if (parsed.content) {
                const content = parsed.content as string
                let logType: LogEntry['type'] = 'observation'
                let logContent = content

                if (content.startsWith('[THOUGHT]')) {
                  logType = 'thought'
                  logContent = content.replace('[THOUGHT]\n', '')
                } else if (content.startsWith('[ACTION]')) {
                  logType = 'action'
                  logContent = content.replace('[ACTION]\n', '')
                } else if (content.startsWith('[OBSERVATION]')) {
                  logType = 'observation'
                  logContent = content.replace('[OBSERVATION]\n', '')
                } else if (content.startsWith('[ERROR]')) {
                  logType = 'error'
                  logContent = content.replace('[ERROR]\n', '')
                } else if (content.startsWith('[FINAL_ANALYSIS]')) {
                  logType = 'final'
                  logContent = content.replace('[FINAL_ANALYSIS]\n', '')
                }

                setLogs((prev) => [
                  ...prev,
                  {
                    type: logType,
                    content: logContent,
                    timestamp: new Date(),
                  },
                ])
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      setLogs((prev) => [
        ...prev,
        {
          type: 'error',
          content: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date(),
        },
      ])
    } finally {
      setIsRunning(false)
    }
  }

  const clearLogs = () => {
    setLogs([])
  }

  const getLogIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'thought':
        return <MessageSquare className="w-4 h-4" />
      case 'action':
        return <Zap className="w-4 h-4" />
      case 'observation':
        return <CheckCircle className="w-4 h-4" />
      case 'error':
        return <AlertCircle className="w-4 h-4" />
      case 'status':
        return <Loader className="w-4 h-4 animate-spin" />
      case 'final':
        return <CheckCircle className="w-4 h-4" />
      default:
        return null
    }
  }

  const getLogColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'thought':
        return 'text-blue-600'
      case 'action':
        return 'text-amber-600'
      case 'observation':
        return 'text-green-600'
      case 'error':
        return 'text-red-600'
      case 'status':
        return 'text-slate-600'
      case 'final':
        return 'text-emerald-600'
      default:
        return 'text-slate-700'
    }
  }

  const getLogBgColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'thought':
        return 'bg-blue-50'
      case 'action':
        return 'bg-amber-50'
      case 'observation':
        return 'bg-green-50'
      case 'error':
        return 'bg-red-50'
      case 'status':
        return 'bg-slate-50'
      case 'final':
        return 'bg-emerald-50'
      default:
        return 'bg-white'
    }
  }

  const getBorderColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'thought':
        return 'border-blue-200'
      case 'action':
        return 'border-amber-200'
      case 'observation':
        return 'border-green-200'
      case 'error':
        return 'border-red-200'
      case 'status':
        return 'border-slate-200'
      case 'final':
        return 'border-emerald-200'
      default:
        return 'border-slate-200'
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg flex flex-col h-full">
      {/* Terminal Input */}
      <div className="border-b border-slate-200 p-4">
        <div className="mb-4">
          <label htmlFor="agent-query" className="text-sm font-medium text-slate-700 mb-2 block">Query</label>
          <textarea
            id="agent-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={isRunning}
            placeholder="Enter your FinOps optimization query..."
            aria-describedby="query-help"
            className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-900 placeholder-slate-400 resize-none h-20 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-2">
          <Button
            onClick={startAgent}
            disabled={isRunning}
            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            size="sm"
            aria-label={isRunning ? 'Agent is running' : 'Run the analysis agent'}
            title="Execute the FinOps analysis agent"
          >
            <Play className="w-4 h-4" aria-hidden="true" />
            {isRunning ? 'Running...' : 'Run Agent'}
          </Button>
          <Button
            onClick={clearLogs}
            disabled={isRunning}
            variant="outline"
            size="sm"
            className="gap-2"
            aria-label="Clear all logs"
            title="Clear terminal logs"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            Clear
          </Button>
        </div>
      </div>

      {/* Terminal Output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 min-h-96 bg-gradient-to-b from-slate-50 to-slate-100"
        role="log"
        aria-live="polite"
        aria-label="Agent execution log"
      >
        {logs.length === 0 ? (
          <div className="text-slate-500 text-center py-12">
            <p className="text-sm">Agent terminal ready. Click &quot;Run Agent&quot; to start analysis.</p>
          </div>
        ) : (
          logs.map((log, idx) => (
            <article 
              key={idx} 
              className={`${getLogBgColor(log.type)} border ${getBorderColor(log.type)} rounded-lg p-3 whitespace-pre-wrap break-words text-sm`}
              aria-label={`${log.type}: ${log.content.substring(0, 50)}${log.content.length > 50 ? '...' : ''}`}
            >
              <div className={`flex items-center gap-2 font-semibold ${getLogColor(log.type)} mb-1`}>
                {getLogIcon(log.type)}
                <span className="uppercase text-xs">{log.type}</span>
                <time className="text-xs font-normal text-slate-500 ml-auto">{log.timestamp.toLocaleTimeString()}</time>
              </div>
              <div className="text-slate-700 ml-6">{log.content}</div>
            </article>
          ))
        )}
        {isRunning && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-600 animate-pulse flex items-center gap-2">
            <Loader className="w-4 h-4 animate-spin" />
            <span className="text-sm">Waiting for agent response...</span>
          </div>
        )}
      </div>
    </div>
  )
}
