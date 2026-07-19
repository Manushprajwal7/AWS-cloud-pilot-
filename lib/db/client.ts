/**
 * Shared PrismaClient singleton. Next.js dev-mode module reloading would
 * otherwise create a new PrismaClient (and a new connection pool) on every
 * hot reload; stashing it on globalThis avoids that, mirroring the
 * singleton pattern already used by lib/simulation/simulation-store.ts and
 * lib/anomalies/detector.ts.
 *
 * When DATABASE_URL is unset we fall back to an in-memory stand-in rather
 * than constructing a real client that throws PrismaClientInitializationError
 * on first query. That keeps the LangGraph agent runnable with nothing but a
 * GROQ_API_KEY — persistence is the only thing given up, and only until
 * DATABASE_URL is set, at which point the real client takes over with no code
 * change. See lib/db/in-memory-client.ts for the (deliberately narrow) scope.
 */

import { PrismaClient } from '@prisma/client'
import { createInMemoryPrisma } from './in-memory-client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaIsReal?: boolean }

const wantsReal = Boolean(process.env.DATABASE_URL)

/** True when a real Postgres is configured; false when running on the in-memory fallback. */
export function isDatabaseConfigured(): boolean {
  return wantsReal
}

function createClient(): PrismaClient {
  if (wantsReal) {
    return new PrismaClient()
  }

  console.warn(
    '[db] DATABASE_URL is not set — using the in-memory store. Graph runs will execute but will not be persisted, and rows are lost on restart. Set DATABASE_URL to use Postgres.',
  )
  return createInMemoryPrisma() as unknown as PrismaClient
}

// Reuse the pinned dev-mode singleton only if it still matches the current
// configuration. Without this check, adding DATABASE_URL via a dev-mode env
// reload (no process restart) would leave the already-pinned in-memory client
// in place forever, permanently disagreeing with isDatabaseConfigured() once
// it starts reporting true.
const pinnedMatchesConfig = globalForPrisma.prisma !== undefined && globalForPrisma.prismaIsReal === wantsReal

export const prisma: PrismaClient = pinnedMatchesConfig ? globalForPrisma.prisma! : createClient()

// The real client is only pinned outside production (a fresh pool per process
// is correct there). The in-memory client must always be pinned, or a hot
// reload would swap in an empty store mid-run and orphan in-flight rows.
if (process.env.NODE_ENV !== 'production' || !wantsReal) {
  globalForPrisma.prisma = prisma
  globalForPrisma.prismaIsReal = wantsReal
}
