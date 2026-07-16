/**
 * Zod schemas shared by the agent service: tool argument validation,
 * inbound request validation, and the shape of streamed ReAct events.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Tool argument schemas
// ---------------------------------------------------------------------------

export const instanceIdSchema = z.object({
  instance_id: z.string().min(1).describe('The EC2 instance ID to target'),
})

export const modifyInstanceSchema = z.object({
  instance_id: z.string().min(1).describe('The EC2 instance ID to modify'),
  new_type: z
    .enum(['t3.micro', 't3.small', 't3.medium', 'm5.large', 'm5.xlarge'])
    .describe('The target instance type'),
})

export const emptySchema = z.object({})

export type InstanceIdInput = z.infer<typeof instanceIdSchema>
export type ModifyInstanceInput = z.infer<typeof modifyInstanceSchema>

// ---------------------------------------------------------------------------
// Inbound API request schema
// ---------------------------------------------------------------------------

export const agentRequestSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, 'query must not be empty')
    .max(2000, 'query must be 2000 characters or fewer')
    .optional(),
})

export type AgentRequest = z.infer<typeof agentRequestSchema>

export const DEFAULT_AGENT_QUERY = 'Analyze our cloud infrastructure and find cost optimization opportunities'

// ---------------------------------------------------------------------------
// Streamed ReAct event schema
// ---------------------------------------------------------------------------

export const reActEventSchema = z.object({
  type: z.enum(['thought', 'action', 'observation', 'error', 'self_correction', 'complete', 'summary']),
  content: z.string(),
  tool: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  attempt: z.number().optional(),
  analysis: z.string().optional(),
})

export type ReActEvent = z.infer<typeof reActEventSchema>
