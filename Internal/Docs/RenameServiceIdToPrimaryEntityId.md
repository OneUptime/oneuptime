# Rename `serviceId` → `primaryEntityId` (Telemetry Analytics) — Implementation Plan

Status: Proposal
Owner: TBD
Last updated: 2026-06-09

> **Decisions locked (2026-06-09):**
> 1. **Hard rename — no deprecated getters.** No `get serviceId()` shim on the models.
> 2. **Use migrations (revised).** Postgres **schema migrations** handle the column rename; a ClickHouse **data migration** copies `…V2 → …V3` with the rename applied in-flight, so **in-retention history is preserved (no gap)**.
> 3. **No API alias — sunset `serviceId` now.** Clean break: the analytics API speaks only `primaryEntityId`/`primaryEntityType`. This is a **breaking API change** and pulls the **frontend into scope** (no longer shielded).
> 4. **Rename the adjacent Postgres fields too** (`TelemetryException`, `TelemetryUsageBilling`) for consistency — via a standard Postgres schema migration.

## Summary

`serviceId` / `serviceType` is a misnomer: it is a **polymorphic primary-entity pointer** (Service / Host / DockerHost / KubernetesCluster / Monitor / RUM app / projectId fallback), not a service id. This plan hard-renames it to **`primaryEntityId` / `primaryEntityType`** across the stack, with **no backward-compat alias**. Semantics are byte-for-byte; only the name changes. The column is **kept** (not dropped, not replaced by `entityKeys` — see [`OpenTelemetryEntities.md`](./OpenTelemetryEntities.md)).

The four decisions make this a clean, atomic, **breaking** rename (no aliased deprecation) with **history preserved** via a copy migration. It is simpler than an aliased rollout (no alias facility) but broader in code (frontend in scope, external API contract breaks, Postgres models renamed).

**Migration model (decision 2):** the rename can't be done in place — `serviceId` is in the sort/primary key, and ClickHouse forbids renaming a key column. So each changed table gets a **new versioned name** (`…V3`); boot schema-sync (`createTables`) creates the empty V3 table, then a **ClickHouse data migration** copies `…V2 → …V3` with the rename applied in-flight (`serviceId AS primaryEntityId`), preserving in-retention history. V2 is dropped after a release as the rollback window. The Postgres rename uses a standard generated schema migration.

Scope facts (verified by code audit; citations below):
- **Physical ClickHouse column name == model column `key`.** Renaming the `key` renames the column and all generated SQL.
- **Generated SQL injects the raw request key**, so the rename is all-or-nothing per query — no partial/aliased state (consistent with decision 3).
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

**Out of scope:** the partition-key change and `entityKeys` columns (separate docs); access-control *semantics*; the `ServiceType` **enum** ([`Common/Types/Telemetry/ServiceType.ts`](../../Common/Types/Telemetry/ServiceType.ts)) — keep as-is; `primaryEntityType` stays typed by it (values unchanged).

---

## Verified mechanics (the audit)

| Fact | Evidence | Consequence |
|---|---|---|
| CH column name = model `key` | [`StatementGenerator`](../../Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts) `toColumnsCreateStatement` (`const keyStatement = column.key`, ≈L989) | Rename the model `key` → column + DDL + SQL all follow. |
| Query keys injected raw into SQL | `toSelectStatement` (`SQL\`${key}\``, ≈L878), `toSortStatement` (≈L846), `toWhereStatement` (≈L414), `toGroupByStatement` (≈L821), `toAggregateSelectStatement` (≈L933) | A query referencing `serviceId` after the rename errors with "Unknown column" — so frontend + all callers switch in lockstep (decision 3). |
| Permission scope is dynamic | `OwnedScopePermission.addOwnedScopeToQuery` reads `model.ownedThrough.fkColumn` (≈L128/137); analytics `ModelPermission` (≈L827/834/889) | No scope-code edits; just the decorator strings + one registry entry. |
| One hardcoded literal | [`OwnerTableRegistry`](../../Common/Server/Types/Database/Permissions/OwnerTableRegistry.ts) `fkColumn: "serviceId"` (L157) | Single-line change. |
| `RENAME COLUMN` impossible here | `serviceId` is in the sort/primary key; ClickHouse forbids renaming a key column | New `…V3` table + data-migration copy is the path (decision 2). |

