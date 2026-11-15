// Client-safe CopilotKit configuration.
//
// This module is imported by both client components (the provider/sidebar) and
// the server route handler, so it must not touch server-only APIs. Server-only
// helpers (backend URL + cookie forwarding) live in `./agui-endpoint.ts`.

/**
 * Name the AG-UI agent is registered under in the CopilotRuntime `agents` map.
 * The provider's `agentId` must match this exact key.
 */
export const COPILOT_AGENT_NAME = "boilerworks_agent";

/**
 * Same-origin Next.js route that hosts the self-hosted CopilotRuntime.
 * Used both as the provider `runtimeUrl` and as the runtime `endpoint`.
 */
export const COPILOT_RUNTIME_URL = "/api/copilotkit";

/**
 * Backend tool name, rendered render-only. This MUST match the Pydantic-AI tool
 * name on the Django `/copilot/agui/` agent (`backend/copilot/agent.py`),
 * otherwise the generative-UI render never fires. It is drawn by a
 * `renderers.tools` entry, never registered as a tool — that keeps it OUT of the
 * frontend tool list advertised in `RunAgentInput.tools`, so it never collides
 * with the identically-named backend tool. Preserve that.
 */
export const COPILOT_TOOL_DRAFT_FORM = "draft_form_definition";

/**
 * Genuine FRONTEND tool. The agent calls this to obtain human approval before it
 * executes a workflow transition. Because it is advertised as a real frontend
 * tool (registered with `useAgentTool`), its name must NOT collide with any backend
 * tool name in `backend/copilot/agent.py` — pydantic-ai rejects duplicate tool
 * names. The backend `execute_workflow_transition` tool stays backend-only; the
 * agent bridges the two: `execute_workflow_transition` (unconfirmed) →
 * `confirm_workflow_transition` → on `{ approved: true }` re-call
 * `execute_workflow_transition` with `confirmed=true`.
 */
export const COPILOT_TOOL_CONFIRM_TRANSITION = "confirm_workflow_transition";

/**
 * Feature flag. The copilot surface is optional, mirroring how the template
 * gates other optional features. `NEXT_PUBLIC_COPILOT_ENABLED` is inlined at
 * build time, so this returns the same value on server and client.
 */
export function isCopilotEnabled(): boolean {
  return process.env.NEXT_PUBLIC_COPILOT_ENABLED === "true";
}
