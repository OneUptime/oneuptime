let concurrency: string | number = process.env["WORKER_CONCURRENCY"] || 100;

if (typeof concurrency === "string") {
  const parsed: number = parseInt(concurrency, 10);
  concurrency = !isNaN(parsed) && parsed > 0 ? parsed : 100;
}

export const WORKER_CONCURRENCY: number = concurrency as number;

/*
 * Per-replica concurrency for the telemetry-monitor evaluation worker fleet
 * (Phase 2). Each replica runs this many monitor evaluations in parallel;
 * fleet throughput = replicas * this. I/O-bound on ClickHouse, so a modest
 * default is fine — scale out by adding replicas.
 */
let telemetryMonitorEvalConcurrency: string | number =
  process.env["TELEMETRY_MONITOR_EVAL_CONCURRENCY"] || 10;

if (typeof telemetryMonitorEvalConcurrency === "string") {
  const parsed: number = parseInt(telemetryMonitorEvalConcurrency, 10);
  telemetryMonitorEvalConcurrency = !isNaN(parsed) && parsed > 0 ? parsed : 10;
}

export const TELEMETRY_MONITOR_EVAL_CONCURRENCY: number =
  telemetryMonitorEvalConcurrency as number;
