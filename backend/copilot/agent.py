"""Pydantic AI copilot agent for the Boilerworks platform.

A single agent whose tools are thin, permission-checked wrappers over the
existing forms and workflow engines. No business logic lives here: every tool
re-checks the acting user's group-based permissions (the same
``P.<PERM>.check`` pattern used across the platform) and then delegates to the
engines' own methods so their versioned lifecycles, transition conditions,
actions and audit logging all fire unchanged.

The agent is served over the AG-UI protocol by ``copilot.views``. The model is
built lazily (only when a real request is served) so the module imports cleanly
without an ``ANTHROPIC_API_KEY`` — tests inject a ``TestModel``/``FunctionModel``
instead.
"""
from __future__ import annotations

import functools
from dataclasses import dataclass
from typing import Any, Optional

from asgiref.sync import sync_to_async
from config.roles_gen import P
from core.schema.common import GlobalIDUtils
from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import ValidationError
from forms.field_types import validate_form_schema
from forms.models import FormDefinition, FormStatus
from pydantic_ai import Agent, RunContext
from pydantic_ai.models import Model
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from workflows.models import WorkflowInstance


class CopilotNotConfigured(RuntimeError):
    """Raised when the copilot is enabled but no ANTHROPIC_API_KEY is set."""


@dataclass
class CopilotDeps:
    """Per-request dependencies handed to the agent and every tool."""

    user: AbstractBaseUser


