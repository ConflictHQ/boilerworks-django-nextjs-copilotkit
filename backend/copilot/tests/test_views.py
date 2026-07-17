"""Endpoint tests: the AG-UI view's session-auth gate.

These exercise the real view through Django's test client (full middleware
stack) and assert the auth boundary without contacting a model:
- anonymous POST is rejected before any model call,
- an authenticated request gets past the auth gate to payload validation.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from pydantic_ai import models

User = get_user_model()
models.ALLOW_MODEL_REQUESTS = False


# The dev-only Debug Toolbar middleware tries to render itself into responses
# when DEBUG is on (it is, under the Tests configuration); disable it here so
# these tests exercise the endpoint's auth behaviour, not the toolbar.
@override_settings(
    DEBUG_TOOLBAR_CONFIG={
        'SHOW_TOOLBAR_CALLBACK': lambda request: False,
        'IS_RUNNING_TESTS': False,
    },
)
class CopilotEndpointAuthTest(TestCase):

    URL = '/app/copilot/agui/'

    def setUp(self):
        self.user = User.objects.create_user(
            username='cop', email='cop@test.com', password='x',
        )

    def test_get_not_allowed(self):
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 405)

    def test_anonymous_post_rejected(self):
        resp = self.client.post(self.URL, data='{}', content_type='application/json')
        self.assertEqual(resp.status_code, 401)

    def test_authenticated_bad_payload_passes_auth_gate(self):
        self.client.force_login(self.user)
        resp = self.client.post(
            self.URL, data='definitely not valid json', content_type='application/json',
        )
        # 422 (not 401): auth passed, and the invalid AG-UI body was rejected
        # at the boundary before any model was contacted.
        self.assertEqual(resp.status_code, 422)
