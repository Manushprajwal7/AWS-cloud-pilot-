# Quick Start Guide - AWS CloudPilot

## Prerequisites

- Node.js 18+ installed
- `pnpm` package manager
- xAI API key (get from https://console.x.ai/)

## Setup

### 1. Clone and Install

```bash
cd /vercel/share/v0-project
pnpm install
```

### 2. Configure Environment

Add your xAI API key to your environment:

```bash
export XAI_API_KEY="your-xai-api-key-here"
```

Or create a `.env.local` file:

```
XAI_API_KEY=your-xai-api-key-here
```

### 3. Start Dev Server

```bash
pnpm dev
```

Output:
```
▲ Next.js 16
- ready started server on 0.0.0.0:3000, url: http://localhost:3000
```

### 4. Open Dashboard

Navigate to: http://localhost:3000

---

## Dashboard Overview

### Sections

#### 1. Header
- **Title**: AWS CloudPilot - AI-Driven FinOps Optimization
- **Reset Button**: Restores infrastructure to default state

#### 2. Metrics Grid
- **Total Monthly Spend**: Sum of all running instance costs
- **Estimated Monthly Waste**: Cost of idle instances (< 5% CPU)
- **Active Anomalies**: Count of underutilized/overutilized instances

#### 3. Agent Terminal
- **Query Input**: Enter your FinOps analysis question
- **Run Agent Button**: Executes the ReAct loop
- **Terminal Output**: Real-time streaming logs with color coding:
  - 🔵 THOUGHT (blue) - Agent reasoning
  - 🟡 ACTION (yellow) - Tool execution
  - 🟢 OBSERVATION (green) - Tool results
  - 🔴 ERROR (red) - Errors
  - ⚪ STATUS (cyan) - Status messages
  - ✅ FINAL (emerald) - Completion

---

## Example Queries

### 1. Find and Stop Idle Instances

```
Find the idle instance and stop it to save costs.
```

**Expected Flow**:
1. Agent calls `get_instances` → Lists 5 instances
2. Agent calls `get_anomalies` → Identifies dev-web-01 (1.8% CPU)
3. Agent calls `stop_instance` → Stops dev-web-01
4. **State Mutated**: `dev-web-01` state changes from `running` → `stopped`
5. Metrics update: Monthly spend decreases ~$7.59

### 2. Analyze Cost Optimization

```
Analyze our infrastructure and recommend cost optimizations.
```

**Expected Flow**:
1. Agent calls `get_instances`
2. Agent calls `get_cost_metrics`
3. Agent calls `get_anomalies`
4. Agent generates optimization report
5. Shows potential annual savings

### 3. Resize Underutilized Instance

```
Downsize the idle dev-web-01 instance to save costs.
```

**Expected Flow**:
1. Agent calls `get_instances`
2. Agent calls `get_anomalies` → Finds dev-web-01 (1.8% CPU)
3. Agent calls `modify_instance_type` with `new_type: t3.nano`
4. **State Mutated**: `dev-web-01` type changes, hourly rate decreases
5. Metrics update: Monthly spend decreases

---

## Key Metrics

### Initial State
- **Total Monthly Spend**: $138.41
- **Monthly Waste**: $15.94 (11.5%)
- **Annual Savings Potential**: $191.32
- **Active Anomalies**: 3 instances

### Target Instance
- **Name**: dev-web-01
- **Instance ID**: i-0123456789abcdef0
- **CPU Utilization**: 1.8% (VERY IDLE)
- **Memory**: 12%
- **Type**: t3.micro
- **Cost**: $0.0104/hour ($7.59/month)
- **State**: running → (target: stopped)

---

## Infrastructure State

### Instances

| Name | Type | CPU | Memory | Cost/hr | State |
|------|------|-----|--------|---------|-------|
| dev-web-01 | t3.micro | 1.8% | 12% | $0.0104 | running |
| prod-api-01 | t3.small | 45.2% | 65% | $0.0208 | running |
| prod-db-01 | t3.medium | 78.5% | 82% | $0.0416 | running |
| analytics-server | m5.large | 92.1% | 90% | $0.096 | running |
| staging-app-01 | t3.small | 3.2% | 8% | $0.0208 | running |

---

## API Endpoints

### POST /api/agent

**Request**:
```bash
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"query":"Find idle instances"}'
```

**Response**: Server-Sent Events (SSE) stream

```
data: {"content":"[THOUGHT]\nAnalyzing infrastructure..."}
data: {"content":"[ACTION]\n► Tool: get_instances\n  Args: {}"}
data: {"content":"[OBSERVATION]\nFound 5 instances..."}
data: [DONE]
```

---

## Server Actions

### Reset Infrastructure

**From Dashboard**: Click "🔄 Reset" button

**From Code**:
```typescript
import { resetInfrastructureAction } from '@/app/actions/simulation'

await resetInfrastructureAction()
```

This restores all instances to their default state.

---

## ReAct Loop Framework

The agent follows this pattern:

```
1. THOUGHT
   ├─ Analyze user query
   ├─ Determine next tool
   └─ Stream reasoning

2. ACTION
   ├─ Select tool
   ├─ Build arguments
   └─ Execute tool

3. OBSERVATION
   ├─ Get tool result
   ├─ Stream result
   └─ Update context

4. REPEAT (max 10 iterations)
   └─ Until goal achieved or out of actions

5. FINAL ANALYSIS
   ├─ Summarize findings
   └─ Report state mutations
```

---

## Available Tools

The agent can use these tools:

### Analysis Tools (Read-Only)
- `get_instances` - List all instances
- `get_cost_metrics` - Show spend & waste
- `get_anomalies` - Find inefficient instances
- `generate_optimization_report` - Full FinOps report

### Optimization Tools (State-Mutating)
- `stop_instance` - Stop idle instance → **Mutates state**
- `modify_instance_type` - Resize instance → **Mutates state**
- `terminate_instance` - Remove instance → **Mutates state**

---

## Troubleshooting

### Issue: "XAI_API_KEY is not set"

**Solution**: Set the environment variable

```bash
export XAI_API_KEY="your-key"
pnpm dev
```

### Issue: Agent not responding

**Check**:
1. Dev server is running (`pnpm dev`)
2. XAI_API_KEY is set correctly
3. Browser console for errors
4. Network tab for failed requests

### Issue: Metrics not updating

**Solution**: Metrics auto-refresh every 5 seconds. If not updating:
1. Click "Reset" button
2. Refresh page (F5)
3. Check browser console for errors

### Issue: Terminal logs not streaming

**Check**:
1. Query is not empty
2. SSE connection is active
3. Check browser Network tab → `/api/agent` → Response stream

---

## File Structure

```
app/
├── page.tsx                    # Main dashboard
├── layout.tsx                  # Root layout (dark mode)
├── actions/
│   └── simulation.ts           # Server Actions
└── api/
    └── agent/
        └── route.ts            # ReAct API endpoint

lib/
├── mockAwsState.ts             # In-memory infrastructure
└── tools/
    └── cloudTools.ts           # LangChain tools

components/
├── metrics-grid.tsx            # Cost metrics display
└── agent-terminal.tsx          # Agent log streaming

public/                         # Static assets

Documentation/
├── README.md                   # Full overview
├── DEPLOYMENT.md               # Production setup
├── REACT_LOOP_GUIDE.md         # ReAct framework
├── LANGCHAIN_TOOLS.md          # Tool implementation
├── IMPLEMENTATION_SUMMARY.md   # Complete architecture
└── QUICK_START.md              # This file
```

---

## Next Steps

1. ✅ Start dev server: `pnpm dev`
2. ✅ Open dashboard: http://localhost:3000
3. ✅ Run first agent query
4. ✅ Watch streaming logs
5. ✅ Verify state mutations
6. ✅ Check metrics update

---

## Deployment

### To Vercel

1. Push code to GitHub
2. Connect repo to Vercel
3. Add `XAI_API_KEY` environment variable
4. Deploy!

```bash
git push origin main
# Vercel auto-deploys
```

### Environment Variables (Required)

```
XAI_API_KEY=your-xai-api-key
```

---

## Support & Documentation

- **Full README**: `README.md`
- **Deployment Guide**: `DEPLOYMENT.md`
- **ReAct Framework**: `REACT_LOOP_GUIDE.md`
- **Tool Details**: `LANGCHAIN_TOOLS.md`
- **Architecture**: `IMPLEMENTATION_SUMMARY.md`

---

## Build Commands

```bash
# Development
pnpm dev

# Production build
pnpm build

# Start production server
pnpm start

# TypeScript check
pnpm typecheck

# Build and check
pnpm build && pnpm start
```

---

## Summary

You now have a fully functional AI-driven FinOps dashboard that:

✅ Streams real-time agent reasoning via SSE  
✅ Executes state-mutating tools for optimization  
✅ Analyzes infrastructure with LangChain tools  
✅ Updates metrics in real-time  
✅ Provides audit trail via streaming logs  

**Next**: Set XAI_API_KEY and run `pnpm dev` to get started!
