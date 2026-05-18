# Permissions Simplification: Owner-Based Access Control

Status: Proposal
Owner: TBD
Last updated: 2026-05-14

## Summary

Today, scoping team access to specific resources requires applying labels to every resource and creating matching label-scoped `TeamPermission` rows. This is operationally heavy: labels drift, get forgotten, and are applied inconsistently. Every major resource already carries `*OwnerTeam` and `*OwnerUser` relations (used today mostly for notifications), and `OwnerRule` can auto-assign owners based on conditions.

This document proposes:

1. Adding a **scope** field to `TeamPermission` (`All` | `Owned` | `Labels`).
2. Introducing **wildcard `AllOperationalResources` permissions** (`ReadAllOperationalResources`, `EditAllOperationalResources`, `DeleteAllOperationalResources`, `CreateAllOperationalResources`) so a team's full operator role is 4 rows, not 30+.
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
| `Owned` | Permission applies to resources where the requesting user is in `*OwnerUser` OR this team is in `*OwnerTeam`. Default for member-style teams. |
| `Labels` | Existing allow/block-list label semantics. Reserved for advanced users. |

`scope` is per row (i.e., per `(team, permission)` tuple), so different operations can have different scopes:

```
(DBA team, ReadMonitor,   All)            -- read all monitors
(DBA team, EditMonitor,   Owned)    -- edit only owned monitors
(DBA team, DeleteMonitor, Owned)    -- delete only owned monitors
```

### 2. `AllOperationalResources` wildcard permissions

Four new permissions covering the operational resource surface:

- `ReadAllOperationalResources` (replaces the removed `ReadAllProjectResources`)
- `EditAllOperationalResources`
- `DeleteAllOperationalResources`
- `CreateAllOperationalResources`

These do **not** cover settings/admin resources (Team, TeamPermission, Project settings, Billing, Integrations). Each model is annotated with `@OperationalResource()` or not; the wildcard short-circuit only applies to those.

In `TablePermission.checkTableLevelPermissions`, add a short-circuit: if the user has the matching `*AllOperationalResources` permission for the requested operation, and the model is `@OperationalResource()`, table-level access is granted. The owner-scope filter (if any) still applies on top. This is a single code-path change, not per-model edits.

### 3. Nested resources

Resources like `MonitorStatusTimeline`, `MonitorProbe`, `MonitorFeed` are nested under `Monitor` via FK. Add an `@OwnedThrough("monitorId", Monitor)` decorator on the nested model. The permission check resolves ownership by walking the FK one hop: "if the team owns the Monitor referenced by `monitorId`, they own this entry."

Default rule: ownership inherits from the parent. Cross-cutting nested resources (rare) can override.

### 4. Role bundles (UI layer only)

The backend stays granular. The UI exposes preset role bundles:

| Role | Bundle |
|---|---|
| Viewer | `ReadAllOperationalResources` |
| Editor | `ReadAllOperationalResources` + `EditAllOperationalResources` |
| Operator | `ReadAllOperationalResources` + `EditAllOperationalResources` + `DeleteAllOperationalResources` + `CreateAllOperationalResources` |
| Admin | Above + settings permissions, typically with `scope = All` |

Picking a bundle writes the corresponding `TeamPermission` rows. Users can still drop to "advanced mode" to edit rows individually.

---

## Permission Check Flow (after change)

For a request like `PATCH /monitor/:id`:

1. **Public/auth** — user is logged in. (Unchanged.)
2. **Billing** — plan permits this operation. (Unchanged.)
3. **Table-level** — user has one of:
   - the model's enumerated `update` permissions, OR
   - `EditAllOperationalResources` (if model is `@OperationalResource()`).
4. **Scope** — for each matching permission row:
   - `All` → pass.
   - `Owned` → fetch resource (and walk `@OwnedThrough` for nested); pass if the requesting user is in the resource's `*OwnerUser` table, OR if any of the user's teams is in the resource's `*OwnerTeam` table.
   - `Labels` → existing label-match logic.
