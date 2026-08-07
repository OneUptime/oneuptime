# Users, Teams & Permissions

Everything in OneUptime lives inside a **project**. Who can do what inside that project comes down to three things: the **users** in it, the **teams** those users belong to, and the **permissions** granted to those teams.

The one rule that explains most of the behaviour: **users never hold permissions directly.** A user's access is the union of the permissions of every team they belong to in that project. If you want to change what somebody can do, you change their team membership or you change that team's permissions.

**Owners** are a separate idea. An owner is whoever is responsible for a specific resource — a monitor, an incident, a dashboard. Owners get notified about their resources, and permissions can optionally be narrowed to "only the things I own".

## The model at a glance

```text
Project
  └── Team                     ← permissions are attached here
       ├── Allow permissions   ← each with a scope: All / Owned / Labels
       ├── Block permissions   ← always win over allow
       └── Team members        ← users who accepted the invitation
```

| Concept | What it is |
| --- | --- |
| User | A single OneUptime account. One login, any number of projects. |
| Project | The tenant boundary. Monitors, incidents, teams and data all belong to exactly one project. |
| Team | A named group inside a project that carries permissions. |
| Team member | A user who has been invited to a team and accepted. |
| Permission | A single capability, e.g. `CreateProjectMonitor`, or a role that bundles many, e.g. `MonitorAdmin`. |
| Scope | How wide an allow permission reaches: all resources, only owned ones, or only labelled ones. |
| Owner | A user or team marked as responsible for one specific resource. |
| Label | A tag you put on resources, used to restrict permissions and to organise. |

## Users

A user account is global to the OneUptime instance — the same login works across every project the user has been invited to.

A user is "in" a project when they are a member of **at least one team** in it. There is no separate "add user to project" step: inviting somebody to a project invites them to a team.

- Invitations create a pending team member. The user only counts as a project member — and only gains any permission — **after they accept the invitation.**
- Removing a user from every team in a project removes their access to it.
- If your project enforces SSO and a user has not authenticated through the identity provider yet, they are treated as an unauthorised SSO user and see nothing until they do. See [SSO](/docs/identity/sso).
- With SCIM configured, your identity provider can create, update and remove users and their team memberships automatically. See [SCIM](/docs/identity/scim).

Where to find it: **Settings → Users** lists everyone in the project and their invitation status.

## Teams

Teams are how permissions get to people. Every new project starts with three:

| Team | Permission it holds | Editable |
| --- | --- | --- |
| Owners | `ProjectOwner` | No. Always has at least one member. |
| Admin | `ProjectAdmin` | No |
| Members | `ProjectMember` | Yes — this one is a starting point, change it freely |

The **Owners** and **Admin** teams are deliberately locked: their permissions cannot be edited and the teams cannot be deleted or renamed. This is what stops a project from being accidentally locked out of itself. The Owners team must always keep at least one member.

`ProjectOwner` is the highest level of access: billing, deleting the project, and everything an admin can do. `ProjectAdmin` covers everything except billing and deleting the project.

Create as many additional teams as you like — "Frontend On-Call", "Support", "Read-Only Auditors" — and give each the permissions it needs.

Where to find it: **Settings → Teams**. Open a team to reach **Members**, **Permissions** and **Block Permissions**.

## Permissions

A permission is one capability. There are two ways to hand them out, and both live on the team's **Permissions** tab.

### Roles

A role bundles a whole product area at one of three levels:

- **Admin** — full control over that area, including its configuration (severities, states, templates).
- **Member** — day-to-day work: create, edit and delete the resources, but not reconfigure the area.
- **Viewer** — read-only.

`MonitorAdmin`, `IncidentMember`, `StatusPageViewer` and so on. Roles are what you want almost all of the time — they stay correct as OneUptime adds features, because a new monitor-related table is added to the existing monitor roles rather than needing a new grant from you.

All {{PERMISSION_ROLE_COUNT}} roles are listed in the [Permission Reference](/docs/permissions/reference).

### Granular permissions

Every individual capability is also assignable on its own — `CreateProjectMonitor`, `ReadProjectIncident`, `DeleteProjectStatusPage`, and {{PERMISSION_TOTAL_COUNT}} others. Use these when a role is too broad and you need to hand out exactly one thing.

These are also the keys you use when creating API keys, and the ones the API and the Terraform provider expect.

The full list is in the [Permission Reference](/docs/permissions/reference).

### Allow and block

Each team has two lists:

- **Permissions** (allow) — what this team can do.
- **Block Permissions** — what this team can never do, regardless of any allow entry.

**Block always wins.** A block entry with no labels removes that capability outright for the team. A block entry with labels removes it only for resources carrying those labels — useful for "this team can edit monitors, except the ones labelled Production".

A permission cannot carry restriction labels in both lists at once; OneUptime rejects the second one with an explanation.

