/**
 * The scenario scheduler: the policy layer that decides *which* scenario each
 * resource is in over time, so the fleet actually exhibits the conditions the
 * anomaly rules look for (CPU spikes, idle cycles, memory leaks, ...) instead
 * of sitting in NORMAL forever.
 *
 * Division of responsibility:
 *   - scenarios.ts        — what each scenario means (its target metrics)
 *   - scenario-runners.ts — *how* metrics move toward that target each tick
 *   - tick-engine.ts      — *when* metrics move
 *   - this module         — *which* scenario a resource is in, and for how long
 *
 * Each programmed resource walks a repeating phase cycle. Phase changes go
 * through tickEngine.setResourceScenario, which retargets without snapping —
 * so a spike ramps in over several ticks and recovers gradually, exactly as
 * the rules expect (they require sustained conditions across a window, not a
 * single reading).
 */

import { simulationStore, type SimulationStore } from './simulation-store'
import { tickEngine, type TickEngine } from './tick-engine'
import type { ResourceMetrics, ScenarioType } from './types'

const DEFAULT_STEP_INTERVAL_MS = 5000

export interface ScenarioPhase {
  scenario: ScenarioType
  /** How many scheduler steps this phase lasts. */
  steps: number
  /**
   * Metric overrides applied at the moment this phase begins. Used for state
   * a per-tick ramp cannot express on its own — e.g. a process restart
   * reclaiming leaked memory, or a resource that was already idle before we
   * started watching it.
   */
  onEnter?: (current: ResourceMetrics) => Partial<ResourceMetrics>
}

export interface ResourceProgram {
  resourceId: string
  /** Steps to wait before the first phase change, so programs don't all flip in lockstep. */
  offsetSteps: number
  phases: ScenarioPhase[]
}

/**
 * Per-resource programs. Resources with no program here are left in NORMAL and
 * still tick (jittering around the baseline), which keeps a couple of healthy
 * controls in the fleet so the optimization score is never a flat 0%.
 *
 * Phase lengths are tuned against the thresholds in lib/anomalies/rules.ts —
 * each active phase is long enough for its rule's window to fill and the
 * anomaly to surface, and each recovery phase is long enough for the condition
 * to clear and auto-resolve.
 */
export const DEFAULT_PROGRAMS: ResourceProgram[] = [
  {
    // Sustained CPU spike (rule needs cpu >= 80% across 3 readings; the ramp
    // from a 38% baseline crosses 80% by ~4 ticks, so 20 steps holds it well
    // past detection before recovering).
    resourceId: 'res-ec2-prod-01',
    offsetSteps: 2,
    phases: [
      { scenario: 'CPU_SPIKE', steps: 20 },
      { scenario: 'NORMAL', steps: 12 },
    ],
  },
  {
    // Idle dev box. The idle rule requires idleHours >= 0.05, which at a 5s
    // tick would take ~36 ticks to accrue from zero. Seeding idleHours on
    // entry models a box that has been idle since the previous evening, so the
    // condition is true as soon as CPU/requests fall — which is the honest
    // reading of the scenario, not an accelerated one.
    resourceId: 'res-ec2-dev-01',
    offsetSteps: 0,
    phases: [
      { scenario: 'IDLE_RESOURCE', steps: 40, onEnter: () => ({ idleHours: 3.2 }) },
      { scenario: 'NORMAL', steps: 10 },
    ],
  },
  {
    // Memory leak sawtooth: memory climbs until the process is restarted and
    // reclaims it, then leaks again. The restart is what makes this repeat —
    // and each fresh climb re-trips the rule, which requires memory to be both
    // above 85% *and* still rising across the window.
    resourceId: 'res-rds-prod-01',
    offsetSteps: 6,
    phases: [
      { scenario: 'MEMORY_LEAK', steps: 26 },
      { scenario: 'NORMAL', steps: 8, onEnter: () => ({ memoryPercent: 45 }) },
    ],
  },
  {
    // Genuinely oversized staging box — steady state, not a cycle.
    resourceId: 'res-ec2-staging-01',
    offsetSteps: 0,
    phases: [{ scenario: 'OVERPROVISIONED', steps: 60 }],
  },
  {
    resourceId: 'res-ecs-prod-01',
    offsetSteps: 9,
    phases: [
      { scenario: 'TRAFFIC_SURGE', steps: 10 },
      { scenario: 'NORMAL', steps: 16 },
    ],
  },
  {
    // Cost spikes are only observable on Lambda: calculateCost keys EC2/RDS/
    // ElastiCache off instance type alone, so their hourly cost cannot move
    // with load. Lambda's scales with invocation volume, so it can.
    resourceId: 'res-lambda-prod-01',
    offsetSteps: 13,
    phases: [
      { scenario: 'COST_SPIKE', steps: 14 },
      { scenario: 'NORMAL', steps: 12 },
    ],
  },
]