5. **Block** — if any block-permission applies via Labels mode, deny.
6. **Column-level** — existing per-column access control. (Unchanged.)

At query time (`GET /monitor`), step 4 contributes a WHERE clause for `Owned` rows: `MonitorOwnerUser.userId = :userId OR MonitorOwnerTeam.teamId IN (:userTeams)`.

---

## Worked Examples

### Customer ask: "Team A read-only on what they own; Team B read-write on what they own."

**Configured via UI (two clicks per team):**

```
Team A:  Viewer    /  Owned
Team B:  Operator  /  Owned
```

**Backing data:**

```
TeamPermission rows for Team A:
  (Team A, ReadAllOperationalResources,   Owned)

TeamPermission rows for Team B:
  (Team B, ReadAllOperationalResources,   Owned)
  (Team B, EditAllOperationalResources,   Owned)
  (Team B, DeleteAllOperationalResources, Owned)
  (Team B, CreateAllOperationalResources, Owned)
```

**Behavior:**

- Team A member lists monitors → sees monitors where Team A is in `MonitorOwnerTeam`, plus any monitors where the member is personally in `MonitorOwnerUser`.
- Team A member tries to edit a monitor → denied (no Edit row).
- Team B member creates a monitor → succeeds; the **creating user** is auto-added to `MonitorOwnerUser`. Team B is not auto-added; teams are populated via explicit configuration or `OwnerRule`.
- Team B member edits a monitor they own — either personally via `MonitorOwnerUser`, or via their team in `MonitorOwnerTeam` → succeeds.
- Team B member edits a monitor owned only by Team A → denied.

### Nested resource example

Team B member updates a `MonitorStatusTimeline` entry whose `monitorId` points to a monitor owned by Team B.

- Table-level: user has `EditAllOperationalResources`, `MonitorStatusTimeline` is `@OperationalResource()` → pass.
- Scope: `@OwnedThrough("monitorId", Monitor)` resolves ownership via the parent monitor. Team B owns the parent → pass.

No new permission, no separate config.

---

## Telemetry & Analytics Resources

Telemetry data — `Log`, `Span`, `Metric` in `Common/Models/AnalyticsModels/` — lives in ClickHouse via `AnalyticsBaseModel`, not Postgres. Queries go through `AnalyticsDatabaseService`, which does **not** invoke `TablePermission.checkTableLevelPermissions`. The operational-resource pipeline above doesn't auto-apply; two adjustments are needed for the new permission model to extend cleanly.

### Ownership inherits via `serviceId`

Each telemetry record carries a `serviceId` FK pointing at `Service` (the TelemetryService). `Service` already has `ServiceOwnerUser` / `ServiceOwnerTeam`. Annotate the analytics models:

```
@OwnedThrough("serviceId", Service)
```

Same decorator used for nested Postgres resources (e.g., `MonitorStatusTimeline`); the analytics path interprets it via its own resolver.

### `*AllOperationalResources` coverage

Log, Span, and Metric are marked `@OperationalResource()`. They count toward `ReadAllOperationalResources` / `EditAllOperationalResources` / `DeleteAllOperationalResources` / `CreateAllOperationalResources`.

The wildcard short-circuit, which today only fires inside `TablePermission`, must be mirrored in `AnalyticsDatabaseService` so analytics queries pick it up. Same logic, parallel location.

### Query-time scope filter

The operational per-row owner-join pattern (`MonitorOwnerUser.userId = :userId OR MonitorOwnerTeam.teamId IN (:userTeams)`) doesn't scale to billions of telemetry rows. For analytics queries the pattern is:

1. **Resolve allowed service IDs once per request.** Run a single Postgres query against `ServiceOwnerUser` / `ServiceOwnerTeam` for the caller and cache the result on the request context.

   ```sql
   -- Conceptually:
   SELECT id FROM Service
   WHERE projectId = :projectId
     AND (id IN (SELECT serviceId FROM ServiceOwnerUser WHERE userId = :userId)
          OR id IN (SELECT serviceId FROM ServiceOwnerTeam WHERE teamId IN (:userTeams)))
   ```

