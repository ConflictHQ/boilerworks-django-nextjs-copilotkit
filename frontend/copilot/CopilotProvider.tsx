"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import "./copilot.css";
import { useTranslations } from "next-intl";
import {
  COPILOT_AGENT_NAME,
  COPILOT_RUNTIME_URL,
  copilotPublicApiKey,
  isCopilotEnabled,
} from "./config";
import { CopilotToolRenders } from "./CopilotToolRenders";

/**
 * Wraps the authenticated app in the CopilotKit provider + chat sidebar.
 *
 * - Gated by the `NEXT_PUBLIC_COPILOT_ENABLED` flag; when off, renders children
 *   untouched (no provider, no bundle-visible widget).
 * - The chat surface only mounts for authenticated users. `authenticated` is
 *   resolved on the server from the same `GET_ME` fetch the app layout already
 *   uses. When enabled the provider context is still mounted for unauthenticated
 *   renders so page-level `useCopilotReadable` hooks never orphan.
 */
export function CopilotProvider({
  authenticated,
  children,
}: {
  authenticated: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("copilot");

  if (!isCopilotEnabled()) return <>{children}</>;

  return (
    <CopilotKit
      runtimeUrl={COPILOT_RUNTIME_URL}
      agent={COPILOT_AGENT_NAME}
      publicApiKey={copilotPublicApiKey()}
    >
      {authenticated ? (
        <>
          <CopilotToolRenders />
          <CopilotSidebar
            defaultOpen={false}
            clickOutsideToClose
            labels={{
              title: t("title"),
              initial: t("initial"),
              placeholder: t("placeholder"),
            }}
          >
            {children}
          </CopilotSidebar>
        </>
      ) : (
        children
      )}
    </CopilotKit>
  );
}
