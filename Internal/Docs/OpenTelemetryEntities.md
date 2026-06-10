# OpenTelemetry Entities in OneUptime

Status: Proposal
Owner: TBD
Last updated: 2026-06-09

> **Decision update (2026-06-09) — rename `serviceId` → `primaryEntityId` (Option B).**
> The single-primary-owner *concept and mechanics* described below are unchanged, but the two columns are being **renamed** `serviceId → primaryEntityId` and `serviceType → primaryEntityType`, executed during the ClickHouse `…V3` table cut in [`ClickHousePartitioningAndScaling.md`](./ClickHousePartitioningAndScaling.md). `serviceId`/`serviceType` are retained as **deprecated API aliases** (accepted and emitted by the analytics API) so external consumers, saved dashboards, and alert rules don't break. **Read every `serviceId`/`serviceType` below as `primaryEntityId`/`primaryEntityType`.**
> The columns are **kept — not dropped, not replaced by `entityKeys`**: `primaryEntityId` (ObjectID) is the authorization anchor (`primaryEntityId IN (:allowed)`), the sort-key locality anchor, and the stable link to the rich Postgres entity for UI routing; `entityKeys Array(String)` is additive membership/filtering only and can never authorize. No separate `primaryEntityKey` hash column is added — the primary's hash already lives in `entityKeys` and in its matching per-type scalar key. This supersedes the "keep the name / relabel only" language in §3c and Decision 4.

> **Implementation status (2026-06-09) — phases 1 + 3 landed.**
> - **Phase 1 (identity layer):** [`EntityType`](../../Common/Types/Telemetry/EntityType.ts) enum + [`TelemetryEntity`](../../Common/Server/Utils/Telemetry/TelemetryEntity.ts) (`computeEntityKey` / `extractEntities` / `extractEntityKeys`) implementing the per-type identifying sets and the `sha256(projectId|type|canonical(id))[:16]` key. Pure + synchronous; covered by [`TelemetryEntity.test.ts`](../../Common/Tests/Server/Utils/Telemetry/TelemetryEntity.test.ts) (18 cases).
> - **Phase 3 (membership column):** additive `entityKeys Array(String)` + `idx_entity_keys bloom_filter(0.01)` on all six signal models (`Log`, `Metric`, `Span`, `ExceptionInstance`, `Profile`, `ProfileSample`). `OtelIngestBaseService.resolveTelemetryResource` now selects the primary entity **and** stamps `entityKeys` (derived from the same resource attributes) onto every row across the traces / logs / metrics / profiles / syslog / fluent builders. Migration: [`AddEntityKeysToTelemetryTables`](../../App/FeatureSet/Workers/DataMigrations/AddEntityKeysToTelemetryTables.ts) (idempotent `ADD COLUMN`/`ADD INDEX`).
> - **v1 semantics:** `entityKeys` carries the OTel-resource entities (`service`, `host`, `k8s.*`, `container`, `process`, `service.instance`, `telemetry.sdk`). For `service` / `host` / `k8s.*`-primary rows it includes the primary's key; OneUptime-specific primaries with no OTel identity (DockerHost / Serverless / Cloud / RUM / Unknown) remain queried via `primaryEntityId`. Syslog/Fluent stamp `[]` (they bypass `resolveTelemetryResource`).
> - **Deferred (not yet built):** scalar per-type key columns (`hostEntityKey`, ...), `TelemetryEntity`/`TelemetryEntityRelationship` Postgres registry (phase 2), read-path switch to `has(entityKeys, ...)` (phase 4), relationships/topology (phase 5), host-MV re-key + OTLP `entity_refs` parsing (phase 6).

## Summary

OpenTelemetry's [entity data model](https://opentelemetry.io/docs/specs/otel/entities/data-model/) (currently **Development** status) reframes a `Resource` from a flat bag of attributes into a **composition of N identified objects** — a span can simultaneously belong to a `service`, a `host`, a `k8s.pod`, a `k8s.node`, a `k8s.cluster`, a `container`, and a `process`. Each entity is just three things: a **type**, an **id** (the minimal immutable identifying attribute set), and a **description** (mutable descriptive attributes).

OneUptime already has a hardcoded, four-type, *single-owner* version of this. The telemetry entities exist as rich Postgres tables (`Service`, `Host`, `DockerHost`, `KubernetesCluster`), but every ClickHouse signal row is attributed to exactly **one** owner via `(serviceId, serviceType)`. The other entities present in the same resource survive only as flat `resource.*` strings inside the `attributes` map, and infra views reverse-engineer them with `GROUP BY attributes['resource.host.name']`.

This document proposes:

