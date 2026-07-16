# Phase 3: The Code Sandbox & Self-Correction Loop

> **The feature that gets you hired**: Agent executes script → Validation catches error → Agent reads error logs → Agent self-corrects autonomously

---

## Overview

AWS CloudPilot now implements a **production-grade self-healing agent loop** with policy validation and autonomous error recovery. When the agent attempts an operation (stop instance, resize, terminate), it passes through a validation sandbox that can block unsafe operations due to security/policy constraints. Critically, **errors are fed back into the ReAct conversation as observations**, forcing the agent to analyze the policy violation and autonomously rewrite a safer command without any user intervention.

This demonstrates cutting-edge AI agent architecture: **safety, transparency, and intelligence working together**.

---

## The Self-Correction Cycle

### The Pattern

```
[Agent Attempts Action]
        ↓
[Validation Sandbox]
        ↓
    ✗ PermissionDenied / PolicyViolation Error
        ↓
[Error Fed Back as OBSERVATION]
        ↓
[Agent Analyzes Error]
        ↓
[Agent Reads Suggestion in Error Details]
        ↓
[Agent Autonomously Chooses Alternative]
        ↓
[Retry with Corrected Command]
        ↓
    ✓ SUCCESS
```

---

## Key Components

### 1. Validation Sandbox (`lib/sandbox/validationSandbox.ts`)

A policy enforcement layer that validates every state-mutating operation:

**Policy Checks**:
- ✗ Block: Stopping production instances (Environment=production tag)
- ✗ Block: Stopping high-CPU instances (>70% actively in use)
- ✗ Block: Terminating production instances (too risky)
- ✗ Block: Upsizing instances (increases costs)
- ✓ Allow: Stopping dev/staging idle instances
- ✓ Allow: Downsizing any instance (saves costs)

**Error Structure**:
```typescript
{
  code: 'PermissionDenied' | 'PolicyViolation' | 'ValidationError',
  message: 'Human-readable error',
  details: {
    tool: 'stop_instance',
    instanceId: 'i-prod-01',
    reason: 'Why it was blocked',
    suggestion: 'How to proceed (for agent to read and act on)'
  }
}
```

### 2. Enhanced ReAct Loop (`app/api/agent/route.ts`)

The ReAct loop now integrates the validation sandbox:

```typescript
// In executeTool():
const validation = validateToolExecution(toolName, instanceId, newType)

if (!validation.valid && validation.error) {
  // Return error as string (with [POLICY_VIOLATION] marker)
  // This becomes an OBSERVATION in the ReAct loop
  return `[POLICY_VIOLATION: PermissionDenied]\n${error.details.reason}...`
}

// In ReAct loop:
if (result.includes('[POLICY_VIOLATION:')) {
  yield `\n[POLICY_VIOLATION_DETECTED]\n${result}`
  yield `\n[SELF_CORRECTION_TRIGGERED]\nAgent analyzing error...`
  // Error fed to agent in next iteration
}
```

### 3. Instance Tags System

Instances now have tags that determine policy applicability:

```typescript
// Development instance - can be optimized
{
  name: 'dev-web-01',
  tags: { Environment: 'staging' },
  cpuUtilization: 1.8,  // Idle
  // ✓ Policy allows: stop, resize, terminate
}

// Production instance - protected
{
  name: 'prod-api-01',
  tags: { Environment: 'production' },
  cpuUtilization: 45.2,
  // ✗ Policy blocks: stop, terminate (only resize allowed)
}
```

---

## Real-World Example Flow

### User Query
```
"Find cost optimizations and apply them immediately"
```

### Iteration 1: Analysis

```
[THOUGHT]
I need to analyze the infrastructure and find optimization opportunities.

[ACTION]
Tool: get_instances
Args: {}

[OBSERVATION]
Found 5 instances:
- dev-web-01 (i-0abc...): t3.micro, 1.8% CPU, $0.0104/hr, staging
- prod-api-01 (i-0abc...): t3.small, 45.2% CPU, $0.0208/hr, production
- prod-db-01 (i-0abc...): t3.medium, 78.5% CPU, $0.0416/hr, production
- analytics-server (i-0abc...): m5.large, 92.1% CPU, $0.096/hr, production
- staging-app-01 (i-0abc...): t3.small, 3.2% CPU, $0.0208/hr, staging
```

