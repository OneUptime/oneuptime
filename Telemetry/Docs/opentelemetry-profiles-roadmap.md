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

**Status**: HTTP endpoint, gRPC service, TelemetryType enum, middleware chain, queue processing, and OTel Collector pipeline are all implemented.

**Implemented in:**
- HTTP endpoint `POST /otlp/v1/profiles`: `Telemetry/API/OTelIngest.ts`
- gRPC ProfilesService/Export: `Telemetry/GrpcServer.ts`
- TelemetryType.Profile enum: `Common/Types/Telemetry/TelemetryType.ts`
- Queue service: `Telemetry/Services/Queue/ProfilesQueueService.ts`
- Queue handler: `Telemetry/Jobs/TelemetryIngest/ProcessTelemetry.ts`
- OTel Collector profiles pipeline: `OTelCollector/otel-collector-config.template.yaml`

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

## Phase 4: Query API ✅ COMPLETE

**Status**: Flamegraph aggregation, function list, diff flamegraph, and pprof export queries are all implemented.

**Implemented in:**
- ProfileAggregationService: `Common/Server/Services/ProfileAggregationService.ts`
  - `getFlamegraph()` — Aggregated flamegraph tree from samples
  - `getFunctionList()` — Top functions by selfValue, totalValue, or sampleCount
  - `getDiffFlamegraph()` — Differential flamegraph comparing two time ranges
- API endpoints in `Common/Server/API/TelemetryAPI.ts`:
  - `POST /telemetry/profiles/flamegraph`
  - `POST /telemetry/profiles/function-list`
  - `POST /telemetry/profiles/diff-flamegraph`
  - `GET /telemetry/profiles/:profileId/pprof`
- CRUD routes for profile/profile-sample: `App/FeatureSet/BaseAPI/Index.ts`
- pprof encoder: `Common/Server/Utils/Profile/PprofEncoder.ts`

---

## Phase 5: Frontend — Profiles UI ✅ COMPLETE

**Status**: All pages, components, cross-signal integration, and service-level profiles tab are implemented.

**Implemented in:**
- Pages: `App/FeatureSet/Dashboard/src/Pages/Profiles/` (Index, View/Index, Layout, SideMenu, Documentation)
- Components: `App/FeatureSet/Dashboard/src/Components/Profiles/`
  - ProfileFlamegraph — Interactive flamegraph with frame type color coding and zoom
  - ProfileFunctionList — Top functions table with sorting
  - ProfileTable — Profiles listing with service/type/attribute filters
  - ProfileTypeSelector — Dropdown filter for profile types (cpu, wall, alloc_objects, etc.)
  - ProfileTimeline — Bar chart showing profile sample density over time
  - DiffFlamegraph — Differential flamegraph comparing two time ranges (red=regression, green=improvement)
- Frame type color coding: `App/FeatureSet/Dashboard/src/Utils/ProfileUtil.ts`
- Cross-Signal Integration:
  - "View Profiles for this Trace" link in TraceExplorer span tooltips
  - Service > Profiles tab: `App/FeatureSet/Dashboard/src/Pages/Service/View/Profiles.tsx`
  - Route and side menu wiring for service-level profiles view

---

## Phase 6: Production Hardening ✅ MOSTLY COMPLETE

**Status**: Data retention, billing, compression, alerting, and pprof export are implemented. Symbolization pipeline and conformance validation are deferred.

### 6.1 Data Retention & Billing ✅ COMPLETE
- TTL via `retentionDate DELETE` on both Profile and ProfileSample tables
- Billing metering in `Common/Server/Services/TelemetryUsageBillingService.ts`
- ZSTD compression on text columns, bloom filter skip indexes

### 6.2 Performance Optimization — Partially done
- **Compression**: ✅ ZSTD(3) codec applied on stacktrace, labels columns
- **Materialized Views**: ❌ Deferred — pre-aggregate top functions per service per hour
- **Sampling**: ❌ Deferred — server-side downsampling for high-volume services
- **Query Caching**: ❌ Deferred — cache aggregated flamegraph results

### 6.3 Symbolization Pipeline — ❌ Deferred (Future Work)
Symbolization is NOT yet standardized in the OTel Profiles spec. The eBPF agent handles on-target symbolization for Go, and many runtimes provide symbol info at collection time. A dedicated symbolization pipeline (symbol uploads, deferred re-symbolization, object storage) can be added in a future release.

### 6.4 Alerting & Monitoring Integration ✅ COMPLETE
**Implemented in:**
- `MonitorType.Profiles` added to enum: `Common/Types/Monitor/MonitorType.ts`
- `CheckOn.ProfileCount` added: `Common/Types/Monitor/CriteriaFilter.ts`
- `ProfileMonitorResponse`: `Common/Types/Monitor/ProfileMonitor/ProfileMonitorResponse.ts`
- `ProfileMonitorCriteria`: `Common/Server/Utils/Monitor/Criteria/ProfileMonitorCriteria.ts`
- `MonitorStep` updated with `profileMonitor` field: `Common/Types/Monitor/MonitorStep.ts`
- `MonitorCriteriaEvaluator` wired for Profiles: `Common/Server/Utils/Monitor/MonitorCriteriaEvaluator.ts`
- `monitorProfile()` function: `Worker/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts`

### 6.5 pprof Export ✅ COMPLETE
**Implemented in:**
- `GET /telemetry/profiles/:profileId/pprof`: `Common/Server/API/TelemetryAPI.ts`
- PprofEncoder utility: `Common/Server/Utils/Profile/PprofEncoder.ts`
- Reconstructs pprof-compatible JSON from denormalized data, gzip compressed

### 6.6 Conformance Validation — ❌ Deferred (Future Work)
Integrate OTel `profcheck` tool into CI once core profiling features stabilize.

---

## Phase 7: Documentation & Launch ✅ COMPLETE

### 7.1 User-Facing Docs ✅ COMPLETE
- Comprehensive profiles documentation: `App/FeatureSet/Docs/Content/telemetry/profiles.md`
- Covers: profile types, setup instructions, instrumentation guides (Alloy, async-profiler, Go pprof, py-spy), OTel Collector config, features, and data retention

---

## Summary Timeline

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Protocol & Ingestion Layer | ✅ Complete |
| 2 | Data Model & ClickHouse Storage | ✅ Complete |
| 3 | Ingestion Service | ✅ Complete |
| 4 | Query API | ✅ Complete |
| 5 | Frontend — Profiles UI | ✅ Complete |
| 6 | Production Hardening | ✅ Mostly complete (symbolization + conformance deferred) |
| 7 | Documentation & Launch | ✅ Complete |

**Remaining future work:** Symbolization pipeline (symbol uploads, deferred re-symbolization), materialized views for performance, server-side downsampling, query caching, and OTel profcheck CI integration.

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
