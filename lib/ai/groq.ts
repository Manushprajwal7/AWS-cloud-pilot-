/**
 * Centralized Groq chat-completions client.
 * Every call to the Groq API in this codebase should go through callGroqChat
 * rather than instantiating a fetch call directly in a route or component.
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_MODEL = 'llama-3.3-70b-versatile'
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 500

export function getGroqModel(): string {
  return process.env.GROQ_MODEL || DEFAULT_MODEL
}

export class GroqConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GroqConfigError'
  }
}

export class GroqRequestError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GroqRequestError'
    this.status = status
  }
}

export function getGroqApiKey(): string {
  const key = process.env.GROQ_API_KEY
  if (!key) {
    throw new GroqConfigError('GROQ_API_KEY environment variable is not set')
  }
  return key
}

export function hasGroqApiKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY)
}

export interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: GroqToolCall[]
  tool_call_id?: string
}

export interface GroqToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface GroqToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required: string[]
    }
  }
}

export interface GroqChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
      tool_calls?: GroqToolCall[]
    }
  }>
}

export interface CallGroqChatOptions {
  messages: GroqChatMessage[]
  tools?: GroqToolDefinition[]
  temperature?: number
  maxTokens?: number
  maxRetries?: number
  retryDelayMs?: number
  /** Set to { type: 'json_object' } to request Groq's JSON mode for structured output. */
  responseFormat?: { type: 'json_object' }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface CallGroqChatStreamOptions {
  messages: GroqChatMessage[]
  temperature?: number
  maxTokens?: number
  /** Called with each incremental content delta as it arrives, in order. */
  onToken: (delta: string) => void
}

/**
 * Streaming variant of callGroqChat: sets `stream: true` and parses Groq's
 * own SSE response (`data: {...}\n\n`, terminated by `data: [DONE]`),
 * invoking onToken per content delta and returning the fully concatenated
 * text once the stream ends. Single attempt, no retry — a mid-stream
 * failure has already partially delivered tokens to the caller, so there's
 * nothing clean to retry; callers decide how to handle a thrown error.
 */
export async function callGroqChatStream(options: CallGroqChatStreamOptions): Promise<string> {
  const apiKey = getGroqApiKey()

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: getGroqModel(),
      messages: options.messages,
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 2500,
      stream: true,
    }),
  })

  if (!response.ok || !response.body) {
    const errorText = await response.text().catch(() => '')
    throw new GroqRequestError(`Groq API error: ${response.status} - ${errorText}`, response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const line = frame.trim()
      if (!line.startsWith('data:')) continue

      const payload = line.slice('data:'.length).trim()
      if (payload === '[DONE]') continue

      let parsed: GroqChatCompletionResponse & { choices?: Array<{ delta?: { content?: string } }> }
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue
      }

      const delta = parsed.choices?.[0]?.delta?.content
      if (delta) {
        full += delta
        options.onToken(delta)
      }
    }
  }

  return full
}

/**
 * Call the Groq chat-completions API with bounded retries on transient
 * failures (429 rate limiting, 5xx server errors, network errors).
 * Non-retryable failures (4xx other than 429) throw immediately.
 */
export async function callGroqChat(options: CallGroqChatOptions): Promise<GroqChatCompletionResponse> {
  const apiKey = getGroqApiKey()
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS

  let lastError: Error = new GroqRequestError('Groq request failed with no attempts made')

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: getGroqModel(),
          messages: options.messages,
          temperature: options.temperature ?? 0,
          max_tokens: options.maxTokens ?? 2500,
          ...(options.tools ? { tools: options.tools } : {}),
          ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        const requestError = new GroqRequestError(
          `Groq API error: ${response.status} - ${errorText}`,
          response.status,
        )

        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          lastError = requestError
          await delay(retryDelayMs * (attempt + 1))
          continue
        }

        throw requestError
      }

      return (await response.json()) as GroqChatCompletionResponse
    } catch (error) {
      if (error instanceof GroqRequestError) {
        throw error
      }

      // Network-level failure (fetch rejected) — treat as retryable.
      lastError = error instanceof Error ? error : new Error('Unknown Groq request failure')
      if (attempt >= maxRetries) {
        throw lastError
      }
      await delay(retryDelayMs * (attempt + 1))
    }
  }

  throw lastError
}
