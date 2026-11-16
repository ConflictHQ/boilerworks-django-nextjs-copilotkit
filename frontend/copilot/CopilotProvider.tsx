"use client";

import { CalliopeAgent, useOpenState } from "@calliopelabs/ui/agent";
import { CopilotKitAgentProvider } from "@calliopelabs/ui/agent/copilotkit";
import { useTranslations } from "next-intl";
import { createContext, useContext, type ReactNode } from "react";
import { COPILOT_AGENT_NAME, COPILOT_RUNTIME_URL, isCopilotEnabled } from "./config";
import { CopilotMarkdown } from "./CopilotMarkdown";
import { CopilotToolRenders, copilotRenderers } from "./CopilotToolRenders";

/** Whether the assistant may show: the copilot is on and someone is signed in. */
const CopilotSurface = createContext(false);

/** Where a viewer's open or closed assistant is remembered, in this browser. */
export const COPILOT_OPEN_KEY = "boilerworks.copilot.open";

/**
 * Wraps the authenticated app in the agent: CopilotKit's headless core runs
 * the Django agent through the self-hosted runtime at `/api/copilotkit`, and
 * `@calliopelabs/ui` draws the conversation (`useCopilotRail` puts it in the
 * shell's right rail). No CopilotKit UI or stylesheet is loaded.
 *
 * - Gated by the `NEXT_PUBLIC_COPILOT_ENABLED` flag; when off, renders children
 *   untouched (no provider, no rail).
 * - The rail and the browser tools only mount for authenticated users.
 *   `authenticated` is resolved on the server from the same `GET_ME` fetch the
 *   app layout already uses. When enabled the provider is still mounted for
 *   unauthenticated renders so page-level `useAgentReadable` hooks never orphan.
 */
export function CopilotProvider({
  authenticated,
  children,
}: {
  authenticated: boolean;
  children: ReactNode;
}) {
  if (!isCopilotEnabled()) return <>{children}</>;

  return (
    <CopilotKitAgentProvider
      runtimeUrl={COPILOT_RUNTIME_URL}
      useSingleEndpoint
      agentId={COPILOT_AGENT_NAME}
    >
      {authenticated ? <CopilotToolRenders /> : null}
      <CopilotSurface.Provider value={authenticated}>{children}</CopilotSurface.Provider>
    </CopilotKitAgentProvider>
  );
}

/**
 * The assistant for the shell's right rail, with its label and the `]`
 * toggle, or nothing when the copilot is off or nobody is signed in. Spread
 * the result into the AppShell (through AppFrame).
 */
export function useCopilotRail(): {
  rightRail?: ReactNode;
  rightRailLabel?: string;
  onToggleRightRail?: () => void;
} {
  const shown = useContext(CopilotSurface);
  const t = useTranslations("copilot");
  const [open, setOpen] = useOpenState({ persistKey: COPILOT_OPEN_KEY });
  if (!shown) return {};
  return {
    rightRail: (
      <CalliopeAgent
        mode="rail"
        persistKey={COPILOT_OPEN_KEY}
        title={t("title")}
        renderers={copilotRenderers}
        renderContent={(text) => <CopilotMarkdown text={text} />}
        placeholder={t("placeholder")}
        empty={<p className="text-muted-foreground px-2 text-center text-sm">{t("initial")}</p>}
      />
    ),
    rightRailLabel: t("title"),
    onToggleRightRail: () => setOpen(!open),
  };
}