1. A generalized **entity extractor** at ingest that derives *all* entities from a resource, replacing the four special-cased discovery paths with one identity-driven loop.
2. A thin **`TelemetryEntity` registry** in Postgres that catalogs every discovered entity, while keeping the existing rich typed tables (`Service`/`Host`/...) as specializations.
3. An additive **`entityKeys Array(String)` membership column** on every ClickHouse signal table, so one signal can belong to many entities. This is the keystone change.
4. A **`TelemetryEntityRelationship`** table populated from resource co-occurrence, giving a real topology graph (and quietly resurrecting the dropped service-dependency capability).
5. Reading OTLP **`entity_refs`** when producers emit them, falling back to the existing heuristic detectors otherwise.

The single-owner `(serviceId, serviceType)` path stays for backward compatibility; everything here is additive.

---

## Background

### What OpenTelemetry entities are

An **Entity** has exactly three primary fields ([data model](https://opentelemetry.io/docs/specs/otel/entities/data-model/)):

| Field | Mutability | Rules |
|---|---|---|
| **type** | immutable | non-empty string, e.g. `service`, `host`, `k8s.pod` |
| **id** (identifying attributes) | immutable | minimal sufficient identity; at least one attribute; repeatably obtainable by observers |
| **description** (descriptive attributes) | mutable | non-identifying metadata; may be empty |

A **Resource is a composition of 0+ entities plus 0+ loose attributes**. On the wire the model is backward compatible: `resource.attributes` stays flat, and new `entity_refs` simply *partition* those keys — each ref names a type and which keys are identifying vs descriptive. Entity **relationships** are explicitly **not** standardized yet ("refined in future specification work"), and the whole model is **Development** maturity. The practical takeaway: model entities internally on our own terms and consume `entity_refs` as an optional input — do not couple our schema to an unstable wire spec.

### Where OneUptime is today

The entities already exist as first-class, auto-discovered Postgres rows:

- [`Service.ts`](../../Common/Models/DatabaseModels/Service.ts) — the telemetry service (formerly `ServiceCatalog`). Identity: `(projectId, name)`. Descriptive: `techStack`, `serviceColor`, `lastSeenAt`, retention config.
- [`Host.ts`](../../Common/Models/DatabaseModels/Host.ts) — identity: `hostIdentifier`. Descriptive: `osType`, `cpuCores`, `totalMemoryBytes`, `agentVersion`, ...
- `DockerHost`, `KubernetesCluster` — same shape.

But each signal picks **one** owner. Every analytics row in [`Span.ts`](../../Common/Models/AnalyticsModels/Span.ts), [`Log.ts`](../../Common/Models/AnalyticsModels/Log.ts), [`Metric.ts`](../../Common/Models/AnalyticsModels/Metric.ts), [`ExceptionInstance.ts`](../../Common/Models/AnalyticsModels/ExceptionInstance.ts), [`Profile.ts`](../../Common/Models/AnalyticsModels/Profile.ts) carries a single `(serviceId, serviceType)`, where `serviceType` is the [`ServiceType`](../../Common/Types/Telemetry/ServiceType.ts) discriminator (`OpenTelemetry`, `Host`, `DockerHost`, `KubernetesCluster`, `Unknown`, `Monitor`, ...).

[`OtelIngestBaseService.ts`](../../App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts) `resolveTelemetryResource()` runs a precedence ladder and **chooses one winner**:

```
explicit service.name        → ServiceType.OpenTelemetry (Service._id)
else host signal             → ServiceType.Host          (Host._id)
else docker runtime          → ServiceType.DockerHost    (DockerHost._id)
else k8s.cluster.name        → ServiceType.KubernetesCluster
else (nothing)               → ServiceType.Unknown       (projectId)
```

The discovery heuristics (`getServiceNameFromAttributes`, `autoDiscoverHost`, `hasHostResourceSignal`, `normalizeHostNameAttributesInPlace`) are good — they are exactly "infer entities from a flat resource." They are just wired to produce a single owner and then discard the structure of every other entity.

---

## Problem

**Single-owner attribution loses the entity graph.** Consider a `SPAN_KIND_SERVER` span from the `checkout` service, running in pod `checkout-7d9f` in namespace `shop`, on node `ip-10-0-1-5`, in cluster `prod-us`, in container `checkout`, as process pid `1234`. That is **six entities**, and the span belongs to all six. OneUptime stores `serviceType=OpenTelemetry, serviceId=<checkout Service._id>` and flattens the rest into `attributes['resource.k8s.pod.name'] = 'checkout-7d9f'`, etc.

Consequences:

- **"Show me everything on host X" is wrong for service-owned signals.** A trace owned by a service but running on host X cannot be found via `serviceId = X`. Infra views compensate with `GROUP BY attributes['resource.host.name']`, which only works because we happen to copy host name into the flat map, and only for the dimensions we special-cased.
- **No real topology.** [`ServiceDependency` was dropped](../../Common/Server/Infrastructure/Postgres/SchemaMigrations/1779277271302-DropServiceDependencyTable.ts); dependencies are recomputed from spans at read time. There is no persisted "pod runs on node," "service hosted on host," or "container part of pod."
- **The host-MV is keyed on a mutable name.** [`MetricItemAggMV1mByHost.ts`](../../Common/Models/AnalyticsModels/MetricItemAggMV1mByHost.ts) keys on `attributes['resource.host.name']`, which is why moving host identity to `host.id` was deferred (see the host-detail hardening note) — the entity model is the forcing function to fix this properly.
- **Adding a new entity type today means a new special-cased path** in `resolveTelemetryResource` plus a new typed table plus new UI plumbing. There is no generic notion of "an entity."

The core gap, stated once: **single-owner `(serviceId, serviceType)` → multi-entity membership.** Everything else in this doc is supporting structure for that one change.

---

## Proposed Design

### 1. Entity types and identity

Define a closed set of supported entity types and, for each, the **identifying attribute set** (semconv-aligned). Everything not in the identifying set is descriptive.

| Entity type | Identifying attributes | Notes |
|---|---|---|
| `service` | `service.name` (+ `service.namespace` if present) | maps to existing `Service` |
| `service.instance` | `service.namespace` + `service.name` + `service.instance.id` | optional, instance-level |
| `host` | `host.id` (fallback `host.name`) | maps to existing `Host`; finally keys on `host.id` |
| `k8s.cluster` | `k8s.cluster.uid` (fallback `k8s.cluster.name`) | maps to existing `KubernetesCluster` |
| `k8s.namespace` | cluster + `k8s.namespace.name` | registry-only initially |
| `k8s.node` | cluster + `k8s.node.uid`/`k8s.node.name` | registry-only initially |
| `k8s.pod` | cluster + namespace + `k8s.pod.uid`/`k8s.pod.name` | registry-only initially |
| `k8s.deployment` | cluster + namespace + `k8s.deployment.name` | registry-only initially |
| `container` | `container.id` | high churn — see Edge Cases |
| `process` | `host.id` + `process.pid` (+ `process.start_time` if present) | high churn — see Edge Cases |
| `telemetry.sdk` | `telemetry.sdk.language` + `telemetry.sdk.name` | low value as a first-class entity; membership-only |

The **entity key** is a stable hash computed purely from the payload — no database round trip:

```
entityKey = sha256(projectId + "|" + entityType + "|" + canonical(identifyingAttrs))
```

`canonical(...)` lowercases/trims and sorts keys, reusing the normalization already in `normalizeHostNameAttributesInPlace`. Because the key is derived from attributes alone, **signal writes never block on entity registry resolution** — we can stamp membership at ingest and reconcile the registry asynchronously.

This collapses the four discovery paths into one extractor:

```
function extractEntities(resourceAttributes): Entity[]
  for each supported entityType:
    if all identifying attrs present:
      emit { type, key: entityKey(...), identifying, descriptive }
```

### 2. `TelemetryEntity` registry (Postgres)

Add a thin registry row for every discovered entity. **Keep the rich typed tables** (`Service`, `Host`, `DockerHost`, `KubernetesCluster`) — they hold bespoke columns and existing UI. The registry adds generality and catches the long tail (pods, nodes, processes) without building eight full-fat tables on day one.

```
TelemetryEntity {
  _id                     ObjectID      -- for owner/label relations and UI routing
  projectId               ObjectID      -- tenant
  entityType              ShortText     -- "service" | "host" | "k8s.pod" | ...
  entityKey               ShortText     -- stable hash (natural key)
  displayName             ShortText     -- derived for UI
  identifyingAttributes   JSON          -- the immutable id set
  descriptiveAttributes   JSON          -- mutable metadata (last-writer-wins, merged)
  resourceType            ShortText?    -- polymorphic pointer to a rich typed row, if any
  resourceId              ObjectID?     -- e.g. resourceType=Host, resourceId=<Host._id>
  labels                  Label[]       -- reuse existing label system
  firstSeenAt             Date
  lastSeenAt              Date
  @Index(projectId, entityType, entityKey) unique
}
```

The polymorphic `(resourceType, resourceId)` pointer deliberately mirrors the existing `(serviceType, serviceId)` pattern. `Service`/`Host`/`DockerHost`/`KubernetesCluster` rows are backfilled into the registry and linked via this pointer; richer types added later (pods, nodes) can start registry-only and graduate to a typed table when the UX warrants it.

Registry upserts (find-or-create by `entityKey`, merge descriptive attrs, bump `lastSeenAt`) reuse the existing throttle/cache machinery in [`OpenTelemetryIngestService.ts`](../../Common/Server/Services/OpenTelemetryIngestService.ts) (`findOrCreateTelemetryService`, the Redis `lastSeenAt` fence, label promotion) — generalized from "service" to "any entity type."

### 3. Entity membership on signals (ClickHouse)

This is the keystone, and it is **additive** — `serviceId` and the primary key do not change (see 3c).

**3a. Universal membership array.** Add to every signal table — `Span`, `Log`, `Metric`, `ExceptionInstance`, `Profile`, `ProfileSample`:

```
entityKeys   Array(String)   DEFAULT []     -- every entity key this signal belongs to
INDEX idx_entity_keys entityKeys TYPE bloom_filter(0.01) GRANULARITY 1
```

`entityKeys` is a superset that always includes the primary entity's key. This is the **same shape as the existing `attributeKeys Array(String)` + `idx_attribute_keys` bloom filter already on `Span`** — a proven membership-lookup pattern in this very table. Cross-cutting reads become:

```sql
-- "all telemetry touching this host" — correct even for service-owned signals
WHERE projectId = :p AND startTime BETWEEN :t0 AND :t1 AND has(entityKeys, :hostEntityKey)
```

**3b. Scalar columns for the hot, well-known types (the fast path).** A signal has **at most one entity per type** — one host, one pod, one cluster, one service. Multi-membership is *across* types, not within one. So for the handful of types that drive dashboards, also store a scalar key column — `serviceEntityKey`, `hostEntityKey`, `k8sPodEntityKey`, `k8sNodeEntityKey`, `k8sClusterEntityKey`, `containerEntityKey`. Scalars unlock locality the array cannot:

- bloom-indexed point lookups (`WHERE hostEntityKey = :key`);
- **projections** on the base table ordered by an entity key — `Span` already ships projections (`proj_trace_by_id ORDER BY (projectId, traceId, startTime)`), so an alternate ordering by entity key is an established mechanism here;
- per-entity-type rollup MVs — exactly the existing [`MetricItemAggMV1mByHost`](../../Common/Models/AnalyticsModels/MetricItemAggMV1mByHost.ts), whose sort key `(projectId, name, hostIdentifier, bucketTime)` lets host-detail charts "land on a tight granule range." Generalize it from one scalar `hostIdentifier` (today derived from `attributes['resource.host.name']`) to one MV per hot entity type, keyed on the entity key.

The array is the catch-all (any type, including the long tail); the scalar columns + per-type MVs/projections are the fast path. This mirrors what OneUptime already does for host — scalar column + dedicated MV — while keeping the generic `attributes` map.

Rejected alternative: a separate `SignalEntity(signalId, entityKey)` join table — at telemetry volume it multiplies row count and destroys columnar locality. **Denormalize onto the signal row.**

**3c. Primary-key impact — `serviceId` does not move.**

Verified against [`Span.ts`](../../Common/Models/AnalyticsModels/Span.ts): engine `MergeTree`, `sortKeys = primaryKeys = (projectId, startTime, serviceId, traceId)`, partition `sipHash64(projectId) % 16`. The entity model keeps all of this byte-for-byte.

- **`serviceId` stays in the sort/primary key and keeps its meaning** — it is simply relabeled "the primary entity's id" (its column description already reads "ID of the resource the span belongs to … disambiguated by serviceType"). Every query keyed on `serviceId`, plus retention TTL, billing, and the `@OwnedThrough("serviceId", Service)` permission path, are untouched.
- **The new columns are non-key.** Adding them is a metadata-only `ALTER TABLE ADD COLUMN ... DEFAULT []` / `ADD INDEX` — no re-sort, no rewrite of existing parts; old rows read the default until merged or `MATERIALIZE INDEX` is run.
- **Membership is deliberately *not* in the primary key.** The sort key is a single linear order, so privileging "by host" would de-optimize "by service" (today's dominant query); and an `Array` column can't be a sort-key component (no `arrayJoin` in `ORDER BY`). Cross-entity reads prune on the `(projectId, startTime)` prefix via the primary key, then use the `entityKeys` bloom index (or a scalar key column / per-type MV) — never a full scan. The time prefix is the dominant pruning axis; the bloom index handles entity selectivity within it.
- **The one invasive change** is re-keying the host MV from `hostIdentifier` (host.name) to the host entity key (host.id): a populated `AggregatingMergeTree` sort key can't be altered in place, so it is a new MV table + backfill + cutover — which is why it is sequenced **last** (phase 6).

### 4. Entity relationships and topology

Relationship types are unstandardized upstream, so do the cheap, durable thing: **co-occurrence edges**. Every ingest batch yields an entity set; the pairs that co-occur in one resource are, by construction, related.

```
TelemetryEntityRelationship {
  _id            ObjectID
  projectId      ObjectID
  fromEntityKey  ShortText
  toEntityKey    ShortText
  relType        ShortText     -- "runs-on" | "member-of" | "hosted-on" | "part-of" | "instance-of"
  firstSeenAt    Date
  lastSeenAt     Date
  @Index(projectId, fromEntityKey, toEntityKey, relType) unique
}
```

`relType` is inferred from the type pair (pod+node ⇒ `runs-on`, pod+cluster ⇒ `member-of`, service+host ⇒ `hosted-on`, container+pod ⇒ `part-of`, service.instance+service ⇒ `instance-of`). Writes are throttled/deduped exactly like `lastSeenAt` and label promotion.

This gives an infra topology graph for free, and **service→service dependency edges** (the dropped `ServiceDependency` capability) fall out of the same table once we derive them from span client/server pairs (`parentSpanId` crossing a service boundary, or `peer.service`/`rpc.service`). Service-map derivation is a fast-follow; resource composition lands first.

### 5. Ingest pipeline changes

Two-source entity extraction, in priority order:

1. **`entity_refs` (authoritative).** When the OTLP `Resource` carries `entity_refs`, parse them directly. Requires updating the Resource proto in [`OtelPayloadDecoder.ts`](../../App/FeatureSet/Telemetry/Utils/OtelPayloadDecoder.ts) / `App/FeatureSet/Telemetry/ProtoFiles/OTel/v1/`.
2. **Heuristic detectors (fallback).** When absent — today's reality, since the spec is Development and most SDKs do not emit refs — fall back to `extractEntities()` built from the existing detectors. No current detection logic is wasted; it becomes the fallback path.

`resolveTelemetryResource()` is refactored to: (a) call `extractEntities()`, (b) choose the **primary** entity via the *existing* precedence ladder (so `serviceId`/`serviceType` is byte-for-byte compatible), (c) stamp **all** entity keys into `entityKeys`, (d) enqueue registry upserts and relationship edges (throttled).

---

## Ingest Flow (after change)

For one OTLP resource batch:

1. **Decode + auth** — unchanged ([`OTelIngest.ts`](../../App/FeatureSet/Telemetry/API/OTelIngest.ts), token → `projectId`).
2. **Normalize** resource attributes (existing host-name canonicalization, generalized).
3. **Extract entities** — `entity_refs` if present, else heuristic detectors. Produce `Entity[]` with stable keys.
4. **Pick primary entity** — existing precedence ladder → `(serviceId, serviceType)`. Backward compatible.
5. **Write signals** — every span/log/metric/exception/profile row in the batch gets `entityKeys = [...all entity keys]` (primary included). No Postgres round trip required here.
6. **Reconcile registry (async/throttled)** — upsert `TelemetryEntity` rows, merge descriptive attrs, bump `lastSeenAt`, promote `oneuptime.label.*` to labels.
7. **Reconcile relationships (async/throttled)** — upsert co-occurrence edges for the batch's entity set.

Steps 5 and 6/7 are decoupled: signal membership is correct immediately; the registry and graph converge behind a throttle.

---

## Query Flow & Worked Examples

### "Everything running on host `web-1`"

```
1. Resolve host entity key:  entityKey('host', { 'host.id': '<id>' })   -- or look up TelemetryEntity by resourceId
2. Spans:   WHERE projectId = :p AND has(entityKeys, :hostKey)
   Logs:    WHERE projectId = :p AND has(entityKeys, :hostKey)
   Metrics: WHERE projectId = :p AND has(entityKeys, :hostKey)
```

Returns service-owned spans that merely *ran on* the host — impossible under single-owner. The Host detail page (`App/FeatureSet/Dashboard/src/Pages/Host/View/`) swaps its `resource.host.name` predicates for `has(entityKeys, ...)`.

### "What is the `checkout` service related to?"

```
SELECT toEntityKey, relType FROM TelemetryEntityRelationship
WHERE projectId = :p AND fromEntityKey = :checkoutServiceKey
-- → hosted-on host web-1, runs-on pod checkout-7d9f, member-of cluster prod-us, ...
```

Drives a topology view and the service map from one table.

### Per-host metric rollup (MV)

[`MetricItemAggMV1mByHost.ts`](../../Common/Models/AnalyticsModels/MetricItemAggMV1mByHost.ts) is re-keyed from `attributes['resource.host.name']` to the host **entity key**, which is derived from `host.id`. This closes the deferred host-identity hardening: the rollup is now keyed on stable identity, not a mutable hostname. (See Migration — this is a ClickHouse migration + backfill on the perf-critical aggregate path, so it is sequenced last.)

---

## Permissions & Access Control

**Verdict: the entity model needs essentially no change to authorization. `serviceId` (the primary entity) keeps governing access; `entityKeys` is a *filtering* surface, not an *authorization* surface.**

This falls out because the existing telemetry ACL is already primary-entity-based and already polymorphic (all verified as implemented, not proposed):

- `AnalyticsDatabaseService` read/aggregate/count/delete/update run `ModelPermission.checkReadPermission → addOwnedScopeToQuery`, which reads the `@OwnedThrough("serviceId", Service, { includeProjectScope: true })` metadata on `Span`/`Log`/`Metric`/`ExceptionInstance` and injects `WHERE serviceId IN (:allowedIds)` before SQL generation.
- The allowed-id set is resolved once per request (WeakMap-cached) by `resolveOwnedParentIds`, which walks every `OwnerTableRegistry` entry flagged `canOwnTelemetry` — today **Service, Host, DockerHost, KubernetesCluster, Monitor** — and unions the `*OwnerUser`/`*OwnerTeam` ids the caller owns. `OwnedThroughMetadata` documents this exactly: *"a telemetry row's serviceId may reference a Service, Host, DockerHost or KubernetesCluster, so Owned scope unions the owned ids across all of them."*
- `scope` (`All` / `Owned` / `Labels`) is live on `TeamPermission`: `All` short-circuits the filter, `Owned` applies the union, `Labels` resolves label-matched ids. Per-pillar perms (`ReadTelemetryServiceTraces`/`Log`/`Metrics`) and `*AllOperationalResources` wildcards are orthogonal table-level gates.

The design for entities:

1. **Primary entity governs (secure default, zero mechanism change).** A signal's access is decided solely by its `(serviceId, serviceType)` primary entity, via the unchanged `addOwnedScopeToQuery` path. A span primary-owned by service `checkout` is authorized by `checkout`'s owners — even though it also belongs to host `web-1`, a pod, a cluster. Owning `web-1` does **not** grant read on `checkout`'s spans.
2. **`entityKeys` is filter-only, always AND-ed with the auth predicate.** Cross-cutting reads compile to `WHERE has(entityKeys, :hostKey) AND serviceId IN (:allowedIds)`. Filtering by an entity you don't own is harmless — it only narrows already-authorized rows. The membership array never widens access.
3. **New primary-entity types extend the registry, not the code.** When a new type can be a *primary* owner (e.g. a pod- or container-primary row), add an `OwnerTableRegistry` entry (`canOwnTelemetry: true`) pointing at its owner tables (on the typed table or on `TelemetryEntity`). `addOwnedScopeToQuery` iterates the registry, so it needs no edit. Secondary-only types (pod/container/process that merely co-occur) need no owner tables — they never govern access.
4. **Why not any-owner-union.** Granting access through *any* co-occurring entity would let a host owner read every team's app traces/logs that happen to run on shared infrastructure — bodies and attributes routinely carry SQL, payloads, and PII, so that is a cross-team data leak by default. It is also slow: authorization would become `hasAny(entityKeys, <large allowed set>)` instead of a `serviceId IN (...)` test on a sort-key-prefixed column. Both reasons make primary-governs the right default.
5. **The "see everything on my infra" cases are already served** without union:
   - *Host owner sees host telemetry* — host system metrics are **primary-owned by the Host** (`serviceType=Host`), so the registry's existing Host entry already grants it. Free.
   - *Platform/SRE sees cluster-wide* — the `scope=All` + `ReadAllOperationalResources` path (implemented); `hasUnrestrictedGrant` skips the filter entirely.
   - *"Services running on this host" panel* — sourced from the relationship graph + entity registry (names/topology), a separate read grant; you see the list without reading other teams' span bodies.
6. **Optional grant-through (opt-in, off by default).** For customers who explicitly want infra owners to read all telemetry on their infra, a per-project, per-entity-type policy can add that type to the auth predicate: `serviceId IN (:allowed) OR hasAny(:typeKeyColumn, :allowedTypeKeys)`. Auditable, scoped to chosen types, never implicit.
7. **Entity catalog & relationships** — `TelemetryEntity` and `TelemetryEntityRelationship` are `@OperationalResource()` and read-scoped so the entity explorer/topology respects the same boundary (you see entities you own, or whose primary-owned telemetry you can see).

**Worked example — one signal connected to two resources A and B; caller owns A but not B.** Access depends solely on which resource is the signal's *primary* entity (`serviceId`), not on the fact that it is connected to both:

- **A is primary** (`serviceId = A`): the caller **sees it** — even though it also references B — because the authorizing predicate `serviceId IN (:allowed)` matches (caller owns A).
- **B is primary** (`serviceId = B`): the caller does **not** see it — *not even on Resource A's page* — because `serviceId = B ∉ allowed`. On A's page the query is `has(entityKeys, :A) = true AND serviceId IN (:allowed) = false` → excluded. The membership predicate narrows; it cannot authorize.

Consequence: **owning a *secondary* entity of a signal does not grant access to it.** In the common cases this is exactly right — the primary entity is the natural owner (the service for app telemetry, the host for infra telemetry). The deliberate trade is that a resource owner does not automatically see *every* signal that merely *touched* their resource — only those it *primarily* belongs to. The escape hatch for "infra owner sees all telemetry on their infra" is `scope=All` (platform teams) or the opt-in per-entity-type grant-through (point 6).

Net: keep `serviceId` as the authorization key (also the performant choice — it sits in the primary key), treat `entityKeys` as filtering only, and grow coverage by registering new primary-entity owner tables. No rewrite of `ModelPermission`.

---

## Data Model Changes

### Postgres

- **New** `TelemetryEntity` table (registry; §Proposed Design 2).
- **New** `TelemetryEntityRelationship` table (§Proposed Design 4).
- `Service` / `Host` / `DockerHost` / `KubernetesCluster` gain an optional `telemetryEntityId` FK back to the registry (nullable; populated by backfill).
- Generate via `npm run generate-postgres-migration` and register in `Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts` (per `AGENTS.md`).

### ClickHouse

- Add `entityKeys Array(String)` + `bloom_filter` index (universal membership) and scalar per-type key columns for the hot types (`serviceEntityKey`, `hostEntityKey`, `k8sPodEntityKey`, `k8sNodeEntityKey`, `k8sClusterEntityKey`, `containerEntityKey`) to `Span`, `Log`, `Metric`, `ExceptionInstance`, `Profile`, `ProfileSample` in `Common/Models/AnalyticsModels/`. All non-key → metadata-only `ADD COLUMN`/`ADD INDEX`; `serviceId` and the sort/primary key are unchanged.
- Re-key `MetricItemAggMV1mByHost` on the host entity key (host.id): new MV table + backfill + cutover, sequenced last (a populated `AggregatingMergeTree` sort key can't be altered in place).
- Hand-written migrations in `DataMigrations`, following existing patterns (per `AGENTS.md`).

### Types

- New `EntityType` enum in `Common/Types/Telemetry/` (`service`, `host`, `container`, `k8s.pod`, ...). `ServiceType` is retained for the primary-entity discriminator; `EntityType` is the broader registry/membership vocabulary.
- New `TelemetryEntity` / `TelemetryEntityRelationship` analytics-free database models under `Common/Models/DatabaseModels/`.

---

## Migration / Phasing

Each phase ships independently and is backward compatible.

1. **Identity layer (code only).** `EntityType` enum + per-type identifying sets + `entityKey()` hashing + `extractEntities()`. Unifies the four discovery paths behind the existing primary-entity selection. No schema change, no behavior change.
2. **Registry.** `TelemetryEntity` table; backfill `Service`/`Host`/`DockerHost`/`KubernetesCluster`; start throttled upserts at ingest.
3. **Membership column.** `entityKeys` on signals + bloom index; stamp at ingest; **keep single-owner**. New rows are correct immediately; historical rows fall back to the existing `attributes`-based queries.
4. **Switch reads.** Move Host/Docker/Kubernetes/Service views to `has(entityKeys, ...)`; keep the attribute predicate as a fallback for pre-migration data.
5. **Relationships + topology.** `TelemetryEntityRelationship` writes; topology + service-map read APIs.
6. **MV re-key + `entity_refs` wire support.** Re-key the host MV on entity key; per-entity rollups; parse OTLP `entity_refs` when present.

**No destructive data migration.** Historical ClickHouse rows are not backfilled with `entityKeys` by default (optional batch backfill from `attributes` can run later); until then, read paths fall back to attribute predicates for old time ranges. Existing `(serviceId, serviceType)` semantics are untouched throughout.

---

## Edge Cases & Rules

### High-cardinality / churny entities

`container` (`container.id`) and `process` (`host.id` + pid) churn aggressively (restarts, pid reuse). Rules:

- These are **membership-only by default** — present in `entityKeys`, but **not** promoted to rich `TelemetryEntity` registry rows unless a per-project setting opts in.
- Reuse the existing per-service `metricCardinalityBudget` concept as a per-type **entity budget**; beyond budget, stop creating registry rows (membership keys still flow).
- Prune registry rows whose `lastSeenAt` exceeds a TTL.

### Identity stability

Only the pinned identifying set determines the key. A descriptive attribute changing (image tag, version, IP) must **not** change identity. If a producer emits a mutable value as identifying via `entity_refs`, we honor the ref but log a cardinality warning.

### Missing identity

If an entity type's identifying attrs are absent (e.g. `host.id` and `host.name` both missing), the entity is simply not emitted — no phantom rows. This subsumes today's `hasHostResourceSignal` gate.

### Primary-entity compatibility

The primary `(serviceId, serviceType)` is selected by the **unchanged** precedence ladder. Dashboards, permissions (`@OwnedThrough("serviceId", Service)` per `PermissionsSimplification.md`), retention, and billing that key off `serviceId` keep working with zero changes. `entityKeys` is purely additive.

### Unknown / no-entity batches

Batches with no resolvable entity keep `serviceType = Unknown, serviceId = projectId` and an empty (or project-only) `entityKeys`. Behavior unchanged.

### Tenant isolation

`entityKey` includes `projectId`, so keys never collide across tenants and a `has(entityKeys, key)` predicate is implicitly tenant-scoped (still always AND-ed with `projectId`).

---

## Recommended Decisions

Recorded so future readers don't relitigate them.

1. **Keep typed tables; add a registry.** Do not replace `Service`/`Host`/`DockerHost`/`KubernetesCluster` with one unified table. They hold rich columns and UI; the registry generalizes around them via a polymorphic `(resourceType, resourceId)` pointer.
2. **Membership is the keystone.** The `entityKeys Array(String)` column is the one change that makes "one signal, many entities" real. Land it early; everything else supports it.
3. **Stable hash, not ObjectID, on signals.** Store the payload-derived `entityKey` hash so signal writes never block on registry resolution; reconcile the registry asynchronously.
4. **Keep single-owner; rename the columns (Option B, 2026-06-09).** The single primary-entity concept and its role in the sort key are unchanged, but the columns are renamed `serviceId → primaryEntityId` / `serviceType → primaryEntityType` during the `…V3` cut, with `serviceId`/`serviceType` kept as deprecated API aliases. Semantics are byte-for-byte; only the name changes. The columns are *kept* (auth + identity anchor), distinct from the additive `entityKeys`. See the decision-update note at the top.
5. **Co-occurrence relationships only, for now.** The upstream relationship taxonomy is undefined; infer `relType` from type pairs and don't over-build.
6. **Treat the wire spec as unstable.** Model entities on our terms via heuristic detectors; consume `entity_refs` as an optional authoritative input when producers emit it.
7. **High-churn types are membership-only by default.** Containers/processes flow as membership keys but are not promoted to registry rows without an opt-in, governed by an entity budget + TTL.
8. **Primary entity governs access; `entityKeys` is filter-only.** Authorization stays on `serviceId` via the existing `@OwnedThrough` / `OwnerTableRegistry` / `addOwnedScopeToQuery` path (already polymorphic over Service/Host/DockerHost/KubernetesCluster/Monitor). Secondary entities never widen access; any-owner-union is rejected as a default for security and performance. See Permissions & Access Control.

## Open Questions

1. **Service-dependency derivation.** Do we promote span-derived service→service edges into `TelemetryEntityRelationship` in phase 5, or keep them read-time? (Leaning: persist, so the service map and infra topology share one source.)
2. **Historical backfill.** Is a one-time batch job to populate `entityKeys` on existing ClickHouse rows worth it, or is forward-only + attribute fallback sufficient? Depends on customer retention windows.
3. **`service.instance` as a first-class entity.** Do we want per-instance entities (and per-instance UI), or is service-level enough until there's demand?
4. **Grant-through opt-in.** Primary-owner-governs is the resolved default (see Permissions & Access Control). Do we build the per-entity-type grant-through escape hatch in v1, or defer until a customer asks? (Leaning: defer.)

## Non-Goals

- Replacing the `(serviceId, serviceType)` primary-owner model or its role in partition/sort keys.
- Building full typed tables and bespoke UI for every entity type up front (pods/nodes/processes start registry-only).
- Implementing OTel **entity propagation** (`OTEL_ENTITIES` env var across process boundaries) — that is a producer-side concern, out of scope for ingest/storage.
- Defining a formal relationship taxonomy ahead of the upstream spec.
- Changing retention, billing, or column-level access control.

## References

- [Entity Data Model](https://opentelemetry.io/docs/specs/otel/entities/data-model/) — type / id / description, identifying vs descriptive rules
- [Entities (overview)](https://opentelemetry.io/docs/specs/otel/entities/) and [Entity Propagation](https://opentelemetry.io/docs/specs/otel/entities/entity-propagation/)
- [Resource Data Model](https://opentelemetry.io/docs/specs/otel/resource/data-model/) — resource as a composition of entities
- [OTEP 0256 — Entities Data Model](https://github.com/open-telemetry/oteps/blob/main/text/entities/0256-entities-data-model.md)
- Related internal doc: `PermissionsSimplification.md` (§Telemetry & Analytics Resources — `@OwnedThrough("serviceId", Service)`)