### Iteration 2: Cost Analysis

```
[THOUGHT]
The dev-web-01 instance is idle with only 1.8% CPU utilization.
This is a perfect candidate for stopping to save costs.
It will save $0.0104 * 730 = $7.59 per month.

Let me identify anomalies to confirm.

[ACTION]
Tool: get_anomalies
Args: {}

[OBSERVATION]
Detected 3 anomalies:
[IDLE] dev-web-01 (i-0abc...): 1.8% CPU - Candidate for termination
[HIGH CPU] prod-api-01 (i-0abc...): 45.2% CPU - Bottleneck
[HIGH CPU] analytics-server (i-0abc...): 92.1% CPU - Overloaded
```

### Iteration 3: First Optimization Attempt (ERROR!)

```
[THOUGHT]
I should focus on the high-CPU instances first. If I can identify why
prod-api-01 is running hot, I might be able to downsize it or distribute
the load.

[ACTION]
Tool: stop_instance
Args: {"instance_id": "i-0abc123def456789b"}
```

### Iteration 3: POLICY VIOLATION!

```
[POLICY_VIOLATION_DETECTED]
[POLICY_VIOLATION: PermissionDenied]
Tool: stop_instance
Instance: i-0abc123def456789b
Error: Access Denied: Cannot stop production instance
Reason: Instance prod-api-01 is tagged as Environment=production. 
        AWS policy prevents stopping production resources without explicit approval.
Suggestion: Consider these alternatives: (1) downsize the instance instead using 
            modify_instance_type, (2) stop a non-production instance like dev-web-01, 
            or (3) request production access from your cloud governance team.

[SELF_CORRECTION_TRIGGERED]
The validation sandbox blocked this action due to policy constraints. 
Analyzing error and attempting alternative approach...

[CORRECTION_CYCLE]
Policy validation caught security/cost violations. Agent analyzing and will 
autonomously retry with safer command targeting valid candidates...
```

### Iteration 4: Agent Self-Corrects (NO USER INPUT!)

```
[THOUGHT]
The policy error is clear: I cannot stop production instances. However,
the suggestion mentions I can stop non-production instances like dev-web-01.
That's actually a good alternative - dev-web-01 is idle with 1.8% CPU
and is marked as staging. Let me use that instead.

[ACTION]
Tool: stop_instance
Args: {"instance_id": "i-0abc123def456789a"}
```

### Iteration 4: SUCCESS!

```
[OBSERVATION]
[EXECUTION_SUCCESS]
✓ Successfully stopped instance dev-web-01 (i-0abc123def456789a). 
Infrastructure state updated. Potential monthly savings: $7.59

[STATE_MUTATION_CONFIRMED]
Infrastructure state has been directly updated in in-memory mockAwsState
dev-web-01.state: 'running' → 'stopped'
```

### Iteration 5: Final Analysis

```
[THOUGHT]
Great! I successfully stopped the idle instance. Now let me generate a
comprehensive report showing all optimizations and potential savings.

[ACTION]
Tool: generate_optimization_report
Args: {}

[OBSERVATION]
[EXECUTION_SUCCESS]
╔════════════════════════════════════════════════════════════════╗
║           AWS CloudPilot FinOps Optimization Report            ║
╚════════════════════════════════════════════════════════════════╝

📊 INFRASTRUCTURE OVERVIEW:
  • Total Instances: 5
  • Running: 4
  • Stopped: 1 (dev-web-01)
  • Total Monthly Spend: $130.82
  • Estimated Monthly Waste: $8.35
  • Waste Percentage: 6.4%

🚨 ANOMALIES DETECTED: 2
  • dev-web-01: 0% CPU utilization (now stopped)
  • staging-app-01: 3.2% CPU utilization (candidate for review)

💡 RECOMMENDATIONS:
  1. Monitor staging-app-01 for potential downsize
  2. Implement auto-scaling for analytics-server (92% CPU)
  3. Review prod-api-01 load distribution

📈 POTENTIAL ANNUAL SAVINGS: $100.20
```

---

## What Makes This "Hire-Worthy"