---

## Approach: hard rename, no alias (decisions 1 & 3)

There is **no `apiAliases` field, no key-remap layer, no dual-emit**. The API speaks `primaryEntityId` only. Consequences, all accepted:

- **Breaking API change, effective immediately.** External consumers, saved dashboards, and alert rules that send/read telemetry `serviceId` must update to `primaryEntityId`. Needs a release note / changelog entry.
- **Frontend is in scope and must ship atomically** with the backend — see [§D](#d-frontend-in-scope-decision-3).
- **No deprecated getters** — `get serviceId()` is removed; all server code uses `.primaryEntityId`.

---

## Migrations (decision 2)

Two migration mechanisms, used for what each is good at.

### ClickHouse — data migration (copy `…V2 → …V3`)
1. **Bump the table name** in [`AnalyticsTableName`](../../Common/Types/AnalyticsDatabase/AnalyticsTableName.ts) for the 6 signal tables (e.g. `Log = "LogItemV3"`) and new MV target/trigger names.
2. **Update the model** — column `key`s, getters/setters, `sortKeys`/`primaryKeys`, `@OwnedThrough`, MV `materializedViews[].query` (new source + `primaryEntityId`). New partition key + `entityKeys` columns may co-land here.
3. **Boot creates the empty V3 tables** via `AnalyticsTableManagement.createTables()` ([`App/FeatureSet/Workers/Index.ts`](../../App/FeatureSet/Workers/Index.ts) ≈L216) — `CREATE … IF NOT EXISTS` from the model.
4. **Data migration copies V2 → V3** with the rename in-flight, following existing patterns in [`DataMigrations/`](../../App/FeatureSet/Workers/DataMigrations/) (extend `DataMigrationBase`, register in `Index.ts`):
   ```sql
   INSERT INTO LogItemV3
   SELECT projectId, serviceId AS primaryEntityId, serviceType AS primaryEntityType,
          time, /* …remaining cols…; entityKeys etc. default if co-landed… */
   FROM LogItemV2;
   ```
   - Batch by time window for large tables; track a watermark so a failed run is resumable (the framework records completion in Postgres and runs once — guard the copy as idempotent so a re-run after partial failure doesn't double-insert; `_id` is preserved).
5. **MV rebuild** — recreate the 2 MV targets/triggers on the V3 source via the established [`RebuildMetricMinuteAggregateMaterializedView`](../../App/FeatureSet/Workers/DataMigrations/RebuildMetricMinuteAggregateMaterializedView.ts) pattern (guard → drop → recreate target → recreate MV on `MetricItemV3` with `primaryEntityId`). MVs don't backfill (known behavior); rollup history resets — acceptable. Sequence last (perf-critical path).
6. **Drop V2** after a release as the rollback window (mirrors [`DeleteOldTelelmetryTable`](../../App/FeatureSet/Workers/DataMigrations/DeleteOldTelelmetryTable.ts)).

### Postgres — schema migration (column rename)
`TelemetryException`, `TelemetryUsageBilling`: rename `serviceId`/`serviceType` columns. Generate via `npm run generate-postgres-migration`, register in [`SchemaMigrations/Index.ts`](../../Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts). Small, metadata-only.

---

## Change inventory by subsystem

### A. Analytics models (6 signal + 2 MV)
[`Common/Models/AnalyticsModels/`](../../Common/Models/AnalyticsModels/): `Log`, `Metric`, `Span`, `ExceptionInstance`, `Profile`, `ProfileSample`, `MetricItemAggMV1m`, `MetricBaselineHourly`:
- `key: "serviceId"` → `"primaryEntityId"`; `key: "serviceType"` → `"primaryEntityType"` (no `apiAliases`).
- **Hard-rename** getters/setters.
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

### D. Frontend (in scope — decision 3)
~50 files in `App/FeatureSet/Dashboard/src` (queries: select/where/sort/groupBy/facetKey; model reads `.serviceId`; navigation). All reference the telemetry `serviceId` (no collision with the status-page `Service` model). With no alias, every one switches to `primaryEntityId` and ships in the **same release** as the backend. High-traffic: `LogsViewer`, `TracesViewer`, `TraceExplorer`, `SpanUtil`, `MetricsViewer`, `TraceTable`, `TraceDetailPanel`, `FlameGraph`.

### E. Postgres adjacent fields (decision 4)
- [`TelemetryException`](../../Common/Models/DatabaseModels/TelemetryException.ts) and [`TelemetryUsageBilling`](../../Common/Models/DatabaseModels/TelemetryUsageBilling.ts): rename `serviceId`/`serviceType` columns + getters/setters + read/write sites (`TelemetryExceptionService`, `TelemetryUsageBillingService` write path). Backed by the Postgres schema migration above.

---

## Phasing & verification gates

| Phase | Work | Gate |
|---|---|---|
| **1. Code rename (atomic)** | §A models, §B registry, §C server/ingest/writers/billing, §D **frontend**, §E Postgres models. Postgres schema migration generated. | Build/type-check green; permission tests (`primaryEntityId IN (:allowed)`); grep gate — no telemetry `serviceId` left in read/write paths. |
| **2. ClickHouse V3 cut + copy** | `AnalyticsTableName` → V3; new partition key + entity columns may co-land; boot creates V3; data-migration copies V2 → V3 with rename. | New + historical rows present in V3; sample queries match V2 baselines on `primaryEntityId`; partition pruning / TTL behavior verified. |
| **3. MV rebuild** | Recreate the 2 MVs on the V3 source. | Dashboard scalar charts repopulate (rollup history resets — expected). |
| **4. Verify, drop V2 & announce** | E2E across traces/logs/metrics/profiles/exceptions UIs; confirm permissions/billing; drop V2 after the rollback window; **publish breaking-change note** for the `serviceId` API sunset. | Frontend works on `primaryEntityId`; external API documented as breaking. |

Co-sequencing: this rename, the partition-key change, and the `entityKeys` columns can all land in the **same V3 cut** (Phase 2) — one data-migration copy carries all three. Recommended.

---

## Rollback

- **Phase 1** is code + a reversible Postgres migration; revert the commit / run the down-migration.
- **Phase 2/3**: V2 is **retained** (not dropped) until Phase 4, so reverting the enum/model to V2 restores reads/writes against intact data. The copy is additive (V2 untouched until the explicit drop).

---

## Risks & mitigations

- **Breaking API change (accepted, decision 3).** External `serviceId` consumers break immediately. *Mitigation:* prominent changelog/release note.
- **Lockstep frontend.** Backend deploy without matching frontend breaks the UI. *Mitigation:* ship §A–§E in one release; grep-gate stray `serviceId`.
- **Copy cost / resumability** on large tables. *Mitigation:* batch by time window, watermark guard, maintenance window; the copy is idempotent and re-runnable.
- **MV rollup reset.** Expected (MVs never backfilled). *Mitigation:* sequence MV rebuild last.

---

## Open / confirm items

1. **Co-land partition + entity columns in the same V3 cut?** (Recommended — one copy migration carries all three.)
2. **Breaking-change comms** — where to announce the `serviceId` API sunset (API reference + changelog + upgrade notes)?
3. **Copy batch strategy** for the largest tables (single statement vs time-windowed/resumable) — decide per expected table size.

## Non-Goals

- Backward-compat alias / deprecated getters (rejected — decisions 1 & 3).
- Partition-key change & `entityKeys` columns themselves (separate docs; co-sequenced only).
- Renaming the `ServiceType` enum or touching `MonitorLog`/`AuditLog`/`MetricItemAggMV1mByHost`.

## References

- Internal: [`ClickHousePartitioningAndScaling.md`](./ClickHousePartitioningAndScaling.md), [`OpenTelemetryEntities.md`](./OpenTelemetryEntities.md), [`PermissionsSimplification.md`](./PermissionsSimplification.md).
- Code: [`StatementGenerator.ts`](../../Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts), [`BaseAnalyticsAPI.ts`](../../Common/Server/API/BaseAnalyticsAPI.ts), [`CommonModel.ts`](../../Common/Models/AnalyticsModels/AnalyticsBaseModel/CommonModel.ts), [`OwnerTableRegistry.ts`](../../Common/Server/Types/Database/Permissions/OwnerTableRegistry.ts), [`AnalyticsTableName.ts`](../../Common/Types/AnalyticsDatabase/AnalyticsTableName.ts), [`DataMigrations/`](../../App/FeatureSet/Workers/DataMigrations/), [`SchemaMigrations/Index.ts`](../../Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts).