2. **Inject `WHERE serviceId IN (:allowedServiceIds)`** on every ClickHouse query the analytics pipeline produces.

For callers where `Owned` evaluates as `All` — admins with `scope = All`, API keys, Probes — the filter is skipped entirely.

One Postgres roundtrip resolves access for the whole request; the ClickHouse predicate is over an indexed column.

### Granularity

Existing per-data-type permissions stay (`ReadTelemetryServiceLog`, `ReadTelemetryServiceTraces`, `ReadTelemetryServiceMetrics`). `*AllOperationalResources` is additive on top — both paths grant access. Existing label-mode rows continue to work because the analytics path always evaluates scope before returning rows.

---

## Edge Cases & Rules

### Create + Owned

A resource can't be owner-scoped before it exists. Rule: `CreateAllOperationalResources` (and any `Create*` permission) **ignores scope** and acts project-wide. On successful create, the **creating user** is auto-added to the resource's `*OwnerUser` table (not their team). Because the `Owned` scope check also matches user-ownership (see §Proposed Design §1), the creator can immediately edit/delete their resource. Teams are populated separately, via explicit configuration or `OwnerRule`.

If a team should be forbidden from creating at all, simply don't grant `Create*` permission to it.

### Unowned resources

A resource with no entries in `*OwnerUser` AND no entries in `*OwnerTeam`:

- Invisible to teams whose access is exclusively `Owned`.
- Visible to teams with `All` scope (admins).
- No automatic backfill runs at migration time. Customers who want resources to land with default owners should define `OwnerRule` entries.

### User in multiple teams

Permissions union. A user in Team A and Team B sees Team A's read-only owned resources plus Team B's read-write owned resources. If a resource is owned by both teams, the more permissive grant wins.

### Cross-team handoff

To give Team A access to a Team B resource, add Team A to that resource's `*OwnerTeam` row. No permission edits required.

### Settings resources

Models without `@OperationalResource()` are not covered by `*AllOperationalResources`. Examples: Team, TeamPermission, Project, Label, Billing, Integration credentials. These remain governed by their explicit permission enums (`EditProjectTeamPermissions`, etc.).

### Non-user callers (API keys, Probes)

API keys and Probes call into the database layer via `DatabaseCommonInteractionProps` but carry no team membership. For these callers, the `Owned` scope evaluates as `All` — owner-based scoping is bypassed. Access is still gated by the permission set on the props (e.g., an API key without `EditMonitor` cannot edit monitors, regardless of scope).

### Block permissions

Block (`isBlockPermission`) is a `Labels` mode concept and stays that way. There is no `Owned`-mode block; users wanting deny-lists must use Labels mode.

### Read defaults

Most ops teams want broad read + scoped write. The "Viewer" bundle uses `Owned` by default but users can switch the read row to `All` while keeping write rows owner-scoped.

---

## Data Model Changes

### `TeamPermission` table

Add column:

```
scope ENUM('All','Owned','Labels') NOT NULL DEFAULT 'Labels'
```

`Labels` is the default for existing rows to preserve behavior on upgrade.

### `Permission` enum (Common/Types/Permission.ts)

Add:

```
ReadAllOperationalResources       -- replaces the removed ReadAllProjectResources
EditAllOperationalResources
DeleteAllOperationalResources
CreateAllOperationalResources
```

### Decorators

- `@OperationalResource()` — class decorator on models that should be covered by `*AllOperationalResources`.
- `@OwnedThrough(fkColumn, ParentModel)` — class decorator on nested models. Resolves ownership via the parent.

### Auto-owner-on-create

New rule in the create path: auto-insert the creating user into the resource's `*OwnerUser` table. No team auto-assignment — teams are populated separately, via explicit configuration or `OwnerRule`. Mirrors the existing `OwnerRule` behavior for user assignment.

### Interaction props

`DatabaseCommonInteractionProps` (and the embedded `UserTenantAccessPermission`) carries the caller's permissions today but not their team membership. Add:

```
userTeamIds: ObjectID[]
```

