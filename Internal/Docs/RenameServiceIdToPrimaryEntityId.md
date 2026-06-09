# Rename `serviceId` → `primaryEntityId` (Telemetry Analytics) — Implementation Plan

Status: Proposal
Owner: TBD
Last updated: 2026-06-09

## Summary

The ClickHouse analytics column `serviceId` (and its discriminator `serviceType`) is a misnomer: it is a **polymorphic primary-entity pointer** (Service / Host / DockerHost / KubernetesCluster / Monitor / RUM app / projectId fallback), not a service id. This plan renames the columns to **`primaryEntityId` / `primaryEntityType`** across the stack, keeping `serviceId` / `serviceType` as **deprecated backward-compat API aliases** so saved dashboards, alert rules, and external API consumers do not break.

This is **Option B** from the design discussion (the alternative — keep the name and relabel conceptually — was rejected in favor of fixing the name while the `…V3` table door is open). The rename is **byte-for-byte semantic-preserving**; only the name changes, and the columns are **kept** (not dropped, not replaced by `entityKeys` — see [`OpenTelemetryEntities.md`](./OpenTelemetryEntities.md) decision-update note).

Scope-defining facts established by code audit (verified, citations below):

- **Physical ClickHouse column name == model column `key`, always** — `StatementGenerator` emits `column.key` directly into DDL and queries. Renaming the model `key` renames the physical column and all generated SQL.
- **The permission layer is already column-agnostic** — it reads the FK column name from `@OwnedThrough` metadata / `OwnerTableRegistry`. Exactly **one** hardcoded `"serviceId"` literal exists in that layer.
- **No existing field-aliasing mechanism** — the alias must be built (small, central).
- **Generated SQL uses the raw request key string**, so the alias must *rewrite keys* (`serviceId → primaryEntityId`) at well-defined choke points, not merely resolve columns.
- **All ~200 frontend references are the telemetry `serviceId`** (no collision with the status-page/on-call `Service` model), and **the API alias shields the frontend entirely** — zero frontend changes required initially.

Blast radius: ~158 files. The bulk is mechanical and shielded by the alias; the load-bearing work is the alias mechanism, the model/permission rename, the V3 migration, and the MV rebuild.

This rename rides the **single `…V3` table cut** shared with the partition-key change ([`ClickHousePartitioningAndScaling.md`](./ClickHousePartitioningAndScaling.md)) and the entity-membership columns ([`OpenTelemetryEntities.md`](./OpenTelemetryEntities.md)) — one rewrite, sequenced below.

> **Verify line numbers at edit time.** File/function citations below come from a code audit and are accurate at the architecture level; exact line numbers may have drifted. Treat them as starting points, not literals.

---

## Scope

**In scope — rename across these analytics tables:**

- Signal tables: `Log`, `Metric`, `Span`, `ExceptionInstance`, `Profile`, `ProfileSample`, `MonitorLog`, `AuditLog`.
- Rollup MV tables: `MetricItemAggMV1m`, `MetricItemAggMV1mByHost`, `MetricBaselineHourly` (serviceId in sort/primary keys + MV SELECT/GROUP BY).
- All read/write/permission/billing code paths touching those columns.
- The `serviceId` / `serviceType` deprecated API alias.

**Adjacent but separate (decide independently — not auto-included):**

- The **Postgres** `TelemetryException` model's own `serviceId`/`serviceType` columns ([`Common/Models/DatabaseModels/TelemetryException.ts`](../../Common/Models/DatabaseModels/TelemetryException.ts)) — a different model; rename only for consistency if desired.
- The **Postgres** `TelemetryUsageBilling` record's `serviceId`/`serviceType` ([`TelemetryUsageBillingService`](../../Common/Server/Services/TelemetryUsageBillingService.ts)) — a billing artifact; can keep its field names and map at the boundary.
- The **`ServiceType` enum** ([`Common/Types/Telemetry/ServiceType.ts`](../../Common/Types/Telemetry/ServiceType.ts)) — **keep as-is**. It is a discriminator whose *values* are unchanged; `primaryEntityType` remains typed by it. Renaming the enum to `EntityType` is out of scope (the entity doc keeps `ServiceType` for the primary discriminator and introduces `EntityType` separately for membership).

