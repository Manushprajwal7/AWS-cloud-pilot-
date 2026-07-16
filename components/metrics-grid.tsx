'use client'

import { useEffect, useState } from 'react'
import { getInfrastructureStateAction, type InfrastructureState } from '@/app/actions/simulation'
import { DollarSign, AlertTriangle, TrendingUp } from 'lucide-react'

export function MetricsGrid() {
  const [state, setState] = useState<InfrastructureState | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loadState = async () => {
      setIsLoading(true)
      const infraState = await getInfrastructureStateAction()
      setState(infraState)
      setIsLoading(false)
    }

    loadState()

    // Refresh metrics every 5 seconds to reflect agent actions
    const interval = setInterval(loadState, 5000)
    return () => clearInterval(interval)
  }, [])

  if (isLoading || !state) {
    return (
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white border border-slate-200 rounded-lg p-6 h-32 animate-pulse"
          >
            <div className="h-4 bg-slate-200 rounded w-1/2 mb-4" />
            <div className="h-8 bg-slate-200 rounded w-3/4" />
          </div>
        ))}
      </div>
    )
  }

  const wastePercentage = ((state.estimatedWaste / state.totalSpend) * 100).toFixed(1)
  const annualSavings = (state.estimatedWaste * 12).toFixed(2)

  return (
    <div className="grid gap-6 grid-cols-1 md:grid-cols-3" role="region" aria-label="Cloud infrastructure metrics">
      {/* Total Cloud Spend */}
      <article className="bg-white border border-slate-200 rounded-lg p-6 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-600 mb-1">Total Monthly Spend</p>
            <p className="text-3xl font-bold text-slate-900" aria-label={`Total monthly spend: ${state.totalSpend.toFixed(2)} dollars`}>${state.totalSpend.toFixed(2)}</p>
          </div>
          <div className="p-2 bg-blue-100 rounded-lg ml-3">
            <DollarSign className="w-5 h-5 text-blue-600" aria-hidden="true" />
          </div>
        </div>
        <p className="text-xs text-slate-500">
          {state.instances.filter((i) => i.state === 'running').length} running instances
        </p>
      </article>

      {/* Estimated Monthly Waste */}
      <article className="bg-white border border-slate-200 rounded-lg p-6 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-600 mb-1">Estimated Monthly Waste</p>
            <p className="text-3xl font-bold text-red-600" aria-label={`Estimated monthly waste: ${state.estimatedWaste.toFixed(2)} dollars`}>${state.estimatedWaste.toFixed(2)}</p>
          </div>
          <div className="p-2 bg-red-100 rounded-lg ml-3">
            <AlertTriangle className="w-5 h-5 text-red-600" aria-hidden="true" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-slate-500">{wastePercentage}% of total spend</p>
          <p className="text-xs font-semibold text-red-600">Annual: ${annualSavings}</p>
        </div>
      </article>

      {/* Active Anomalies */}
      <article className="bg-white border border-slate-200 rounded-lg p-6 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-600 mb-1">Active Anomalies</p>
            <p className="text-3xl font-bold text-orange-600" aria-label={`Active anomalies: ${state.anomalyCount}`}>{state.anomalyCount}</p>
          </div>
          <div className="p-2 bg-orange-100 rounded-lg ml-3">
            <TrendingUp className="w-5 h-5 text-orange-600" aria-hidden="true" />
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Unusual utilization patterns detected
        </p>
      </article>
    </div>
  )
}
