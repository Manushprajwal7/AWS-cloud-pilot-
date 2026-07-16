/**
 * Shared PrismaClient singleton. Next.js dev-mode module reloading would
 * otherwise create a new PrismaClient (and a new connection pool) on every
 * hot reload; stashing it on globalThis avoids that, mirroring the
 * singleton pattern already used by lib/simulation/simulation-store.ts and
 * lib/anomalies/detector.ts.
 */

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
