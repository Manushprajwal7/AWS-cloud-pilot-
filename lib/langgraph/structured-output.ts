/**
 * Zod-validated structured output over Groq's JSON mode, shared by the
 * diagnose and planRemediation nodes. Groq is asked to fill in a JSON
 * object; the result is parsed and validated against the caller's schema,
 * with one bounded retry (schema violation fed back as an error message)
 * before giving up. This is the only place an LLM response is allowed to
 * populate GraphState — every other field traces back to deterministic
 * simulation/anomaly/financial modules.
 */

import { z } from 'zod'
import { callGroqChat, type GroqChatMessage } from '@/lib/ai/groq'

export class StructuredOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StructuredOutputError'
  }
}

export interface GenerateStructuredOutputOptions<T extends z.ZodTypeAny> {
  schema: T
  systemPrompt: string
  userPrompt: string
  maxAttempts?: number
}

export async function generateStructuredOutput<T extends z.ZodTypeAny>(
  options: GenerateStructuredOutputOptions<T>,
): Promise<z.infer<T>> {
  const maxAttempts = options.maxAttempts ?? 2
  const messages: GroqChatMessage[] = [
    { role: 'system', content: options.systemPrompt },
    { role: 'user', content: options.userPrompt },
  ]

  let lastError = ''

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (lastError) {
      messages.push({
        role: 'user',
        content: `Your previous response was invalid: ${lastError}\nRespond again with ONLY a JSON object matching the required shape.`,
      })
    }

    const response = await callGroqChat({
      messages,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
    })

    const content = response.choices?.[0]?.message?.content
    if (!content) {
      lastError = 'Groq returned no message content'
      continue
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(content)
    } catch {
      lastError = 'response was not valid JSON'
      continue
    }

    const result = options.schema.safeParse(parsedJson)
    if (result.success) {
      return result.data
    }

    lastError = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
  }

  throw new StructuredOutputError(`Failed to obtain valid structured output after ${maxAttempts} attempts: ${lastError}`)
}