export interface ScenarioSchedulerOptions {
  stepIntervalMs?: number
  programs?: ResourceProgram[]
}

export interface ScenarioScheduler {
  start(): void
  stop(): void
  isRunning(): boolean
  /** Advance every program by exactly one step. Exposed so tests don't wait on real timers. */
  step(): void
  getStepCount(): number
  /** The scenario each programmed resource is currently in, for diagnostics. */
  describe(): { resourceId: string; scenario: ScenarioType; stepsRemaining: number }[]
}

interface Cursor {
  phaseIndex: number
  stepsRemaining: number
  started: boolean
}

export function createScenarioScheduler(
  store: SimulationStore,
  engine: TickEngine,
  options: ScenarioSchedulerOptions = {},
): ScenarioScheduler {
  const stepIntervalMs = options.stepIntervalMs ?? DEFAULT_STEP_INTERVAL_MS
  const programs = options.programs ?? DEFAULT_PROGRAMS

  const cursors = new Map<string, Cursor>(
    programs.map((program) => [
      program.resourceId,
      { phaseIndex: 0, stepsRemaining: program.offsetSteps, started: false },
    ]),
  )

  let timer: ReturnType<typeof setInterval> | null = null
  let stepCount = 0

  function enterPhase(program: ResourceProgram, phase: ScenarioPhase): void {
    const resource = store.getResource(program.resourceId)
    // A program can name a resource this store doesn't have (e.g. a trimmed
    // seed set in a test); skip it rather than throwing out of a timer.
    if (!resource) return

    engine.setResourceScenario(program.resourceId, phase.scenario)

    if (phase.onEnter) {
      const overrides = phase.onEnter(resource.metrics)
      store.updateResource(program.resourceId, { metrics: { ...resource.metrics, ...overrides } })
    }
  }

  function step(): void {
    stepCount++

    for (const program of programs) {
      if (program.phases.length === 0) continue
      const cursor = cursors.get(program.resourceId)
      if (!cursor) continue

      if (cursor.stepsRemaining > 0) {
        cursor.stepsRemaining--
        continue
      }

      // First activation runs the phase the cursor already points at; every
      // later one advances first, so phase[0] isn't skipped on startup.
      if (cursor.started) {
        cursor.phaseIndex = (cursor.phaseIndex + 1) % program.phases.length
      }
      cursor.started = true

      const phase = program.phases[cursor.phaseIndex]
      cursor.stepsRemaining = phase.steps
      enterPhase(program, phase)
    }
  }

  function start(): void {
    if (timer) return
    // Kick the first step immediately so the fleet starts diverging from
    // NORMAL on boot rather than after a full interval of dead air.
    step()
    timer = setInterval(step, stepIntervalMs)
    // Don't hold the process open on this timer alone.
    timer.unref?.()
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

  function getStepCount(): number {
    return stepCount
  }

  function describe(): { resourceId: string; scenario: ScenarioType; stepsRemaining: number }[] {
    return programs.flatMap((program) => {
      const cursor = cursors.get(program.resourceId)
      if (!cursor || program.phases.length === 0) return []
      return [
        {
          resourceId: program.resourceId,
          scenario: program.phases[cursor.phaseIndex].scenario,
          stepsRemaining: cursor.stepsRemaining,
        },
      ]
    })
  }

  return { start, stop, isRunning, step, getStepCount, describe }
}

/**
 * Shared singleton bound to the shared store and tick engine, started on boot
 * by instrumentation.ts. Pinned to globalThis alongside them so a hot reload
 * doesn't leave a second scheduler running its own phase cycle against the
 * same fleet.
 */
const globalForScheduler = globalThis as unknown as { scenarioScheduler?: ScenarioScheduler }

export const scenarioScheduler: ScenarioScheduler =
  globalForScheduler.scenarioScheduler ?? createScenarioScheduler(simulationStore, tickEngine)

globalForScheduler.scenarioScheduler = scenarioScheduler
