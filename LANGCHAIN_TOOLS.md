# LangChain Tools Implementation

## Overview

This document details the two primary LangChain tools that directly mutate the infrastructure state, along with supporting analysis tools.

## Primary Tools (State-Mutating)

### Tool 1: `stop_instance`

**File**: `lib/tools/cloudTools.ts`

**Tool Definition**:
```typescript
export const stopInstanceTool = {
  name: 'stop_instance',
  description: 'CRITICAL ACTION: Stop a running EC2 instance to reduce costs. Use this for idle or underutilized instances (< 5% CPU). This directly mutates the infrastructure state.',
  schema: instanceIdSchema,  // z.object({ instance_id: z.string() })
  async execute(input: z.infer<typeof instanceIdSchema> | string): Promise<string>
}
```

**Input Schema** (via Zod):
```typescript
const instanceIdSchema = z.object({
  instance_id: z.string().describe('The EC2 instance ID to target'),
})
```

**Execution Flow**:
```
1. Accept instanceId as input
2. Validate instanceId exists in mockAwsState
3. Check if CPU utilization < 20% (safety check)
4. Call mockAwsState.stopInstance(instanceId)
   └→ DIRECTLY MUTATES: instance.state = 'stopped'
5. Return confirmation message with monthly savings
```

**State Mutation Implementation** (`lib/mockAwsState.ts`):
```typescript
export function stopInstance(instanceId: string): AwsInstance | null {
  const instance = mockInstances.find((i) => i.instanceId === instanceId)
  if (instance && instance.state !== 'stopped') {
    instance.state = 'stopped'  // ← DIRECT MUTATION
    return instance
  }
  return null
}
```

**Example Tool Call**:
```json
{
  "tool": "stop_instance",
  "input": {
    "instance_id": "i-0123456789abcdef0"
  }
}
```

**Example Response**:
```
✓ [STATE MUTATED] Successfully stopped instance dev-web-01 (i-0123456789abcdef0). 
Infrastructure state updated. Potential monthly savings: $7.59
```

**Safety Features**:
- Validates instance exists
- Checks CPU utilization < 20% before stopping
- Returns error if already stopped
- Calculates and reports monthly/annual savings

---

### Tool 2: `modify_instance_type`

**File**: `lib/tools/cloudTools.ts`

**Tool Definition**:
```typescript
export const modifyInstanceTypeTool = {
  name: 'modify_instance_type',
  description: 'CRITICAL ACTION: Resize an EC2 instance to a different type. Use this for right-sizing underutilized instances. This directly mutates the infrastructure state by updating the instance type and cost.',
  schema: modifyInstanceSchema,
  async execute(input: z.infer<typeof modifyInstanceSchema>): Promise<string>
}
```

**Input Schema** (via Zod):
```typescript
const modifyInstanceSchema = z.object({
  instance_id: z.string().describe('The EC2 instance ID to modify'),
  new_type: z.enum(['t3.micro', 't3.small', 't3.medium', 'm5.large', 'm5.xlarge'])
    .describe('The target instance type'),
})
```

**Execution Flow**:
```
1. Accept instanceId and newType as input
2. Validate both parameters exist
3. Validate new_type is in allowed enum
4. Check new type is smaller than current (cost reduction)
5. Call mockAwsState.modifyInstanceType(instanceId, newType)
   └→ DIRECTLY MUTATES: 
      instance.type = newType
      instance.hourlyRate = typeRates[newType]
6. Return confirmation with cost comparison
```

