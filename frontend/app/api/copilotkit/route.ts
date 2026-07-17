import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import type { NextRequest } from "next/server";
import { COPILOT_AGENT_NAME, COPILOT_RUNTIME_URL } from "@/copilot/config";
import { buildForwardedHeaders, getCopilotBackendUrl } from "@/copilot/agui-endpoint";

// The runtime does a server-to-server fetch to Django and relies on Node APIs.
export const runtime = "nodejs";
// Reads per-request cookies — never statically cache this route.
export const dynamic = "force-dynamic";

// The LLM lives in the Django Pydantic-AI agent, so the runtime uses the empty
// service adapter — it satisfies the adapter slot without calling an LLM itself.
const serviceAdapter = new ExperimentalEmptyAdapter();

export const POST = async (req: NextRequest) => {
  // Build the runtime per-request so the incoming session cookies are forwarded
  // to Django on the runtime -> backend hop (they are not forwarded by default).
  const forwardedHeaders = buildForwardedHeaders(req.headers.get("cookie") ?? "");

  const runtime = new CopilotRuntime({
    agents: {
      [COPILOT_AGENT_NAME]: new HttpAgent({
        url: getCopilotBackendUrl(),
        headers: forwardedHeaders,
      }),
    },
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: COPILOT_RUNTIME_URL,
  });

  return handleRequest(req);
};
