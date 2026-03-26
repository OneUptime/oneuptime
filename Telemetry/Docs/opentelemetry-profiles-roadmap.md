# OpenTelemetry Profiles: Implementation Roadmap for OneUptime

## Overview

OpenTelemetry Profiles is the fourth core observability signal (joining traces, metrics, and logs), providing a unified standard for continuous production profiling. As of March 2026, it has reached **Public Alpha** status. This document outlines how OneUptime can add first-class support for ingesting, storing, querying, and visualizing profiling data.

Reference: https://opentelemetry.io/blog/2026/profiles-alpha/

---

## Why Profiles Matter for OneUptime

- **Complete Observability**: Profiles fill the gap between "what happened" (traces/logs) and "why it was slow" (CPU/memory/allocation hotspots).
- **Cross-Signal Correlation**: Profile samples carry `trace_id` and `span_id`, enabling direct linkage from a slow span to the exact flamegraph showing where time was spent.
- **Cost Optimization**: Customers can use profiles to identify wasteful code paths and reduce compute costs.
- **Competitive Parity**: Major vendors (Datadog, Grafana, Elastic) are actively building OTLP Profiles support.

---

## Current Architecture (Context)

OneUptime already ingests three OTel signals through a consistent pipeline:

```
Client --> gRPC (4317) / HTTP (/otlp/v1/{signal})
       --> OtelRequestMiddleware (protobuf/JSON decode)
       --> TelemetryIngest Middleware (auth)
       --> 202 Accepted (immediate response)
       --> Bull MQ Queue (async)
       --> Ingest Service (batch processing)
       --> ClickHouse (MergeTree tables)
```

Key files to reference:
- Ingestion endpoints: `Telemetry/API/OTelIngest.ts`
- gRPC server: `Telemetry/GrpcServer.ts`
- Proto files: `Telemetry/ProtoFiles/OTel/v1/`
- Analytics models: `Common/Models/AnalyticsModels/`
- Queue services: `Telemetry/Services/Queue/`

The Profiles implementation should follow this exact same pattern for consistency.

---

## Phase 1: Protocol & Ingestion Layer

**Goal**: Accept OTLP Profiles data over gRPC and HTTP.

### 1.1 Add Protobuf Definitions

Add the profiles proto files to `Telemetry/ProtoFiles/OTel/v1/`:

- `profiles.proto` — Core profiles data model (from `opentelemetry/proto/profiles/v1development/profiles.proto`)
- `profiles_service.proto` — ProfilesService with `Export` RPC

**Important:** The proto package is `opentelemetry.proto.profiles.v1development` (not `v1`). This `v1development` path will change to `v1` when Profiles reaches GA. Plan for this migration (see Risks section).

The OTLP Profiles format uses a **deduplicated stack representation** where each unique callstack is stored once, with dictionary tables for common entities (functions, locations, mappings). Key message types:

```protobuf
message ExportProfilesServiceRequest {
  repeated ResourceProfiles resource_profiles = 1;
}

message ResourceProfiles {
  Resource resource = 1;
  repeated ScopeProfiles scope_profiles = 2;
  string schema_url = 3;
}

message ScopeProfiles {
  InstrumentationScope scope = 1;
  repeated ProfileContainer profiles = 2;
}

message ProfileContainer {
  bytes profile_id = 1;
  int64 start_time_unix_nano = 2;
  int64 end_time_unix_nano = 3;
  Profile profile = 5;
  // ...attributes, dropped_attributes_count
}

// NOTE: ProfilesDictionary is batch-scoped (shared across all profiles
// in a ProfilesData message), NOT per-profile. The ingestion service
// must pass the dictionary context when processing individual profiles.
message ProfilesDictionary {
  repeated string string_table = 1;
  repeated Mapping mapping_table = 2;
  repeated Location location_table = 3;
  repeated Function function_table = 4;
  repeated Link link_table = 5;
  // ...
}

message Profile {
  repeated ValueType sample_type = 1;
  repeated Sample sample = 2;
  int64 time_unix_nano = 3;
  int64 duration_nano = 4;
  ValueType period_type = 5;
  int64 period = 6;
  bytes profile_id = 7;
  repeated int32 attribute_indices = 8;
  uint32 dropped_attributes_count = 9;
  string original_payload_format = 10;  // e.g., "pprofext"
  bytes original_payload = 11;          // raw pprof bytes for round-tripping
}

message Sample {
  int32 stack_index = 1;
  repeated int64 values = 2;
  repeated int32 attribute_indices = 3;
  int32 link_index = 4;
  repeated int64 timestamps_unix_nano = 5;  // NOTE: repeated — multiple timestamps per sample
}
```

