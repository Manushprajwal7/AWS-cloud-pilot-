import { describe, expect, it, vi, beforeEach } from 'vitest'
import { reActEventSchema } from './schemas'
import { runReActLoop } from './react-loop'

const { callGroqChatMock } = vi.hoisted(() => ({
  callGroqChatMock: vi.fn(),
}))

const { executeToolMock, buildToolDefinitionsMock, isStateMutatingToolMock } = vi.hoisted(() => ({
  executeToolMock: vi.fn(),
  buildToolDefinitionsMock: vi.fn(() => []),
  isStateMutatingToolMock: vi.fn(() => false),
}))

vi.mock('./groq', () => ({
  callGroqChat: callGroqChatMock,
}))

vi.mock('./tools', () => ({
  executeTool: executeToolMock,
  buildToolDefinitions: buildToolDefinitionsMock,
  isStateMutatingTool: isStateMutatingToolMock,
}))

async function collectEvents(generator: AsyncGenerator<unknown>) {
  const events: unknown[] = []
  for await (const event of generator) {
    events.push(event)
  }
  return events
}

describe('lib/ai/react-loop', () => {
  beforeEach(() => {
    callGroqChatMock.mockReset()
    executeToolMock.mockReset()
    isStateMutatingToolMock.mockReset().mockReturnValue(false)
  })

  describe('streaming event structure', () => {
    it('yields events that all conform to the ReActEvent schema, in the expected order', async () => {
      callGroqChatMock
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: 'Checking infrastructure',
                tool_calls: [
                  { id: 'call_1', type: 'function', function: { name: 'get_instances', arguments: '{}' } },
                ],
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'All done', tool_calls: undefined } }],
        })

      executeToolMock.mockResolvedValueOnce({ result: 'Found 5 instances', correctionNeeded: false })

      const events = await collectEvents(runReActLoop('Analyze my infrastructure'))

      // Every event must satisfy the shared streaming contract.
      for (const event of events) {
        const parsed = reActEventSchema.safeParse(event)
        expect(parsed.success, `event failed schema: ${JSON.stringify(event)}`).toBe(true)
      }

      const types = events.map((e) => (e as { type: string }).type)
      expect(types).toEqual(['thought', 'action', 'observation', 'thought', 'complete', 'summary'])
    })

    it('emits an error event when Groq returns no message', async () => {
      callGroqChatMock.mockResolvedValueOnce({ choices: [] })

      const events = await collectEvents(runReActLoop('Analyze my infrastructure'))

      for (const event of events) {
        expect(reActEventSchema.safeParse(event).success).toBe(true)
      }

      const types = events.map((e) => (e as { type: string }).type)
      expect(types[0]).toBe('error')
      expect(types).toContain('summary')
    })

    it('emits a structured error event when the Groq call throws', async () => {
      callGroqChatMock.mockRejectedValueOnce(new Error('network down'))

      const events = await collectEvents(runReActLoop('Analyze my infrastructure'))

      for (const event of events) {
        expect(reActEventSchema.safeParse(event).success).toBe(true)
      }

      const errorEvent = events.find((e) => (e as { type: string }).type === 'error') as
        | { content: string }
        | undefined
      expect(errorEvent?.content).toContain('network down')
    })
  })

  describe('maximum retry (correction) enforcement', () => {
    it('stops self-correcting once maxCorrections is reached, never exceeding it', async () => {
      // Every iteration: the model requests one tool call, which always fails validation.
      callGroqChatMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'call_x', type: 'function', function: { name: 'stop_instance', arguments: '{"instance_id":"i-1"}' } },
              ],
            },
          },
        ],
      })

      executeToolMock.mockResolvedValue({
        result: '[POLICY_VIOLATION] Cannot stop production instance',
        correctionNeeded: true,
      })

      const events = await collectEvents(
        runReActLoop('Stop everything', { maxCorrections: 2, maxIterations: 10 }),
      )

      const correctionEvents = events.filter((e) => (e as { type: string }).type === 'self_correction') as Array<{
        attempt: number
      }>

      expect(correctionEvents.length).toBe(2)
      expect(correctionEvents.map((e) => e.attempt)).toEqual([1, 2])

      // The loop must not keep calling the model after the correction budget is exhausted.
      expect(callGroqChatMock).toHaveBeenCalledTimes(2)
    })

    it('stops after maxIterations even if the model keeps requesting more work', async () => {
      callGroqChatMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'still working',
              tool_calls: [
                { id: 'call_y', type: 'function', function: { name: 'get_instances', arguments: '{}' } },
              ],
            },
          },
        ],
      })

      executeToolMock.mockResolvedValue({ result: 'ok', correctionNeeded: false })

      await collectEvents(runReActLoop('Keep going forever', { maxIterations: 3, maxCorrections: 100 }))

      expect(callGroqChatMock).toHaveBeenCalledTimes(3)
    })
  })
})
