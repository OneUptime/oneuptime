# Runtime CPU and memory improvements

This audit started from master commit `f74d205650`. It targets redundant work and
object retention in telemetry pipelines, probes, and background workers. The
measurements below are isolated benchmarks on Node 26.5.1, not estimates of the
percentage improvement for a production deployment.

## Implemented changes

| Path | Previous behavior | New behavior |
| --- | --- | --- |
| Log and trace processors | JSON-string configurations were parsed for every record. Category processors consequently recompiled their filters for every record. | Normalize once per processor instance and reuse compiled filters. Replacing the configuration invalidates the entry. Weak ownership lets expired processors and their configurations be collected. |
| Request, email, and server heartbeat sweeps | Loaded every matching monitor into arrays and launched every evaluation at once. Request/email jobs returned before evaluations finished, allowing successive ticks to overlap. | Fetch 100-row pages using an immutable ID cursor, run at most 10 evaluations, and await completion. A renewing lease prevents overlapping sweeps of the same type across workers. |
| Periodic probe checks | Retained already-ingested response bodies and screenshots in step result arrays, then in settled promises until the slowest monitor finished. | Ingest and log each step before moving on. Periodic tasks resolve without retaining response arrays. Interactive monitor tests still return their results. |
| Queue job deadlines | Successful and failed jobs left their deadline timer alive until its original expiration. | Clear the timer on success, rejection, synchronous failure, or timeout. Underlying work is still not cancelled when a deadline expires. |

The sweep limits are per monitor type. They bound selected row count and active
evaluations, not the size of any one monitor's JSON. Never-checked incoming
monitors still run first; within each phase, ID ordering replaces mutable
last-check ordering. A large backlog may take longer to sweep than unrestricted
fan-out. Measure detection delay as well as memory when evaluating this tradeoff.

## Reproducible measurements

### Configuration parsing and category filters

From `App`, run:

```sh
node --require ts-node/register/transpile-only scripts/benchmark-pipeline-config.ts
```

The script compares the previous normalization path with the new helper using
100,000 records and eight categories, with five alternating rounds. Both paths
evaluate the same filters and verify identical match counts.

| Measurement per round | Before | After |
| --- | ---: | ---: |
| Median process CPU time | 3,775.37 ms | 167.34 ms |
| Configuration parses | 100,000 | 1 |
| Filter compilations | 800,000 | 8 |

That is approximately 95.6% less CPU in this isolated parsing/filtering path.
Database access, row construction, network traffic, and other ingestion work are
outside the measurement. Workloads without these processors will not see this
particular benefit. Other builds were running concurrently, so wall-clock timings
are deliberately not used as the headline result.

### Completed probe response retention

From the repository root, run:

```sh
git show f74d205650:Probe/Utils/Monitors/Monitor.ts > /tmp/oneuptime-monitor-before.ts
node --expose-gc Probe/scripts/benchmark-response-lifetime.js /tmp/oneuptime-monitor-before.ts
node --expose-gc Probe/scripts/benchmark-response-lifetime.js
```

This harness loads the actual monitor implementation with I/O and telemetry
context mocked. Each of 100 monitors ingests a 512 KiB first response and waits on
a second step. Garbage collection occurs while every monitor is still pending.

| Measurement | Before | After |
| --- | ---: | ---: |
| Already-ingested response objects still retained | 100 | 0 |
| Additional live JavaScript heap in the recorded run | 50.21 MiB | 0.14 MiB |

Heap deltas vary between runs. The useful invariant is that completed response
objects are collectible while later work remains pending. This is not a claim
about total probe RSS, browser memory, or response memory still needed for an
active ingestion request.

### Deterministic regression coverage

- Pipeline unit and integration tests cover configuration replacement, malformed
  input, object mutation, tenant isolation, cache refresh, category precedence,
  and one parse/compile per processor across large batches.
- Monitor tests traverse 1,003 rows, hold evaluations pending to verify the
  concurrency/page limits, change query membership, exercise overlapping worker
  invocations, and cover lock loss, database failures, cursor errors, and existing
  heartbeat/status behavior.
- Probe tests cover step ingestion, completion ordering, errors, mixed-speed
  batches, deadlines, worker slots, and interactive results.
- Queue deadline tests cover success and all failure paths, concurrent jobs,
  unrelated timers, late settlement, and 10,000 completed jobs without lingering
  deadline handles.

## Next recommendations

1. **Measure each production role under the same workload.** The existing
   `Common/Server/Utils/Telemetry/RuntimeMetrics.ts` exports CPU utilization, heap,
   RSS, external memory, and event-loop delay. Pair those with worker/probe
   durations, queue depth, ingest rate, and heartbeat detection delay. Compare
   equal traffic, fleet size, and deployment settings, including bursts and a
   sustained run. The local Docker development app also runs five frontend build
   watchers, so its container memory is not a production API-process baseline.
2. **Coalesce concurrent telemetry cache misses and batch processor reads.**
   The log/trace pipeline loaders cache projects for 60 seconds but still load
   processor lists per pipeline. Concurrent cold loads can repeat the same
   database work. A follow-up should share in-flight loads and fetch processors
   in batches, with rejection/retry, tenant-isolation, and invalidation tests.
3. **Bound the remaining on-call backlog sweeps.**
   `UserOnCallLog/ExecutePendingExecutions.ts` and
   `OnCallDutyPolicyExecutionLog/ExecutePendingExecutions.ts` still collect whole
   backlogs and process them concurrently. Apply pagination and backpressure
   after pinning escalation order, idempotency, and duplicate-tick behavior in
   tests; these notification paths need a separate focused review.
4. **Use measured service-specific deployment sizing.** The repository already
   supports dedicated queue workers and a telemetry fan-in writer. Review those
   existing settings against database capacity, queue wait times, and ClickHouse
   insert behavior before increasing worker replicas or concurrency. Increasing
   heap limits alone does not remove redundant work or retained objects.

No database migration or deployment configuration change is required for this
patch. Local validation runs against the isolated worktree; the existing Compose
stack mounts the original checkout, so its health is not evidence that this branch
has been exercised under production load.
