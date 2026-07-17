// Server-only helpers for the CopilotKit -> Django AG-UI bridge.
//
// The browser calls the same-origin `/api/copilotkit` route, so it forwards the
// Django session cookie automatically. The runtime's server-to-server fetch to
// Django does NOT forward those cookies, so we read them off the incoming
// request and inject them into the downstream AG-UI request. This mirrors how
// the Apollo server client re-attaches auth on the RSC hop.

/**
 * Resolve the Django AG-UI endpoint.
 *
 * Defaults to the `/app/` mount used by every other backend route in this
 * template (GraphQL lives at `${NEXT_PUBLIC_API_ROOT}/app/gql/config/`).
 * `COPILOT_AGUI_URL` overrides the whole URL when the AG-UI endpoint is mounted
 * elsewhere or served by a separate host.
 */
export function getCopilotBackendUrl(): string {
  const override = process.env.COPILOT_AGUI_URL?.trim();
  if (override) return override;
  const apiRoot = (process.env.NEXT_PUBLIC_API_ROOT ?? "").replace(/\/+$/, "");
  return `${apiRoot}/app/copilot/agui/`;
}

/**
 * Read a single cookie value out of a raw `Cookie` header. Returns null when the
 * header is empty or the cookie is absent.
 */
export function readCookie(cookieHeader: string, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Build the headers attached to the downstream AG-UI request.
 *
 * - `Authorization` carries the `backend_jwt` cookie value — the full
 *   `Session <session_key>` string auth1 issued at login. This is what
 *   actually authenticates the server-to-server hop: Django's session cookie
 *   lives on the backend origin and never reaches this route, and
 *   `Auth0SessionMiddleware` resolves `Authorization: Session <key>` exactly
 *   like the Apollo clients do.
 * - `Cookie` still carries the incoming jar for same-origin/proxied deploys
 *   where the Django `sessionid` does ride along.
 * - `X-CSRFToken` mirrors the `csrftoken` cookie so Django's session-auth CSRF
 *   check passes on this POST. Harmless when the backend exempts the view.
 */
export function buildForwardedHeaders(cookieHeader: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
    const backendJwt = readCookie(cookieHeader, "backend_jwt");
    if (backendJwt) headers.Authorization = backendJwt;
    const csrfToken = readCookie(cookieHeader, "csrftoken");
    if (csrfToken) headers["X-CSRFToken"] = csrfToken;
  }
  return headers;
}
