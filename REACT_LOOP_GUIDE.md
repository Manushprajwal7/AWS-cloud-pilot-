# ReAct Loop Implementation Guide

## Overview

The AWS CloudPilot agent implements an explicit **ReAct (Reasoning + Acting)** framework using xAI Grok and LangChain tools. The system streams internal reasoning steps via Server-Sent Events (SSE), allowing the Agent Terminal to render the thought process in real-time.

## Two Primary State-Mutation Tools

### 1. `stop_instance(instanceId)`

**Purpose**: Stop a running EC2 instance to reduce costs

**Signature**:
```typescript
{
  name: 'stop_instance',
  description: 'CRITICAL ACTION: Stop a running EC2 instance to reduce costs',
  schema: z.object({ instance_id: z.string() }),
  async execute(input: { instance_id: string }): Promise<string>
}
```

**Direct State Mutation**: Calls `stopInstance(instanceId)` from `mockAwsState.ts`
```typescript
// This DIRECTLY mutates the in-memory state:
instance.state = 'stopped'
```

**Example Response**:
```
✓ [STATE MUTATED] Successfully stopped instance dev-web-01 (i-0123456789abcdef0). 
Infrastructure state updated. Potential monthly savings: $7.59
```

**Usage in ReAct Loop**:
- Called after agent identifies idle instance (1.8% CPU)
- Agent streams: `[ACTION]\n► Tool: stop_instance\n  Args: {"instance_id": "i-0123..."}`
- Upon execution: `[STATE_MUTATION_CONFIRMED] Infrastructure state has been directly updated`

---

### 2. `modify_instance_type(instanceId, newType)`

**Purpose**: Resize an EC2 instance to a different type for right-sizing

**Signature**:
```typescript
{
  name: 'modify_instance_type',
  description: 'CRITICAL ACTION: Resize an EC2 instance to a different type',
  schema: z.object({
    instance_id: z.string(),
    new_type: z.enum(['t3.micro', 't3.small', 't3.medium', 'm5.large', 'm5.xlarge'])
  }),
  async execute(input: { instance_id: string; new_type: string }): Promise<string>
}
```

**Direct State Mutation**: Calls `modifyInstanceType(instanceId, newType)` from `mockAwsState.ts`
```typescript
// This DIRECTLY mutates the in-memory state:
instance.type = newType
instance.hourlyRate = typeRates[newType]  // Updates cost structure
```

**Example Response**:
```
✓ [STATE MUTATED] Successfully modified instance dev-web-01 from t3.micro to t3.nano. 
Infrastructure state updated. Monthly cost: $7.59 → $3.50 (saves $4.09)
```

**Usage in ReAct Loop**:
- Called to downsize underutilized instances
- Agent streams: `[ACTION]\n► Tool: modify_instance_type\n  Args: {"instance_id": "i-0123...", "new_type": "t3.nano"}`
- Upon execution: `[STATE_MUTATION_CONFIRMED] Infrastructure state has been directly updated`

---

## ReAct Loop Framework

The agent follows an explicit **Thought → Action → Observation → Repeat** loop:

### Phase 1: THOUGHT (Reasoning)
- Agent analyzes the prompt and infrastructure state
- Determines which tool to call next
- Streams as: `[THOUGHT]\n{reasoning text}`

**Example**:
```
[THOUGHT]
I need to analyze the infrastructure to find cost optimization opportunities.
Let me start by getting the list of instances and their utilization metrics.
```

### Phase 2: ACTION (Tool Invocation)
- Agent selects the appropriate tool
- Streams tool name and arguments
- Format: `[ACTION]\n► Tool: {tool_name}\n  Args: {json args}`

**Example**:
```
[ACTION]
► Tool: get_instances
  Args: {}
```

### Phase 3: OBSERVATION (Result)
- Tool executes and returns result
- Streams result to terminal
- Format: `[OBSERVATION]\n{result text}`

**Example**:
```
[OBSERVATION]
Found 5 instances:
dev-web-01 (i-001): CPU=1.8%, Memory=12%, $0.0104/hr, State=running
prod-api-01 (i-002): CPU=45.2%, Memory=65%, $0.0208/hr, State=running
...
```

### Iteration Cycle
The loop repeats until:
1. Agent finds the optimization target (idle instance at 1.8% CPU)
2. Agent executes `stop_instance` or `modify_instance_type`
3. Agent confirms state mutation occurred
4. Maximum 10 iterations reached

