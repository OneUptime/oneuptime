let probeConcurrency: string | number =
  process.env["PROBE_INGEST_CONCURRENCY"] || 100;

if (typeof probeConcurrency === "string") {
  const parsed: number = parseInt(probeConcurrency, 10);
  probeConcurrency = !isNaN(parsed) && parsed > 0 ? parsed : 100;
}

export const PROBE_INGEST_CONCURRENCY: number = probeConcurrency as number;

let serverMonitorConcurrency: string | number =
  process.env["SERVER_MONITOR_INGEST_CONCURRENCY"] || 100;

if (typeof serverMonitorConcurrency === "string") {
  const parsed: number = parseInt(serverMonitorConcurrency, 10);
  serverMonitorConcurrency = !isNaN(parsed) && parsed > 0 ? parsed : 100;
}

export const SERVER_MONITOR_INGEST_CONCURRENCY: number =
  serverMonitorConcurrency as number;

let incomingRequestConcurrency: string | number =
  process.env["INCOMING_REQUEST_INGEST_CONCURRENCY"] || 100;

if (typeof incomingRequestConcurrency === "string") {
  const parsed: number = parseInt(incomingRequestConcurrency, 10);
  incomingRequestConcurrency =
    !isNaN(parsed) && parsed > 0 ? parsed : 100;
}

export const INCOMING_REQUEST_INGEST_CONCURRENCY: number =
  incomingRequestConcurrency as number;
