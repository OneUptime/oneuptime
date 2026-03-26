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

### 1.2 Register HTTP Endpoint

In `Telemetry/API/OTelIngest.ts`, add:

```
POST /otlp/v1/profiles
```

Follow the same pattern as traces/metrics/logs:
1. Parse protobuf or JSON body via `OtelRequestMiddleware`
2. Authenticate via `TelemetryIngest` middleware
3. Return 202 immediately
4. Queue for async processing

### 1.3 Register gRPC Service

In `Telemetry/GrpcServer.ts`, register the `ProfilesService/Export` RPC handler alongside the existing trace/metrics/logs handlers.

### 1.4 Update OTel Collector Config

In `OTelCollector/otel-collector-config.template.yaml`, add a `profiles` pipeline:

```yaml
service:
  pipelines:
    profiles:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp]
```

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
| `attributes` | String (JSON) | Profile-level attributes |
| `resourceAttributes` | String (JSON) | Resource attributes |

**Proposed ClickHouse Table: `profile_sample`**

This is the high-volume table storing individual samples (denormalized for query performance):

| Column | Type | Description |
|--------|------|-------------|
| `projectId` | String (ObjectID) | Tenant ID |
| `serviceId` | String (ObjectID) | Service reference |
| `profileId` | String | FK to profile table |
| `traceId` | String | Trace correlation |
| `spanId` | String | Span correlation |
| `time` | DateTime64(9) | Sample timestamp |
| `stacktrace` | Array(String) | Fully-resolved stack frames (function@file:line) |
| `stacktraceHash` | String | Hash of stacktrace for grouping |
| `value` | Int64 | Sample value (CPU time, bytes, count) |
| `profileType` | String | Denormalized for filtering |
| `labels` | String (JSON) | Sample-level labels |

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
- Alternative: A single table with nested arrays for samples. This is more storage-efficient but makes aggregation queries harder. Start with two tables and revisit if needed.

**Denormalization strategy:**
The OTLP Profiles wire format uses dictionary-based deduplication (string tables, function tables, location tables). At ingestion time, we should **resolve all references** and store fully-materialized stack frames. This trades storage space for query simplicity — the same approach used for span attributes today.

**Expected data volume:**
- A typical eBPF profiler generates ~10-100 samples/second per process
- Each sample with a 20-frame stack ≈ 1-2 KB denormalized
- For 100 services, ~100K-1M samples/minute
- ClickHouse compression (LZ4) reduces this significantly, especially with sorted stacktrace hashes

### 2.3 Create Database Service

Create `Common/Server/Services/ProfileService.ts` extending `AnalyticsDatabaseService<Profile>`.

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

The OTLP Profile message uses dictionary tables for compression. The ingestion service must resolve these:

```
For each sample in profile.sample:
  For each location_index in sample.location_index:
    location = profile.location[location_index]
    For each line in location.line:
      function = profile.function[line.function_index]
      function_name = profile.string_table[function.name]
      file_name = profile.string_table[function.filename]
      frame = "${function_name}@${file_name}:${line.line}"
    Build stacktrace array from frames
  Compute stacktrace_hash = hash(stacktrace)
  Extract value from sample.value[type_index]
  Write denormalized row to buffer
```

**pprof interoperability:**
Store enough metadata to reconstruct pprof format for export. The OTLP Profiles format supports round-trip conversion to/from pprof with no information loss.

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

### 5.3 Cross-Signal Integration

- **Trace Detail Page**: Add a "Profile" tab/button on `TraceExplorer.tsx` that links to the flamegraph filtered by `traceId`.
- **Span Detail**: When viewing a span, show an inline flamegraph if profile samples exist for that `spanId`.
- **Service Overview**: Add a "Profiles" tab on the service detail page showing aggregated flamegraphs.

### 5.4 Navigation

Add "Profiles" to the dashboard sidebar navigation alongside Traces, Metrics, and Logs.

### Estimated Effort: 3-4 weeks

---

## Phase 6: Production Hardening

**Goal**: Make the implementation production-ready.

### 6.1 Data Retention & Billing

- Add `profileRetentionInDays` to service-level settings (alongside existing telemetry retention)
- Add billing metering for profile sample ingestion (samples/month)
- Apply TTL rules on ClickHouse tables

### 6.2 Performance Optimization

- **Materialized Views**: Pre-aggregate top functions per service per hour for fast dashboard loading
- **Sampling**: For high-volume services, support server-side downsampling of profile data
- **Compression**: Evaluate dictionary encoding for `stacktrace` column (high repetition rate)
- **Query Caching**: Cache aggregated flamegraph results for repeated time ranges

### 6.3 Alerting Integration

- Allow alerting on profile metrics (e.g., "alert when function X exceeds Y% of CPU")
- Surface profile data in incident timelines

### 6.4 pprof Export

- Add `GET /profiles/:profileId/pprof` endpoint that converts stored data back to pprof format
- Enables users to download and analyze profiles with existing tools (go tool pprof, etc.)

### Estimated Effort: 2-3 weeks

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
| 6 | Production Hardening | 2-3 weeks | Phase 5 |
| 7 | Documentation & Launch | 1 week | Phase 6 |

**Total estimated effort: 13-19 weeks** (with parallelization of phases 4+5, closer to 10-14 weeks)

---

## Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OTLP Profiles is still Alpha — proto schema may change | Breaking changes to ingestion | Pin to specific OTLP proto version (v1.10.0+), add version detection |
| High storage volume from continuous profiling | ClickHouse disk/cost growth | Server-side sampling, aggressive TTL defaults (7 days), compression tuning |
| Flamegraph rendering performance with large profiles | Slow UI | Limit to top 10K stacktraces, lazy-load deep frames, pre-aggregate |
| Denormalization complexity in ingestion | Bugs, data loss | Extensive unit tests with real pprof data, conformance checker validation |
| Limited client-side instrumentation maturity | Low adoption | Start with eBPF profiler (no code changes needed), expand as ecosystem matures |

---

## References

- [OTel Profiles Alpha Blog Post](https://opentelemetry.io/blog/2026/profiles-alpha/)
- [OTLP Profiles Proto](https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/profiles/v1development/profiles.proto)
- [OTel eBPF Profiling Agent](https://github.com/open-telemetry/opentelemetry-ebpf-profiler)
- [pprof Format](https://github.com/google/pprof)
- [OTel Semantic Conventions for Profiles](https://opentelemetry.io/docs/specs/semconv/general/profiles/)
