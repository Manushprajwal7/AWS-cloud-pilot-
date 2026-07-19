import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { simulationStore } from '@/lib/simulation/simulation-store'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/simulation/scenario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/simulation/scenario', () => {
  it('sets the scenario without instantly snapping metrics', async () => {
    const [seed] = simulationStore.listResources()
    const response = await POST(makeRequest({ resourceId: seed.id, scenario: 'CPU_SPIKE' }))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { resource: { activeScenario: string; metrics: { cpuPercent: number } } }
    expect(body.resource.activeScenario).toBe('CPU_SPIKE')
    expect(body.resource.metrics.cpuPercent).toBe(seed.metrics.cpuPercent)
  })

  it('instant: true snaps metrics straight to the scenario target', async () => {
    const [seed] = simulationStore.listResources()
    const response = await POST(makeRequest({ resourceId: seed.id, scenario: 'IDLE_RESOURCE', instant: true }))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { resource: { activeScenario: string; metrics: { cpuPercent: number; idleHours: number } } }
    expect(body.resource.activeScenario).toBe('IDLE_RESOURCE')
    expect(body.resource.metrics.cpuPercent).toBe(2)
    expect(body.resource.metrics.idleHours).toBe(6)
  })

  it('returns 400 for an invalid scenario value', async () => {
    const [seed] = simulationStore.listResources()
    const response = await POST(makeRequest({ resourceId: seed.id, scenario: 'NOT_REAL' }))
    expect(response.status).toBe(400)
  })

  it('returns 404 for an unknown resourceId', async () => {
    const response = await POST(makeRequest({ resourceId: 'ghost', scenario: 'CPU_SPIKE' }))
    expect(response.status).toBe(404)
  })

  it('returns 400 when resourceId is missing', async () => {
    const response = await POST(makeRequest({ scenario: 'CPU_SPIKE' }))
    expect(response.status).toBe(400)
  })
})