---

## Complete Example Flow

### User Query
```
"Find the idle instance and stop it to save costs."
```

### Iteration 1: Discover Infrastructure

**[THOUGHT]**
```
I need to identify underutilized instances to optimize costs.
The user wants me to find the idle instance and stop it.
Let me first examine all instances and their utilization.
```

**[ACTION]**
```
► Tool: get_instances
  Args: {}
```

**[OBSERVATION]**
```
Found 5 instances:
dev-web-01 (i-001): CPU=1.8%, Memory=12%, $0.0104/hr, State=running
prod-api-01 (i-002): CPU=45.2%, Memory=65%, $0.0208/hr, State=running
prod-db-01 (i-003): CPU=78.5%, Memory=82%, $0.0416/hr, State=running
analytics-server (i-004): CPU=92.1%, Memory=90%, $0.096/hr, State=running
staging-app-01 (i-005): CPU=3.2%, Memory=8%, $0.0208/hr, State=running
```

### Iteration 2: Identify Anomalies

**[THOUGHT]**
```
I can see two instances with low CPU utilization:
- dev-web-01 at 1.8% (very idle)
- staging-app-01 at 3.2% (also underutilized)

dev-web-01 is the most idle at 1.8% CPU. This is the primary optimization target.
Let me check the anomalies to confirm these are detected as optimization opportunities.
```

**[ACTION]**
```
► Tool: get_anomalies
  Args: {}
```

**[OBSERVATION]**
```
Detected 3 anomalies:
[IDLE] dev-web-01 (i-001): 1.8% CPU - Candidate for termination or downsizing
[IDLE] staging-app-01 (i-005): 3.2% CPU - Candidate for termination or downsizing
[HIGH CPU] analytics-server (i-004): 92.1% CPU - Possible bottleneck
```

### Iteration 3: Execute Optimization (PRIMARY STATE MUTATION)

**[THOUGHT]**
```
Perfect! The anomalies confirm that dev-web-01 is idle at 1.8% CPU.
This instance is clearly not being used. I should stop it to reduce costs.
Stopping this instance will save approximately $7.59/month ($91.08/year).
Let me execute the optimization.
```

**[ACTION]**
```
► Tool: stop_instance
  Args: {"instance_id": "i-001"}
```

**[OBSERVATION]**
```
✓ [STATE MUTATED] Successfully stopped instance dev-web-01 (i-001). 
Infrastructure state updated. Potential monthly savings: $7.59
```

**[STATE_MUTATION_CONFIRMED]**
```
Infrastructure state has been directly updated
```

### Iteration 4: Final Analysis

**[THOUGHT]**
```
Excellent! I have successfully:
1. Identified the idle instance (dev-web-01 with 1.8% CPU)
2. Executed the stop_instance tool, which DIRECTLY mutated the infrastructure state
3. Confirmed the optimization will save $7.59/month

The task is complete. The infrastructure state now reflects a stopped instance,
reducing monthly cloud costs. Let me generate a final report.
```

**[ACTION]**
```
► Tool: generate_optimization_report
  Args: {}
```

**[FINAL_ANALYSIS]**
```
✓ Optimization Complete
  - Instance Stopped: dev-web-01 (i-001)
  - Monthly Savings: $7.59
  - Annual Savings: $91.08
  - Infrastructure State: Successfully updated (state = 'stopped')
  
The agent has completed its analysis and executed cost optimizations.
```

**[COMPLETION]**
```
✓ ReAct loop completed with 4 iteration(s). Infrastructure state has been successfully mutated.
```

---

## LangChain Tool Definitions

### Tool Schema Validation

Each tool includes Zod schemas for input validation:

```typescript
const instanceIdSchema = z.object({
  instance_id: z.string().describe('The EC2 instance ID to target'),
})

const modifyInstanceSchema = z.object({
  instance_id: z.string(),
  new_type: z.enum(['t3.micro', 't3.small', 't3.medium', 'm5.large', 'm5.xlarge']),
})
```

### Tool Map Integration

The API route maintains a `toolMap` that connects tool names to their implementations:

