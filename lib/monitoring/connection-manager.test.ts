import { describe, it, expect, vi } from 'vitest'
import { createConnectionManager, type ConnectionManagerDeps } from './connection-manager'
import { createPollStore } from './providers/poll-store'
import type { MonitoringAdapter, ReadableResourceStore } from './types'
import type { MonitoringCredentialsInput } from './credential-schemas'

const FAKE_INPUT: MonitoringCredentialsInput = {
  provider: 'PROMETHEUS',
  credentials: { serverUrl: 'http://fake-prometheus:9090' },
}

function fakeSimulationStore(): ReadableResourceStore {
  return { listResources: () => [], getResource: () => undefined, getMetricHistory: () => [], subscribe: () => () => {} }
}

function fakeAdapter(ok = true): MonitoringAdapter {
  const store = createPollStore()
  return {
    provider: 'PROMETHEUS',
    testConnection: async () => (ok ? { ok: true, message: 'ok' } : { ok: false, message: 'bad credentials' }),
    start: vi.fn(),
    stop: vi.fn(),
    store,
  }
}

function fakeDeps(overrides: Partial<ConnectionManagerDeps> = {}): ConnectionManagerDeps {
  const monitoringConnection = {
    upsert: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue(null),
  }

  return {
    prisma: { monitoringConnection } as unknown as ConnectionManagerDeps['prisma'],
    simulationStore: fakeSimulationStore(),
    tickEngine: { isRunning: () => false },
    anomalyDetector: { rebind: vi.fn() },
    buildAdapter: () => fakeAdapter(),
    ...overrides,
  }
}

describe('connection-manager', () => {
  it('getActiveStore returns an empty store when nothing is connected and the tick engine is stopped', () => {
    const manager = createConnectionManager(fakeDeps())
    expect(manager.getActiveStore().listResources()).toEqual([])
  })

  it('getActiveStore falls back to simulationStore when the tick engine is running', () => {
    const simStore = fakeSimulationStore()
    const manager = createConnectionManager(fakeDeps({ simulationStore: simStore, tickEngine: { isRunning: () => true } }))
    expect(manager.getActiveStore()).toBe(simStore)
  })

  it('connect() switches getActiveStore to the adapter store and rebinds the anomaly detector', async () => {
    const adapter = fakeAdapter()
    const rebind = vi.fn()
    const manager = createConnectionManager(fakeDeps({ buildAdapter: () => adapter, anomalyDetector: { rebind } }))

    const result = await manager.connect(FAKE_INPUT)

    expect(result.ok).toBe(true)
    expect(manager.getActiveStore()).toBe(adapter.store)
    expect(adapter.start).toHaveBeenCalledOnce()
    expect(rebind).toHaveBeenCalledWith(adapter.store)
    expect(manager.getStatus()).toMatchObject({ connected: true, provider: 'PROMETHEUS' })
  })

  it('connect() does not persist or switch the active store when testConnection fails', async () => {
    const adapter = fakeAdapter(false)
    const upsert = vi.fn()
    const manager = createConnectionManager(
      fakeDeps({ buildAdapter: () => adapter, prisma: { monitoringConnection: { upsert, delete: vi.fn(), findUnique: vi.fn() } } as unknown as ConnectionManagerDeps['prisma'] }),
    )

    const result = await manager.connect(FAKE_INPUT)

    expect(result.ok).toBe(false)
    expect(adapter.start).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect(manager.getStatus().connected).toBe(false)
  })

  it('disconnect() stops the adapter, rebinds to simulationStore when the tick engine is running, and clears status', async () => {
    const adapter = fakeAdapter()
    const simStore = fakeSimulationStore()
    const rebind = vi.fn()
    const manager = createConnectionManager(
      fakeDeps({ buildAdapter: () => adapter, simulationStore: simStore, tickEngine: { isRunning: () => true }, anomalyDetector: { rebind } }),
    )

    await manager.connect(FAKE_INPUT)
    await manager.disconnect()

    expect(adapter.stop).toHaveBeenCalledOnce()
    expect(rebind).toHaveBeenLastCalledWith(simStore)
    expect(manager.getStatus().connected).toBe(false)
    expect(manager.getActiveStore()).not.toBe(adapter.store)
    expect(manager.getActiveStore()).toBe(simStore)
  })

  it('disconnect() rebinds to the empty store when the tick engine is not running', async () => {
    const adapter = fakeAdapter()
    const rebind = vi.fn()
    const manager = createConnectionManager(
      fakeDeps({ buildAdapter: () => adapter, tickEngine: { isRunning: () => false }, anomalyDetector: { rebind } }),
    )

    await manager.connect(FAKE_INPUT)
    await manager.disconnect()

    expect(manager.getActiveStore().listResources()).toEqual([])
    expect(rebind).toHaveBeenLastCalledWith(manager.getActiveStore())
  })

  describe('syncAnomalyDetectorBinding', () => {
    it('rebinds the detector to whatever getActiveStore() currently resolves to', () => {
      const rebind = vi.fn()
      const simStore = fakeSimulationStore()
      let running = false
      const manager = createConnectionManager(
        fakeDeps({ simulationStore: simStore, tickEngine: { isRunning: () => running }, anomalyDetector: { rebind } }),
      )

      manager.syncAnomalyDetectorBinding()
      expect(rebind).toHaveBeenLastCalledWith(manager.getActiveStore())
      expect(manager.getActiveStore().listResources()).toEqual([])

      running = true
      manager.syncAnomalyDetectorBinding()
      expect(rebind).toHaveBeenLastCalledWith(simStore)
    })
  })
})
