/**
 * The ReAct (Thought -> Action -> Observation -> Self-Correction) agent loop.
 * Pure orchestration: calls the Groq client, executes tools through the
 * deterministic validation sandbox, and yields streaming events. Contains
 * no HTTP/route concerns — app/api/agent/route.ts is a thin adapter over this.
 */

import { callGroqChat, type GroqChatMessage } from '@/lib/ai/groq'
import { buildToolDefinitions, executeTool, isStateMutatingTool } from '@/lib/ai/tools'
import { REACT_AGENT_SYSTEM_PROMPT } from '@/lib/ai/prompts'
import type { ReActEvent } from '@/lib/ai/schemas'

export interface ReActLoopOptions {
  maxIterations?: number
  maxCorrections?: number
}

const DEFAULT_MAX_ITERATIONS = 5
const DEFAULT_MAX_CORRECTIONS = 5

/**
 * Run the ReAct loop for a single user query, yielding one ReActEvent per
 * step so the caller can stream them (e.g. over SSE).
 */
export async function* runReActLoop(userQuery: string, options: ReActLoopOptions = {}): AsyncGenerator<ReActEvent> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const maxCorrections = options.maxCorrections ?? DEFAULT_MAX_CORRECTIONS

  const messages: GroqChatMessage[] = [
    { role: 'system', content: REACT_AGENT_SYSTEM_PROMPT },
    { role: 'user', content: userQuery },
  ]

  const toolDefinitions = buildToolDefinitions()

  let iterations = 0
  let correctionAttempts = 0
  let totalMutations = 0

  while (iterations < maxIterations && correctionAttempts < maxCorrections) {
    iterations++

    try {
      const data = await callGroqChat({
        messages,
        tools: toolDefinitions,
        temperature: 0.7,
        maxTokens: 2500,
      })

      const assistantMessage = data.choices?.[0]?.message

      if (!assistantMessage) {
        yield { type: 'error', content: 'No response from Groq' }
        break
      }

      if (assistantMessage.content) {
        yield {
          type: 'thought',
          content: assistantMessage.content,
        }
      }

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        if (assistantMessage.content) {
          yield {
            type: 'complete',
            content: assistantMessage.content,
          }
        }
        break
      }

      messages.push({
        role: 'assistant',
        content: assistantMessage.content || '',
        tool_calls: assistantMessage.tool_calls,
      })

      for (const toolCall of assistantMessage.tool_calls) {
        const isStateMutation = isStateMutatingTool(toolCall.function.name)

        try {
          const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>

          yield {
            type: 'action',
            tool: toolCall.function.name,
            params: args,
            content: `Executing ${toolCall.function.name} with params: ${JSON.stringify(args)}`,
          }

          const { result, correctionNeeded } = await executeTool(toolCall.function.name, args)

          if (correctionNeeded) {
            correctionAttempts++

            let errorType = 'UNKNOWN'
            if (result.includes('[POLICY_VIOLATION]')) errorType = 'POLICY_VIOLATION'
            else if (result.includes('[VALIDATION_ERROR]')) errorType = 'VALIDATION_ERROR'
            else if (result.includes('[EXECUTION_ERROR]')) errorType = 'EXECUTION_ERROR'

            yield {
              type: 'self_correction',
              attempt: correctionAttempts,
              analysis: `Caught ${errorType}. ${result}`,
              content: result,
            }
          } else {
            yield {
              type: 'observation',
              content: result,
            }

            if (isStateMutation) {
              totalMutations++
            }
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          })
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'

          yield {
            type: 'error',
            content: `Tool ${toolCall.function.name} failed: ${errorMsg}`,
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `[EXECUTION_ERROR] ${errorMsg}`,
          })
        }
      }

      if (correctionAttempts >= maxCorrections) {
        yield {
          type: 'summary',
          content: `Reached maximum correction attempts (${maxCorrections}). Stopping analysis. Total state mutations: ${totalMutations}`,
        }
        break
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'

      yield {
        type: 'error',
        content: errorMsg,
      }
      break
    }
  }

  yield {
    type: 'summary',
    content: `ReAct Analysis Complete
─────────────────────
Iterations: ${iterations}/${maxIterations}
Correction Attempts: ${correctionAttempts}/${maxCorrections}
State Mutations: ${totalMutations}
Status: ${iterations >= maxIterations ? 'Max iterations reached' : correctionAttempts >= maxCorrections ? 'Max corrections reached' : 'Analysis complete'}`,
  }
}
