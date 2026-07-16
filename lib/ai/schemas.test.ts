import { describe, expect, it } from 'vitest'
import {
  agentRequestSchema,
  instanceIdSchema,
  modifyInstanceSchema,
  reActEventSchema,
} from './schemas'

describe('lib/ai/schemas', () => {
  describe('invalid request input', () => {
    it('accepts a missing query (falls back to default at the call site)', () => {
      expect(agentRequestSchema.safeParse({}).success).toBe(true)
    })

    it('accepts a well-formed query', () => {
      const result = agentRequestSchema.safeParse({ query: 'Find idle instances' })
      expect(result.success).toBe(true)
    })

    it('rejects an empty string query', () => {
      const result = agentRequestSchema.safeParse({ query: '' })
      expect(result.success).toBe(false)
    })

    it('rejects a non-string query', () => {
      const result = agentRequestSchema.safeParse({ query: 12345 })
      expect(result.success).toBe(false)
    })

    it('rejects a query over the max length', () => {
      const result = agentRequestSchema.safeParse({ query: 'a'.repeat(2001) })
      expect(result.success).toBe(false)
    })
  })

  describe('tool output validation (argument schemas)', () => {
    it('accepts a valid instance_id payload', () => {
      expect(instanceIdSchema.safeParse({ instance_id: 'i-0abc123' }).success).toBe(true)
    })

    it('rejects a missing instance_id', () => {
      expect(instanceIdSchema.safeParse({}).success).toBe(false)
    })

    it('rejects an empty instance_id', () => {
      expect(instanceIdSchema.safeParse({ instance_id: '' }).success).toBe(false)
    })

    it('accepts a valid modify_instance_type payload', () => {
      const result = modifyInstanceSchema.safeParse({ instance_id: 'i-0abc123', new_type: 't3.small' })
      expect(result.success).toBe(true)
    })

    it('rejects a modify_instance_type payload with an invalid enum value', () => {
      const result = modifyInstanceSchema.safeParse({ instance_id: 'i-0abc123', new_type: 'not-a-real-type' })
      expect(result.success).toBe(false)
    })

    it('rejects a modify_instance_type payload missing new_type', () => {
      const result = modifyInstanceSchema.safeParse({ instance_id: 'i-0abc123' })
      expect(result.success).toBe(false)
    })
  })

  describe('streaming event structure', () => {
    it('accepts a minimal valid event', () => {
      const result = reActEventSchema.safeParse({ type: 'thought', content: 'Thinking...' })
      expect(result.success).toBe(true)
    })

    it('accepts an action event with tool/params', () => {
      const result = reActEventSchema.safeParse({
        type: 'action',
        content: 'Executing get_instances',
        tool: 'get_instances',
        params: {},
      })
      expect(result.success).toBe(true)
    })

    it('accepts a self_correction event with attempt/analysis', () => {
      const result = reActEventSchema.safeParse({
        type: 'self_correction',
        content: '[POLICY_VIOLATION] ...',
        attempt: 1,
        analysis: 'Caught POLICY_VIOLATION.',
      })
      expect(result.success).toBe(true)
    })

    it('rejects an event with an unknown type', () => {
      const result = reActEventSchema.safeParse({ type: 'not_a_real_type', content: 'x' })
      expect(result.success).toBe(false)
    })

    it('rejects an event missing content', () => {
      const result = reActEventSchema.safeParse({ type: 'thought' })
      expect(result.success).toBe(false)
    })
  })
})
