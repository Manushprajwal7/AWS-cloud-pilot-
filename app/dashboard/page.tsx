"use client";

import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { MetricsCards } from "@/components/dashboard/metrics-cards";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { InfrastructureTable } from "@/components/dashboard/infrastructure-table";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import { GraphRunsPanel } from "@/components/dashboard/graph-runs-panel";
import { TelemetryPanel } from "@/components/monitoring/telemetry-panel";

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen w-screen bg-paper">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <div className="flex-1 flex flex-col ml-60">
        {/* Header */}
        <Header />

        {/* Content Area */}
        <main className="pt-16">
          <div className="w-full px-6 py-6 space-y-6 max-w-[1600px]">
            {/* Metrics Cards */}
            <MetricsCards />

            {/* Live Telemetry: resource health, selector, and CPU/memory/network/request/latency/error-rate/cost charts */}
            <TelemetryPanel />

            {/* Recent Anomalies + Real Audit Trail */}
            <div className="grid grid-cols-12 gap-5 items-start">
              <div className="col-span-12 lg:col-span-5">
                <AlertsPanel />
              </div>
              <div className="col-span-12 lg:col-span-7">
                <RecentActivity />
              </div>
            </div>

            {/* Infrastructure Table */}
            <InfrastructureTable />

            {/* Graph Execution Visualizer */}
            <GraphRunsPanel />
          </div>
        </main>
      </div>
    </div>
  );
}