### 1. Safety First
- Policy validation catches unsafe operations before execution
- Production instances cannot be accidentally stopped/terminated
- Cost controls prevent upsizing (cost increases)

### 2. Autonomous Problem-Solving
- Agent reads error details and **understands why it failed**
- Agent analyzes suggestions and **chooses alternative action**
- Agent retries **without asking user for help**
- No "I don't know what to do, please help"

### 3. Full Transparency
- Every step logged to terminal
- User sees original attempt, policy violation, and recovery
- User understands why agent made each decision
- Audit trail for compliance/debugging

### 4. Production-Grade Architecture
- Structured error format (code, message, details, suggestion)
- Validation rules are extensible
- Error recovery is deterministic
- System stays safe even with agent errors

### 5. Realistic AWS Simulation
- Production/staging/development tags
- High CPU detection (active workload protection)
- Type validation (no invalid sizes)
- Cost model consistency

---

## Terminal Output Example

Here's what users see in the Agent Terminal:

```
[THOUGHT]
Analyzing infrastructure for cost optimization opportunities...

[ACTION]
► Tool: get_instances
  Args: {}

[OBSERVATION]
[EXECUTION_SUCCESS]
Found 5 instances:
dev-web-01 (t3.micro, 1.8% CPU)
prod-api-01 (t3.small, 45.2% CPU)
...

[ACTION]
► Tool: stop_instance
  Args: {"instance_id":"i-prod-01"}

[POLICY_VIOLATION_DETECTED]
[POLICY_VIOLATION: PermissionDenied]
Tool: stop_instance
Instance: i-prod-01
Error: Access Denied: Cannot stop production instance
Reason: Instance prod-api-01 is tagged as Environment=production.
Suggestion: Stop non-production instance like dev-web-01 instead

[SELF_CORRECTION_TRIGGERED]
The validation sandbox blocked this action due to policy constraints.
Analyzing error and attempting alternative approach...

[CORRECTION_CYCLE]
Policy validation caught security violations. Agent analyzing...
will autonomously retry with safer command targeting dev-web-01...

[ACTION]
► Tool: stop_instance
  Args: {"instance_id":"i-dev-01"}

[OBSERVATION]
[EXECUTION_SUCCESS]
✓ Successfully stopped instance dev-web-01
Monthly savings: $7.59

[STATE_MUTATION_CONFIRMED]
Infrastructure state has been directly updated in in-memory mockAwsState
```

---

## Implementation Details

### Files Modified/Created

```
NEW:
✓ lib/sandbox/validationSandbox.ts (300 lines)
  - Policy validation functions
  - Error structures
  - Tag-based logic

ENHANCED:
✓ app/api/agent/route.ts
  - Integration of validation sandbox
  - Error detection and logging
  - Self-correction cycle

✓ lib/mockAwsState.ts
  - Instance tags system
  - prod/staging/dev classification

DOCUMENTATION:
✓ VALIDATION_SANDBOX_GUIDE.md (433 lines)
✓ SANDBOX_ARCHITECTURE.md (476 lines)
✓ PHASE3_SELF_CORRECTION.md (this file)
```

### Policy Rules

```typescript
validateStopInstance(instanceId) {
  // Rule 1: Instance must exist
  if (!instance) return ValidationError
  
  // Rule 2: Cannot stop production instances
  if (instance.tags?.Environment === 'production') 
    return PermissionDenied
  
  // Rule 3: Cannot stop actively-used instances (>70% CPU)
  if (instance.cpuUtilization > 70)
    return PolicyViolation
  
  return { valid: true }
}

validateModifyInstanceType(instanceId, newType) {
  // Rule 1: Type must be valid enum
  if (!validTypes.includes(newType)) return ValidationError
  
  // Rule 2: Can only downsize (cost reduction)
  if (newType >= currentType) return ValidationError
  
  return { valid: true, warnings: [...] }
}

validateTerminateInstance(instanceId) {
  // Rule 1: Never terminate production (too risky)
  if (isProd) return PermissionDenied
  
  // Rule 2: Cannot terminate active instance
  if (cpuUtilization > 70) return PolicyViolation
  
  return { valid: true }
}
```

---

## Testing the Self-Correction

