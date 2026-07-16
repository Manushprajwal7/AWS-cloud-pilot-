/**
 * The simulation tick engine: on a configurable interval, advances every
 * resource in a SimulationStore one step (via scenario-runners.ts) and
 * persists the result through store.saveMetricSnapshot — which is also
 * what drives GET /api/simulation/stream, since that route just relays the
 * store's own subscribe() events. The engine owns *when* metrics change;
 * scenario-runners.ts owns *how* they change; the store owns *what the
 * current/historical state is*.
 */

import { simulationStore, InvalidScenarioError, type SimulationStore } from './simulation-store'
import { stepResourceMetrics } from './scenario-runners'
import type { RandomSource } from './metric-generator'
import { getScenarioDefinition, isValidScenario } from './scenarios'
import type { ScenarioType, SimulatedCloudResource } from './types'

const DEFAULT_TICK_INTERVAL_MS = 5000

export interface TickEngineOptions {
  tickIntervalMs?: number
  random?: RandomSource
}

export interface TickEngine {
  start(): void
  stop(): void
  isRunning(): boolean
  getTickIntervalMs(): number
  setTickIntervalMs(ms: number): void
  /** Advance every resource by exactly one tick. Exposed so tests (and callers that want manual control) don't have to wait on real timers. */
  tick(): void
  getTickCount(): number
  /**
   * Change a resource's target scenario WITHOUT snapping its metrics —
   * the next tick(s) carry the resource's current metrics toward the new
   * scenario's target, producing a ramp (or, when the new scenario is
   * NORMAL, a recovery) instead of an instant jump. For an instant jump,
   * use simulationStore.activateScenario directly instead.
   */
  setResourceScenario(id: string, scenario: ScenarioType): SimulatedCloudResource
}

export function createTickEngine(store: SimulationStore, options: TickEngineOptions = {}): TickEngine {
  let tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS
  const random = options.random ?? Math.random
  let timer: ReturnType<typeof setInterval> | null = null
  let tickCount = 0

  function tick(): void {
    tickCount++
    for (const resource of store.listResources()) {
      const nextMetrics = stepResourceMetrics(resource.metrics, resource.activeScenario, {
        random,
        tickIntervalMs,
      })
      store.saveMetricSnapshot(resource.id, nextMetrics)
    }
  }

  function start(): void {
    if (timer) return
    timer = setInterval(tick, tickIntervalMs)
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function isRunning(): boolean {
    return timer !== null
  }

  function getTickIntervalMs(): number {
    return tickIntervalMs
  }

  function setTickIntervalMs(ms: number): void {
    if (!(ms > 0)) {
      throw new RangeError('tickIntervalMs must be greater than 0')
    }
    tickIntervalMs = ms
    if (timer) {
      clearInterval(timer)
      timer = setInterval(tick, tickIntervalMs)
    }
  }

  function getTickCount(): number {
    return tickCount
  }

  function setResourceScenario(id: string, scenario: ScenarioType): SimulatedCloudResource {
    if (!isValidScenario(scenario)) {
      throw new InvalidScenarioError(scenario)
    }
    const definition = getScenarioDefinition(scenario)
    return store.updateResource(id, { activeScenario: scenario, status: definition.status })
  }

  return {
    start,
    stop,
    isRunning,
    getTickIntervalMs,
    setTickIntervalMs,
    tick,
    getTickCount,
    setResourceScenario,
  }
}

/** Shared singleton bound to the shared simulationStore, used by the API routes. */
export const tickEngine = createTickEngine(simulationStore)
