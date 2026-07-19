-- CreateTable
CREATE TABLE "CloudResource" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "cost" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anomaly" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolutionReason" TEXT,

    CONSTRAINT "Anomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "anomalyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "currentNode" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentNodeRun" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "node" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "AgentNodeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemediationPlan" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "anomalyId" TEXT,
    "action" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "expectedMonthlySavingsUsd" DOUBLE PRECISION,
    "realizedMonthlySavingsUsd" DOUBLE PRECISION,
    "riskLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemediationPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerraformArtifact" (
    "id" TEXT NOT NULL,
    "remediationPlanId" TEXT NOT NULL,
    "hcl" TEXT NOT NULL,
    "planJson" JSONB,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TerraformArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerraformExecution" (
    "id" TEXT NOT NULL,
    "terraformArtifactId" TEXT NOT NULL,
    "jobId" TEXT,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "logs" TEXT,
    "exitCode" INTEGER,
    "appliedCodeHash" TEXT,
    "appliedPlanHash" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TerraformExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerraformCorrectionAttempt" (
    "id" TEXT NOT NULL,
    "terraformArtifactId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "previousCodeHash" TEXT NOT NULL,
    "correctedCodeHash" TEXT,
    "triggerError" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TerraformCorrectionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanApproval" (
    "id" TEXT NOT NULL,
    "terraformArtifactId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "planHash" TEXT NOT NULL,
    "createCount" INTEGER NOT NULL,
    "updateCount" INTEGER NOT NULL,
    "deleteCount" INTEGER NOT NULL,
    "replacementCount" INTEGER NOT NULL,
    "affectedResourceCount" INTEGER NOT NULL,
    "estimatedMonthlyCostChangeUsd" DOUBLE PRECISION NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDecision" (
    "id" TEXT NOT NULL,
    "remediationPlanId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "policyName" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationResult" (
    "id" TEXT NOT NULL,
    "terraformExecutionId" TEXT NOT NULL,
    "checkName" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "details" JSONB,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RollbackRecord" (
    "id" TEXT NOT NULL,
    "terraformExecutionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RollbackRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CloudResource_externalId_key" ON "CloudResource"("externalId");

-- CreateIndex
CREATE INDEX "CloudResource_service_idx" ON "CloudResource"("service");

-- CreateIndex
CREATE INDEX "CloudResource_environment_idx" ON "CloudResource"("environment");

-- CreateIndex
CREATE INDEX "CloudResource_updatedAt_idx" ON "CloudResource"("updatedAt");

-- CreateIndex
CREATE INDEX "MetricSnapshot_resourceId_capturedAt_idx" ON "MetricSnapshot"("resourceId", "capturedAt");

-- CreateIndex
CREATE INDEX "Anomaly_resourceId_idx" ON "Anomaly"("resourceId");

-- CreateIndex
CREATE INDEX "Anomaly_status_severity_idx" ON "Anomaly"("status", "severity");

-- CreateIndex
CREATE INDEX "Anomaly_type_idx" ON "Anomaly"("type");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_runId_key" ON "AgentRun"("runId");

-- CreateIndex
CREATE INDEX "AgentRun_runId_idx" ON "AgentRun"("runId");

-- CreateIndex
CREATE INDEX "AgentRun_status_idx" ON "AgentRun"("status");

-- CreateIndex
CREATE INDEX "AgentRun_anomalyId_idx" ON "AgentRun"("anomalyId");

-- CreateIndex
CREATE INDEX "AgentRun_startedAt_idx" ON "AgentRun"("startedAt");

-- CreateIndex
CREATE INDEX "AgentNodeRun_agentRunId_idx" ON "AgentNodeRun"("agentRunId");

-- CreateIndex
CREATE INDEX "AgentNodeRun_agentRunId_node_idx" ON "AgentNodeRun"("agentRunId", "node");

-- CreateIndex
CREATE INDEX "AgentNodeRun_status_idx" ON "AgentNodeRun"("status");

-- CreateIndex
CREATE INDEX "RemediationPlan_agentRunId_idx" ON "RemediationPlan"("agentRunId");

-- CreateIndex
CREATE INDEX "RemediationPlan_status_idx" ON "RemediationPlan"("status");

-- CreateIndex
CREATE INDEX "RemediationPlan_resourceId_idx" ON "RemediationPlan"("resourceId");

-- CreateIndex
CREATE INDEX "TerraformArtifact_remediationPlanId_idx" ON "TerraformArtifact"("remediationPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "TerraformExecution_jobId_key" ON "TerraformExecution"("jobId");

-- CreateIndex
CREATE INDEX "TerraformExecution_status_idx" ON "TerraformExecution"("status");

-- CreateIndex
CREATE INDEX "TerraformExecution_terraformArtifactId_idx" ON "TerraformExecution"("terraformArtifactId");

-- CreateIndex
CREATE INDEX "TerraformExecution_jobId_idx" ON "TerraformExecution"("jobId");

-- CreateIndex
CREATE INDEX "TerraformCorrectionAttempt_terraformArtifactId_idx" ON "TerraformCorrectionAttempt"("terraformArtifactId");

-- CreateIndex
CREATE INDEX "TerraformCorrectionAttempt_result_idx" ON "TerraformCorrectionAttempt"("result");

-- CreateIndex
CREATE INDEX "PlanApproval_terraformArtifactId_idx" ON "PlanApproval"("terraformArtifactId");

-- CreateIndex
CREATE INDEX "PlanApproval_decision_idx" ON "PlanApproval"("decision");

-- CreateIndex
CREATE INDEX "PolicyDecision_remediationPlanId_idx" ON "PolicyDecision"("remediationPlanId");

-- CreateIndex
CREATE INDEX "PolicyDecision_decision_idx" ON "PolicyDecision"("decision");

-- CreateIndex
CREATE INDEX "VerificationResult_terraformExecutionId_idx" ON "VerificationResult"("terraformExecutionId");

-- CreateIndex
CREATE INDEX "VerificationResult_passed_idx" ON "VerificationResult"("passed");

-- CreateIndex
CREATE INDEX "RollbackRecord_terraformExecutionId_idx" ON "RollbackRecord"("terraformExecutionId");

-- CreateIndex
CREATE INDEX "RollbackRecord_status_idx" ON "RollbackRecord"("status");

-- CreateIndex
CREATE INDEX "AuditEvent_agentRunId_idx" ON "AuditEvent"("agentRunId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "CloudResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anomaly" ADD CONSTRAINT "Anomaly_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "CloudResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_anomalyId_fkey" FOREIGN KEY ("anomalyId") REFERENCES "Anomaly"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNodeRun" ADD CONSTRAINT "AgentNodeRun_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationPlan" ADD CONSTRAINT "RemediationPlan_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationPlan" ADD CONSTRAINT "RemediationPlan_anomalyId_fkey" FOREIGN KEY ("anomalyId") REFERENCES "Anomaly"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerraformArtifact" ADD CONSTRAINT "TerraformArtifact_remediationPlanId_fkey" FOREIGN KEY ("remediationPlanId") REFERENCES "RemediationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerraformExecution" ADD CONSTRAINT "TerraformExecution_terraformArtifactId_fkey" FOREIGN KEY ("terraformArtifactId") REFERENCES "TerraformArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerraformCorrectionAttempt" ADD CONSTRAINT "TerraformCorrectionAttempt_terraformArtifactId_fkey" FOREIGN KEY ("terraformArtifactId") REFERENCES "TerraformArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanApproval" ADD CONSTRAINT "PlanApproval_terraformArtifactId_fkey" FOREIGN KEY ("terraformArtifactId") REFERENCES "TerraformArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_remediationPlanId_fkey" FOREIGN KEY ("remediationPlanId") REFERENCES "RemediationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationResult" ADD CONSTRAINT "VerificationResult_terraformExecutionId_fkey" FOREIGN KEY ("terraformExecutionId") REFERENCES "TerraformExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RollbackRecord" ADD CONSTRAINT "RollbackRecord_terraformExecutionId_fkey" FOREIGN KEY ("terraformExecutionId") REFERENCES "TerraformExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
