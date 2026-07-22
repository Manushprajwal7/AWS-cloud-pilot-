import { describe, expect, it, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { tickEngine } from '@/lib/simulation/tick-engine'

describe('GET /api/simulation/stream', () => {
  afterEach(() => {
    tickEngine.stop()
  })

  it('is an SSE stream whose first message is a full snapshot', async () => {
    tickEngine.start()
    const controller = new AbortController()
    const request = new NextRequest('http://localhost/api/simulation/stream', { signal: controller.signal })

    const response = await GET(request)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')

    const reader = response.body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)

    expect(text.startsWith('data: ')).toBe(true)
    const parsed = JSON.parse(text.slice('data: '.length).trim())
    expect(parsed.type).toBe('snapshot')
    expect(parsed.resources).toHaveLength(8)
    expect(typeof parsed.running).toBe('boolean')

    controller.abort()
    await reader.cancel().catch(() => {})
  })
})
