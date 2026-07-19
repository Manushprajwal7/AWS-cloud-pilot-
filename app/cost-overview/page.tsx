'use client'

import { useMemo } from 'react'
import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { useResourceList } from '@/hooks/use-resource-list'
import { DollarSign, PieChart, BarChart3, Radio } from 'lucide-react'
import type { SimulatedCloudResource } from '@/lib/simulation/types'

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function resourceTypeLabel(resource: SimulatedCloudResource): string {
  const { service, configuration } = resource
  if (configuration.instanceType) return configuration.instanceType
  if (service === 'ECS') return `${configuration.desiredCapacity ?? 1} task(s)`
  if (service === 'LAMBDA') return `${configuration.memoryGb ?? 0.5}GB`
  return service
}

export default function CostOverviewPage() {
  const { resources } = useResourceList()

  const costAnalysis = useMemo(() => {
    const byService: Record<string, { cost: number; count: number }> = {}
    const byEnvironment: Record<string, number> = {}

    resources.forEach((r) => {
      // By service
      if (!byService[r.service]) {
        byService[r.service] = { cost: 0, count: 0 }
      }
      byService[r.service].cost += r.cost.projectedMonthlyUsd
      byService[r.service].count += 1

      // By environment
      byEnvironment[r.environment] = (byEnvironment[r.environment] ?? 0) + r.cost.projectedMonthlyUsd
    })

    const totalCost = resources.reduce((sum, r) => sum + r.cost.projectedMonthlyUsd, 0)
    const avgCostPerResource = resources.length > 0 ? totalCost / resources.length : 0

    return {
      totalCost,
      avgCostPerResource,
      byService: Object.entries(byService)
        .map(([name, data]) => ({ name, ...data, percent: (data.cost / totalCost) * 100 }))
        .sort((a, b) => b.cost - a.cost),
      byEnvironment: Object.entries(byEnvironment)
        .map(([name, cost]) => ({ name, cost, percent: (cost / totalCost) * 100 }))
        .sort((a, b) => b.cost - a.cost),
    }
  }, [resources])

  return (
    <div className="flex h-screen w-screen bg-paper overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-56 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto pt-16">
          <div className="w-full px-6 py-6 space-y-6">
            {/* Page Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-ink">Cost Overview</h1>
                <p className="text-graphite mt-1">Analyze your cloud spending and cost trends</p>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 bg-panel border border-hairline rounded-lg text-sm text-graphite">
                <Radio className="w-3.5 h-3.5 text-ok" />
                Live snapshot
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-6">
              <div className="bg-panel rounded-lg border border-hairline p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 bg-signal-soft rounded-lg flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-signal" />
                  </div>
                </div>
                <p className="text-sm text-graphite mb-2">Total Monthly Cost</p>
                <p className="text-3xl font-bold text-ink">{formatUsd(costAnalysis.totalCost)}</p>
                <p className="text-sm text-graphite mt-3">Projected from current live usage</p>
              </div>

              <div className="bg-panel rounded-lg border border-hairline p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 bg-info-soft rounded-lg flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-info" />
                  </div>
                </div>
                <p className="text-sm text-graphite mb-2">Average Cost Per Resource</p>
                <p className="text-3xl font-bold text-ink">{formatUsd(costAnalysis.avgCostPerResource)}</p>
                <p className="text-sm text-graphite mt-3">Across {resources.length} resource{resources.length === 1 ? '' : 's'}</p>
              </div>

              <div className="bg-panel rounded-lg border border-hairline p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 bg-ok-soft rounded-lg flex items-center justify-center">
                    <PieChart className="w-5 h-5 text-ok" />
                  </div>
                </div>
                <p className="text-sm text-graphite mb-2">Number of Resources</p>
                <p className="text-3xl font-bold text-ink">{resources.length}</p>
                <p className="text-sm text-graphite mt-3">Across {new Set(resources.map((r) => r.environment)).size} environments</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Cost by Service */}
              <div className="bg-panel rounded-lg border border-hairline p-6">
                <h3 className="text-lg font-semibold text-ink mb-4">Cost by Service</h3>
                <div className="space-y-3">
                  {costAnalysis.byService.map((item) => (
                    <div key={item.name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-ink">{item.name}</span>
                        <span className="text-sm font-semibold text-ink">{formatUsd(item.cost)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-subtle rounded-full overflow-hidden">
                          <div
                            className="h-full bg-signal"
                            style={{ width: `${item.percent}%` }}
                          />
                        </div>
                        <span className="text-xs text-graphite w-8">{item.percent.toFixed(0)}%</span>
                      </div>
                      <span className="text-xs text-graphite">{item.count} resource{item.count !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cost by Environment */}
              <div className="bg-panel rounded-lg border border-hairline p-6">
                <h3 className="text-lg font-semibold text-ink mb-4">Cost by Environment</h3>
                <div className="space-y-3">
                  {costAnalysis.byEnvironment.map((item, idx) => {
                    const colors = ['bg-danger', 'bg-signal', 'bg-info']
                    return (
                      <div key={item.name}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-ink capitalize">{item.name}</span>
                          <span className="text-sm font-semibold text-ink">{formatUsd(item.cost)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-subtle rounded-full overflow-hidden">
                            <div
                              className={colors[idx] || 'bg-graphite'}
                              style={{ width: `${item.percent}%` }}
                            />
                          </div>
                          <span className="text-xs text-graphite w-8">{item.percent.toFixed(0)}%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Cost Trends Table */}
            <div className="bg-panel rounded-lg border border-hairline overflow-hidden">
              <div className="px-6 py-4 border-b border-hairline">
                <h3 className="text-lg font-semibold text-ink">Top Cost Drivers</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-subtle border-b border-hairline">
                    <tr>
                      <th className="px-6 py-3 text-left font-semibold text-ink">Resource</th>
                      <th className="px-6 py-3 text-left font-semibold text-ink">Type</th>
                      <th className="px-6 py-3 text-left font-semibold text-ink">Service</th>
                      <th className="px-6 py-3 text-left font-semibold text-ink">Environment</th>
                      <th className="px-6 py-3 text-right font-semibold text-ink">Monthly Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {[...resources]
                      .sort((a, b) => b.cost.projectedMonthlyUsd - a.cost.projectedMonthlyUsd)
                      .slice(0, 10)
                      .map((resource) => (
                        <tr key={resource.id} className="hover:bg-subtle">
                          <td className="px-6 py-3 font-medium text-ink">{resource.name}</td>
                          <td className="px-6 py-3 text-graphite">{resourceTypeLabel(resource)}</td>
                          <td className="px-6 py-3 text-graphite">{resource.service}</td>
                          <td className="px-6 py-3">
                            <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-subtle text-ink capitalize">
                              {resource.environment}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-right font-semibold text-ink">
                            {formatUsd(resource.cost.projectedMonthlyUsd)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
