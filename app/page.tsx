'use client'

import { resetInfrastructureAction } from '@/app/actions/simulation'
import { MetricsGrid } from '@/components/metrics-grid'
import { AgentTerminal } from '@/components/agent-terminal'
import { GraphTerminal } from '@/components/graph-terminal'
import { Button } from '@/components/ui/button'
import { Cloud, RotateCcw, BookOpen, LayoutDashboard } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'

export default function Dashboard() {
  const [isResetting, setIsResetting] = useState(false)

  const handleReset = async () => {
    setIsResetting(true)
    try {
      await resetInfrastructureAction()
      window.location.reload()
    } catch (error) {
      console.error('Reset failed:', error)
    } finally {
      setIsResetting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Cloud className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">CloudPilot</h1>
                <p className="text-sm text-slate-500">AI-Powered Cloud Cost Optimization</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link href="/dashboard">
                <Button
                  variant="default"
                  size="sm"
                  className="gap-2 bg-blue-600 hover:bg-blue-700"
                >
                  <LayoutDashboard className="w-4 h-4" aria-hidden="true" />
                  Dashboard
                </Button>
              </Link>
              <Button
                onClick={handleReset}
                disabled={isResetting}
                variant="outline"
                size="sm"
                className="gap-2"
                aria-label="Reset infrastructure to initial state"
                title="Reset all infrastructure metrics and state"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                {isResetting ? 'Resetting...' : 'Reset'}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Metrics Section */}
        <section className="mb-10" aria-labelledby="metrics-heading">
          <div className="flex items-center gap-2 mb-5">
            <div className="h-1 w-1 rounded-full bg-blue-600" aria-hidden="true" />
            <h2 id="metrics-heading" className="text-lg font-semibold text-slate-900">Key Metrics</h2>
          </div>
          <MetricsGrid />
        </section>

        {/* Agent Terminal Section */}
        <section className="mb-10" aria-labelledby="agent-heading">
          <div className="flex items-center gap-2 mb-5">
            <div className="h-1 w-1 rounded-full bg-blue-600" aria-hidden="true" />
            <h2 id="agent-heading" className="text-lg font-semibold text-slate-900">Optimization Agent</h2>
          </div>
          <AgentTerminal />
        </section>

        {/* LangGraph Orchestration Section */}
        <section className="mb-10" aria-labelledby="graph-heading">
          <div className="flex items-center gap-2 mb-5">
            <div className="h-1 w-1 rounded-full bg-blue-600" aria-hidden="true" />
            <h2 id="graph-heading" className="text-lg font-semibold text-slate-900">LangGraph Orchestration</h2>
          </div>
          <GraphTerminal />
        </section>

        {/* Footer Info */}
        <section className="mt-12 p-6 bg-white border border-slate-200 rounded-xl shadow-sm" aria-labelledby="how-it-works">
          <div className="flex items-start gap-3 mb-4">
            <BookOpen className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <h3 id="how-it-works" className="font-semibold text-slate-900">How It Works</h3>
          </div>
          <ol className="text-sm text-slate-600 space-y-3 ml-8">
            <li className="flex gap-2">
              <span className="text-blue-600 font-semibold" aria-hidden="true">1.</span>
              <span><strong>Metrics Analysis:</strong> Real-time monitoring of cloud spend, waste, and infrastructure anomalies</span>
            </li>
            <li className="flex gap-2">
              <span className="text-blue-600 font-semibold" aria-hidden="true">2.</span>
              <span><strong>AI Reasoning:</strong> xAI Grok analyzes infrastructure using ReAct loops to find optimization opportunities</span>
            </li>
            <li className="flex gap-2">
              <span className="text-blue-600 font-semibold" aria-hidden="true">3.</span>
              <span><strong>Real-time Feedback:</strong> Watch the agent&apos;s complete reasoning flow: Thought → Action → Observation</span>
            </li>
            <li className="flex gap-2">
              <span className="text-blue-600 font-semibold" aria-hidden="true">4.</span>
              <span><strong>Safe Execution:</strong> Validation sandbox catches policy violations and agent self-corrects autonomously</span>
            </li>
          </ol>
        </section>
      </main>
    </div>
  )
}
