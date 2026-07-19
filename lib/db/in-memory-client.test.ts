import { describe, expect, it } from 'vitest'
import { createInMemoryPrisma } from './in-memory-client'

type Delegate = {
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>
  createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>
  findUnique(args: { where: Record<string, unknown>; include?: Record<string, unknown> }): Promise<Record<string, unknown> | null>
  findMany(args?: Record<string, unknown>): Promise<Record<string, unknown>[]>
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<Record<string, unknown>>
  count(args?: { where?: Record<string, unknown> }): Promise<number>
  delete(args: { where: Record<string, unknown> }): Promise<Record<string, unknown>>
  aggregate(args: { where?: Record<string, unknown>; _sum?: Record<string, boolean> }): Promise<{ _sum: Record<string, unknown> }>
}

function client() {
  return createInMemoryPrisma() as unknown as Record<string, Delegate>
}

describe('createInMemoryPrisma', () => {
  it('assigns an id and @default(now()) timestamps on create', async () => {
    const db = client()
    const row = await db.agentRun.create({ data: { runId: 'run-1', status: 'running' } })

    expect(row.id).toBeTypeOf('string')
    expect(row.startedAt).toBeInstanceOf(Date)
    expect(row.runId).toBe('run-1')
  })

  it('finds a row by a non-id unique field, which is how the graph looks runs up', async () => {
    const db = client()
    await db.agentRun.create({ data: { runId: 'run-1', status: 'running' } })

    expect(await db.agentRun.findUnique({ where: { runId: 'run-1' } })).toMatchObject({ runId: 'run-1' })
    expect(await db.agentRun.findUnique({ where: { runId: 'nope' } })).toBeNull()
  })

  it('round-trips a created row through findUnique by id — terraformInit depends on this', async () => {
    const db = client()
    const created = await db.terraformExecution.create({ data: { status: 'queued', logs: 'init' } })
    const found = await db.terraformExecution.findUnique({ where: { id: created.id } })

    expect(found).toMatchObject({ id: created.id, logs: 'init' })
  })

  it('merges defined fields on update and ignores undefined ones, like Prisma', async () => {
    const db = client()
    await db.agentRun.create({ data: { runId: 'run-1', status: 'running', currentNode: 'monitor' } })
    const updated = await db.agentRun.update({
      where: { runId: 'run-1' },
      data: { status: 'completed', currentNode: undefined },
    })

    expect(updated.status).toBe('completed')
    // Prisma leaves an undefined field untouched rather than nulling it.
    expect(updated.currentNode).toBe('monitor')
  })

  it('throws P2025 when updating a row that does not exist', async () => {
    const db = client()
    await expect(db.agentRun.update({ where: { runId: 'ghost' }, data: { status: 'x' } })).rejects.toMatchObject({
      code: 'P2025',
    })
  })

  it('counts rows inserted via createMany', async () => {
    const db = client()
    const result = await db.policyDecision.createMany({ data: [{ rule: 'a' }, { rule: 'b' }] })

    expect(result).toEqual({ count: 2 })
    expect(await db.policyDecision.count()).toBe(2)
  })

  it('hydrates the AgentRun -> nodeRuns relation that getAgentRun includes', async () => {
    const db = client()
    const run = await db.agentRun.create({ data: { runId: 'run-1', status: 'running' } })
    await db.agentNodeRun.create({ data: { agentRunId: run.id, node: 'monitor', startedAt: new Date(2) } })
    await db.agentNodeRun.create({ data: { agentRunId: run.id, node: 'detectAnomaly', startedAt: new Date(1) } })
    await db.agentNodeRun.create({ data: { agentRunId: 'other-run', node: 'audit' } })

    const found = await db.agentRun.findUnique({
      where: { runId: 'run-1' },
      include: { nodeRuns: { orderBy: { startedAt: 'asc' } } },
    })

    const nodeRuns = found?.nodeRuns as Record<string, unknown>[]
    expect(nodeRuns.map((n) => n.node)).toEqual(['detectAnomaly', 'monitor'])
  })

  it('applies orderBy/take on findMany, which listAgentRuns relies on', async () => {
    const db = client()
    await db.agentRun.create({ data: { runId: 'a', startedAt: new Date(1) } })
    await db.agentRun.create({ data: { runId: 'b', startedAt: new Date(3) } })
    await db.agentRun.create({ data: { runId: 'c', startedAt: new Date(2) } })

    const rows = await db.agentRun.findMany({ orderBy: { startedAt: 'desc' }, take: 2 })

    expect(rows.map((r) => r.runId)).toEqual(['b', 'c'])
  })

  it('keeps models isolated from one another', async () => {
    const db = client()
    await db.agentRun.create({ data: { runId: 'run-1' } })

    expect(await db.auditEvent.count()).toBe(0)
    expect(await db.agentRun.count()).toBe(1)
  })

  it('sums a numeric field via aggregate, which the dashboard summary route relies on', async () => {
    const db = client()
    await db.remediationPlan.create({ data: { expectedMonthlySavingsUsd: 10, realizedMonthlySavingsUsd: null } })
    await db.remediationPlan.create({ data: { expectedMonthlySavingsUsd: 25, realizedMonthlySavingsUsd: null } })
    await db.remediationPlan.create({ data: { expectedMonthlySavingsUsd: 5, realizedMonthlySavingsUsd: 100 } })

    const potential = await db.remediationPlan.aggregate({
      _sum: { expectedMonthlySavingsUsd: true },
      where: { realizedMonthlySavingsUsd: null },
    })

    expect(potential._sum.expectedMonthlySavingsUsd).toBe(35)
  })

  it('deletes a row', async () => {
    const db = client()
    await db.agentRun.create({ data: { runId: 'run-1' } })
    await db.agentRun.delete({ where: { runId: 'run-1' } })

    expect(await db.agentRun.findUnique({ where: { runId: 'run-1' } })).toBeNull()
  })
})