### 1.2 Add TelemetryType Enum Value

In `Common/Types/Telemetry/TelemetryType.ts`, add `Profile = "Profile"` to the existing enum (currently: Metric, Trace, Log, Exception).

### 1.3 Register HTTP Endpoint

In `Telemetry/API/OTelIngest.ts`, add:

```
POST /otlp/v1/profiles
```

Follow the same middleware chain as traces/metrics/logs:
1. `OpenTelemetryRequestMiddleware.getProductType` — Decode protobuf/JSON, set `ProductType.Profiles`
2. `TelemetryIngest.isAuthorizedServiceMiddleware` — Validate `x-oneuptime-token`, extract `projectId`
3. Return 202 immediately
4. Queue for async processing

### 1.4 Register gRPC Service

In `Telemetry/GrpcServer.ts`, register the `ProfilesService/Export` RPC handler alongside the existing trace/metrics/logs handlers.

### 1.5 Update OTel Collector Config

In `OTelCollector/otel-collector-config.template.yaml`, add a `profiles` pipeline to the existing three pipelines (traces, metrics, logs):

```yaml
service:
  pipelines:
    profiles:
      receivers: [otlp]
      processors: []
      exporters: [otlphttp]
```

**Note:** The OTel Collector in OneUptime is primarily used by the Kubernetes Agent. The main telemetry service handles OTLP ingestion directly. Also note: the OTel Arrow receiver does NOT yet support profiles.

### 1.6 Helm Chart Updates

In `HelmChart/Public/oneuptime/templates/telemetry.yaml`:
- No port changes needed (profiles use the same gRPC 4317 and HTTP 3403 ports)
- Add `TELEMETRY_PROFILE_FLUSH_BATCH_SIZE` environment variable
- Update KEDA autoscaling config to account for profiles queue load

### Estimated Effort: 1-2 weeks

---

## Phase 2: Data Model & ClickHouse Storage

**Goal**: Design an efficient ClickHouse schema for profile data.

### 2.1 Design the Analytics Model

Create `Common/Models/AnalyticsModels/Profile.ts` following the pattern of `Span.ts`, `Metric.ts`, `Log.ts`.

**Proposed ClickHouse Table: `profile`**

| Column | Type | Description |
|--------|------|-------------|
| `projectId` | String (ObjectID) | Tenant ID |
| `serviceId` | String (ObjectID) | Service reference |
| `profileId` | String | Unique profile identifier |
| `traceId` | String | Correlation with traces |
| `spanId` | String | Correlation with spans |
| `startTime` | DateTime64(9) | Profile start timestamp |
| `endTime` | DateTime64(9) | Profile end timestamp |
| `duration` | UInt64 | Duration in nanoseconds |
| `profileType` | String | e.g., `cpu`, `wall`, `alloc_objects`, `alloc_space`, `goroutine` |
| `unit` | String | e.g., `nanoseconds`, `bytes`, `count` |
| `periodType` | String | Sampling period type |
| `period` | Int64 | Sampling period value |
| `attributes` | String (JSON) | Profile-level attributes (note: `KeyValueAndUnit`, not `KeyValue` — includes `unit` field) |
| `resourceAttributes` | String (JSON) | Resource attributes |
| `originalPayloadFormat` | String | e.g., `pprofext` — for pprof round-tripping |
| `originalPayload` | String (base64) | Raw pprof bytes (optional, for lossless re-export) |
| `retentionDate` | DateTime64 | TTL column for automatic expiry (pattern from existing tables) |

**Proposed ClickHouse Table: `profile_sample`**

This is the high-volume table storing individual samples (denormalized for query performance):

| Column | Type | Description |
|--------|------|-------------|
| `projectId` | String (ObjectID) | Tenant ID |
| `serviceId` | String (ObjectID) | Service reference |
| `profileId` | String | FK to profile table |
| `traceId` | String | Trace correlation (from Link table) |
| `spanId` | String | Span correlation (from Link table) |
| `time` | DateTime64(9) | Sample timestamp |
| `stacktrace` | Array(String) | Fully-resolved stack frames (function@file:line) |
| `stacktraceHash` | String | Hash of stacktrace for grouping |
| `frameTypes` | Array(String) | Per-frame runtime type (`kernel`, `native`, `jvm`, `cpython`, `go`, `v8js`, etc.) |
| `value` | Int64 | Sample value (CPU time, bytes, count) |
| `profileType` | String | Denormalized for filtering |
| `labels` | String (JSON) | Sample-level labels |
| `buildId` | String | Executable build ID (for deferred symbolization) |
| `retentionDate` | DateTime64 | TTL column for automatic expiry |

