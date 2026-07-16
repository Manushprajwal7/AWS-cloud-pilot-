import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ORIGINAL_ENV = { ...process.env }

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/agent', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.resetModules()
  })

  describe('missing Groq key', () => {
    it('returns a structured 500 error when GROQ_API_KEY is unset', async () => {
      delete process.env.GROQ_API_KEY
      const { POST } = await import('./route')

      const response = await POST(makeRequest({ query: 'Analyze infra' }))

      expect(response.status).toBe(500)
      const body = (await response.json()) as { error: string }
      expect(body.error).toMatch(/GROQ_API_KEY/)
    })
  })

  describe('invalid request input', () => {
    beforeEach(() => {
      process.env.GROQ_API_KEY = 'test-key'
    })

    it('returns 400 when the body is not valid JSON', async () => {
      const { POST } = await import('./route')
      const request = new NextRequest('http://localhost/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not valid json',
      })

      const response = await POST(request)
      expect(response.status).toBe(400)
    })

    it('returns 400 when query is an empty string', async () => {
      const { POST } = await import('./route')
      const response = await POST(makeRequest({ query: '' }))
      expect(response.status).toBe(400)
      const body = (await response.json()) as { error: string }
      expect(body.error).toBe('Invalid request body')
    })

    it('returns 400 when query is not a string', async () => {
      const { POST } = await import('./route')
      const response = await POST(makeRequest({ query: 12345 }))
      expect(response.status).toBe(400)
    })

    it('accepts a request with no query at all (falls back to the default)', async () => {
      // The generator starts consuming as soon as the stream is constructed, so stub
      // fetch to fail fast rather than hitting the real Groq API from a test.
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled in tests')))

      const { POST } = await import('./route')
      const response = await POST(makeRequest({}))
      // Passes validation and starts streaming — status 200 with an SSE content type.
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')

      vi.unstubAllGlobals()
    })
  })
})
