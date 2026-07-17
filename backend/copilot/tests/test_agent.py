"""Tool-level tests: permission gating (allowed + denied) and HITL transitions.

The agent is driven by a FunctionModel that scripts exactly one tool call and
then a final text turn, so no live LLM is ever contacted. Assertions are made
against the real database and against the tool's returned payload.
"""
from asgiref.sync import async_to_sync
from config.roles_gen import P
from copilot.agent import CopilotDeps, build_agent
from copilot.tests.support import grant, make_member_user, make_org
from core.schema.common import GlobalIDUtils
from django.test import TestCase
from forms.models import FormDefinition, FormStatus
from pydantic_ai import ModelResponse, TextPart, ToolCallPart, models
from pydantic_ai.messages import ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel
from workflows.models import WorkflowDefinition, WorkflowInstance

# Belt-and-suspenders: forbid any accidental real model request.
models.ALLOW_MODEL_REQUESTS = False


def _script(tool_name, tool_args):
    """FunctionModel body: call one tool once, then answer with plain text."""
    def fn(messages, info):
        already_called = any(
            isinstance(p, ToolReturnPart) for m in messages for p in m.parts
        )
        if already_called:
            return ModelResponse(parts=[TextPart('done')])
        return ModelResponse(parts=[ToolCallPart(tool_name=tool_name, args=tool_args)])
    return fn


class CopilotToolTestBase(TestCase):

    def setUp(self):
        self.org = make_org()
        self.allowed = make_member_user(self.org, 'allowed')
        self.denied = make_member_user(self.org, 'denied')
        # The placeholder model is never used — every run overrides it.
        self.agent = build_agent(model=TestModel(call_tools=[]))

    def run_tool(self, user, tool_name, tool_args):
        deps = CopilotDeps(user=user)
        fn_model = FunctionModel(_script(tool_name, tool_args))
        agent = self.agent

        async def _go():
            with agent.override(model=fn_model):
                return await agent.run('please help', deps=deps)

        result = async_to_sync(_go)()
        return self._tool_return(result, tool_name)

    @staticmethod
    def _tool_return(result, tool_name):
        for msg in result.all_messages():
            for part in msg.parts:
                if isinstance(part, ToolReturnPart) and part.tool_name == tool_name:
                    return part.content
        return None


class DraftFormDefinitionToolTest(CopilotToolTestBase):

    SCHEMA = {
        'type': 'object',
        'properties': {'email': {'type': 'string', 'format': 'email'}},
        'required': ['email'],
    }

    def test_draft_allowed_creates_draft(self):
        grant(self.org, self.allowed, P.FORMDEFINITION_ADD)
        payload = self.run_tool(self.allowed, 'draft_form_definition', {
            'name': 'Contact', 'slug': 'contact',
            'description': 'Contact us', 'schema': self.SCHEMA,
        })
        self.assertEqual(payload['status'], 'created')
        self.assertEqual(payload['slug'], 'contact')
        self.assertEqual(payload['form_status'], FormStatus.DRAFT)

        # Exactly one draft row, in draft state, owned by the acting user.
        # (The engine's Tracking base owns the version number, so assert the
        # tool reports whatever it persisted rather than a hardcoded value.)
        forms = FormDefinition.objects.filter(slug='contact')
        self.assertEqual(forms.count(), 1)
        form = forms.get()
        self.assertEqual(form.status, FormStatus.DRAFT)
        self.assertEqual(form.created_by_id, self.allowed.pk)
        self.assertEqual(payload['version'], form.version)

    def test_draft_denied_makes_no_row(self):
        payload = self.run_tool(self.denied, 'draft_form_definition', {
            'name': 'Contact', 'slug': 'contact',
            'description': '', 'schema': self.SCHEMA,
        })
        self.assertEqual(payload['status'], 'permission_denied')
        self.assertFalse(FormDefinition.objects.filter(slug='contact').exists())