**Out of scope:** the partition-key change itself, the `entityKeys` membership columns, and any access-control semantics change (those live in the other two docs; this doc only co-sequences with them).

---

## Verified mechanics (the audit)

| Fact | Evidence | Consequence for the plan |
|---|---|---|
| ClickHouse column name = model column `key` | [`StatementGenerator.ts`](../../Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts) `toColumnsCreateStatement` (`const keyStatement = column.key`, ≈L989) | Renaming the model `key` renames the physical column + all generated DDL/SQL. No separate DDL rename needed beyond the V3 create. |
| Query keys are injected raw into SQL | `toSelectStatement` (`SQL\`${key}\``, ≈L878), `toSortStatement` (≈L846), `toWhereStatement` (≈L414 validates via `getTableColumn`), `toGroupByStatement` (≈L821), `toAggregateSelectStatement` (≈L933) | The alias must **rewrite the key string** before SQL generation; alias-aware `getTableColumn` alone is insufficient (it would validate but emit `serviceId` into SQL → error). |
| Permission scope is dynamic | `OwnedScopePermission.addOwnedScopeToQuery` reads `model.ownedThrough.fkColumn` (≈L128/137); analytics `ModelPermission` reads `fkColumn` from decorator + registry (≈L827/834, L889) | No edits needed in the scope-resolution code. Only the **decorator strings** and **one registry entry** change. |
| One hardcoded literal in permissions | [`OwnerTableRegistry.ts`](../../Common/Server/Types/Database/Permissions/OwnerTableRegistry.ts) `fkColumn: "serviceId"` (L157, Service entry) | Single-line change. |
| No existing alias mechanism | (audit found none) | Build a small, central alias facility (below). |
| Frontend uses only telemetry `serviceId` | 50 files in `App/FeatureSet/Dashboard/src`; no import collision with `DatabaseModels/Service` | API alias shields all of it; defer frontend rename. |
| V1→V2 was drop-not-copy | [`DeleteOldTelelmetryTable.ts`](../../App/FeatureSet/Workers/DataMigrations/DeleteOldTelelmetryTable.ts) dropped old tables; V2 auto-created at boot | V3 follows the same enum-bump + boot-create pattern, **plus** an explicit data copy (below) since we don't want to silently drop in-retention telemetry. |

---

## The alias mechanism (build first)

A signal row exposes `primaryEntityId`/`primaryEntityType` but the API must still accept and emit `serviceId`/`serviceType`. Because generated SQL uses the raw key, the alias is a **bidirectional key remap** at a small number of choke points.

**1. Declare aliases on the column.** Add an optional `apiAliases: Array<string>` to [`AnalyticsTableColumn`](../../Common/Types/AnalyticsDatabase/TableColumn.ts). On the renamed columns:

```ts
// primaryEntityId column
apiAliases: ["serviceId"],
// primaryEntityType column
apiAliases: ["serviceType"],
```

The model builds a derived `aliasToCanonical: Map<string,string>` (`"serviceId" → "primaryEntityId"`) and `canonicalToAliases`.

**2. Inbound key rewrite (request → SQL).** Rewrite keys via `aliasToCanonical` at the **top of each StatementGenerator method** that consumes request keys — this covers every caller (API and internal):

- `toWhereStatement`, `toSelectStatement`, `toSortStatement`, `toGroupByStatement`, `toAggregateSelectStatement`.
- Implement once as `private resolveKey(key): string { return this.model.aliasToCanonical.get(key) ?? key; }` and apply where each method reads `key`, before `getTableColumn(key)` and before appending to SQL.