Because a user's access is the union across all their teams, a block on one team does **not** cancel an allow on another team. Blocks restrict the team they are set on. If somebody has more access than you expect, check every team they belong to.

## Scope: how far an allow permission reaches

Every allow permission is granted with a scope, chosen when you add it:

| Scope | Meaning |
| --- | --- |
| All resources in the project | The default. The permission applies to every matching resource. |
| Owned by this team or its members | The permission only applies to resources where this team, or the user acting, is listed as an owner. |
| Restrict by labels (advanced) | The permission only applies to resources carrying at least one of the selected labels. |

**Owned** is the simplest way to build a "you look after your own services" model: give a team `MonitorAdmin` scoped to Owned, then make that team the owner of the monitors it is responsible for. It only narrows resources that can actually have owners — monitors, incidents, dashboards, services and the like. Project configuration (incident states, labels, teams themselves) has no owner, so an Owned-scoped role behaves normally there.

**Labels** is the more manual version of the same idea: tag resources, then grant permissions restricted to those tags.

Some roles are project-wide by definition and do not offer a scope at all, because scoping them would be meaningless — "Billing Admin, but only for the billing I own" does not describe anything:

{{PERMISSION_SCOPE_EXEMPT_ROLES}}

## Owners

An owner is a user or a team attached to one specific resource. Most resources that represent something you operate — monitors, incidents, alerts, scheduled maintenance events, on-call policies, dashboards, services, status pages, workflows, runbooks and SLOs — have an **Owners** tab.

Owners do two jobs:

1. **Notification.** Owners are who OneUptime tells when something happens to the resource — a monitor goes down, an incident is created, an SLO starts burning through its error budget.
2. **Access, when you ask for it.** Ownership is what the `Owned` permission scope resolves against. A user matches if they are personally an owner, or if any team they belong to is an owner.

Ownership on its own grants nothing. Being the owner of a monitor does not let you edit it unless a team you belong to also holds a monitor permission. Ownership narrows access; it never widens it.

## Labels

Labels are project-wide tags you attach to resources. They serve two purposes: filtering and grouping in the dashboard, and restricting permissions as described above.

A label restriction is satisfied if the resource carries **at least one** of the labels on the permission. A resource with no labels at all matches no label-restricted permission.

Where to find it: **Settings → Labels**.

## API keys

API keys are granted permissions directly, on the key itself — they do not belong to teams and are not affected by team membership.

- Assign the same granular permissions and roles you would give a team.
- Keys support **block permissions** and **label restrictions**, the same way teams do.
- Keys do **not** support the Owned scope. Ownership resolves against a user, and a key is not a user, so grant keys the access they need explicitly.

Give each integration its own key with the narrowest set of permissions that works, so you can revoke one without disturbing the others.

Where to find it: **Settings → API Keys**. See also the [API Reference](/docs/api-reference/api-reference).

## How OneUptime decides whether a request is allowed

For a signed-in user, in order:

1. Find the teams the user belongs to in this project, counting only accepted invitations.
2. Collect every permission row on those teams — allow and block, each with its labels and scope.
3. Check the block list first. A matching block with no labels rejects the request outright.
4. Check the allow list. The request needs at least one permission that the target table accepts for this operation.
5. Apply scope. Owned-scoped grants narrow the query to owned resources; label-scoped grants narrow it to matching labels. If any other grant for the same operation is broader, the broader one wins.
6. Apply label blocks. A block with labels rejects the request if the target resource carries one of them.

Every logged-in user additionally holds a small set of automatic permissions that cover things like reading their own profile and their own notification rules. These are not admin permissions and do not unlock anyone else's data.

Resolved permissions are cached per user and project, and refreshed when team membership or team permissions change. If you change permissions and a user does not see the change immediately, have them reload.

## Recipes

**A team that only watches.** Create the team, add the `Viewer` role, or the per-area `*Viewer` roles for just the areas they should see.

**On-call engineers who manage their own services.** Give the team `MonitorAdmin`, `IncidentMember` and `OnCallMember` scoped to **Owned**, then add the team as owner of the monitors it runs.

**Contractors kept away from production.** Give the team the roles it needs at **All** scope, then add a **block permission** for the sensitive capabilities, restricted to the `Production` label.

**A CI pipeline that only reports deployments.** Create an API key with just the granular permissions it needs — no roles.

**Someone who should not see billing.** Do not add them to the Owners team. `ProjectAdmin` already excludes billing.

## Next

- [Permission Reference](/docs/permissions/reference) — every role and every granular permission, generated from the OneUptime source.
- [SSO](/docs/identity/sso) and [SCIM](/docs/identity/scim) — authentication and automatic user provisioning.
- [API Reference](/docs/api-reference/api-reference) — using permissions from the API.
