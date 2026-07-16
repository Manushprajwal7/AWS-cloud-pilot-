import { describe, expect, it } from 'vitest'
import { GET } from './route'
import { simulationStore } from '@/lib/simulation/simulation-store'

describe('GET /api/simulation/resources/:id', () => {
  it('returns the resource when it exists', async () => {
    const [seed] = simulationStore.listResources()
    const response = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: seed.id }) })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { resource: { id: string } }
    expect(body.resource.id).toBe(seed.id)
  })

  it('returns a structured 404 for an unknown id', async () => {
    const response = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'ghost' }) })
    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: string; resourceId: string }
    expect(body.resourceId).toBe('ghost')
  })
})
