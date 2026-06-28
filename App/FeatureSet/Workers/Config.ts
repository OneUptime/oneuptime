let concurrency: string | number = process.env["WORKER_CONCURRENCY"] || 100;

if (typeof concurrency === "string") {
  const parsed: number = parseInt(concurrency, 10);
  concurrency = !isNaN(parsed) && parsed > 0 ? parsed : 100;
}

export const WORKER_CONCURRENCY: number = concurrency as number;

let telemetryMonitorEvaluationConcurrency: string | number =
  process.env["TELEMETRY_MONITOR_EVALUATION_CONCURRENCY"] || 5;

if (typeof telemetryMonitorEvaluationConcurrency === "string") {
  const parsed: number = parseInt(telemetryMonitorEvaluationConcurrency, 10);
  telemetryMonitorEvaluationConcurrency =
    !isNaN(parsed) && parsed > 0 ? parsed : 5;
}

export const TELEMETRY_MONITOR_EVALUATION_CONCURRENCY: number =
  telemetryMonitorEvaluationConcurrency as number;
