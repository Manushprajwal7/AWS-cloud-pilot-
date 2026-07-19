/**
 * A minimal, in-memory stand-in for PrismaClient, used only when
 * DATABASE_URL is unset (see lib/db/client.ts). It exists so the LangGraph
 * agent — whose value is the Groq-backed reasoning in diagnose/planRemediation
 * — can run locally without provisioning Postgres. Every graph node persists
 * through `prisma`, so without this the run dies in initializeGraphRun before
 * a single node executes.
 *
 * This is deliberately NOT a general Prisma implementation. It covers exactly
 * the surface the graph path uses (create/createMany/findUnique/findFirst/
 * findMany/update/updateMany/upsert/count/delete/deleteMany, plus the one
 * relation the run routes read back: AgentRun -> nodeRuns). Rows live for the
 * lifetime of the process and are lost on restart. If you need durable runs,
 * set DATABASE_URL and the real client takes over automatically.
 */

import { randomUUID } from 'node:crypto'

type Row = Record<string, unknown>

interface RelationSpec {
  /** Delegate name holding the related rows. */
  model: string
  /** Field on the related row pointing back at this row's `id`. */
  foreignKey: string
}

/**
 * Relations that callers actually read back via `include`. Only AgentRun ->
 * nodeRuns is used (getAgentRun in agent-run-repository); anything else would
 * silently come back undefined, so add it here rather than assuming.
 */
const RELATIONS: Record<string, Record<string, RelationSpec>> = {
  agentRun: {
    nodeRuns: { model: 'agentNodeRun', foreignKey: 'agentRunId' },
  },
}

const MODELS = [
  'cloudResource',
  'metricSnapshot',
  'anomaly',
  'agentRun',
  'agentNodeRun',
  'remediationPlan',
  'terraformArtifact',
  'terraformExecution',
  'terraformCorrectionAttempt',
  'planApproval',
  'policyDecision',
  'verificationResult',
  'rollbackRecord',
  'auditEvent',
] as const

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key]
    if (expected instanceof Date && actual instanceof Date) return expected.getTime() === actual.getTime()
    return actual === expected
  })
}

/** Prisma omits `undefined` fields on update rather than nulling them out. */
function mergeDefined(row: Row, data: Row): Row {
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) row[key] = value
  }
  return row
}

function applySelect(row: Row, select: Record<string, boolean> | undefined): Row {
  if (!select) return row
  const picked: Row = {}
  for (const [key, wanted] of Object.entries(select)) {
    if (wanted) picked[key] = row[key]
  }
  return picked
}

function compareBy(field: string, direction: 'asc' | 'desc') {
  return (a: Row, b: Row): number => {
    const av = a[field]
    const bv = b[field]
    const an = av instanceof Date ? av.getTime() : (av as number | string)
    const bn = bv instanceof Date ? bv.getTime() : (bv as number | string)
    if (an === bn) return 0
    const ascending = an < bn ? -1 : 1
    return direction === 'asc' ? ascending : -ascending
  }
}