Also apply at the **facets** endpoint (facet keys) and the **create/update** parse path.

**3. Outbound emit (SQL result → JSON).** In [`CommonModel.toJSON`](../../Common/Models/AnalyticsModels/AnalyticsBaseModel/CommonModel.ts) (≈L201), after emitting `json[column.key]`, also emit each alias: `for (const a of column.apiAliases) json[a] = json[column.key]`. Responses then carry **both** `primaryEntityId` and `serviceId`.

**4. Inbound parse (JSON → model).** In `CommonModel.fromJSON` (≈L193) and the API create/update body handling in [`BaseAnalyticsAPI`](../../Common/Server/API/BaseAnalyticsAPI.ts) (≈L552/523), remap alias keys → canonical before `setColumnValue` (which throws on unknown columns).

**5. Aggregate responses.** In `BaseAnalyticsAPI.getAggregate` (≈L398), the result `groupBy` keys come back canonical (`primaryEntityId`); add the alias key to the response object so dashboards grouping by `serviceId` still find it.

**6. (Complementary, optional) ClickHouse `ALIAS` columns** for raw-SQL / direct-ClickHouse consumers:

```sql
ALTER TABLE LogItemV3 ADD COLUMN serviceId ALIAS primaryEntityId;
ALTER TABLE LogItemV3 ADD COLUMN serviceType ALIAS primaryEntityType;
```

Zero-storage computed columns so ad-hoc `SELECT serviceId …` keeps working. Caveats: not selected by `SELECT *`, cannot be in sort/primary keys, cannot be `INSERT`ed. Use as a safety net, not the primary mechanism.

**Land this mechanism first with an empty alias map (no-op), tested, before any rename** — it de-risks everything downstream.

---

## Change inventory by subsystem

### A. Analytics models (8 signal tables)
`Log`, `Metric`, `Span`, `ExceptionInstance`, `Profile`, `ProfileSample`, `MonitorLog`, `AuditLog` in [`Common/Models/AnalyticsModels/`](../../Common/Models/AnalyticsModels/):
- `key: "serviceId"` → `"primaryEntityId"` (+ `apiAliases: ["serviceId"]`); `key: "serviceType"` → `"primaryEntityType"` (+ `apiAliases: ["serviceType"]`).
- Getters/setters `serviceId`/`serviceType` → `primaryEntityId`/`primaryEntityType` (keep deprecated getters delegating, optional).
- `sortKeys` / `primaryKeys` arrays: `"serviceId"` → `"primaryEntityId"`.
- `@OwnedThrough("serviceId", …)` → `@OwnedThrough("primaryEntityId", …)` (6 models: Log, Span, Metric, Profile, ProfileSample, ExceptionInstance).

### B. Permissions (single hardcoded reference)
- [`OwnerTableRegistry.ts`](../../Common/Server/Types/Database/Permissions/OwnerTableRegistry.ts) L157: `fkColumn: "serviceId"` → `"primaryEntityId"` (+ update polymorphism comments ≈L65/68).
- `OwnedScopePermission.ts` / analytics `ModelPermission.ts`: **no change** (dynamic).

### C. Types & ingest metadata
- `TelemetryServiceMetadata` interface ([`OpenTelemetryIngestService.ts`](../../Common/Server/Services/OpenTelemetryIngestService.ts) ≈L40-56): rename fields `serviceId`/`serviceType`.
- `OtelIngestBaseService.resolveTelemetryResource` and callers: rename the produced fields.

### D. Ingest write-sites (set columns on rows)
| File | ≈Line | Builder |
|---|---|---|
| `OtelMetricsIngestService` | 2119 | `buildMetricRow` |
| `OtelTracesIngestService` | 952 / 999 | `buildSpanRow` / `buildExceptionRow` |
| `OtelLogsIngestService` | 683 / 972 | `saveLog` / `collectExceptionFromLog` |
| `OtelProfilesIngestService` | 983 / 1040 | `buildProfileRow` / `buildSampleRow` |
| `MonitorMetricUtil` | 139 | `buildMonitorMetricRow` |