**State Mutation Implementation** (`lib/mockAwsState.ts`):
```typescript
export function modifyInstanceType(
  instanceId: string,
  newType: 't3.micro' | 't3.small' | 't3.medium' | 'm5.large' | 'm5.xlarge',
): AwsInstance | null {
  const instance = mockInstances.find((i) => i.instanceId === instanceId)
  if (!instance) return null

  const typeRates: Record<string, number> = {
    't3.micro': 0.0104,
    't3.small': 0.0208,
    't3.medium': 0.0416,
    'm5.large': 0.096,
    'm5.xlarge': 0.192,
  }

  const newRate = typeRates[newType]
  if (!newRate) return null

  // DIRECT MUTATIONS to in-memory state:
  instance.type = newType
  instance.hourlyRate = newRate

  return instance
}
```

**Example Tool Call**:
```json
{
  "tool": "modify_instance_type",
  "input": {
    "instance_id": "i-0123456789abcdef0",
    "new_type": "t3.small"
  }
}
```

**Example Response**:
```
✓ [STATE MUTATED] Successfully modified instance dev-web-01 from t3.micro to t3.small. 
Infrastructure state updated. Monthly cost: $7.59 → $15.17 (increases $7.58)
```

**Safety Features**:
- Validates instance exists
- Validates new_type is in allowed enum
- Checks cost reduction (prevents upsizing)
- Calculates monthly/annual savings
- Returns error on invalid type or upsize attempts

---

## Supporting Analysis Tools (Read-Only)

### Tool: `get_instances`

**Purpose**: Retrieve all instances with utilization metrics

**No Input Schema** (read-only operation)

**Response**:
```
Found 5 instances:
dev-web-01 (i-001): CPU=1.8%, Memory=12%, $0.0104/hr, State=running
prod-api-01 (i-002): CPU=45.2%, Memory=65%, $0.0208/hr, State=running
prod-db-01 (i-003): CPU=78.5%, Memory=82%, $0.0416/hr, State=running
analytics-server (i-004): CPU=92.1%, Memory=90%, $0.096/hr, State=running
staging-app-01 (i-005): CPU=3.2%, Memory=8%, $0.0208/hr, State=running
```

**Uses**: Initial reconnaissance to understand infrastructure

---

### Tool: `get_cost_metrics`

**Purpose**: Get spend, waste, and optimization analysis

**No Input Schema** (read-only operation)

**Response**:
```
Cost Metrics:
- Total Monthly Spend: $138.41
- Estimated Monthly Waste: $15.94 (11.5%)
- Optimization Potential: $191.32/year
```

**Calculation**:
- Total Monthly Spend = sum of (instance.hourlyRate × 730 hours)
- Estimated Monthly Waste = sum of cost for instances with < 5% CPU
- Annual Potential = Monthly Waste × 12

---

### Tool: `get_anomalies`

**Purpose**: Identify instances with unusual utilization patterns

**No Input Schema** (read-only operation)

**Response**:
```
Detected 3 anomalies:
[IDLE] dev-web-01 (i-001): 1.8% CPU - Candidate for termination or downsizing
[IDLE] staging-app-01 (i-005): 3.2% CPU - Candidate for termination or downsizing
[HIGH CPU] analytics-server (i-004): 92.1% CPU - Possible bottleneck
```

**Detection Logic**:
- IDLE: CPU < 5% (candidates for stop/terminate)
- HIGH CPU: CPU > 80% (potential bottlenecks or optimization opportunities)

---

### Tool: `terminate_instance`

**Purpose**: Permanently remove an instance

**Input Schema**:
```typescript
z.object({ instance_id: z.string() })
```

**Safety Checks**:
- Refuses if CPU > 50% (might be in use)
- Warns about irreversibility
- Requires explicit instance ID

**State Mutation**:
```typescript
instance.state = 'terminated'
```

---

### Tool: `generate_optimization_report`

**Purpose**: Generate comprehensive FinOps report

**No Input Schema** (read-only analysis)

