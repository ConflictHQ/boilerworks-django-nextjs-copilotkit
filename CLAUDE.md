# Claude — Boilerworks Django

Primary conventions doc: [`bootstrap.md`](bootstrap.md)
Context seed: [`memory.md`](memory.md)

Read both before writing any code.

---

## Claude-specific notes

- Prefer `Edit` over rewriting whole files.
- Run `make lint` (flake8 + isort) before committing. Max line length is 140.
- Never expose integer PKs in API responses — use `guid` or relay global ID.
- Auth check is required at the top of **every** GraphQL resolver and mutation.
- `config/roles_gen.py` is generated — don't edit it; use `make perms`.
- Soft-delete only: set `deleted_at`/`deleted_by`, never call `.delete()` on business objects.
- Copilot tools (`copilot/agent.py`): permission check first, results not exceptions, external IDs only; mutating tools are HITL (`confirmation_required` → `confirmed=true`). Tool names are mirrored in `frontend/copilot/config.ts` — change both together. Tests use `TestModel`/`FunctionModel`, never live LLM calls. See bootstrap.md "Copilot (AG-UI agent)".

## GraphQL stack

- **Framework**: Strawberry GraphQL (`strawberry-graphql` + `strawberry-graphql-django`)
- **Schema**: `config/schema.py` assembles Query/Mutation from all apps
- **Types**: `<app>/schema/types.py` or `core/schema/types/<domain>.py`
- **Mutations**: `<app>/schema/mutations.py` or `core/schema/mutations/<domain>.py`
- **Context**: `core/schema/context.py` — `StrawberryContext` (user, session, dataloaders, permissions)
- **Dataloaders**: `core/schema/dataloaders.py` — async batch loaders with `sync_to_async`
- **View**: `core/schema/views.py` — `CoreStrawberryView`
- **Endpoint**: `/gql/config/` (main), `/gql/config/auth/` (login only)
