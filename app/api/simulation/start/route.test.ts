import { describe, expect, it, afterEach } from 'vitest'
import { POST as startPOST } from './route'
import { tickEngine } from '@/lib/simulation/tick-engine'

describe('POST /api/simulation/start', () => {
  afterEach(() => {
    tickEngine.stop()
  })

  it('starts the tick engine and reports it running', async () => {
    expect(tickEngine.isRunning()).toBe(false)
    const response = await startPOST()
    expect(response.status).toBe(200)
    const body = (await response.json()) as { running: boolean; tickIntervalMs: number }
    expect(body.running).toBe(true)
    expect(tickEngine.isRunning()).toBe(true)
  })
})
