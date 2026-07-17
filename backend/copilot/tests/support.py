"""Shared test helpers for the copilot app.

Builds users whose permissions come from the platform's org-scoped group model:
a permission is only effective when the granting group is linked to the user's
active organization via an OrganizationMember. ``grant`` wires that up the same
way the admin does.
"""
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from organization.models import Organization, OrganizationMember

User = get_user_model()


def make_org(name='CopilotTestOrg'):
    return Organization.objects.create(name=name)


def make_member_user(org, username):
    user = User.objects.create_user(
        username=username, email=f'{username}@test.com', password='x',
    )
    OrganizationMember.objects.create(organization=org, member=user, is_active=True)
    user.profile.active_organization = org
    user.profile.save()
    return user


def grant(org, user, perm_enum):
    """Grant a permission (a ``P`` enum member) to ``user`` within ``org``."""
    perm = perm_enum.perm()
    group, _ = Group.objects.get_or_create(name=f'grp-{perm.codename}')
    group.permissions.add(perm)
    # The group must belong to the org before it can be attached to a member.
    org.groups.add(group)
    membership = OrganizationMember.objects.get(member=user, organization=org)
    membership.groups.add(group)