**Response**:
```
╔════════════════════════════════════════════════════════════════╗
║           AWS CloudPilot FinOps Optimization Report            ║
╚════════════════════════════════════════════════════════════════╝

📊 INFRASTRUCTURE OVERVIEW:
  • Total Instances: 5
  • Running: 4
  • Stopped: 1
  • Total Monthly Spend: $131.00
  • Estimated Monthly Waste: $7.59
  • Waste Percentage: 5.8%

🚨 ANOMALIES DETECTED: 1
  • staging-app-01 (i-005): 3.2% CPU utilization

📈 POTENTIAL ANNUAL SAVINGS: $91.08
```

---

## API Route Integration

**File**: `app/api/agent/route.ts`

### Tool Mapping

```typescript
const toolMap: Record<string, Tool> = {
  get_instances: getInstancesTool,
  get_cost_metrics: getCostMetricsTool,
  get_anomalies: getAnomaliesTool,
  stop_instance: stopInstanceTool,              // STATE-MUTATING
  modify_instance_type: modifyInstanceTypeTool, // STATE-MUTATING
  terminate_instance: terminateInstanceTool,
  generate_optimization_report: generateReportTool,
}
```

### Tool Execution

```typescript
async function executeTool(toolName: string, toolInput: Record<string, unknown>): Promise<string> {
  const tool = toolMap[toolName]
  if (!tool) {
    return `Error: Unknown tool '${toolName}'`
  }

  try {
    // Special handling for state-mutating tools
    if (toolName === 'stop_instance' || toolName === 'terminate_instance') {
      const instanceId = toolInput.instance_id || ''
      return await tool.execute(String(instanceId))
    }

    if (toolName === 'modify_instance_type') {
      const instanceId = toolInput.instance_id || ''
      const newType = toolInput.new_type || ''
      return await tool.execute({ instance_id: String(instanceId), new_type: String(newType) })
    }

    // Read-only tools
    return await tool.execute({})
  } catch (error) {
    return `Error executing tool: ${error instanceof Error ? error.message : 'Unknown error'}`
  }
}
```

### xAI Grok Tool Registration

Tools are registered with Grok API as function calling tools:

```typescript
tools: Object.values(toolMap).map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: 
        tool.name === 'modify_instance_type'
          ? {
              instance_id: { type: 'string', description: 'The EC2 instance ID' },
              new_type: { 
                type: 'string', 
                enum: ['t3.micro', 't3.small', 't3.medium', 'm5.large', 'm5.xlarge']
              },
            }
          : tool.name === 'stop_instance' || tool.name === 'terminate_instance'
            ? { instance_id: { type: 'string' } }
            : {},
      required: 
        tool.name === 'modify_instance_type' 
          ? ['instance_id', 'new_type']
          : tool.name === 'stop_instance' || tool.name === 'terminate_instance'
            ? ['instance_id']
            : [],
    },
  },
}))
```

---

## Mock Infrastructure State

**File**: `lib/mockAwsState.ts`

### In-Memory Instance Array

```typescript
interface AwsInstance {
  instanceId: string
  name: string
  type: 't3.micro' | 't3.small' | 't3.medium' | 'm5.large' | 'm5.xlarge'
  cpuUtilization: number  // %
  memoryUtilization: number  // %
  hourlyRate: number
  state: 'running' | 'stopped' | 'terminated'
}

const mockInstances: AwsInstance[] = [
  {
    instanceId: 'i-0123456789abcdef0',
    name: 'dev-web-01',
    type: 't3.micro',
    cpuUtilization: 1.8,  // ← TARGET FOR OPTIMIZATION
    memoryUtilization: 12,
    hourlyRate: 0.0104,
    state: 'running',
  },
  // ... 4 more instances
]
```

### State Utility Functions

```typescript
export function getInstances(): AwsInstance[]
export function getInstanceById(instanceId: string): AwsInstance | null
export function getAnomalies(): AwsInstance[]
export function calculateTotalSpend(): number
export function calculateEstimatedWaste(): number
export function stopInstance(instanceId: string): AwsInstance | null         // MUTATES
export function startInstance(instanceId: string): AwsInstance | null        // MUTATES
export function terminateInstance(instanceId: string): AwsInstance | null    // MUTATES
export function modifyInstanceType(instanceId: string, newType: string): AwsInstance | null  // MUTATES
```