### Test 1: Basic Production Protection

```bash
# Terminal input
curl -X POST http://localhost:3000/api/agent \
  -d '{"query":"Stop prod-api-01 to save costs"}'

# Expected output
[THOUGHT] ...analyzing...
[ACTION] Tool: stop_instance(prod-api-01)
[POLICY_VIOLATION_DETECTED] PermissionDenied
[SELF_CORRECTION_TRIGGERED]
[ACTION] Tool: stop_instance(dev-web-01)  ← Corrected!
[OBSERVATION] [EXECUTION_SUCCESS] ✓ Stopped dev-web-01
```

### Test 2: Multiple Corrections

```bash
# Terminal input
curl -X POST http://localhost:3000/api/agent \
  -d '{"query":"Aggressively stop high-CPU instances"}'

# Expected output
Iteration 1: Try analytics-server (92% CPU) → PolicyViolation
Iteration 2: Try prod-db-01 (78% CPU) → PermissionDenied  
Iteration 3: Try dev-web-01 (1.8% CPU) → ✓ Success
```

### Test 3: Invalid ID Auto-Recovery

```bash
# Agent encounters invalid ID
[ACTION] Tool: stop_instance(i-invalid)
[VALIDATION_ERROR] Instance not found

# Agent self-corrects
[ACTION] Tool: get_instances()
[OBSERVATION] Lists valid instances
[ACTION] Tool: stop_instance(i-valid)  ← Now uses valid ID
```

---

## Why This Matters for Hiring

### Shows Deep Understanding Of
- ✓ Agentic AI loops and error handling
- ✓ Policy enforcement and security
- ✓ State management and transactions
- ✓ Streaming APIs and real-time feedback
- ✓ Error message design for agent comprehension
- ✓ Self-healing system architecture

### Demonstrates Production Skills
- ✓ Defensive coding (validation before execution)
- ✓ Error recovery patterns
- ✓ Audit trails and transparency
- ✓ Extensible policy system
- ✓ Type safety (Zod validation)
- ✓ Clear separation of concerns

### Proves AI Agent Mastery
- ✓ Agent can read and understand error messages
- ✓ Agent can parse suggestions and act on them
- ✓ Agent autonomously corrects without user input
- ✓ Agent learns from policy violations
- ✓ System maintains safety while being helpful
- ✓ Error injection drives agent intelligence

---

## Running It

### 1. Set Environment
```bash
export XAI_API_KEY="your-grok-api-key"
```

### 2. Start Server
```bash
cd /vercel/share/v0-project
pnpm dev
```

### 3. Open Dashboard
```
http://localhost:3000
```

### 4. Run Test Query
```
"Stop idle instances to save costs"
```

### 5. Watch Self-Correction
- See first attempt blocked by policy
- Watch agent analyze error
- Observe agent retry with corrected command
- See final success with state mutation
- Check metrics update

---

## Architecture Summary

```
User Query
    ↓
ReAct Loop (Thought → Action)
    ↓
Tool Execution
    ↓
VALIDATION SANDBOX ← NEW!
├─ Instance validation
├─ Tag-based policy checks
├─ CPU utilization checks
└─ Type safety validation
    ↓
    ├─ ✓ Valid → Execute & Mutate State
    │
    └─ ✗ Invalid → Return PolicyViolationError
         ├─ code
         ├─ message
         └─ suggestion (for agent to read!)
    ↓
Feed Back to ReAct Loop (as OBSERVATION)
    ↓
Agent Analyzes Error + Suggestion
    ↓
Agent Autonomously Chooses Alternative
    ↓
Next Iteration (usually succeeds)
    ↓
USER SEES ENTIRE SELF-CORRECTION IN TERMINAL
```

---

## Summary

This Phase 3 implementation showcases a **production-grade self-healing agent**:

1. **Policy Enforcement**: Validation sandbox blocks unsafe operations
2. **Error Communication**: Structured errors with actionable suggestions
3. **Autonomous Correction**: Agent reads errors and fixes itself
4. **Full Transparency**: User sees entire correction cycle
5. **Safety + Intelligence**: Protection doesn't sacrifice helpfulness

This is the kind of system that gets engineers hired at top AI companies.
