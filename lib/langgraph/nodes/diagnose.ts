/**
 * diagnosisAgent node: asks Groq to explain the anomaly detectAnomalyWorker
 * selected, grounded strictly in the deterministic evidence rules.ts
 * already computed. The LLM narrates and classifies (root cause,
 * recommended action type) — it never invents metric values; every number
 * in the prompt comes from state.anomaly.evidence and state.resource.
 */

import { diagnosisSchema, type GraphState, type GraphStateUpdate } from '../state'
import { generateStructuredOutput } from '../structured-output'

const SYSTEM_PROMPT = `You are CloudPilot's diagnosis engine. You are given a real, already-detected cloud infrastructure anomaly along with the deterministic evidence that triggered it. Explain the likely root cause and classify what kind of remediation it points to.

Rules:
- Only reason about the evidence provided. Do not invent metric values.
- recommendedActionType must be one of: NO_ACTION, STOP, RIGHTSIZE, SCHEDULE, SCALE_OUT, SCALE_IN.
- Respond with ONLY a JSON object with keys: rootCause (string), explanation (string), confidence (number 0-1), affectedMetrics (string array), recommendedActionType (string).`

export async function diagnoseNode(state: GraphState): Promise<GraphStateUpdate> {
  const { anomaly, resource } = state
  if (!anomaly || !resource) {
    throw new Error('diagnosisAgent: no anomaly/resource in state — detectAnomalyWorker must run first')
  }

  const userPrompt = `Resource: ${resource.name} (${resource.service}, ${resource.environment}, ${resource.region})
Current status: ${resource.status}
Current metrics: ${JSON.stringify(resource.metrics)}

Anomaly type: ${anomaly.type}
Severity: ${anomaly.severity}
Detected confidence: ${anomaly.confidence}
Evidence:
${anomaly.evidence.map((e) => `- ${e.metric}: observed ${e.observedValue}${e.unit}, threshold ${e.threshold}${e.unit} — ${e.description}`).join('\n')}

Diagnose this anomaly and classify the recommended action type.`

  const diagnosis = await generateStructuredOutput({
    schema: diagnosisSchema,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
  })

  return { diagnosis }
}
