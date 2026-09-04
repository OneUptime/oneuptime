# Concurrent ingestion CPU and memory improvements

This follow-up starts from master `0b23baed11`, after the improvements documented
in [RuntimeResourceUsage.md](./RuntimeResourceUsage.md). It removes repeated work
and excess buffering when many requests or monitors run together. No schema
migration, dependency update, or deployment configuration change is required.

## Changes

### Share concurrent pipeline loads

Log and trace pipeline loaders now share a pending load for the same project and
signal. A burst of cold requests previously repeated every pipeline/processor
query, filter compilation, and configuration allocation before the first load
populated the existing cache. All callers now receive the same loaded graph.

The existing 60-second result TTL, 10,000-project limit per signal, enabled
predicates, query limits, and database sort order are preserved. The TTL starts
when loading completes. Failures reach every waiter and release the slot for
retry. Results for different projects and signals remain independent.

Pending entries are also capped at 10,000 per signal. Overflow requests still
load, but do not share or cache their result without an ownership slot. A pending
load older than 60 seconds stops attracting new callers; it is not cancelled.
At capacity, an expired oldest slot is reclaimed for a new project.
Its original callers receive its outcome, but a superseded load cannot overwrite
newer configuration or remove a replacement's pending entry. No cleanup timers
are added.

### Index metric catalog service membership

A collector export can contain the same metric from thousands of services. The
catalog formerly scanned the growing service array for every observation. Each
scan also created an array and read Service.id, whose getter constructs an
ObjectID. The new request-local index makes membership checks constant time.

Catalog entries retain first-observation metadata and first-seen service order.
Host and other infrastructure IDs are still excluded from Service relationships.
Heartbeat metrics, aggregation temporality, monotonic counters, chunk flushes,
and best-effort catalog persistence keep their existing behavior. A Set is
allocated only when a metric encounters a second distinct service; the usual
single-service export stores its first ID directly. This index adds linear
request-local memory and is released with the request.

### Reserve writer capacity before yielding

TelemetryFanInWriter previously checked its pending-row limit before an await,
then incremented the count afterward. Concurrent submitters could all pass the
same check, multiplying the intended buffer limit. Row reservations now happen
synchronously before yielding. Completing inserts transfer capacity to queued
callers in FIFO order before waking them, avoiding repeated wakeups of the whole
queue.

Whole submissions remain intact. One submission can cross the high-water mark,
including a submission larger than the configured limit. Every subsequent
submission waits until admitted rows fall below that mark. This bounds accepted
buffering, not rows already held by callers waiting to submit, request-body
memory, or total process RSS. Existing acknowledgements, deduplication tokens,
retry semantics, insert concurrency, and shutdown drains are unchanged.

### Share probe connectivity checks

Simultaneously failing monitors on a SaaS probe now share overlapping reference
connectivity checks independently for HTTP, ICMP, and TCP. Settled results are
immediately discarded so a subsequent monitor checks current connectivity.
Self-hosted probes retain their existing public-connectivity bypass.

A five-minute sharing limit prevents an unusually old operation from attracting
new callers indefinitely. This allows the existing TCP fallback budget of about
145 seconds. Original callers still receive their original outcome; late
settlement cannot remove a newer operation. Sharing uses at most three map
entries and adds no timers or result cache.

## Isolated measurements

Measured with Node 26.6.0. These are reproducible workload-specific measurements,
not estimates of deployment-wide savings. Concurrent unrelated development
processes were running; prefer operation counts and retained-object invariants
over wall-clock comparisons. Heap deltas vary with V8 and collection timing.

| Workload / measurement | Before | After |
| --- | ---: | ---: |
| 1,000 cold pipeline callers, 20 pipelines: database calls | 21,000 | 21 |
| Same burst: filter compilations | 20,000 | 20 |
| Same burst: distinct retained configuration graphs | 1,000 | 1 |
| Same burst: sampled retained JS heap | 19.89 MiB | 0.10 MiB |
| Same burst: process CPU in recorded run | 325.63 ms | 3.05 ms |
| 2,000 services, 4 metrics, 24,000 observations: catalog median CPU | 2,069.12 ms | 4.08 ms |
| Same catalog: existing-service ID reads during membership scans | 39,996,000 | 0 |
| 200 writer producers, 100-row chunks, 1,000-row limit: admitted rows while inserts stall | 20,000 | 1,000 |
| Same writer workload: sampled live JS heap increase | 23.20 MiB | 12.35 MiB |
| 10,000 simultaneous offline probe callers: reference checks | 50,000 | 5 |
| Same probe burst: simultaneously pending references | 10,000 | 1 |
| Same probe burst: sampled pending JS heap | 10.60 MiB | 2.54 MiB |

