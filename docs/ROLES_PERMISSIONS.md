# Roles and permissions

wFileManager roles are stored in the shared Supabase project using the `wfilemanager_` prefix.

Implemented in v0.6.0:

- Persistent system and custom roles.
- Create, rename, describe and update custom roles.
- Update permissions on system roles except Administrator.
- Delete unassigned custom roles.
- Assign a role when creating a user.
- Return the current role permissions to the local Ubuntu engine.
- Enforce action permissions on file, upload, trash and terminal endpoints.
- Hide navigation entries that the current role cannot use.

The Administrator role always has every permission.

Not implemented yet:

- Per-path allow and deny rules.
- Read-only path inheritance.
- Editing an existing user's assigned role.
- Fine-grained UI disabling inside every page.