(Files in `App/FeatureSet/Telemetry/Services/` and `Common/Server/Utils/Monitor/`.)

### E. Programmatic metric writers (set `.serviceId` / `.serviceType`)
- [`AlertService.ts`](../../Common/Server/Services/AlertService.ts): 4 metrics (≈L1345-1502).
- [`IncidentService.ts`](../../Common/Server/Services/IncidentService.ts): 7 metrics (≈L1720-3010).
- (These set typed model fields — covered by the model getter/setter rename.)

### F. Materialized views (re-key + rebuild — see next section)
- [`MetricItemAggMV1m.ts`](../../Common/Models/AnalyticsModels/MetricItemAggMV1m.ts), [`MetricItemAggMV1mByHost.ts`](../../Common/Models/AnalyticsModels/MetricItemAggMV1mByHost.ts), [`MetricBaselineHourly.ts`](../../Common/Models/AnalyticsModels/MetricBaselineHourly.ts): `serviceId` in `sortKeys`, `primaryKeys`, and the `materializedViews[].query` SELECT/GROUP BY → `primaryEntityId`; MV source table `MetricItemV2` → `MetricItemV3`.

### G. Billing (raw SQL)
- [`AnalyticsDatabaseService.groupTelemetryUsageByService`](../../Common/Server/Services/AnalyticsDatabaseService.ts) ≈L482: raw SQL `SELECT serviceId …, serviceType … GROUP BY serviceId, serviceType` → `primaryEntityId`/`primaryEntityType`. Use `SELECT primaryEntityId AS serviceId` if you want to keep the downstream `TelemetryUsageBilling` write/interface field names unchanged (recommended to keep that scope tight).

### H. Frontend — no change (shielded by alias)
- ~50 files in `App/FeatureSet/Dashboard/src` (query select/filter/sort, facet keys, model reads, navigation). The API alias makes all of it work unchanged. **Defer** a frontend rename to a later, low-priority, zero-risk cleanup.

---

## The `…V3` table migration

ClickHouse cannot `ALTER` a partition key or rename a sort-key column in place, so this is a new versioned table (consistent with the existing `…V2` pattern). One cut carries the **partition change + rename + entity columns**.

1. **`AnalyticsTableName` enum** ([`Common/Types/AnalyticsDatabase/AnalyticsTableName.ts`](../../Common/Types/AnalyticsDatabase/AnalyticsTableName.ts)): bump migrated tables to `…V3` (e.g. `Log = "LogItemV3"`).
2. **Model schema**: rename columns (§A), set new `partitionKey` (e.g. `toYYYYMMDD(time)`), update sort/primary keys, add entity columns (`entityKeys`, per-type scalars), add `SETTINGS ttl_only_drop_parts = 1` where applicable.
3. **Boot auto-creates** the empty V3 tables — `AnalyticsTableManagement.createTables()` ([`App/FeatureSet/Workers/Index.ts`](../../App/FeatureSet/Workers/Index.ts) ≈L216) runs `CREATE TABLE IF NOT EXISTS` from the model.
4. **Data copy migration** (`DataMigrationBase`, registered in [`DataMigrations/Index.ts`](../../App/FeatureSet/Workers/DataMigrations/Index.ts)). Per table, with the rename done in-flight:
   ```sql
   INSERT INTO LogItemV3
   SELECT projectId, primaryEntityId, primaryEntityType, time, /* …all cols… */
   FROM (SELECT *, serviceId AS primaryEntityId, serviceType AS primaryEntityType FROM LogItemV2);
   ```
   - Batch by time window for large tables; track progress so a failed run is resumable (the migration framework records completion in Postgres and runs once — a mid-run failure needs manual/idempotent recovery, so guard with a "V3 row-count / watermark" check).
   - Writes already go to V3 after deploy (model points to V3), so V2 is read-only at cutover and nothing is missed; `_id` is preserved so the copy is not double-counted on re-run if guarded.
