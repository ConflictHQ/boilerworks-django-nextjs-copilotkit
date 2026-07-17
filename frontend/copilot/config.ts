// Client-safe CopilotKit configuration.
//
// This module is imported by both client components (the provider/sidebar) and
// the server route handler, so it must not touch server-only APIs. Server-only
// helpers (backend URL + cookie forwarding) live in `./agui-endpoint.ts`.

/**
 * Name the AG-UI agent is registered under in the CopilotRuntime `agents` map.
 * The `<CopilotKit agent={...}>` prop must match this exact key.
 */
export const COPILOT_AGENT_NAME = "boilerworks_agent";

/**
 * Same-origin Next.js route that hosts the self-hosted CopilotRuntime.
 * Used both as the provider `runtimeUrl` and as the runtime `endpoint`.
 */
export const COPILOT_RUNTIME_URL = "/api/copilotkit";

/**
 * Backend tool names the agent exposes. These MUST match the Pydantic-AI tool
 * names on the Django `/copilot/agui/` agent, otherwise the generative-UI /
 * HITL renders never fire. Kept here as the single reconciliation point.
 */
export const COPILOT_TOOL_DRAFT_FORM = "draft_form_definition";
export const COPILOT_TOOL_TRANSITION_WORKFLOW = "execute_workflow_transition";

/**
 * Feature flag. The copilot surface is optional, mirroring how the template
 * gates other optional features. `NEXT_PUBLIC_COPILOT_ENABLED` is inlined at
 * build time, so this returns the same value on server and client.
 */
export function isCopilotEnabled(): boolean {
  return process.env.NEXT_PUBLIC_COPILOT_ENABLED === "true";
}

/**
 * Optional CopilotKit Cloud public API key (`cpk-…`). NOT required — the
 * template self-hosts the runtime and the LLM lives in the Django agent.
 * Set `NEXT_PUBLIC_COPILOTKIT_API_KEY` (e.g. in `.env.local`) only to enable
 * Copilot Cloud features during development/testing.
 */
export function copilotPublicApiKey(): string | undefined {
  return process.env.NEXT_PUBLIC_COPILOTKIT_API_KEY || undefined;
}
