# Permission Reference

Every role and permission OneUptime can grant, grouped the way the dashboard's permission picker groups them. Use this page to find the exact name or key to give a team, an API key or a Terraform resource.

The tables are generated from the OneUptime source when the page is served: the same list the dashboard, the API and the Terraform provider use. They always match the version you are running. For how permissions fit together (teams, scopes, owners and blocks), start with [Users, Teams & Permissions](/docs/permissions/index).

## How to read the tables

Each role and permission has a row with these columns:

- **Role** or **Permission**: the name the dashboard shows.
- **Permission Key**: the value to use with the [API](/docs/api-reference/api-reference), the [CLI](/docs/cli/index) and the [Terraform provider](/docs/terraform/index).
- **Scope** (roles only): `All, Owned or Labels` means you choose how far the role reaches when you grant it. `Project-wide only` means the role always applies across the whole project.
- **Restrict by labels** (permissions only): `Yes` means a grant of this permission can be limited to resources carrying particular labels.
- **Description**: what the role or permission allows.

> [!TIP]
> Reach for a role first. Roles stay correct as OneUptime adds features, while a list of single permissions has to be kept up to date by hand.

## Roles

{{PERMISSION_ROLE_COUNT}} roles, each bundling a product area at Admin, Member or Viewer level. These are what **Add Role** offers on a team's **Permissions** page and on an API key's page.

{{PERMISSION_ROLE_TABLES}}

## Granular permissions

{{PERMISSION_TOTAL_COUNT}} individual capabilities across {{PERMISSION_GROUP_COUNT}} groups. These are what **Add Permission** offers, for a team or an API key, when a role is broader than you need.

{{PERMISSION_GRANULAR_TABLES}}

## Next steps

:::cards
- [Users, Teams & Permissions](/docs/permissions/index): How teams, scopes, owners and blocks decide what someone can do.
- [API Reference](/docs/api-reference/api-reference): Use permission keys with API keys.
- [Terraform Provider](/docs/terraform/index): Manage teams and their permissions as code.
:::
