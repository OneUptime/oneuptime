# Permissions Simplification: Owner-Based Access Control

Status: Proposal
Owner: TBD
Last updated: 2026-05-14

## Summary

Today, scoping team access to specific resources requires applying labels to every resource and creating matching label-scoped `TeamPermission` rows. This is operationally heavy: labels drift, get forgotten, and are applied inconsistently. Every major resource already carries `*OwnerTeam` and `*OwnerUser` relations (used today mostly for notifications), and `OwnerRule` can auto-assign owners based on conditions.

This document proposes:

1. Adding a **scope** field to `TeamPermission` (`All` | `OwnedByTeam` | `Labels`).
2. Introducing **wildcard `AllResources` permissions** (`ReadAllResources`, `EditAllResources`, `DeleteAllResources`, `CreateAllResources`) so a team's full operator role is 4 rows, not 30+.
3. Inheriting ownership for **nested resources** through a parent FK via an `@OwnedThrough(...)` decorator.
4. Exposing **role bundles** in the UI (Viewer / Operator / Admin) so most users never see individual permission enums.

Labels-as-permissions stay supported for advanced/legacy use; they are no longer the default path.

---

## Problem

The current `TeamPermission` row is:

```
(team, permission, labels[], isBlock)
```

To give "Team A read-only on resources Team A owns," an admin today must:

1. Tag every relevant resource with a Team-A-specific label.
2. Maintain those labels as resources are created.
3. Create one `TeamPermission` row per `Read*` permission, each carrying the label.
4. Repeat for every resource family (Monitor, Incident, Alert, StatusPage, Runbook, Dashboard, ...).

Symptoms:

- Heavy upfront setup and ongoing drift.
- Two parallel concepts of "ownership" (labels and `*OwnerTeam`) that mean similar things.
- Hard to reason about: a missing label silently denies access.
- Block-list semantics confuse users who only want allow-list behavior.

`*OwnerTeam` already exists for every major resource. We can collapse the two concepts.

---

## Proposed Design

### 1. Permission scope

Add a `scope` enum to `TeamPermission`:

| Scope | Behavior |
|---|---|
| `All` | Permission applies to every resource in the project. Default for admin-style teams. |
| `OwnedByTeam` | Permission applies only to resources where this team is in the resource's `*OwnerTeam` table. Default for member-style teams. |
| `Labels` | Existing allow/block-list label semantics. Reserved for advanced users. |

`scope` is per row (i.e., per `(team, permission)` tuple), so different operations can have different scopes:

```
(DBA team, ReadMonitor,   All)            -- read all monitors
(DBA team, EditMonitor,   OwnedByTeam)    -- edit only owned monitors
(DBA team, DeleteMonitor, OwnedByTeam)    -- delete only owned monitors
```

### 2. `AllResources` wildcard permissions

Four new permissions covering the operational resource surface:

- `ReadAllResources` (promotes the existing `ReadAllProjectResources`)
- `EditAllResources`
- `DeleteAllResources`
- `CreateAllResources`

These do **not** cover settings/admin resources (Team, TeamPermission, Project settings, Billing, Integrations). Each model is annotated with `@OperationalResource()` or not; the wildcard short-circuit only applies to those.

In `TablePermission.checkTableLevelPermissions`, add a short-circuit: if the user has the matching `*AllResources` permission for the requested operation, and the model is `@OperationalResource()`, table-level access is granted. The owner-scope filter (if any) still applies on top. This is a single code-path change, not per-model edits.

### 3. Nested resources

Resources like `MonitorStatusTimeline`, `MonitorProbe`, `MonitorFeed` are nested under `Monitor` via FK. Add an `@OwnedThrough("monitorId", Monitor)` decorator on the nested model. The permission check resolves ownership by walking the FK one hop: "if the team owns the Monitor referenced by `monitorId`, they own this entry."

Default rule: ownership inherits from the parent. Cross-cutting nested resources (rare) can override.

### 4. Role bundles (UI layer only)

The backend stays granular. The UI exposes preset role bundles:

| Role | Bundle |
|---|---|
| Viewer | `ReadAllResources` |
| Editor | `ReadAllResources` + `EditAllResources` |
| Operator | `ReadAllResources` + `EditAllResources` + `DeleteAllResources` + `CreateAllResources` |
| Admin | Above + settings permissions, typically with `scope = All` |

Picking a bundle writes the corresponding `TeamPermission` rows. Users can still drop to "advanced mode" to edit rows individually.

---

## Permission Check Flow (after change)

For a request like `PATCH /monitor/:id`:

1. **Public/auth** — user is logged in. (Unchanged.)
2. **Billing** — plan permits this operation. (Unchanged.)
3. **Table-level** — user has one of:
   - the model's enumerated `update` permissions, OR
   - `EditAllResources` (if model is `@OperationalResource()`).
4. **Scope** — for each matching permission row:
   - `All` → pass.
   - `OwnedByTeam` → fetch resource (and walk `@OwnedThrough` for nested), check user's teams intersect the resource's owner teams.
   - `Labels` → existing label-match logic.
5. **Block** — if any block-permission applies via Labels mode, deny.
6. **Column-level** — existing per-column access control. (Unchanged.)

At query time (`GET /monitor`), step 4 contributes a WHERE clause: `MonitorOwnerTeam.teamId IN (:userTeams)` for `OwnedByTeam` rows.

---

## Worked Examples

### Customer ask: "Team A read-only on what they own; Team B read-write on what they own."

**Configured via UI (two clicks per team):**

```
Team A:  Viewer    /  Owned by this team
Team B:  Operator  /  Owned by this team
```

**Backing data:**