**Table Engine & Indexing:**
- Engine: `MergeTree`
- Partition by: `toYYYYMMDD(time)`
- Primary key: `(projectId, serviceId, time)`
- Order by: `(projectId, serviceId, time, profileType, stacktraceHash)`
- TTL: `time + INTERVAL dataRetentionInDays DAY`
- Skip indexes on `profileType`, `traceId`, `stacktraceHash`

### 2.2 Storage Considerations

**Why two tables?**
- The `profile` table stores metadata and is low-volume — used for listing/filtering profiles.
- The `profile_sample` table stores denormalized samples — high-volume but optimized for flamegraph aggregation queries.
- This mirrors the existing pattern where `ExceptionInstance` (ClickHouse) is a sub-signal of `Span`, with its own table but linked via `traceId`/`spanId`.
- Alternative: A single table with nested arrays for samples. This is more storage-efficient but makes aggregation queries harder. Start with two tables and revisit if needed.

**Denormalization strategy:**
The OTLP Profiles wire format uses dictionary-based deduplication (string tables, function tables, location tables). **Critically, the `ProfilesDictionary` is shared across ALL profiles in a `ProfilesData` batch** — you cannot process individual profiles without the batch-level dictionary context.

At ingestion time, we should **resolve all dictionary references** and store fully-materialized stack frames. This trades storage space for query simplicity — the same approach used for span attributes today.

**Inline frame handling:**
`Location.lines` is a repeated field supporting inlined functions — a single location can expand to multiple logical frames. The denormalization logic must expand these into the full stacktrace array.

**`original_payload` storage decision:**
The `Profile` message includes `original_payload_format` and `original_payload` fields containing the raw pprof bytes. Storing this enables lossless pprof round-trip export but significantly increases storage. Options:
- **Store always**: Full pprof compatibility, ~2-5x storage increase
- **Store on demand**: Only when `original_payload_format` is set (opt-in by producer)
- **Don't store**: Reconstruct pprof from denormalized data (lossy for some edge cases)

Recommendation: Store on demand (option 2) — only persist when the producer explicitly includes it.

**Expected data volume:**
- A typical eBPF profiler generates ~10-100 samples/second per process
- Each sample with a 20-frame stack ≈ 1-2 KB denormalized
- For 100 services, ~100K-1M samples/minute
- ClickHouse compression (LZ4) reduces this significantly, especially with sorted stacktrace hashes

### 2.3 Create Database Service

Create `Common/Server/Services/ProfileService.ts` and `Common/Server/Services/ProfileSampleService.ts` extending `AnalyticsDatabaseService<Profile>` and `AnalyticsDatabaseService<ProfileSample>`.

Add `TableBillingAccessControl` to both models following the pattern in existing analytics models to enable plan-based billing constraints on profile ingestion/querying.

### 2.4 Data Migration

Follow the migration pattern from `Worker/DataMigrations/AddRetentionDateAndSkipIndexesToTelemetryTables.ts`:
- Add `retentionDate` column with TTL expression: `retentionDate DELETE`
- Add skip indexes: `bloom_filter` on `traceId`, `profileId`, `stacktraceHash`; `set` on `profileType`
- Apply `ZSTD(3)` codec on `stacktrace` and `labels` columns (high compression benefit)
- Default retention: 15 days (matching existing telemetry defaults)

### Estimated Effort: 2-3 weeks

---

## Phase 3: Ingestion Service

**Goal**: Process OTLP Profiles payloads and write to ClickHouse.

### 3.1 Create Ingest Service

Create `Telemetry/Services/OtelProfilesIngestService.ts` extending `OtelIngestBaseService`:

```typescript
class OtelProfilesIngestService extends OtelIngestBaseService {
  // Entry point
  async ingestProfiles(request: ExportProfilesServiceRequest): Promise<void>;

  // Denormalize OTLP profile data:
  // 1. Resolve string_table references
  // 2. Resolve function/location/mapping references
  // 3. Build fully-qualified stack frames per sample
  // 4. Extract trace_id/span_id for correlation
  // 5. Buffer and batch-insert into ClickHouse
  async processProfile(profile: ProfileContainer, resource: Resource): Promise<void>;

  // Flush buffer (batch size: 500 samples)
  async flushProfilesBuffer(): Promise<void>;
}
```