class ListFormDefinitionsToolTest(CopilotToolTestBase):

    def setUp(self):
        super().setUp()
        FormDefinition.objects.create(
            name='Alpha', slug='alpha', schema={}, version=1, status=FormStatus.DRAFT,
        )

    def test_list_allowed(self):
        grant(self.org, self.allowed, P.FORMDEFINITION_VIEW)
        payload = self.run_tool(self.allowed, 'list_form_definitions', {})
        self.assertEqual(payload['status'], 'ok')
        self.assertTrue(any(f['slug'] == 'alpha' for f in payload['forms']))

    def test_list_denied(self):
        payload = self.run_tool(self.denied, 'list_form_definitions', {})
        self.assertEqual(payload['status'], 'permission_denied')


class WorkflowTransitionToolTest(CopilotToolTestBase):

    def setUp(self):
        super().setUp()
        self.wf = WorkflowDefinition.objects.create(
            name='Doc Review', slug='doc-review', model_label='forms.FormDefinition',
            states=[
                {'name': 'draft', 'label': 'Draft', 'is_initial': True},
                {'name': 'submitted', 'label': 'Submitted'},
                {'name': 'approved', 'label': 'Approved', 'is_final': True},
            ],
            transitions=[
                {'from_state': 'draft', 'to_state': 'submitted', 'label': 'Submit'},
                {'from_state': 'submitted', 'to_state': 'approved', 'label': 'Approve'},
            ],
        )
        self.target = FormDefinition.objects.create(
            name='Doc', slug='doc', schema={}, version=1,
        )
        self.instance = WorkflowInstance.start(self.wf, self.target, self.allowed)
        self.instance_ref = GlobalIDUtils.to_global_id('WorkflowInstance', self.instance.pk)

    def test_unconfirmed_does_not_transition(self):
        grant(self.org, self.allowed, P.WORKFLOWINSTANCE_CHANGE)
        payload = self.run_tool(self.allowed, 'execute_workflow_transition', {
            'instance_ref': self.instance_ref, 'to_state': 'submitted', 'confirmed': False,
        })
        self.assertEqual(payload['status'], 'confirmation_required')
        self.assertEqual(payload['from_state'], 'draft')
        self.assertEqual(payload['to_state'], 'submitted')

        self.instance.refresh_from_db()
        self.assertEqual(self.instance.current_state, 'draft')
        self.assertEqual(self.instance.transition_logs.count(), 1)

    def test_confirmed_transitions(self):
        grant(self.org, self.allowed, P.WORKFLOWINSTANCE_CHANGE)
        payload = self.run_tool(self.allowed, 'execute_workflow_transition', {
            'instance_ref': self.instance_ref, 'to_state': 'submitted', 'confirmed': True,
        })
        self.assertEqual(payload['status'], 'executed')
        self.assertEqual(payload['from_state'], 'draft')
        self.assertEqual(payload['to_state'], 'submitted')

        self.instance.refresh_from_db()
        self.assertEqual(self.instance.current_state, 'submitted')
        self.assertEqual(self.instance.transition_logs.count(), 2)

    def test_confirmed_denied_no_change(self):
        payload = self.run_tool(self.denied, 'execute_workflow_transition', {
            'instance_ref': self.instance_ref, 'to_state': 'submitted', 'confirmed': True,
        })
        self.assertEqual(payload['status'], 'permission_denied')

        self.instance.refresh_from_db()
        self.assertEqual(self.instance.current_state, 'draft')
        self.assertEqual(self.instance.transition_logs.count(), 1)

    def test_list_workflow_states_allowed(self):
        grant(self.org, self.allowed, P.WORKFLOWINSTANCE_VIEW)
        object_ref = GlobalIDUtils.to_global_id('FormDefinition', self.target.pk)
        payload = self.run_tool(self.allowed, 'list_workflow_states', {
            'model_label': 'forms.FormDefinition', 'object_ref': object_ref,
        })
        self.assertEqual(payload['status'], 'ok')
        self.assertEqual(len(payload['instances']), 1)
        self.assertEqual(payload['instances'][0]['current_state'], 'draft')
        self.assertEqual(payload['instances'][0]['instance_ref'], self.instance_ref)
