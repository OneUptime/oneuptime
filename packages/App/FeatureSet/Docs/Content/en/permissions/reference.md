# Permission Reference

Every permission OneUptime can grant, grouped exactly as the dashboard's permission picker groups them.

This page is generated from the OneUptime source at request time — the same list the dashboard, the API and the Terraform provider use. It cannot drift from the product, and it reflects the version you are running.

If you are looking for how permissions fit together — teams, scopes, owners, blocks — start with [Users, Teams & Permissions](/docs/permissions/index).

The **Permission Key** column is the value to use with the [API](/docs/api-reference/api-reference), the [CLI](/docs/cli/index) and the [Terraform provider](/docs/terraform/index). The titles are what you see in the dashboard.

## Roles

{{PERMISSION_ROLE_COUNT}} roles, each bundling a product area at Admin, Member or Viewer level. These are what the **Role** picker offers when you add a permission to a team.

The **Scope** column says whether the role can be narrowed when you grant it. `All, Owned or Labels` means you can pick; `Project-wide only` means the role always applies across the whole project.

{{PERMISSION_ROLE_TABLES}}

## Granular permissions

{{PERMISSION_TOTAL_COUNT}} individual capabilities across {{PERMISSION_GROUP_COUNT}} groups. These are what the **Granular** picker offers, and what you assign to API keys.

The **Restrict by labels** column says whether a grant of this permission can be limited to resources carrying particular labels.

{{PERMISSION_GRANULAR_TABLES}}