### 3.2 Create Queue Service

Create `Telemetry/Services/Queue/ProfilesQueueService.ts`:
- Add `TelemetryType.Profiles` enum value
- Register queue handler in `Telemetry/Jobs/TelemetryIngest/ProcessTelemetry.ts`
- Batch size: 500 (start conservative, tune later)

### 3.3 Key Implementation Details

**Denormalization logic** (the hardest part of this phase):

The OTLP Profile message uses dictionary tables for compression. **The dictionary is batch-scoped** — it lives on the `ProfilesData` message, not on individual `Profile` messages. The ingestion service must pass the dictionary when processing each profile.

```
dictionary = profilesData.dictionary  // batch-level dictionary

For each resourceProfiles in profilesData.resource_profiles:
  For each scopeProfiles in resourceProfiles.scope_profiles:
    For each profile in scopeProfiles.profiles:
      For each sample in profile.sample:
        stack = dictionary.stack_table[sample.stack_index]
        For each location_index in stack.location_indices:
          location = dictionary.location_table[location_index]
          // Handle INLINE FRAMES: location.lines is repeated
          For each line in location.lines:
            function = dictionary.function_table[line.function_index]
            function_name = dictionary.string_table[function.name_strindex]
            system_name = dictionary.string_table[function.system_name_strindex]  // mangled name
            file_name = dictionary.string_table[function.filename_strindex]
            frame_type = attributes[profile.frame.type]  // kernel, native, jvm, etc.
            frame = "${function_name}@${file_name}:${line.line}"
          Build stacktrace array from all frames (including inlined)
        Compute stacktrace_hash = SHA256(stacktrace)

        // Resolve trace correlation from Link table
        link = dictionary.link_table[sample.link_index]
        trace_id = link.trace_id
        span_id = link.span_id

        // Note: sample.timestamps_unix_nano is REPEATED (multiple timestamps per sample)
        // Use first timestamp as sample time, store all if needed

        Extract value from sample.values[type_index]
        Write denormalized row to buffer
```

**Mixed-runtime stacks:**
The eBPF agent produces stacks that cross kernel/native/managed boundaries (e.g., kernel → libc → JVM → application Java code). Each frame has a `profile.frame.type` attribute. Store this per-frame in the `frameTypes` array column for proper rendering.

**Unsymbolized frames:**
Not all frames will be symbolized at ingestion time (especially native/kernel frames from eBPF). Store the mapping `build_id` attributes (`process.executable.build_id.gnu`, `.go`, `.htlhash`) so frames can be symbolized later when debug info becomes available. See Phase 6 for symbolization pipeline.

**pprof interoperability:**
If `original_payload_format` is set (e.g., `pprofext`), store the `original_payload` bytes for lossless re-export. The OTLP Profiles format supports round-trip conversion to/from pprof with no information loss.

### Estimated Effort: 2-3 weeks

---

## Phase 4: Query API

**Goal**: Expose APIs for querying and aggregating profile data.

### 4.1 Core Query Endpoints

Add to the telemetry API router:

| Endpoint | Purpose |
|----------|---------|
| `GET /profiles` | List profiles with filters (service, time range, profile type) |
| `GET /profiles/:profileId` | Get profile metadata |
| `GET /profiles/:profileId/flamegraph` | Aggregated flamegraph data for a single profile |
| `GET /profiles/aggregate/flamegraph` | Aggregated flamegraph across multiple profiles (time range) |
| `GET /profiles/function-list` | Top functions by self/total time |
| `GET /profiles/diff` | Diff flamegraph between two time ranges |

### 4.2 Flamegraph Aggregation Query

The core query for flamegraph rendering in ClickHouse:

```sql
SELECT
  stacktrace,
  SUM(value) as total_value
FROM profile_sample
WHERE projectId = {projectId}
  AND serviceId = {serviceId}
  AND time BETWEEN {startTime} AND {endTime}
  AND profileType = {profileType}
GROUP BY stacktrace
ORDER BY total_value DESC
LIMIT 10000
```

The API layer then builds a tree structure from flat stacktraces for the frontend flamegraph component.

### 4.3 Cross-Signal Correlation Queries

Leverage `traceId`/`spanId` columns for correlation:

