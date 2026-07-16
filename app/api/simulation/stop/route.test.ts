import { describe, expect, it, afterEach } from 'vitest'
import { POST as stopPOST } from './route'
import { tickEngine } from '@/lib/simulation/tick-engine'

describe('POST /api/simulation/stop', () => {
  afterEach(() => {
    tickEngine.stop()
  })

  it('stops the tick engine and reports it not running', async () => {
    tickEngine.start()
    expect(tickEngine.isRunning()).toBe(true)

    const response = await stopPOST()
    expect(response.status).toBe(200)
    const body = (await response.json()) as { running: boolean }
    expect(body.running).toBe(false)
    expect(tickEngine.isRunning()).toBe(false)
  })
})
