# Rename `serviceId` → `primaryEntityId` (Telemetry Analytics) — Implementation Plan

Status: Proposal
Owner: TBD
Last updated: 2026-06-09

> **Decisions locked (2026-06-09):**
> 1. **Hard rename — no deprecated getters.** No `get serviceId()` shim on the models.
> 2. **No data migrations for now.** No `INSERT…SELECT` copy, no swap. Forward-only via schema-sync; old tables are parked and self-drain via TTL.
> 3. **No API alias — sunset `serviceId` now.** Clean break: the analytics API speaks only `primaryEntityId`/`primaryEntityType`. This is a **breaking API change** and pulls the **frontend into scope** (it is no longer shielded).
> 4. **Rename the adjacent Postgres fields too** (`TelemetryException`, `TelemetryUsageBilling`) for consistency — see the migration caveat in [§Postgres](#e-postgres-adjacent-fields-decision-4).

## Summary

`serviceId` / `serviceType` is a misnomer: it is a **polymorphic primary-entity pointer** (Service / Host / DockerHost / KubernetesCluster / Monitor / RUM app / projectId fallback), not a service id. This plan hard-renames it to **`primaryEntityId` / `primaryEntityType`** across the stack, with **no backward-compat alias** and **no data-migration**. Semantics are byte-for-byte; only the name changes. The column is **kept** (not dropped, not replaced by `entityKeys` — see [`OpenTelemetryEntities.md`](./OpenTelemetryEntities.md)).

The four decisions above make this **simpler in infrastructure** (no alias facility, no copy/swap migration) but **broader in code** (frontend now in scope, external API contract breaks, Postgres models renamed). Net trade: a clean, atomic, breaking rename instead of a long aliased deprecation.

**The forward-only principle (from decision 2):** nothing is altered in place and no data is moved. Each ClickHouse object whose shape changes gets a **new versioned name**; boot-time schema-sync (`createTables` / `createMaterializedViews` — these are `CREATE … IF NOT EXISTS`, *not* `DataMigration`s) creates it fresh; the old object is **left in place (parked), not dropped**, and drains itself via its existing `retentionDate` TTL over one retention window. This is self-healing for short-retention telemetry: within ~one retention period, the new table holds a full window and the parked one is empty.

Scope facts (verified by code audit; citations below):
- **Physical ClickHouse column name == model column `key`.** Renaming the `key` renames the column and all generated SQL.
- **Generated SQL injects the raw request key**, so a rename is all-or-nothing per query — there is no partial/aliased middle state (which is consistent with decision 3).
- **The permission layer is column-agnostic** — one hardcoded `"serviceId"` literal + 6 decorator strings.

> **Verify line numbers at edit time** — citations are architecture-accurate; exact lines may have drifted.

---

## Scope

**Rename `serviceId`→`primaryEntityId`, `serviceType`→`primaryEntityType` in (verified to actually have the column):**

- **Signal tables (6):** `Log`, `Metric`, `Span`, `ExceptionInstance`, `Profile`, `ProfileSample` — each defines the column and carries `@OwnedThrough("serviceId", …)`.
- **MV tables (2):** `MetricItemAggMV1m`, `MetricBaselineHourly` — `serviceId` in sort/primary keys + the `materializedViews[].query`.
- **Postgres models (2, decision 4):** `TelemetryException`, `TelemetryUsageBilling`.
- All read/write/permission/billing/frontend code touching those columns.

**Confirmed NOT affected (no `serviceId` column — do not touch):**
- `MonitorLog` (keyed by `monitorId`), `AuditLog` (keyed by `resourceType`/`resourceId`), `MetricItemAggMV1mByHost` (keyed by `hostIdentifier`).

**Out of scope:** the partition-key change and `entityKeys` columns (separate docs); access-control *semantics*; the `ServiceType` **enum** ([`Common/Types/Telemetry/ServiceType.ts`](../../Common/Types/Telemetry/ServiceType.ts)) — keep as-is; `primaryEntityType` remains typed by it (its values are unchanged).

---

## Verified mechanics (the audit)

| Fact | Evidence | Consequence |
|---|---|---|
| CH column name = model `key` | [`StatementGenerator`](../../Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts) `toColumnsCreateStatement` (`const keyStatement = column.key`, ≈L989) | Rename the model `key` → column + DDL + SQL all follow. |
| Query keys injected raw into SQL | `toSelectStatement` (`SQL\`${key}\``, ≈L878), `toSortStatement` (≈L846), `toWhereStatement` (≈L414), `toGroupByStatement` (≈L821), `toAggregateSelectStatement` (≈L933) | A query referencing `serviceId` after the rename errors with "Unknown column" — so frontend + all callers must switch in lockstep (decision 3). |
| Permission scope is dynamic | `OwnedScopePermission.addOwnedScopeToQuery` reads `model.ownedThrough.fkColumn` (≈L128/137); analytics `ModelPermission` (≈L827/834/889) | No scope-code edits; just the decorator strings + one registry entry. |
| One hardcoded literal | [`OwnerTableRegistry`](../../Common/Server/Types/Database/Permissions/OwnerTableRegistry.ts) `fkColumn: "serviceId"` (L157) | Single-line change. |
| `RENAME COLUMN` impossible here | `serviceId` is in the sort/primary key; ClickHouse forbids renaming a key column | Confirms forward-only **new table** is the only no-migration path (decision 2). |

---

## Approach: hard rename, no alias (decisions 1 & 3)

There is **no `apiAliases` field, no key-remap layer, no dual-emit**. The API speaks `primaryEntityId` only. Consequences, all accepted:

- **Breaking API change, effective immediately.** External consumers, saved dashboards, and alert rules that send/read `serviceId` in telemetry queries will break and must update to `primaryEntityId`. Needs a release note / changelog entry.
- **Frontend is in scope and must ship atomically** with the backend — see [§D](#d-frontend-now-in-scope-decision-3).
- **No deprecated getters** — `get serviceId()` is removed; all server code uses `.primaryEntityId`.
- The optional ClickHouse `ALIAS` column escape hatch is **not** used (decision 3 = clean break).

---

## Forward-only migration model (decision 2)

No `DataMigration` is written. The transition is purely a model/enum change picked up by boot schema-sync:

1. **Bump the table name** in [`AnalyticsTableName`](../../Common/Types/AnalyticsDatabase/AnalyticsTableName.ts) for each renamed table (e.g. `Log = "LogItemV3"`, `Metric = "MetricItemV3"`, … and new MV target/trigger names like `MetricItemAggMV1mV2` / `…_mv2`). *(Enum edit, not a migration.)*
2. **Update the model** — column `key`s, getters/setters, `sortKeys`/`primaryKeys`, `@OwnedThrough`, and the MV `materializedViews[].query` (new source table + `primaryEntityId`).
3. **Boot creates the fresh objects** — `AnalyticsTableManagement.createTables()` and `createMaterializedViews()` ([`App/FeatureSet/Workers/Index.ts`](../../App/FeatureSet/Workers/Index.ts) ≈L216/226) run `CREATE … IF NOT EXISTS` from the updated models. No migration code.
4. **Old objects are parked, not dropped.** The previous `…V2` tables / `…_mv` views remain physically present, stop receiving writes (the model now points at the new name), and **self-drain via their existing `retentionDate` TTL**. A future optional cleanup can `DROP` them once empty.

**Consequence to confirm:** on existing installs, pre-cutover telemetry history becomes **temporarily invisible** (it's parked in the old table, not deleted) and ages out over one retention window while the new table fills. For these short-retention signal tables this self-heals in ~days–weeks. **Nothing is deleted**, so this is also rollback-friendly. (A copy migration to carry history forward is explicitly **deferred** per decision 2 — it can be added later if a customer needs zero-gap history.)

---

## Change inventory by subsystem

### A. Analytics models (6 signal + 2 MV)
[`Common/Models/AnalyticsModels/`](../../Common/Models/AnalyticsModels/): `Log`, `Metric`, `Span`, `ExceptionInstance`, `Profile`, `ProfileSample`, `MetricItemAggMV1m`, `MetricBaselineHourly`:
- `key: "serviceId"` → `"primaryEntityId"`; `key: "serviceType"` → `"primaryEntityType"` (no `apiAliases`).
- **Hard-rename** getters/setters (no `serviceId` shim).
- `sortKeys` / `primaryKeys`: `"serviceId"` → `"primaryEntityId"`.
- `@OwnedThrough("serviceId", …)` → `@OwnedThrough("primaryEntityId", …)` (6 signal models).
- MV `materializedViews[].query`: `serviceId` → `primaryEntityId`, source `MetricItemV2` → `MetricItemV3`.

### B. Permissions
- [`OwnerTableRegistry`](../../Common/Server/Types/Database/Permissions/OwnerTableRegistry.ts) L157 `fkColumn: "serviceId"` → `"primaryEntityId"` (+ comments). No other permission-code change.

### C. Server: types, ingest, writers, billing
- `TelemetryServiceMetadata` interface + `OtelIngestBaseService.resolveTelemetryResource` (rename produced fields).
- Ingest write-sites (build*Row): `OtelMetricsIngestService` (≈L2119), `OtelTracesIngestService` (≈L952/999), `OtelLogsIngestService` (≈L683/972), `OtelProfilesIngestService` (≈L983/1040), `MonitorMetricUtil` (≈L139).
- Programmatic writers: [`AlertService`](../../Common/Server/Services/AlertService.ts) (4 metrics), [`IncidentService`](../../Common/Server/Services/IncidentService.ts) (7 metrics) — covered by the model setter rename.
- Billing raw SQL: [`AnalyticsDatabaseService.groupTelemetryUsageByService`](../../Common/Server/Services/AnalyticsDatabaseService.ts) (≈L482) `serviceId`/`serviceType` → `primaryEntityId`/`primaryEntityType`.

### D. Frontend (now in scope — decision 3)
~50 files in `App/FeatureSet/Dashboard/src` (queries: select/where/sort/groupBy/facetKey; model reads `.serviceId`; navigation). All reference the telemetry `serviceId` (no collision with the status-page `Service` model). Because there is **no alias**, every one must switch to `primaryEntityId` and ship in the **same release** as the backend. High-traffic: `LogsViewer`, `TracesViewer`, `TraceExplorer`, `SpanUtil`, `MetricsViewer`, `TraceTable`, `TraceDetailPanel`, `FlameGraph`.

### E. Postgres adjacent fields (decision 4)
- [`TelemetryException`](../../Common/Models/DatabaseModels/TelemetryException.ts) and [`TelemetryUsageBilling`](../../Common/Models/DatabaseModels/TelemetryUsageBilling.ts): rename `serviceId`/`serviceType` columns + getters/setters + read/write sites (e.g. `TelemetryExceptionService`, `TelemetryUsageBillingService` write path).
- **⚠️ Migration caveat vs decision 2:** a Postgres column rename **requires a generated schema migration** (`npm run generate-postgres-migration`, registered in [`SchemaMigrations/Index.ts`](../../Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts)) — there is no schema-sync for Postgres column renames. This is a small, standard, metadata-only migration, **not** the heavy ClickHouse data-copy that decision 2 defers. **Confirm:** does "no migrations for now" permit this small Postgres rename migration (recommended — it's the only way to do #4), or should the Postgres rename also be deferred (leaving those two models on `serviceId` for now)?

---

## Phasing & verification gates

No alias phase. The rename is one coordinated change; ship the code rename and the ClickHouse name-bump together.

| Phase | Work | Gate |
|---|---|---|
| **1. Code rename (atomic)** | §A models (keys/getters/sortkeys/`@OwnedThrough`), §B registry, §C server/ingest/writers/billing, §D **frontend**, §E Postgres models + migration. | Build/type-check green; permission tests (`primaryEntityId IN (:allowed)`); no `serviceId` left in analytics read/write paths (grep gate). |
| **2. ClickHouse name-bump (schema-sync)** | `AnalyticsTableName` → V3 for the 6 signal tables; new MV target/trigger names; new partition key + entity columns may co-land here. Boot creates fresh; old tables parked. | New writes land in V3; reads return post-cutover data; old V2 parked & TTL-draining; sample queries succeed with `primaryEntityId`. |
| **3. MV recreate** | New-named MV targets/triggers created fresh by `createMaterializedViews()`; old MVs parked. | Dashboard scalar charts repopulate forward (rollup history resets — expected; MVs never backfilled). |
| **4. Verify & announce** | E2E across traces/logs/metrics/profiles/exceptions UIs (now renamed); confirm permissions/billing; **publish breaking-change note** for the `serviceId` API sunset. | Frontend works on `primaryEntityId`; external API documented as breaking. |

Co-sequencing: this rename, the partition-key change, and the `entityKeys` columns can all land in the **same V3 name-bump** (Phase 2) since none requires a data migration under decision 2 — one fresh schema, one cutover.

---

## Rollback

Forward-only makes rollback clean: the old `…V2` tables are **parked, not dropped**, so reverting the enum/model back to V2 restores reads/writes against intact historical data. Code phases revert by reverting the commit. The Postgres rename rolls back with a down-migration.

---

## Risks & mitigations

- **Breaking API change (accepted, decision 3).** External `serviceId` consumers break immediately. *Mitigation:* prominent changelog/release note; this is the explicit trade for a clean break.
- **Lockstep frontend.** A backend deploy without the matching frontend breaks the UI. *Mitigation:* ship §A–§E in one release; grep-gate for stray `serviceId`.
- **History gap on existing installs (accepted, decision 2).** Pre-cutover telemetry is parked & invisible until it TTL-drains. *Mitigation:* communicate; it self-heals within one retention window; a copy migration can be added later if needed.
- **MV rollup reset.** Expected (MVs never backfilled). *Mitigation:* sequence MV recreate last.
- **Postgres-migration tension (§E).** Needs the open-question answer before that slice proceeds.

---

## Open / confirm items

1. **§E Postgres rename vs "no migrations"** — permit the small standard Postgres column-rename migration (recommended), or defer the Postgres rename too?
2. **Co-land partition + entity columns in the same V3 cut?** (Recommended — one cutover, no extra migration cost under decision 2.)
3. **Breaking-change comms** — where to announce the `serviceId` API sunset (API reference + changelog + upgrade notes)?

## Non-Goals

- Backward-compat alias / deprecated getters (explicitly rejected — decisions 1 & 3).
- Data-copy / swap migrations (deferred — decision 2).
- Partition-key change & `entityKeys` columns themselves (separate docs; co-sequenced only).
- Renaming the `ServiceType` enum or touching `MonitorLog`/`AuditLog`/`MetricItemAggMV1mByHost`.

## References

- Internal: [`ClickHousePartitioningAndScaling.md`](./ClickHousePartitioningAndScaling.md), [`OpenTelemetryEntities.md`](./OpenTelemetryEntities.md), [`PermissionsSimplification.md`](./PermissionsSimplification.md).
- Code: [`StatementGenerator.ts`](../../Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts), [`BaseAnalyticsAPI.ts`](../../Common/Server/API/BaseAnalyticsAPI.ts), [`CommonModel.ts`](../../Common/Models/AnalyticsModels/AnalyticsBaseModel/CommonModel.ts), [`OwnerTableRegistry.ts`](../../Common/Server/Types/Database/Permissions/OwnerTableRegistry.ts), [`AnalyticsTableName.ts`](../../Common/Types/AnalyticsDatabase/AnalyticsTableName.ts), [`DataMigrations/`](../../App/FeatureSet/Workers/DataMigrations/).