```typescript
const toolMap = {
  get_instances: getInstancesTool,
  get_cost_metrics: getCostMetricsTool,
  get_anomalies: getAnomaliesTool,
  stop_instance: stopInstanceTool,           // PRIMARY: mutates state
  modify_instance_type: modifyInstanceTypeTool, // PRIMARY: mutates state
  terminate_instance: terminateInstanceTool,
  generate_optimization_report: generateReportTool,
}
```

---

## SSE Streaming Implementation

### Event Types

The API streams events with the following types:

```typescript
type StreamEvent = 
  | 'thought'    // [THOUGHT] Reasoning phase
  | 'action'     // [ACTION] Tool invocation
  | 'observation'  // [OBSERVATION] Tool result
  | 'error'      // [ERROR] Error occurred
  | 'final'      // [FINAL_ANALYSIS] Completion
  | 'done'       // [DONE] Stream end
```

### Client-Side Listener

The Agent Terminal component listens to SSE events:

```typescript
const eventSource = new EventSource(`/api/agent?query=${encodeURIComponent(query)}`)

eventSource.onmessage = (event) => {
  // Parse event data and update terminal
  const log = JSON.parse(event.data)
  setLogs(prev => [...prev, log])
}
```

### Server-Side Streaming

The API route sends events via SSE:

```typescript
const encoder = new TextEncoder()
response.write(encoder.encode(`data: ${JSON.stringify({ type: 'thought', content: '...' })}\n\n`))
```

---

## Key Features

✓ **Explicit ReAct Framework**: Clear Thought → Action → Observation phases  
✓ **Direct State Mutation**: Both tools directly modify `mockAwsState`  
✓ **LangChain Integration**: Proper tool schema validation with Zod  
✓ **SSE Streaming**: Real-time log rendering in Agent Terminal  
✓ **Error Handling**: Comprehensive error checking and feedback  
✓ **Max Iterations**: Safety limit of 10 iterations to prevent loops  
✓ **Full Transparency**: All reasoning steps visible to the user  

---

## Testing the ReAct Loop

### 1. Via Terminal

```bash
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"query":"Find the idle instance and stop it to save costs."}'
```

### 2. Via Dashboard

1. Open http://localhost:3000
2. Navigate to the Agent Terminal section
3. Click "Run Agent"
4. Watch the streaming logs in real-time:
   - Green: Thoughts and reasoning
   - Yellow: Actions (tool calls)
   - Blue: Observations (tool results)
   - Red: Errors

### 3. Via Browser DevTools

Open the browser console and inspect SSE events:
```javascript
const es = new EventSource('/api/agent?query=Find%20idle%20instances')
es.onmessage = (e) => console.log('Event:', JSON.parse(e.data))
```

---

## State Mutation Verification

After running the agent, verify state changes:

```bash
# Check infrastructure state (via Server Action)
curl -X POST http://localhost:3000/api/debug/state \
  -H "Content-Type: application/json"
```

Look for:
- `dev-web-01` state changed from `running` → `stopped`
- Updated metrics showing reduced monthly costs
- Agent terminal displaying confirmation messages

---

## Architecture Summary

```
User Query
    ↓
[API Route] /api/agent
    ↓
[ReAct Loop] (max 10 iterations)
    ├→ [THOUGHT] xAI Grok generates reasoning
    ├→ [ACTION] Selects tool from toolMap
    ├→ [EXECUTION] Calls LangChain tool
    │   ├→ [stop_instance] → mockAwsState.stopInstance() → STATE MUTATED
    │   ├→ [modify_instance_type] → mockAwsState.modifyInstanceType() → STATE MUTATED
    │   └→ [Other tools] → read-only operations
    ├→ [OBSERVATION] Streams result via SSE
    └→ Loop until no tool calls or max iterations
    ↓
[SSE Stream] Server → Client
    ↓
[Agent Terminal] Renders streaming logs in real-time
```

---

## Performance Notes

- **Iteration Time**: ~2-3 seconds per iteration (depends on xAI API latency)
- **State Mutations**: Instant (in-memory operations)
- **Terminal Rendering**: Real-time via SSE
- **Memory Overhead**: Minimal (in-memory state is small)

---

## Next Steps

1. Set `XAI_API_KEY` environment variable to enable Grok API calls
2. Run the dashboard: `pnpm dev`
3. Click "Run Agent" in the Agent Terminal
4. Observe the streaming ReAct loop in action
5. Verify metrics update after state mutations
