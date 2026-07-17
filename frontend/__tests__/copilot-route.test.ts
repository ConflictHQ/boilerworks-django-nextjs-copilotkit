// Covers the CopilotKit -> Django AG-UI bridge:
//   1. the pure cookie/CSRF forwarding + URL helpers, and
//   2. the /api/copilotkit route handler wiring — with the CopilotRuntime and
//      AG-UI HttpAgent boundary mocked, asserting cookie forwarding + the
//      backend URL the agent is pointed at.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildForwardedHeaders, getCopilotBackendUrl, readCookie } from "@/copilot/agui-endpoint";

// --- pure helpers ----------------------------------------------------------

describe("readCookie", () => {
  it("extracts a named cookie value", () => {
    expect(readCookie("sessionid=abc; csrftoken=xyz", "csrftoken")).toBe("xyz");
  });

  it("url-decodes the value", () => {
    expect(readCookie("k=a%20b", "k")).toBe("a b");
  });

  it("returns null when the cookie or header is absent", () => {
    expect(readCookie("sessionid=abc", "csrftoken")).toBeNull();
    expect(readCookie("", "csrftoken")).toBeNull();
  });
});

describe("buildForwardedHeaders", () => {
  it("promotes the backend_jwt cookie to the Authorization header", () => {
    const headers = buildForwardedHeaders("backend_jwt=Session%20sk-123; csrftoken=tok");
    expect(headers.Authorization).toBe("Session sk-123");
  });

  it("sends no Authorization header without a backend_jwt cookie", () => {
    const headers = buildForwardedHeaders("sessionid=s1; csrftoken=tok");
    expect(headers.Authorization).toBeUndefined();
  });

  it("forwards the Cookie jar and mirrors csrftoken into X-CSRFToken", () => {
    const headers = buildForwardedHeaders("sessionid=s1; csrftoken=tok123");
    expect(headers.Cookie).toBe("sessionid=s1; csrftoken=tok123");
    expect(headers["X-CSRFToken"]).toBe("tok123");
  });

  it("forwards Cookie without X-CSRFToken when there is no csrftoken", () => {
    const headers = buildForwardedHeaders("sessionid=s1");
    expect(headers.Cookie).toBe("sessionid=s1");
    expect(headers["X-CSRFToken"]).toBeUndefined();
  });

  it("returns no headers when there is no incoming cookie", () => {
    expect(buildForwardedHeaders("")).toEqual({});
  });
});

describe("getCopilotBackendUrl", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("derives the endpoint from NEXT_PUBLIC_API_ROOT under the /app/ mount", () => {
    process.env.NEXT_PUBLIC_API_ROOT = "http://localhost:8000";
    delete process.env.COPILOT_AGUI_URL;
    expect(getCopilotBackendUrl()).toBe("http://localhost:8000/app/copilot/agui/");
  });

  it("prefers the COPILOT_AGUI_URL override when set", () => {
    process.env.NEXT_PUBLIC_API_ROOT = "http://localhost:8000";
    process.env.COPILOT_AGUI_URL = "https://agent.example.com/agui/";
    expect(getCopilotBackendUrl()).toBe("https://agent.example.com/agui/");
  });

  it("throws a configuration error when neither env var yields an origin", () => {
    delete process.env.COPILOT_AGUI_URL;
    delete process.env.NEXT_PUBLIC_API_ROOT;
    // A relative fallback would hand HttpAgent's Node fetch an unparseable URL.
    expect(() => getCopilotBackendUrl()).toThrow(/NEXT_PUBLIC_API_ROOT/);
    expect(() => getCopilotBackendUrl()).toThrow(/COPILOT_AGUI_URL/);
  });

  it("throws when NEXT_PUBLIC_API_ROOT is whitespace-only and no override is set", () => {
    delete process.env.COPILOT_AGUI_URL;
    process.env.NEXT_PUBLIC_API_ROOT = "   ";
    expect(() => getCopilotBackendUrl()).toThrow(/not configured/i);
  });
});

// --- route handler wiring (runtime boundary mocked) ------------------------

const mocks = vi.hoisted(() => ({
  httpAgent: vi.fn(),
  copilotRuntime: vi.fn(),
  emptyAdapter: vi.fn(),
  endpoint: vi.fn(),
  handleRequest: vi.fn(async () => new Response("ok")),
}));

vi.mock("@ag-ui/client", () => ({
  HttpAgent: class {
    constructor(config: unknown) {
      mocks.httpAgent(config);
    }
  },
}));

vi.mock("@copilotkit/runtime", () => ({
  CopilotRuntime: class {
    constructor(config: unknown) {
      mocks.copilotRuntime(config);
    }
  },
  ExperimentalEmptyAdapter: class {
    constructor() {
      mocks.emptyAdapter();
    }
  },
  copilotRuntimeNextJSAppRouterEndpoint: (options: unknown) => {
    mocks.endpoint(options);
    return { handleRequest: mocks.handleRequest };
  },
}));

describe("POST /api/copilotkit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_API_ROOT = "http://localhost:8000";
    delete process.env.COPILOT_AGUI_URL;
  });

  it("forwards session cookies + CSRF to the AG-UI agent and delegates to the runtime", async () => {
    const { POST } = await import("@/app/api/copilotkit/route");

    const req = new Request("http://localhost:3000/api/copilotkit", {
      method: "POST",
      headers: { cookie: "sessionid=s1; csrftoken=tok" },
    });

    const res = await POST(req as never);

    // HttpAgent points at the derived Django endpoint with cookies forwarded.
    expect(mocks.httpAgent).toHaveBeenCalledWith({
      url: "http://localhost:8000/app/copilot/agui/",
      headers: { Cookie: "sessionid=s1; csrftoken=tok", "X-CSRFToken": "tok" },
    });
    // The runtime is wired with an agents map and delegated to the App Router endpoint.
    expect(mocks.copilotRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.endpoint).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "/api/copilotkit" })
    );
    expect(mocks.handleRequest).toHaveBeenCalledTimes(1);
    expect(res).toBeInstanceOf(Response);
  });

  it("sends no auth headers when the request carries no cookies", async () => {
    const { POST } = await import("@/app/api/copilotkit/route");

    const req = new Request("http://localhost:3000/api/copilotkit", { method: "POST" });
    await POST(req as never);

    expect(mocks.httpAgent).toHaveBeenCalledWith({
      url: "http://localhost:8000/app/copilot/agui/",
      headers: {},
    });
  });
});