export function createInMemoryPrisma(): Record<string, unknown> {
  // One row table per model, keyed by id, insertion-ordered.
  const tables = new Map<string, Map<string, Row>>()
  for (const model of MODELS) tables.set(model, new Map())

  function rowsOf(model: string): Row[] {
    return [...(tables.get(model)?.values() ?? [])]
  }

  function hydrate(model: string, row: Row, include: Record<string, unknown> | undefined): Row {
    if (!include) return { ...row }
    const hydrated: Row = { ...row }
    for (const [relationName, spec] of Object.entries(RELATIONS[model] ?? {})) {
      const wanted = include[relationName]
      if (!wanted) continue
      let related = rowsOf(spec.model).filter((r) => r[spec.foreignKey] === row.id)
      const orderBy = typeof wanted === 'object' ? (wanted as Row).orderBy : undefined
      if (orderBy && typeof orderBy === 'object') {
        const [field, direction] = Object.entries(orderBy as Row)[0] as [string, 'asc' | 'desc']
        related = related.sort(compareBy(field, direction))
      }
      hydrated[relationName] = related.map((r) => ({ ...r }))
    }
    return hydrated
  }

  function insert(model: string, data: Row): Row {
    const now = new Date()
    const row: Row = {
      id: randomUUID(),
      // Mirrors the @default(now()) columns in schema.prisma. Harmless on the
      // few models that lack one — nothing reads a field it doesn't define.
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      ...data,
    }
    tables.get(model)!.set(row.id as string, row)
    return row
  }

  function findRow(model: string, where: Row | undefined): Row | undefined {
    return rowsOf(model).find((row) => matchesWhere(row, where))
  }

  function createDelegate(model: string) {
    return {
      async create(args: { data: Row; include?: Record<string, unknown>; select?: Record<string, boolean> }) {
        const row = insert(model, args.data)
        return applySelect(hydrate(model, row, args.include), args.select)
      },

      async createMany(args: { data: Row[] }) {
        const items = Array.isArray(args.data) ? args.data : [args.data]
        for (const item of items) insert(model, item)
        return { count: items.length }
      },

      async findUnique(args: { where: Row; include?: Record<string, unknown>; select?: Record<string, boolean> }) {
        const row = findRow(model, args.where)
        return row ? applySelect(hydrate(model, row, args.include), args.select) : null
      },

      async findFirst(args: { where?: Row; include?: Record<string, unknown>; select?: Record<string, boolean> } = {}) {
        const row = findRow(model, args.where)
        return row ? applySelect(hydrate(model, row, args.include), args.select) : null
      },

      async findMany(
        args: {
          where?: Row
          orderBy?: Row
          take?: number
          select?: Record<string, boolean>
          include?: Record<string, unknown>
        } = {},
      ) {
        let rows = rowsOf(model).filter((row) => matchesWhere(row, args.where))
        if (args.orderBy) {
          const [field, direction] = Object.entries(args.orderBy)[0] as [string, 'asc' | 'desc']
          rows = rows.sort(compareBy(field, direction))
        }
        if (typeof args.take === 'number') rows = rows.slice(0, args.take)
        return rows.map((row) => applySelect(hydrate(model, row, args.include), args.select))
      },

      async update(args: { where: Row; data: Row; include?: Record<string, unknown>; select?: Record<string, boolean> }) {
        const row = findRow(model, args.where)
        if (!row) {
          // Prisma throws P2025 here; callers that catch it deserve the same shape.
          const error = new Error(`In-memory ${model}.update: no row matching ${JSON.stringify(args.where)}`)
          ;(error as Error & { code?: string }).code = 'P2025'
          throw error
        }
        mergeDefined(row, args.data)
        return applySelect(hydrate(model, row, args.include), args.select)
      },

      async updateMany(args: { where?: Row; data: Row }) {
        const rows = rowsOf(model).filter((row) => matchesWhere(row, args.where))
        for (const row of rows) mergeDefined(row, args.data)
        return { count: rows.length }
      },

      async upsert(args: { where: Row; create: Row; update: Row }) {
        const row = findRow(model, args.where)
        if (row) {
          mergeDefined(row, args.update)
          return { ...row }
        }
        return { ...insert(model, args.create) }
      },

      async count(args: { where?: Row } = {}) {
        return rowsOf(model).filter((row) => matchesWhere(row, args.where)).length
      },

      /** Only `_sum` is implemented — the one aggregate GET /api/dashboard/summary reads. */
      async aggregate(args: { where?: Row; _sum?: Record<string, boolean> } = {}) {
        const rows = rowsOf(model).filter((row) => matchesWhere(row, args.where))
        const sums: Row = {}
        for (const field of Object.keys(args._sum ?? {})) {
          sums[field] = rows.reduce((total, row) => total + ((row[field] as number | null | undefined) ?? 0), 0)
        }
        return { _sum: sums }
      },

      async delete(args: { where: Row }) {
        const row = findRow(model, args.where)
        if (!row) {
          const error = new Error(`In-memory ${model}.delete: no row matching ${JSON.stringify(args.where)}`)
          ;(error as Error & { code?: string }).code = 'P2025'
          throw error
        }
        tables.get(model)!.delete(row.id as string)
        return { ...row }
      },

      async deleteMany(args: { where?: Row } = {}) {
        const rows = rowsOf(model).filter((row) => matchesWhere(row, args.where))
        for (const row of rows) tables.get(model)!.delete(row.id as string)
        return { count: rows.length }
      },
    }
  }

  const client: Record<string, unknown> = {
    async $connect() {},
    async $disconnect() {},
    /** Prisma runs these in a transaction; in-memory there's nothing to isolate. */
    async $transaction(arg: unknown) {
      if (Array.isArray(arg)) return Promise.all(arg)
      if (typeof arg === 'function') return (arg as (tx: unknown) => unknown)(client)
      return arg
    },
  }

  for (const model of MODELS) client[model] = createDelegate(model)

  return client
}
