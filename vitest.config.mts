import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    // The default 5000ms is too tight once every test file's cold import
    // (langgraph, prisma, bullmq, ioredis, ...) is competing for CPU/IO
    // across vitest's parallel workers — that's genuinely slow, not hung,
    // and was flaking app/api/agent/route.test.ts under full-suite runs.
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
