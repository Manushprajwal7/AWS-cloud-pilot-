import { describe, expect, it } from 'vitest'
import { GET } from './route'

describe('GET /api/simulation/resources', () => {
  it('returns all 8 seeded resources', async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    const body = (await response.json()) as { resources: unknown[] }
    expect(body.resources).toHaveLength(8)
  })
})
