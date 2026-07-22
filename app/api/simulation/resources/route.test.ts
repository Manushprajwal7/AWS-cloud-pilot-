import { describe, expect, it, afterEach } from 'vitest'
import { GET } from './route'
import { tickEngine } from '@/lib/simulation/tick-engine'

describe('GET /api/simulation/resources', () => {
  afterEach(() => {
    tickEngine.stop()
  })

  it('returns all 8 seeded resources while the simulation is running', async () => {
    tickEngine.start()
    const response = await GET()
    expect(response.status).toBe(200)
    const body = (await response.json()) as { resources: unknown[] }
    expect(body.resources).toHaveLength(8)
  })

  it('returns an empty list when the simulation is stopped and no monitoring backend is connected', async () => {
    tickEngine.stop()
    const response = await GET()
    expect(response.status).toBe(200)
    const body = (await response.json()) as { resources: unknown[] }
    expect(body.resources).toHaveLength(0)
  })
})