```sql
-- Get profile samples for a specific trace
SELECT stacktrace, SUM(value) as total_value
FROM profile_sample
WHERE projectId = {projectId}
  AND traceId = {traceId}
GROUP BY stacktrace

-- Get profile samples for a specific span
SELECT stacktrace, SUM(value) as total_value
FROM profile_sample
WHERE projectId = {projectId}
  AND spanId = {spanId}
GROUP BY stacktrace
```

This enables a "View Profile" button on the trace detail page.

### Estimated Effort: 2 weeks

---

## Phase 5: Frontend — Profiles UI

**Goal**: Build the profiles exploration and visualization UI.

### 5.1 New Pages & Routes

Add to `App/FeatureSet/Dashboard/src/`:

- `Pages/Profiles/ProfileList.tsx` — List/search profiles by service, time range, type
- `Pages/Profiles/ProfileDetail.tsx` — Single profile detail view
- `Routes/ProfilesRoutes.tsx` — Route definitions

### 5.2 Core Components

| Component | Purpose |
|-----------|---------|
| `Components/Profiles/FlameGraph.tsx` | Interactive flamegraph (CPU/memory/alloc). Consider using an existing open-source flamegraph library (e.g., `speedscope` or `d3-flame-graph`) |
| `Components/Profiles/FunctionList.tsx` | Table of functions sorted by self/total time with search |
| `Components/Profiles/ProfileTypeSelector.tsx` | Dropdown to select profile type (CPU, heap, goroutine, etc.) |
| `Components/Profiles/DiffFlameGraph.tsx` | Side-by-side or differential flamegraph comparing two time ranges |
| `Components/Profiles/ProfileTimeline.tsx` | Timeline showing profile sample density over time |

**Frame type color coding:**
Mixed-runtime stacks from the eBPF agent contain frames from different runtimes (kernel, native, JVM, CPython, Go, V8, etc.). The flamegraph component should color-code frames by their `profile.frame.type` attribute so users can visually distinguish application code from kernel/native/runtime internals. Suggested palette:
- Kernel frames: red/orange
- Native (C/C++/Rust): blue
- JVM/Go/V8/CPython/Ruby: green shades (per runtime)

### 5.3 Sidebar Navigation

Create `Pages/Profiles/SideMenu.tsx` following the existing pattern (see `Pages/Traces/SideMenu.tsx`, `Pages/Metrics/SideMenu.tsx`, `Pages/Logs/SideMenu.tsx`):
- Main section: "Profiles" → PageMap.PROFILES
- Documentation section: Link to PROFILES_DOCUMENTATION route

Add "Profiles" entry to the main dashboard navigation sidebar.

### 5.4 Cross-Signal Integration

- **Trace Detail Page**: Add a "Profile" tab/button on `TraceExplorer.tsx` that links to the flamegraph filtered by `traceId`.
- **Span Detail**: When viewing a span, show an inline flamegraph if profile samples exist for that `spanId`.
- **Service Overview**: Add a "Profiles" tab on the service detail page showing aggregated flamegraphs.

### Estimated Effort: 3-4 weeks

---

## Phase 6: Production Hardening

**Goal**: Make the implementation production-ready.

### 6.1 Data Retention & Billing

- Add `profileRetentionInDays` to service-level settings (alongside existing `retainTelemetryDataForDays`)
- Add billing metering for profile sample ingestion (samples/month) via `TableBillingAccessControl`
- Apply TTL rules on ClickHouse tables using `retentionDate DELETE` pattern

### 6.2 Performance Optimization

- **Materialized Views**: Pre-aggregate top functions per service per hour for fast dashboard loading
- **Sampling**: For high-volume services, support server-side downsampling of profile data
- **Compression**: Apply `ZSTD(3)` codec on `stacktrace`, `labels`, and `originalPayload` columns
- **Query Caching**: Cache aggregated flamegraph results for repeated time ranges

### 6.3 Symbolization Pipeline

**This is a significant piece of work.** Symbolization is NOT yet standardized in the OTel Profiles spec. OneUptime needs its own strategy:

1. **Store build IDs at ingestion**: Persist `process.executable.build_id.gnu`, `.go`, `.htlhash` attributes from mappings
2. **Accept symbol uploads**: Provide an API endpoint where users can upload debug symbols (DWARF, PDB, source maps) keyed by build ID
3. **Deferred symbolization**: When symbols are uploaded, re-symbolize existing unsymbolized frames in ClickHouse by matching `buildId` + address
4. **Symbol storage**: Store uploaded symbols in object storage (S3/MinIO), indexed by build ID hash

This can be deferred to a later release — the eBPF agent handles on-target symbolization for Go, and many runtimes (JVM, CPython, V8) provide symbol info at collection time. Native/kernel frames are the main gap.