populated at request authentication. The `Owned` scope check consumes this to evaluate "any of the user's teams is in the resource's `*OwnerTeam`."

For non-user callers (API keys, Probes), `userTeamIds` is absent and `Owned` evaluates as `All` (see Edge Cases).

---

## Migration

1. **Add `scope` field** with default `Labels`. Existing rows behave exactly as today.
2. **Ship `*AllOperationalResources` permissions** and the `TablePermission` short-circuit.
3. **Annotate models** with `@OperationalResource()` and nested models with `@OwnedThrough(...)`.
4. **Thread `userTeamIds` through `DatabaseCommonInteractionProps`** so `Owned` scope can be evaluated cheaply per request.
5. **UI rollout**: introduce the role-bundle picker as the default for new team permissions. Existing rows render in "advanced mode."

**No data migration runs.** Existing `TeamPermission` rows default to `scope = Labels` and behave exactly as today. Customers who want owner-based scoping opt in by creating new rows with `scope = Owned`; they populate `*OwnerUser` / `*OwnerTeam` via manual configuration or `OwnerRule`. No one-time backfill of owner tables is performed.

---

## Resolved Decisions

Recorded so future readers don't relitigate them.

1. **Scope name** → `Owned` (renamed from `OwnedByTeam`). The check matches user-ownership OR team-ownership; the shorter name reflects that.
2. **Auto-owner-on-create granularity** → Insert the **creating user** into `*OwnerUser` only. Do not auto-assign teams. The `Owned` scope check also matches user-ownership, so the creator can immediately edit/delete their own resource. Teams are populated explicitly or via `OwnerRule`.
3. **API-key/Probe access** → For non-user callers (no team membership in `DatabaseCommonInteractionProps`), the `Owned` scope evaluates as `All`. The permission set on the props still gates access.
4. **No data migration** → Existing rows default to `scope = Labels` and keep working unchanged. New `Owned` rows are opt-in. No one-time backfill of `*OwnerUser` / `*OwnerTeam` is performed.
5. **Threading team membership** → `DatabaseCommonInteractionProps` gains a `userTeamIds: ObjectID[]` field populated at request authentication, consumed by the `Owned` scope check.
6. **Default scope for a brand-new project's "Members" team** → `Owned`. With auto-owner-on-create assigning the creating user, resources the user created themselves are always visible under `Owned`. The remaining empty-list risk ("resources I didn't create and no one assigned to me/my team") is acceptable for member-style teams.
7. **Default scope per role bundle in the UI** → `Owned` for every bundle (Viewer / Editor / Operator). Single uniform default, least-privilege by default, matches the canonical customer ask in this doc. The day-one empty-list UX (e.g., a new Viewer who hasn't been assigned ownership of anything) is addressed via UI empty-state copy, not by widening the default scope.
8. **`ReadAllProjectResources` removed** → The deprecated `ReadAllProjectResources` enum value and its runtime alias have been removed. `ReadAllOperationalResources` is the sole wildcard for read access across operational resources.
9. **Telemetry / analytics permissions** → Log, Span, and Metric inherit ownership via `@OwnedThrough("serviceId", Service)` and are `@OperationalResource()` (covered by `*AllOperationalResources`). The wildcard short-circuit and `Owned` scope check are mirrored in `AnalyticsDatabaseService` as a parallel path. At query time, the user's allowed service IDs are resolved **once per request** from `ServiceOwnerUser` / `ServiceOwnerTeam`, then injected as `WHERE serviceId IN (...)` on every ClickHouse query — not per-row owner joins, which don't scale to telemetry volume.

## Open Questions

1. **`OwnerRule` overlap** — once owner-based permissions are standard, should `OwnerRule` UI surface "create permission" suggestions automatically? Not a blocker for first ship.

---

## Non-Goals

- Changing how labels work as organizational tags. Labels keep their non-permission use (filtering, grouping, dashboards).
- Replacing `OwnerRule`. It complements the new model by automating owner assignment.
- Changing column-level access control.
- Removing the `Labels` scope mode. It remains supported for advanced cases (deny-lists, cross-cutting permissions).
