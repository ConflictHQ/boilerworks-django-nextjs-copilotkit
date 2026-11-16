import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import type { NextRequest } from "next/server";
import { COPILOT_AGENT_NAME, COPILOT_RUNTIME_URL } from "@/copilot/config";
import { buildForwardedHeaders, getCopilotBackendUrl } from "@/copilot/agui-endpoint";

// The runtime does a server-to-server fetch to Django and relies on Node APIs.
export const runtime = "nodejs";
// Reads per-request cookies — never statically cache this route.
export const dynamic = "force-dynamic";

/**
 * The self-hosted CopilotRuntime (v2, one route for info, runs and stops). The
 * LLM lives in the Django Pydantic-AI agent; the runtime only relays AG-UI to it.
 * It is built per request so the incoming session cookies are forwarded to
 * Django on the runtime -> backend hop (they are not forwarded by default).
 */
export const POST = async (req: NextRequest) => {
  const forwardedHeaders = buildForwardedHeaders(req.headers.get("cookie") ?? "");

  const copilotRuntime = new CopilotRuntime({
    agents: {
      [COPILOT_AGENT_NAME]: new HttpAgent({
        url: getCopilotBackendUrl(),
        headers: forwardedHeaders,
      }),
    },
  });

  const handler = createCopilotRuntimeHandler({
    runtime: copilotRuntime,
    basePath: COPILOT_RUNTIME_URL,
    mode: "single-route",
  });

  return handler(req);
};