The pipeline, writer, and probe harnesses execute the selected source with I/O
stubbed. Pipeline measurements exclude actual Postgres/network latency. The
writer harness holds ClickHouse inserts pending, then verifies both versions
ultimately insert all 60,000 rows. Its heap includes rows retained by blocked
callers. The probe heap includes deferred stub promises and caller promises,
not actual sockets. The catalog benchmark uses real models and the new helper,
compared with the previous scan algorithm; it excludes row processing and
persistence. It also measures one-service and 500-service cases and checks output
counts and service order.

## Reproduce

Use the supported Node runtime. From the repository root:

```sh
git show 0b23baed11:App/FeatureSet/Telemetry/Services/LogPipelineService.ts > /tmp/oneuptime-log-pipeline-before.ts
node --expose-gc App/scripts/benchmark-pipeline-loads.js /tmp/oneuptime-log-pipeline-before.ts
node --expose-gc App/scripts/benchmark-pipeline-loads.js

git show 0b23baed11:Common/Server/Utils/Telemetry/TelemetryFanInWriter.ts > /tmp/oneuptime-fanin-before.ts
node --expose-gc Common/Scripts/benchmark-fanin-capacity.js /tmp/oneuptime-fanin-before.ts
node --expose-gc Common/Scripts/benchmark-fanin-capacity.js

git show 0b23baed11:Probe/Utils/OnlineCheck.ts > /tmp/oneuptime-online-check-before.ts
node --expose-gc Probe/scripts/benchmark-online-check.js /tmp/oneuptime-online-check-before.ts
node --expose-gc Probe/scripts/benchmark-online-check.js
```

From `App`:

```sh
node --require ts-node/register/transpile-only scripts/benchmark-metric-catalog.ts
```

## Regression coverage

The focused run passes 356 tests across 16 suites, including 142 new regression
and scale cases: 124 pipeline/cache tests, 45 metric-ingestion tests, 86 writer
tests, and 101 probe tests. Tests assert work counts and behavior rather than
machine-dependent timing thresholds.

- Pipeline cache unit tests exercise 10,000 overlapping callers, empty values,
  rejection/synchronous failure, expiry, refresh, slow-load replacement, backward
  clock changes, bounded completed/pending entries, overflow, late completion,
  and project/signal isolation. Service integration tests exercise real loaders
  and filter compilation with database I/O stubbed, including 1,000 callers
  loading 20 ordered pipelines, partial failures, metadata edits, and late joiners.
- Metric catalog tests cover service-ID value equality, metadata/service order,
  every non-Service entity type, repeated and independent exports, large service
  lists, heartbeat overlap, row/chunk counts, counter semantics, and failed
  catalog persistence. Existing IoT rule and ingestion-stamp suites also run.
- Writer tests hold inserts pending to inspect synchronous reservations, bounded
  resumed waves, FIFO admission, multiple insert slots, oversized submissions,
  retries and terminal failures. A 2,000-submission multi-table shutdown test
  verifies every row and its deduplication token. The existing writer suite runs
  alongside these regressions.
- Probe tests cover 10,000 simultaneous callers, all three protocols, fallback
  order, late joiners, self-hosted bypass, failures, immediate rechecks after
  recovery, sharing expiry, and late settlement. Existing ICMP/TCP monitor
  regression suites also run.

These service integration tests isolate database/network I/O. They do not replace
a sustained deployment test against real Postgres and ClickHouse. The local
Compose stack mounts the original checkout, not this worktree, and its endpoint
returned HTTP 502 during inspection. It is not used as branch validation.

For a deployment comparison, hold workload, role split, concurrency, and database
capacity constant. Measure CPU, live heap/RSS, queue depth, accepted/dropped rows,
ingestion latency, and monitor detection delay during steady traffic and bursts.
Writer backpressure can increase the time submitters wait when storage is slow;
that is the intended tradeoff for limiting accepted work.