5. **Drop V2** after a release as a backup window: `DROP TABLE IF EXISTS LogItemV2` (mirrors [`DeleteOldTelelmetryTable.ts`](../../App/FeatureSet/Workers/DataMigrations/DeleteOldTelelmetryTable.ts)).

**Data-preservation choice (per table):**
- **Copy (default, recommended)** for anything a customer expects to retain — definitely `AuditLog`. Preserves in-retention history; IO-heavy on large tables.
- **Forward-only (accept loss)** is acceptable only for short-retention signals where history ages out in days and the copy cost isn't worth it — explicit opt-out, never for `AuditLog`. (This is what V1→V2 did.)

---

## Materialized view re-key + rebuild

The rollup MVs are `AggregatingMergeTree` with `serviceId` in their sort/primary keys and `MetricItemV2` + `serviceId` in their `materializedViews[].query`. A populated `AggregatingMergeTree` sort key cannot be altered in place, so this is **drop + recreate + let it repopulate forward**, using the established pattern in [`RebuildMetricMinuteAggregateMaterializedView.ts`](../../App/FeatureSet/Workers/DataMigrations/RebuildMetricMinuteAggregateMaterializedView.ts):

1. Guard: skip if the MV already points at `MetricItemV3` / `primaryEntityId`.
2. `DROP VIEW IF EXISTS …_mv; DROP TABLE IF EXISTS <target>`.
3. Recreate the target table (new partition `toYYYYMM(bucketTime)`, sort key with `primaryEntityId`).
4. Recreate the MV `… AS SELECT … primaryEntityId … FROM MetricItemV3 GROUP BY … primaryEntityId`.

MVs do **not** backfill (known behavior — see the metrics-MV note), so rollup history resets at rebuild. This is acceptable and already true of any MV change here; sequence it **last** (it touches the perf-critical aggregate path). Re-keying `MetricItemAggMV1mByHost` from `hostIdentifier` to the host entity key is a related change owned by [`OpenTelemetryEntities.md`](./OpenTelemetryEntities.md) — coordinate so the host MV is rebuilt once.

---

## Phasing, sequencing & verification gates

Each phase is independently shippable and backward-compatible.

| Phase | Work | Verification gate |
|---|---|---|
| **0. Alias facility** | `apiAliases` on `AnalyticsTableColumn`; central key-rewrite in `StatementGenerator` + facets + create/update; `toJSON`/`fromJSON` emit/parse aliases; aggregate-response alias. Ship with **empty** alias map. | Unit tests: a column with a dummy alias round-trips through where/select/sort/groupBy/aggregate/facets and JSON. No behavior change with empty map. |
| **1. Rename in models + permissions** | §A model column keys/getters/setters/sort keys + `apiAliases:["serviceId"]`; 6 `@OwnedThrough`; `OwnerTableRegistry:157`; `TelemetryServiceMetadata`; ingest write-sites (§C/D); programmatic writers (§E); billing SQL (§G). | Build/type-check green; permission tests pass (`primaryEntityId IN (:allowed)`); API still accepts/emits `serviceId` via alias. |
| **2. V3 cut + data copy** | Enum→V3; new partition key + entity columns in models; boot creates V3; copy migration (§Migration); drop V2 (deferred a release). | New + historical rows present in V3; partition pruning + TTL drops observed; sample queries match V2 baselines. |
| **3. MV re-key + rebuild** | Update + rebuild the 3 MVs (and coordinate host-MV re-key with the entity doc). | Dashboard scalar charts repopulate; per-host charts work; no MV-empty regressions. |
| **4. Verify & cutover** | End-to-end: traces/logs/metrics/profiles/exceptions UIs (unchanged frontend), alerting rules referencing `serviceId`, saved dashboards. | Frontend works with **zero** changes; external API `serviceId` contract intact. |
| **5. Deferred (optional)** | Rename frontend `serviceId`→`primaryEntityId` (50 files, low-risk once alias proven); announce a deprecation timeline for the `serviceId` API alias. | n/a (cleanup). |

