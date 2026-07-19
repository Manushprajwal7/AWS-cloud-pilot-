/**
 * Next.js boot hook. Starts the simulation on server startup so the dashboard
 * has live data the moment it loads, instead of only after someone manually
 * POSTs /api/simulation/start (which nothing in the UI ever did — the reason
 * every metrics/anomaly panel rendered empty).
 *
 * Set SIMULATION_AUTOSTART=false to opt out and drive the engine by hand
 * through the /api/simulation/* routes instead.
 */

export async function register(): Promise<void> {
  // Also runs for the edge runtime, where timers and the store singleton have
  // no meaning — the simulation is nodejs-only.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.SIMULATION_AUTOSTART === 'false') return

  const { tickEngine } = await import('@/lib/simulation/tick-engine')
  const { scenarioScheduler } = await import('@/lib/simulation/scenario-scheduler')

  // Importing the detector is what wires it to the store: it subscribes at
  // module load. It has to be live *before* the first tick, or the metric
  // snapshots that arrive in the meantime are never evaluated.
  await import('@/lib/anomalies/detector')

  tickEngine.start()
  scenarioScheduler.start()

  console.log(
    `[simulation] tick engine started (${tickEngine.getTickIntervalMs()}ms) with ${scenarioScheduler.describe().length} scheduled resource programs`,
  )
}
