"""AG-UI endpoint for the copilot.

A single Django async view that serves the Pydantic AI agent over the AG-UI
protocol. Session auth (the platform's normal middleware) gates the endpoint —
anonymous requests are rejected with 401 before any model call. The request
body is parsed into an AG-UI ``RunAgentInput`` and the agent's event stream is
returned as Server-Sent Events via ``StreamingHttpResponse``.

The lower-level ``AGUIAdapter`` primitives are used (not ``dispatch_request``),
because that helper expects a Starlette request/response; this keeps the
endpoint native to Django so ``request.user`` and the auth stack apply directly.
"""
from __future__ import annotations

import json
from http import HTTPStatus

from copilot.agent import CopilotDeps, CopilotNotConfigured, get_agent
from django.http import JsonResponse, StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt
from pydantic import ValidationError
from pydantic_ai.ui import SSE_CONTENT_TYPE
from pydantic_ai.ui.ag_ui import AGUIAdapter


@csrf_exempt
async def copilot_agui(request):
    """POST /copilot/agui/ — stream an AG-UI agent run as SSE."""
    if request.method != 'POST':
        return JsonResponse(
            {'error': 'Method not allowed. Use POST.'},
            status=HTTPStatus.METHOD_NOT_ALLOWED,
        )

    # Auth gate: reject anonymous callers before touching the model.
    user = await request.auser()
    if not user or not user.is_authenticated:
        return JsonResponse(
            {'error': 'Authentication required.'},
            status=HTTPStatus.UNAUTHORIZED,
        )

    # Validate the AG-UI request payload at the boundary.
    try:
        run_input = AGUIAdapter.build_run_input(request.body)
    except ValidationError as exc:
        return JsonResponse(
            {'error': 'Invalid AG-UI request payload.', 'detail': json.loads(exc.json())},
            status=HTTPStatus.UNPROCESSABLE_ENTITY,
        )

    try:
        agent = get_agent()
    except CopilotNotConfigured as exc:
        return JsonResponse({'error': str(exc)}, status=HTTPStatus.SERVICE_UNAVAILABLE)

    accept = request.headers.get('accept') or SSE_CONTENT_TYPE
    adapter = AGUIAdapter(agent=agent, run_input=run_input, accept=accept)
    deps = CopilotDeps(user=user)

    sse_stream = adapter.encode_stream(adapter.run_stream(deps=deps))
    response = StreamingHttpResponse(sse_stream, content_type=SSE_CONTENT_TYPE)
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response
