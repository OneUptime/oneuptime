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

## Phase 1: Protocol & Ingestion Layer ✅ COMPLETE

**Status**: HTTP endpoint, TelemetryType enum, middleware chain, and queue processing are all implemented.

**Implemented in:**
- HTTP endpoint `POST /otlp/v1/profiles`: `Telemetry/API/OTelIngest.ts`
- TelemetryType.Profile enum: `Common/Types/Telemetry/TelemetryType.ts`
- Queue service: `Telemetry/Services/Queue/ProfilesQueueService.ts`
- Queue handler: `Telemetry/Jobs/TelemetryIngest/ProcessTelemetry.ts`

### Remaining Items

- **1.4 Register gRPC Service** — `ProfilesService/Export` RPC handler not yet registered in `Telemetry/GrpcServer.ts`
- **1.5 Update OTel Collector Config** — No `profiles` pipeline in `OTelCollector/otel-collector-config.template.yaml` yet
- **1.6 Helm Chart Updates** — `TELEMETRY_PROFILE_FLUSH_BATCH_SIZE` env var and KEDA autoscaling updates not yet applied

---

## Phase 2: Data Model & ClickHouse Storage ✅ COMPLETE

**Status**: Both ClickHouse tables (profile, profile_sample) and database services are implemented with full schemas, ZSTD(3) compression, bloom filter skip indexes, and retention date support.

**Implemented in:**
- Profile model: `Common/Models/AnalyticsModels/Profile.ts`
- ProfileSample model: `Common/Models/AnalyticsModels/ProfileSample.ts`
- ProfileService: `Common/Server/Services/ProfileService.ts`
- ProfileSampleService: `Common/Server/Services/ProfileSampleService.ts`
- API routes registered in `App/FeatureSet/BaseAPI/Index.ts`

---

## Phase 3: Ingestion Service ✅ COMPLETE

**Status**: Full OTLP Profiles ingestion is implemented including dictionary denormalization, inline frame handling, mixed-runtime stack support, trace/span correlation via Link table, stacktrace hashing (SHA256), batch processing, and graceful error handling.

**Implemented in:**
- Ingest service (835 lines): `Telemetry/Services/OtelProfilesIngestService.ts`
- Queue service: `Telemetry/Services/Queue/ProfilesQueueService.ts`
- Queue handler: `Telemetry/Jobs/TelemetryIngest/ProcessTelemetry.ts`

---

## Phase 4: Query API ✅ MOSTLY COMPLETE

**Status**: Flamegraph aggregation and function list queries are implemented with tree-building algorithm, filtering by projectId/profileId/serviceId/time ranges/profile type, and a 50K sample limit per query.

**Implemented in:**
- ProfileAggregationService (417 lines): `Common/Server/Services/ProfileAggregationService.ts`
  - `getFlamegraph()` — Aggregated flamegraph tree from samples
  - `getFunctionList()` — Top functions by selfValue, totalValue, or sampleCount
- CRUD routes for profile/profile-sample: `App/FeatureSet/BaseAPI/Index.ts`

### Remaining Items

- **Diff flamegraph endpoint** — `GET /profiles/diff` for comparing two time ranges not yet implemented
- **Cross-signal correlation queries** — Dedicated endpoints for querying profiles by `traceId`/`spanId` (e.g., "View Profile" button on trace detail page)

---

## Phase 5: Frontend — Profiles UI ✅ MOSTLY COMPLETE

**Status**: Core pages (listing, detail view, layout, side menu, documentation) and key components (flamegraph, function list, profiles table) are implemented.

**Implemented in:**
- Pages: `App/FeatureSet/Dashboard/src/Pages/Profiles/` (Index, View/Index, Layout, SideMenu, Documentation)
- Components: `App/FeatureSet/Dashboard/src/Components/Profiles/` (ProfileFlamegraph, ProfileFunctionList, ProfileTable)

### Remaining Items

- **DiffFlameGraph component** — Side-by-side or differential flamegraph comparing two time ranges
- **ProfileTimeline component** — Timeline showing profile sample density over time
- **ProfileTypeSelector component** — Dropdown to select profile type (CPU, heap, goroutine, etc.)
- **Frame type color coding** — Color-code flamegraph frames by `profile.frame.type` (kernel=red/orange, native=blue, managed=green shades)
- **5.4 Cross-Signal Integration**:
  - Trace Detail Page: Add "Profile" tab/button on `TraceExplorer.tsx` linking to flamegraph by `traceId`
  - Span Detail: Inline flamegraph when profile samples exist for a `spanId`
  - Service Overview: "Profiles" tab on service detail page with aggregated flamegraphs

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

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Protocol & Ingestion Layer | ✅ Complete (gRPC, OTel Collector config, Helm chart remaining) |
| 2 | Data Model & ClickHouse Storage | ✅ Complete |
| 3 | Ingestion Service | ✅ Complete |
| 4 | Query API | ✅ Mostly complete (diff flamegraph, cross-signal endpoints remaining) |
| 5 | Frontend — Profiles UI | ✅ Mostly complete (diff view, timeline, color coding, cross-signal integration remaining) |
| 6 | Production Hardening | ❌ Not started |
| 7 | Documentation & Launch | ❌ Not started |

**Remaining work is primarily:** Phase 1 gaps (gRPC/Helm), Phase 4-5 advanced features (diff flamegraphs, cross-signal integration, frame type color coding), and all of Phases 6-7 (symbolization, alerting, pprof export, conformance, docs).

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