```
TeamPermission rows for Team A:
  (Team A, ReadAllResources,   OwnedByTeam)

TeamPermission rows for Team B:
  (Team B, ReadAllResources,   OwnedByTeam)
  (Team B, EditAllResources,   OwnedByTeam)
  (Team B, DeleteAllResources, OwnedByTeam)
  (Team B, CreateAllResources, OwnedByTeam)
```

**Behavior:**

- Team A member lists monitors → sees only monitors where Team A is in `MonitorOwnerTeam`.
- Team A member tries to edit a monitor → denied (no Edit row).
- Team B member creates a monitor → succeeds; Team B auto-added to `MonitorOwnerTeam`.
- Team B member edits a monitor they own → succeeds.
- Team B member edits a monitor owned only by Team A → denied.

### Nested resource example

Team B member updates a `MonitorStatusTimeline` entry whose `monitorId` points to a monitor owned by Team B.

- Table-level: user has `EditAllResources`, `MonitorStatusTimeline` is `@OperationalResource()` → pass.
- Scope: `@OwnedThrough("monitorId", Monitor)` resolves ownership via the parent monitor. Team B owns the parent → pass.

No new permission, no separate config.

---

## Edge Cases & Rules

### Create + OwnedByTeam

A resource can't be owner-scoped before it exists. Rule: `CreateAllResources` (and any `Create*` permission) **ignores scope** and acts project-wide. On successful create, the creating user's primary team(s) are auto-added to the resource's `*OwnerTeam` table. This makes the immediately-following edit/delete work under `OwnedByTeam` scope.

If a team should be forbidden from creating at all, simply don't grant `Create*` permission to it.

### Unowned resources

A resource with no entries in `*OwnerTeam`:

- Invisible to teams whose access is exclusively `OwnedByTeam`.
- Visible to teams with `All` scope (admins).
- Migration creates default owners via `OwnerRule` for legacy data (see Migration section).

### User in multiple teams

Permissions union. A user in Team A and Team B sees Team A's read-only owned resources plus Team B's read-write owned resources. If a resource is owned by both teams, the more permissive grant wins.

### Cross-team handoff

To give Team A access to a Team B resource, add Team A to that resource's `*OwnerTeam` row. No permission edits required.

### Settings resources

Models without `@OperationalResource()` are not covered by `*AllResources`. Examples: Team, TeamPermission, Project, Label, Billing, Integration credentials. These remain governed by their explicit permission enums (`EditProjectTeamPermissions`, etc.).

### Block permissions

Block (`isBlockPermission`) is a `Labels` mode concept and stays that way. There is no `OwnedByTeam`-mode block; users wanting deny-lists must use Labels mode.

### Read defaults

Most ops teams want broad read + scoped write. The "Viewer" bundle uses `OwnedByTeam` by default but users can switch the read row to `All` while keeping write rows owner-scoped.

---

## Data Model Changes

### `TeamPermission` table

Add column:

```
scope ENUM('All','OwnedByTeam','Labels') NOT NULL DEFAULT 'Labels'
```

`Labels` is the default for existing rows to preserve behavior on upgrade.

### `Permission` enum (Common/Types/Permission.ts)

Add:

```
ReadAllResources       -- supersedes ReadAllProjectResources (keep as alias)
EditAllResources
DeleteAllResources
CreateAllResources
```

### Decorators

- `@OperationalResource()` — class decorator on models that should be covered by `*AllResources`.
- `@OwnedThrough(fkColumn, ParentModel)` — class decorator on nested models. Resolves ownership via the parent.

### Auto-owner-on-create

New rule in the create path: if scope-aware permissions are used and the creating user belongs to one or more teams, auto-insert the user's primary team into the resource's `*OwnerTeam` table. Mirrors the existing `OwnerRule` behavior.

---

## Migration

1. **Add `scope` field** with default `Labels`. Existing rows behave exactly as today.
2. **Ship `*AllResources` permissions** and the `TablePermission` short-circuit.
3. **Annotate models** with `@OperationalResource()` and nested models with `@OwnedThrough(...)`.
4. **Backfill legacy ownership** via a one-time migration: for resources with no owner team, optionally apply existing label-matching `OwnerRule` definitions to seed `*OwnerTeam` rows.
5. **UI rollout**: introduce the role-bundle picker as the default for new team permissions. Existing rows render in "advanced mode."
6. **Deprecation**: mark `ReadAllProjectResources` as alias of `ReadAllResources`. Schedule removal in a future major version.

No data is destroyed at any step. Customers using label-permissions continue to work.

---

## Open Questions

1. **Default scope for a brand-new project's "Members" team** — `OwnedByTeam` or `All`? Recommendation: `OwnedByTeam` only if owner auto-assignment is reliable; otherwise `All` to avoid empty-list surprises.
2. **Auto-owner-on-create granularity** — assign the user's *primary* team, *all* their teams, or just the creating user (`*OwnerUser`)? Leaning toward "user + their primary team."
3. **Read defaults in the Viewer bundle** — `OwnedByTeam` (matches the customer ask in this doc) or `All` with only writes scoped (matches typical ops-tool behavior)? Worth user research.
4. **`OwnerRule` overlap** — once owner-based permissions are standard, should `OwnerRule` UI surface "create permission" suggestions automatically?
5. **API-key/Probe access** — these use `DatabaseCommonInteractionProps` without team membership. They should likely default to `All` semantics. Confirm.

---

## Non-Goals

- Changing how labels work as organizational tags. Labels keep their non-permission use (filtering, grouping, dashboards).
- Replacing `OwnerRule`. It complements the new model by automating owner assignment.
- Changing column-level access control.
- Removing the `Labels` scope mode. It remains supported for advanced cases (deny-lists, cross-cutting permissions).