SYSTEM_PROMPT = (
    'You are the Boilerworks copilot, embedded in a Django operations portal. '
    'You help authenticated staff inspect and draft form definitions and drive '
    'object workflows, using only the tools provided.\n\n'
    'Rules:\n'
    '- Never invent data; call a tool to read or change anything.\n'
    "- Every tool enforces the user's permissions. If a tool result has "
    "status 'permission_denied', tell the user they lack the required "
    'permission and do not retry that action.\n'
    '- Executing a workflow transition is irreversible. Always call '
    'execute_workflow_transition first WITHOUT confirmed to obtain the '
    'confirmation summary, relay it to the user, and only call again with '
    'confirmed=true after the user explicitly approves.\n'
    '- Refer to forms by their slug and to workflow objects by the reference '
    'ids returned by the read tools. Never ask users for internal numeric ids.'
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _denied(action: str) -> dict[str, Any]:
    return {
        'status': 'permission_denied',
        'message': f'You do not have permission to {action}.',
    }


def _project_transitions(transitions: list[dict]) -> list[dict[str, Any]]:
    """Expose only the safe, user-facing fields of an available transition."""
    return [
        {
            'to_state': t['to_state'],
            'label': t.get('label', t['to_state']),
            'conditions_met': t.get('conditions_met', True),
        }
        for t in transitions
    ]


def _resolve_instance(instance_ref: str) -> Optional[WorkflowInstance]:
    pk = GlobalIDUtils.get_pk_flexible(instance_ref, expected_type='WorkflowInstance')
    if not pk:
        return None
    return WorkflowInstance.objects.filter(pk=pk).first()


# ---------------------------------------------------------------------------
# Forms engine — synchronous implementations (run inside sync_to_async)
# ---------------------------------------------------------------------------

def _list_form_definitions_sync(user, status: Optional[str]) -> dict[str, Any]:
    if not P.FORMDEFINITION_VIEW.check(user, raised_error=False):
        return _denied('view form definitions')
    qs = FormDefinition.objects.all()
    if status:
        qs = qs.filter(status=status)
    return {
        'status': 'ok',
        'forms': [
            {
                'slug': f.slug,
                'name': f.name,
                'version': f.version,
                'form_status': f.status,
                'form_type': f.form_type,
                'description': f.description,
            }
            for f in qs
        ],
    }


def _get_form_definition_sync(user, slug: str) -> dict[str, Any]:
    if not P.FORMDEFINITION_VIEW.check(user, raised_error=False):
        return _denied('view form definitions')
    form = FormDefinition.objects.get_published(slug) or FormDefinition.objects.get_latest(slug)
    if not form:
        return {'status': 'not_found', 'message': f'No form definition with slug "{slug}".'}
    return {
        'status': 'ok',
        'slug': form.slug,
        'name': form.name,
        'version': form.version,
        'form_status': form.status,
        'form_type': form.form_type,
        'description': form.description,
        'schema': form.schema,
    }


def _draft_form_definition_sync(user, name: str, slug: str, description: str,
                                schema: dict[str, Any]) -> dict[str, Any]:
    if not P.FORMDEFINITION_ADD.check(user, raised_error=False):
        return _denied('create form definitions')

    is_valid, errors = validate_form_schema(schema)
    if not is_valid:
        return {'status': 'invalid_schema', 'errors': [e['message'] for e in errors]}

    if FormDefinition.objects.filter(slug=slug, status=FormStatus.DRAFT).exists():
        return {'status': 'error', 'message': f'A draft already exists for slug "{slug}".'}

    latest = FormDefinition.objects.get_latest(slug)
    version = (latest.version + 1) if latest else 1
    form = FormDefinition.objects.create(
        name=name,
        slug=slug,
        description=description or '',
        schema=schema,
        version=version,
        status=FormStatus.DRAFT,
        created_by=user,
        updated_by=user,
    )
    return {
        'status': 'created',
        'slug': form.slug,
        'version': form.version,
        'name': form.name,
        'form_status': form.status,
    }


# ---------------------------------------------------------------------------
# Workflow engine — synchronous implementations (run inside sync_to_async)
# ---------------------------------------------------------------------------

def _list_workflow_states_sync(user, model_label: str, object_ref: str) -> dict[str, Any]:
    if not P.WORKFLOWINSTANCE_VIEW.check(user, raised_error=False):
        return _denied('view workflow states')

    obj_pk = GlobalIDUtils.get_pk_flexible(object_ref)
    if not obj_pk:
        return {'status': 'error', 'message': 'Invalid object reference.'}

    try:
        app_label, model_name = model_label.split('.')
        ct = ContentType.objects.get(app_label=app_label, model=model_name.lower())
    except (ValueError, ContentType.DoesNotExist):
        return {'status': 'error', 'message': f'Unknown model "{model_label}".'}

    instances = (
        WorkflowInstance.objects
        .filter(content_type=ct, object_id=obj_pk)
        .order_by('-started_at')
    )
    return {
        'status': 'ok',
        'instances': [
            {
                'instance_ref': GlobalIDUtils.to_global_id('WorkflowInstance', inst.pk),
                'workflow_slug': inst.workflow.slug,
                'workflow_name': inst.workflow.name,
                'current_state': inst.current_state,
                'current_state_label': inst.workflow.get_state_label(inst.current_state),
                'is_completed': inst.is_completed,
                'available_transitions': _project_transitions(inst.get_available_transitions(user)),
            }
            for inst in instances
        ],
    }


def _list_available_transitions_sync(user, instance_ref: str) -> dict[str, Any]:
    if not P.WORKFLOWINSTANCE_VIEW.check(user, raised_error=False):
        return _denied('view workflow transitions')
    inst = _resolve_instance(instance_ref)
    if not inst:
        return {'status': 'not_found', 'message': 'Workflow instance not found.'}
    return {
        'status': 'ok',
        'instance_ref': GlobalIDUtils.to_global_id('WorkflowInstance', inst.pk),
        'current_state': inst.current_state,
        'available_transitions': _project_transitions(inst.get_available_transitions(user)),
    }


def _execute_workflow_transition_sync(user, instance_ref: str, to_state: str, note: str,
                                      confirmed: bool) -> dict[str, Any]:
    if not P.WORKFLOWINSTANCE_CHANGE.check(user, raised_error=False):
        return _denied('execute workflow transitions')

    inst = _resolve_instance(instance_ref)
    if not inst:
        return {'status': 'not_found', 'message': 'Workflow instance not found.'}
    if inst.is_completed:
        return {'status': 'error', 'message': 'This workflow instance is already completed.'}

    transition_def = inst.workflow.get_transition(inst.current_state, to_state)
    if not transition_def:
        return {
            'status': 'error',
            'message': f'No transition from "{inst.current_state}" to "{to_state}".',
        }

    if not confirmed:
        return {
            'status': 'confirmation_required',
            'instance_ref': GlobalIDUtils.to_global_id('WorkflowInstance', inst.pk),
            'from_state': inst.current_state,
            'to_state': to_state,
            'label': transition_def.get('label', to_state),
            'message': (
                f'This will transition "{inst.workflow.name}" from '
                f'"{inst.workflow.get_state_label(inst.current_state)}" to '
                f'"{inst.workflow.get_state_label(to_state)}". Call '
                'execute_workflow_transition again with confirmed=true to proceed.'
            ),
        }

    try:
        log = inst.transition(to_state, user, note or '')
    except ValidationError as exc:
        return {'status': 'error', 'message': '; '.join(exc.messages)}

    return {
        'status': 'executed',
        'instance_ref': GlobalIDUtils.to_global_id('WorkflowInstance', inst.pk),
        'from_state': log.from_state,
        'to_state': log.to_state,
        'transition_log_ref': GlobalIDUtils.to_global_id('TransitionLog', log.pk),
    }


# ---------------------------------------------------------------------------
# Tools (async, AG-UI facing). Django ORM runs in the calling thread via
# sync_to_async(thread_sensitive=True) so it shares the request's connection.
# ---------------------------------------------------------------------------

async def list_form_definitions(ctx: RunContext[CopilotDeps],
                                status: Optional[str] = None) -> dict[str, Any]:
    """List form definitions, optionally filtered by status (draft/published/archived).

    Requires the form-definition view permission.
    """
    return await sync_to_async(_list_form_definitions_sync, thread_sensitive=True)(
        ctx.deps.user, status)


async def get_form_definition(ctx: RunContext[CopilotDeps], slug: str) -> dict[str, Any]:
    """Get a single form definition by slug (published version if any, else latest).

    Requires the form-definition view permission.
    """
    return await sync_to_async(_get_form_definition_sync, thread_sensitive=True)(
        ctx.deps.user, slug)


async def draft_form_definition(ctx: RunContext[CopilotDeps], name: str, slug: str,
                                schema: dict[str, Any], description: str = '') -> dict[str, Any]:
    """Draft a new form definition and save it unpublished (draft) for review.

    ``schema`` must be a JSON Schema object: ``{"type": "object", "properties":
    {...}, "required": [...]}``. The draft is versioned by the forms engine and
    is NOT accepting submissions until a human publishes it. Requires the
    form-definition add permission.
    """
    return await sync_to_async(_draft_form_definition_sync, thread_sensitive=True)(
        ctx.deps.user, name, slug, description, schema)


async def list_workflow_states(ctx: RunContext[CopilotDeps], model_label: str,
                               object_ref: str) -> dict[str, Any]:
    """List the workflow instance(s) and current state for a target object.

    ``model_label`` is like "forms.FormSubmission"; ``object_ref`` is the
    object's reference id. Returns each instance's reference id, current state
    and the transitions currently available. Requires the workflow-instance
    view permission.
    """
    return await sync_to_async(_list_workflow_states_sync, thread_sensitive=True)(
        ctx.deps.user, model_label, object_ref)


async def list_available_transitions(ctx: RunContext[CopilotDeps],
                                     instance_ref: str) -> dict[str, Any]:
    """List transitions available from a workflow instance's current state.

    ``instance_ref`` is a reference id returned by list_workflow_states.
    Requires the workflow-instance view permission.
    """
    return await sync_to_async(_list_available_transitions_sync, thread_sensitive=True)(
        ctx.deps.user, instance_ref)


async def execute_workflow_transition(ctx: RunContext[CopilotDeps], instance_ref: str,
                                      to_state: str, note: str = '',
                                      confirmed: bool = False) -> dict[str, Any]:
    """Execute a workflow transition — human-in-the-loop, requires confirmation.

    Called with confirmed=false (the default) it returns a
    ``confirmation_required`` payload describing the change and does NOT modify
    anything. Only when called again with confirmed=true does it run the
    transition through the workflow engine (firing conditions, actions and audit
    logging). Requires the workflow-instance change permission.
    """
    return await sync_to_async(_execute_workflow_transition_sync, thread_sensitive=True)(
        ctx.deps.user, instance_ref, to_state, note, confirmed)


TOOLS = (
    list_form_definitions,
    get_form_definition,
    draft_form_definition,
    list_workflow_states,
    list_available_transitions,
    execute_workflow_transition,
)


# ---------------------------------------------------------------------------
# Agent construction
# ---------------------------------------------------------------------------

def _configured_model() -> AnthropicModel:
    """Build the configured Anthropic model. Raises if no API key is set."""
    api_key = settings.ANTHROPIC_API_KEY
    if not api_key:
        raise CopilotNotConfigured('ANTHROPIC_API_KEY is not set; the copilot is unavailable.')
    model_name = settings.COPILOT_MODEL
    if ':' in model_name:
        # Accept the "anthropic:<id>" form; AnthropicModel wants the bare id.
        model_name = model_name.split(':', 1)[1]
    return AnthropicModel(model_name, provider=AnthropicProvider(api_key=api_key))


def build_agent(model: Model | str | None = None) -> Agent[CopilotDeps]:
    """Build a fresh copilot agent with all tools registered.

    Pass ``model`` (e.g. a ``TestModel``/``FunctionModel``) in tests; production
    callers pass nothing and the configured Anthropic model is built lazily.
    """
    agent = Agent(
        model or _configured_model(),
        deps_type=CopilotDeps,
        system_prompt=SYSTEM_PROMPT,
        retries=2,
    )
    for tool in TOOLS:
        agent.tool(tool)
    return agent


@functools.lru_cache(maxsize=1)
def get_agent() -> Agent[CopilotDeps]:
    """Return the process-wide production agent (built once, real model)."""
    return build_agent()
