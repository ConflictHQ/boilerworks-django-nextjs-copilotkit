"use client";

import { useAgentReadable } from "@calliopelabs/ui/agent";
import { isCopilotEnabled } from "./config";

export type DashboardStat = { label: string; value: string; change: string };

function DashboardReadable({ stats }: { stats: DashboardStat[] }) {
  useAgentReadable(
    "Metrics currently shown on the operator dashboard (revenue, orders, customers, products) " +
      "with their month-over-month change. Use this when the user asks about the dashboard figures.",
    { page: "dashboard", stats }
  );
  return null;
}

/**
 * Exposes the dashboard's stat cards to the copilot as page context. Renders
 * nothing. Gated by the same feature flag as the provider, so the underlying
 * `useAgentReadable` only runs when the CopilotKit context is present.
 */
export function DashboardCopilotContext({ stats }: { stats: DashboardStat[] }) {
  if (!isCopilotEnabled()) return null;
  return <DashboardReadable stats={stats} />;
}
