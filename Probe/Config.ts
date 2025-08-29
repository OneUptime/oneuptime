import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import Port from "Common/Types/Port";

if (!process.env["PROBE_INGEST_URL"] && !process.env["ONEUPTIME_URL"]) {
  logger.error("PROBE_INGEST_URL or ONEUPTIME_URL is not set");
  process.exit();
}

export let PROBE_INGEST_URL: URL = URL.fromString(
  process.env["ONEUPTIME_URL"] ||
    process.env["PROBE_INGEST_URL"] ||
    "https://oneuptime.com",
);

// If probe api does not have the path. Add it.
if (
  !PROBE_INGEST_URL.toString().endsWith("probe-ingest") &&
  !PROBE_INGEST_URL.toString().endsWith("probe-ingest/")
) {
  PROBE_INGEST_URL = URL.fromString(
    PROBE_INGEST_URL.addRoute("/probe-ingest").toString(),
  );
}

export const PROBE_NAME: string | null = process.env["PROBE_NAME"] || null;

export const PROBE_DESCRIPTION: string | null =
  process.env["PROBE_DESCRIPTION"] || null;

export const PROBE_ID: ObjectID | null = process.env["PROBE_ID"]
  ? new ObjectID(process.env["PROBE_ID"])
  : null;

if (!process.env["PROBE_KEY"]) {
  logger.error("PROBE_KEY is not set");
  process.exit();
}

export const PROBE_KEY: string = process.env["PROBE_KEY"];

let probeMonitoringWorkers: string | number =
  process.env["PROBE_MONITORING_WORKERS"] || 1;

if (typeof probeMonitoringWorkers === "string") {
  probeMonitoringWorkers = parseInt(probeMonitoringWorkers);
}

export const PROBE_MONITORING_WORKERS: number = probeMonitoringWorkers;

let monitorFetchLimit: string | number =
  process.env["PROBE_MONITOR_FETCH_LIMIT"] || 10;

if (typeof monitorFetchLimit === "string") {
  monitorFetchLimit = parseInt(monitorFetchLimit);
}

export const PROBE_MONITOR_FETCH_LIMIT: number = monitorFetchLimit;

export const HOSTNAME: string = process.env["HOSTNAME"] || "localhost";

export const PROXY_URL: URL | null = process.env["PROXY_URL"]
  ? URL.fromString(process.env["PROXY_URL"])
  : null;

export const PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS: number = process.env[
  "PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS"
]
  ? parseInt(
      process.env["PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS"].toString(),
    )
  : 60000;

export const PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS: number = process
  .env["PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS"]
  ? parseInt(
      process.env["PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS"].toString(),
    )
  : 60000;

export const PROBE_MONITOR_RETRY_LIMIT: number = process.env[
  "PROBE_MONITOR_RETRY_LIMIT"
]
  ? parseInt(process.env["PROBE_MONITOR_RETRY_LIMIT"].toString())
  : 3;

export const PORT: Port = new Port(
  process.env["PORT"] ? parseInt(process.env["PORT"]) : 3874,
);