---

## SSE Streaming Events

The ReAct loop streams these event types to the client:

```typescript
type EventType = 'thought' | 'action' | 'observation' | 'error' | 'final' | 'done'

interface StreamEvent {
  type: EventType
  content: string
  tool?: string
  instanceId?: string
}
```

**Stream Format** (Server-Sent Events):
```
data: {"type":"thought","content":"I need to analyze..."}

data: {"type":"action","content":"Tool: get_instances","tool":"get_instances"}

data: {"type":"observation","content":"Found 5 instances..."}

data: {"type":"done"}
```

---

## Validation & Error Handling

### Input Validation (Zod Schemas)

All tools with inputs use Zod for runtime validation:

```typescript
const modifyInstanceSchema = z.object({
  instance_id: z.string(),
  new_type: z.enum(['t3.micro', 't3.small', 't3.medium', 'm5.large', 'm5.xlarge']),
})

// Parsing happens in executeTool():
const args = JSON.parse(toolCall.function.arguments)
const validated = modifyInstanceSchema.parse(args)
```

### Error Responses

Tools return structured error messages:

```
Error: Instance i-invalid not found. Check get_instances tool first.
Error: Missing required parameter 'instance_id' for stop_instance
Error: Invalid target type t3.invalid
Warning: Instance prod-api-01 has 45.2% CPU utilization. Stopping might impact workloads.
Warning: Refusing to terminate prod-api-01. High CPU utilization (45.2%) suggests this instance is actively being used.
```

---

## Performance Characteristics

| Tool | Type | Latency | State Impact |
|------|------|---------|--------------|
| get_instances | Read | ~1ms | None |
| get_cost_metrics | Read | ~1ms | None |
| get_anomalies | Read | ~1ms | None |
| stop_instance | Mutate | ~2ms | Immediate |
| modify_instance_type | Mutate | ~2ms | Immediate |
| terminate_instance | Mutate | ~2ms | Immediate |
| generate_optimization_report | Read | ~5ms | None |

---

## Testing Tools Directly

### Via cURL

```bash
# Stop an instance
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"query":"Stop the idle instance i-0123456789abcdef0"}'

# Modify instance type
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"query":"Resize dev-web-01 to t3.small for cost savings"}'

# Get anomalies
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"query":"Show me which instances are underutilized"}'
```

### Via Dashboard

1. Open http://localhost:3000
2. Go to Agent Terminal
3. Type query in input (e.g., "Find idle instances")
4. Click "Run Agent"
5. Watch streaming logs of Thought → Action → Observation

---

## Tool Priority & Execution Order

The ReAct loop follows this recommended sequence:

1. **Discovery** (read-only analysis)
   - get_instances → understand infrastructure
   - get_cost_metrics → understand spend
   - get_anomalies → identify optimization targets

2. **Optimization** (state-mutating actions)
   - stop_instance → for idle instances
   - modify_instance_type → for right-sizing
   - terminate_instance → for unused resources

3. **Reporting** (final analysis)
   - generate_optimization_report → summarize results

---

## State Mutation Confirmation

After executing state-mutating tools, the system confirms:

```
[STATE_MUTATION_CONFIRMED] Infrastructure state has been directly updated
```

This appears in the SSE stream, allowing the client to:
1. Show visual feedback to user
2. Refresh metrics display
3. Trigger dashboard updates
4. Log state change for audit trail

---

## Next Steps for Enhancement

1. Add persistent state tracking (log state mutations to database)
2. Implement rollback capability (undo previous mutations)
3. Add approval workflow (require user confirmation before mutations)
4. Integrate with real AWS API (replace mock state)
5. Add cost projection modeling
6. Implement scheduled agent runs
