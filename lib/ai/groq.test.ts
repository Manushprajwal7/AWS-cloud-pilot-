import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callGroqChat, getGroqApiKey, hasGroqApiKey, GroqConfigError, GroqRequestError } from './groq'

const ORIGINAL_ENV = { ...process.env }

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('lib/ai/groq', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('missing Groq key', () => {
    it('hasGroqApiKey returns false when GROQ_API_KEY is unset', () => {
      delete process.env.GROQ_API_KEY
      expect(hasGroqApiKey()).toBe(false)
    })

    it('getGroqApiKey throws GroqConfigError when GROQ_API_KEY is unset', () => {
      delete process.env.GROQ_API_KEY
      expect(() => getGroqApiKey()).toThrow(GroqConfigError)
    })

    it('callGroqChat rejects with GroqConfigError before making any network call', async () => {
      delete process.env.GROQ_API_KEY
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)

      await expect(callGroqChat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(GroqConfigError)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('maximum retry enforcement', () => {
    beforeEach(() => {
      process.env.GROQ_API_KEY = 'test-key'
    })

    it('retries retryable failures (5xx) up to maxRetries then throws', async () => {
      const fetchSpy = vi.fn().mockImplementation(
        async () => new Response('server error', { status: 503 }),
      )
      vi.stubGlobal('fetch', fetchSpy)

      await expect(
        callGroqChat({
          messages: [{ role: 'user', content: 'hi' }],
          maxRetries: 2,
          retryDelayMs: 0,
        }),
      ).rejects.toThrow(GroqRequestError)

      // Initial attempt + 2 retries = 3 total calls, never more.
      expect(fetchSpy).toHaveBeenCalledTimes(3)
    })

    it('does not retry non-retryable failures (4xx other than 429)', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response('bad request', { status: 400 }),
      )
      vi.stubGlobal('fetch', fetchSpy)

      await expect(
        callGroqChat({
          messages: [{ role: 'user', content: 'hi' }],
          maxRetries: 3,
          retryDelayMs: 0,
        }),
      ).rejects.toThrow(GroqRequestError)

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('succeeds without retrying when the first call succeeds', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
      )
      vi.stubGlobal('fetch', fetchSpy)

      const result = await callGroqChat({
        messages: [{ role: 'user', content: 'hi' }],
        maxRetries: 2,
        retryDelayMs: 0,
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(result.choices?.[0]?.message?.content).toBe('ok')
    })

    it('recovers after a transient failure within the retry budget', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
        .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'recovered' } }] }))
      vi.stubGlobal('fetch', fetchSpy)

      const result = await callGroqChat({
        messages: [{ role: 'user', content: 'hi' }],
        maxRetries: 2,
        retryDelayMs: 0,
      })

      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(result.choices?.[0]?.message?.content).toBe('recovered')
    })
  })
})
