# OpenTelemetry Profiles: Remaining Roadmap

All core phases (ingestion, storage, query API, frontend UI, alerting, docs) are implemented. This document tracks remaining future work items.

---

## Performance Optimization

- **Materialized Views**: Pre-aggregate top functions per service per hour for faster queries
- **Server-Side Sampling**: Downsampling for high-volume services to control storage costs
- **Query Caching**: Cache aggregated flamegraph results to reduce ClickHouse load

## Symbolization Pipeline

Symbolization is NOT yet standardized in the OTel Profiles spec. The eBPF agent handles on-target symbolization for Go, and many runtimes provide symbol info at collection time. A dedicated symbolization pipeline (symbol uploads, deferred re-symbolization, object storage) can be added once the spec stabilizes.

## Conformance Validation

Integrate OTel `profcheck` tool into CI once core profiling features stabilize.

---

## Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OTLP Profiles is still Alpha — proto schema may change | Breaking changes to ingestion | Pin to specific OTLP proto version (v1.10.0+), add version detection |
| `v1development` package path will change to `v1` at GA | Proto import path migration | Abstract proto version behind internal types; plan migration script for when GA lands |
| High storage volume from continuous profiling | ClickHouse disk/cost growth | Server-side sampling, aggressive TTL defaults (15 days), ZSTD(3) compression |
| Flamegraph rendering performance with large profiles | Slow UI | Limit to top 10K stacktraces, lazy-load deep frames, pre-aggregate via materialized views |
| Symbolization is not standardized | Unsymbolized frames in flamegraphs | Store build IDs for deferred symbolization; accept eBPF agent's on-target symbolization as baseline |
| Semantic conventions are minimal (only `profile.frame.type`) | Schema may need changes as conventions mature | Keep attribute storage flexible (JSON columns); avoid hardcoding specific attribute names |

---

## References

- [OTel Profiles Alpha Blog Post](https://opentelemetry.io/blog/2026/profiles-alpha/)
- [OTLP Profiles Proto](https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/profiles/v1development/profiles.proto)
- [OTel eBPF Profiling Agent](https://github.com/open-telemetry/opentelemetry-ebpf-profiler)
- [pprof Format](https://github.com/google/pprof)
- [OTel Semantic Conventions for Profiles](https://opentelemetry.io/docs/specs/semconv/general/profiles/)
