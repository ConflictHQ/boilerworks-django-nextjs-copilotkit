from copilot.views import copilot_agui
from django.urls import path

urlpatterns = [
    path('agui/', copilot_agui, name='copilot-agui'),
]
