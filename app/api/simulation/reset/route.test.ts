import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { simulationStore } from '@/lib/simulation/simulation-store'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/simulation/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/simulation/reset', () => {
  it('resets a single resource when resourceId is given', async () => {
    const [seed] = simulationStore.listResources()
    simulationStore.activateScenario(seed.id, 'CPU_SPIKE')

    const response = await POST(makeRequest({ resourceId: seed.id }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { resources: Array<{ id: string; activeScenario: string }> }
    expect(body.resources).toHaveLength(1)
    expect(body.resources[0].activeScenario).toBe('NORMAL')
  })

  it('resets every resource when no resourceId is given', async () => {
    const all = simulationStore.listResources()
    for (const r of all) simulationStore.activateScenario(r.id, 'CPU_SPIKE')

    const response = await POST(makeRequest({}))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { resources: Array<{ activeScenario: string }> }
    expect(body.resources).toHaveLength(all.length)
    for (const resource of body.resources) {
      expect(resource.activeScenario).toBe('NORMAL')
    }
  })

  it('returns 404 for an unknown resourceId', async () => {
    const response = await POST(makeRequest({ resourceId: 'ghost' }))
    expect(response.status).toBe(404)
  })

  it('returns 400 for an invalid body', async () => {
    const response = await POST(makeRequest({ resourceId: '' }))
    expect(response.status).toBe(400)
  })
})
