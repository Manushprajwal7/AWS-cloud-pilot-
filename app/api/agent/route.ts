import { NextRequest, NextResponse } from 'next/server'
import { runReActLoop } from '@/lib/ai/react-loop'
import { agentRequestSchema, DEFAULT_AGENT_QUERY } from '@/lib/ai/schemas'
import { hasGroqApiKey, GroqConfigError, GroqRequestError } from '@/lib/ai/groq'

/**
 * POST /api/agent - ReAct agent with SSE streaming
 *
 * This route only: validates the request body, invokes the agent service,
 * streams its events over SSE, and returns structured errors. All Groq
 * client logic, prompts, tool registration, and loop orchestration live in
 * lib/ai/*.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!hasGroqApiKey()) {
    return NextResponse.json(
      { error: 'GROQ_API_KEY environment variable is not set' },
      { status: 500 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const parsed = agentRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const userQuery = parsed.data.query || DEFAULT_AGENT_QUERY

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runReActLoop(userQuery)) {
          const data = `data: ${JSON.stringify(event)}\n\n`
          controller.enqueue(new TextEncoder().encode(data))
        }

        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      } catch (error) {
        const errorMsg = error instanceof GroqConfigError || error instanceof GroqRequestError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Unknown error'
        const data = `data: ${JSON.stringify({ type: 'error', content: errorMsg })}\n\n`
        controller.enqueue(new TextEncoder().encode(data))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
