/**
 * Persistence for LangGraph execution: one AgentRun row per graph
 * invocation, one AgentNodeRun row per node execution within that run.
 * This is the only module that should write AgentRun/AgentNodeRun rows —
 * lib/langgraph/graph.ts calls it from node wrappers so every real
 * execution is recorded, and only real executions are recorded (no
 * fabricated progress rows).
 */

import { prisma } from '@/lib/db/client'
import type { GraphNodeName, GraphStatus } from '@/lib/langgraph/state'

export interface CreateAgentRunInput {
  runId: string
  anomalyId?: string | null
  input: unknown
}

export async function createAgentRun(input: CreateAgentRunInput) {
  return prisma.agentRun.create({
    data: {
      runId: input.runId,
      anomalyId: input.anomalyId ?? null,
      input: input.input as object,
      status: 'running',
    },
  })
}

export async function updateAgentRunStatus(
  runId: string,
  status: GraphStatus,
  fields: { currentNode?: GraphNodeName | null; output?: unknown; error?: string | null } = {},
) {
  return prisma.agentRun.update({
    where: { runId },
    data: {
      status,
      currentNode: fields.currentNode ?? undefined,
      output: fields.output !== undefined ? (fields.output as object) : undefined,
      error: fields.error ?? undefined,
      completedAt: status === 'completed' || status === 'failed' ? new Date() : undefined,
    },
  })
}

export async function getAgentRun(runId: string) {
  return prisma.agentRun.findUnique({
    where: { runId },
    include: { nodeRuns: { orderBy: { startedAt: 'asc' } } },
  })
}

export async function listAgentRuns(limit: number) {
  return prisma.agentRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: { runId: true, status: true, startedAt: true, completedAt: true, error: true, input: true },
  })
}

export async function startNodeRun(agentRunDbId: string, node: GraphNodeName, input: unknown) {
  return prisma.agentNodeRun.create({
    data: {
      agentRunId: agentRunDbId,
      node,
      status: 'running',
      input: input as object,
    },
  })
}

export async function completeNodeRun(
  nodeRunId: string,
  result: { status: 'completed' | 'failed'; output?: unknown; error?: string; startedAt: Date },
) {
  const completedAt = new Date()
  return prisma.agentNodeRun.update({
    where: { id: nodeRunId },
    data: {
      status: result.status,
      output: result.output !== undefined ? (result.output as object) : undefined,
      error: result.error,
      completedAt,
      durationMs: completedAt.getTime() - result.startedAt.getTime(),
    },
  })
}