**Ordering vs. the other two efforts:** entity *identity/registry* code (code-only, no schema) → **this rename + partition change + entity columns in one V3 cut** (Phase 2) → switch reads / MV re-key (Phase 3). Do not cut V3 more than once.

---

## Rollback

- **Phase 0–1** are pure code; revert the commit.
- **Phase 2**: V2 is retained (not dropped) for a full release as the rollback target — revert the enum/model to V2 and the historical data is intact. The copy is additive (V2 untouched until the explicit drop).
- **Phase 3**: MV rebuild is reversible by re-pointing at the prior source (rollup history resets either way).

---

## Risks & mitigations

- **Alias coverage gaps break queries.** If any surface (where / select / sort / groupBy / aggregate / facets / response / create-update) misses the remap, a `serviceId` request errors with "Unknown column". *Mitigation:* single shared `resolveKey` helper applied at every choke point; Phase-0 round-trip tests exercise all surfaces.
- **Data-copy cost / resumability** on large tables. *Mitigation:* batch by time window, watermark guard, run in a maintenance window; offer forward-only for short-retention signals.
- **MV history reset.** Expected and acceptable (MVs never backfilled). *Mitigation:* communicate; rebuild last.
- **Two `serviceId` meanings.** The status-page/on-call `Service` model also has ids; confirmed no overlap in the analytics path, but keep the rename strictly within `AnalyticsModels` + their read/write paths.
- **Partition + rename + entity columns coupled in one cut** increases the size of Phase 2. *Mitigation:* land Phase 0/1 (rename behind alias, still on V2 partition) well ahead, so Phase 2 is "new table + copy" only.

---

## Open questions

1. **Keep deprecated getters?** Retain `get serviceId()` delegating to `primaryEntityId` on the models for a release, or hard-rename and rely solely on the API alias?
2. **Copy vs forward-only per table** — confirm which signal tables are short-retention enough to skip the copy (almost certainly copy `AuditLog`, `Metric`; likely copy all).
3. **`serviceId` API alias sunset** — one release? Two? Tie to a documented deprecation in the API reference.
4. **Rename the adjacent Postgres `TelemetryException` / `TelemetryUsageBilling` fields** for consistency, or leave them?

## Non-Goals

- Changing access-control *semantics* (primary-entity-governs stays; see the entity doc).
- The partition-key change and `entityKeys` columns themselves (separate docs; only co-sequenced here).
- Renaming the `ServiceType` enum.
- Renaming the frontend in this effort (deferred Phase 5).

## References

- Internal: [`ClickHousePartitioningAndScaling.md`](./ClickHousePartitioningAndScaling.md) (the V3 partition change this rides with), [`OpenTelemetryEntities.md`](./OpenTelemetryEntities.md) (primary-entity model, `entityKeys`, decision-update note), [`PermissionsSimplification.md`](./PermissionsSimplification.md) (`@OwnedThrough` / `OwnerTableRegistry`).
- Code: [`StatementGenerator.ts`](../../Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts), [`BaseAnalyticsAPI.ts`](../../Common/Server/API/BaseAnalyticsAPI.ts), [`CommonModel.ts`](../../Common/Models/AnalyticsModels/AnalyticsBaseModel/CommonModel.ts), [`OwnerTableRegistry.ts`](../../Common/Server/Types/Database/Permissions/OwnerTableRegistry.ts), [`DataMigrations/`](../../App/FeatureSet/Workers/DataMigrations/).