### 6.4 Alerting & Monitoring Integration

Following the existing pattern in `Worker/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts`:
- Add `MonitorStepProfileMonitor` configuration type
- Add `ProfileMonitorResponse` response type
- Add `MonitorType.Profiles` to the monitor type enum
- Enable alerting on profile metrics (e.g., "alert when function X exceeds Y% of CPU")
- Surface profile data in incident timelines

### 6.5 pprof Export

- Add `GET /profiles/:profileId/pprof` endpoint that converts stored data back to pprof format
- If `original_payload` was stored, return it directly (lossless)
- Otherwise, reconstruct pprof from denormalized data
- Enables users to download and analyze profiles with existing tools (go tool pprof, etc.)

### 6.6 Conformance Validation

Integrate the OTel `profcheck` conformance checker tool into CI to validate that OneUptime correctly accepts and processes compliant profiles. This catches regressions when upgrading proto definitions.

### Estimated Effort: 3-4 weeks

---

## Phase 7: Documentation & Launch

### 7.1 User-Facing Docs

Add `App/FeatureSet/Docs/Content/telemetry/profiles.md`:
- How to instrument your application for continuous profiling
- Configuring the OTel eBPF profiler agent
- Configuring async-profiler (Java) with OTLP export
- Viewing profiles in OneUptime
- Cross-signal correlation (profiles + traces)

### 7.2 Example Data

Add `Telemetry/Docs/profileData.example.json` with a sample OTLP Profiles payload.

### Estimated Effort: 1 week

---

## Summary Timeline

| Phase | Description | Effort | Dependencies |
|-------|-------------|--------|--------------|
| 1 | Protocol & Ingestion Layer | 1-2 weeks | None |
| 2 | Data Model & ClickHouse Storage | 2-3 weeks | Phase 1 |
| 3 | Ingestion Service | 2-3 weeks | Phase 1, 2 |
| 4 | Query API | 2 weeks | Phase 2, 3 |
| 5 | Frontend — Profiles UI | 3-4 weeks | Phase 4 |
| 6 | Production Hardening (incl. symbolization, alerting, conformance) | 3-4 weeks | Phase 5 |
| 7 | Documentation & Launch | 1 week | Phase 6 |

**Total estimated effort: 14-21 weeks** (with parallelization of phases 4+5, closer to 11-16 weeks)

**Suggested MVP scope (Phases 1-5):** Ship ingestion + storage + basic flamegraph UI first (~9-14 weeks). Symbolization, alerting integration, and pprof export can follow as iterative improvements.

---

## Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OTLP Profiles is still Alpha — proto schema may change | Breaking changes to ingestion | Pin to specific OTLP proto version (v1.10.0+), add version detection |
| `v1development` package path will change to `v1` at GA | Proto import path migration | Abstract proto version behind internal types; plan migration script for when GA lands |
| High storage volume from continuous profiling | ClickHouse disk/cost growth | Server-side sampling, aggressive TTL defaults (15 days), ZSTD(3) compression |
| Flamegraph rendering performance with large profiles | Slow UI | Limit to top 10K stacktraces, lazy-load deep frames, pre-aggregate via materialized views |
| Denormalization complexity (batch-scoped dictionary, inline frames, mixed runtimes) | Bugs, data loss | Extensive unit tests with real pprof data, conformance checker validation, test with eBPF agent output |
| Symbolization is not standardized | Unsymbolized frames in flamegraphs | Store build IDs for deferred symbolization; accept eBPF agent's on-target symbolization as baseline |
| Semantic conventions are minimal (only `profile.frame.type`) | Schema may need changes as conventions mature | Keep attribute storage flexible (JSON columns); avoid hardcoding specific attribute names |
| Limited client-side instrumentation maturity | Low adoption | Start with eBPF profiler (no code changes needed), expand as ecosystem matures |
| `original_payload` can be large | Storage bloat | Store on-demand only (when producer sets `original_payload_format`), not by default |

---

## References

- [OTel Profiles Alpha Blog Post](https://opentelemetry.io/blog/2026/profiles-alpha/)
- [OTLP Profiles Proto](https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/profiles/v1development/profiles.proto)
- [OTel eBPF Profiling Agent](https://github.com/open-telemetry/opentelemetry-ebpf-profiler)
- [pprof Format](https://github.com/google/pprof)
- [OTel Semantic Conventions for Profiles](https://opentelemetry.io/docs/specs/semconv/general/profiles/)
