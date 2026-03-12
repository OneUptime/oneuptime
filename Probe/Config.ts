import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import Port from "Common/Types/Port";
import NumberUtil from "Common/Utils/Number";

if (!process.env["PROBE_INGEST_URL"] && !process.env["ONEUPTIME_URL"]) {
  logger.error("PROBE_INGEST_URL or ONEUPTIME_URL is not set");
  process.exit(1);
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
  process.exit(1);
}

export const PROBE_KEY: string = process.env["PROBE_KEY"];

export const PROBE_MONITORING_WORKERS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_MONITORING_WORKERS"],
    defaultValue: 1,
    min: 1,
  });

export const PROBE_MONITOR_FETCH_LIMIT: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_MONITOR_FETCH_LIMIT"],
    defaultValue: 10,
    min: 1,
  });

export const HOSTNAME: string = process.env["HOSTNAME"] || "localhost";

export const PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS"],
    defaultValue: 60000,
    min: 1,
  });

export const PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS"],
    defaultValue: 60000,
    min: 1,
  });

export const PROBE_MONITOR_RETRY_LIMIT: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_MONITOR_RETRY_LIMIT"],
    defaultValue: 3,
    min: 0,
  });

export const PORT: Port = new Port(
  NumberUtil.parseNumberWithDefault({
    value: process.env["PORT"],
    defaultValue: 3874,
    min: 1,
  }),
);

export const PROBE_SYNTHETIC_RUNNER_URL: URL = URL.fromString(
  process.env["PROBE_SYNTHETIC_RUNNER_URL"] || "http://127.0.0.1:3885",
);

/*
 * Proxy configuration for all HTTP/HTTPS requests made by the probe
 * HTTP_PROXY_URL: Proxy for HTTP requests
 * Format: http://[username:password@]proxy.example.com:port
 * Example: http://proxy.example.com:8080
 * Example with auth: http://user:pass@proxy.example.com:8080
 */
export const HTTP_PROXY_URL: string | null =
  process.env["HTTP_PROXY_URL"] || process.env["http_proxy"] || null;

/*
 * HTTPS_PROXY_URL: Proxy for HTTPS requests
 * Format: http://[username:password@]proxy.example.com:port
 * Example: http://proxy.example.com:8080
 * Example with auth: http://user:pass@proxy.example.com:8080
 */
export const HTTPS_PROXY_URL: string | null =
  process.env["HTTPS_PROXY_URL"] || process.env["https_proxy"] || null;

/*
 * NO_PROXY: Comma-separated list of hosts that should bypass the configured proxy.
 * Hosts can include optional ports (example.com:8080) or leading dots for subdomains (.example.com).
 */
const rawNoProxy: string | undefined =
  process.env["NO_PROXY"] || process.env["no_proxy"] || undefined;

export const NO_PROXY: Array<string> = rawNoProxy
  ? rawNoProxy
      .split(",")
      .map((value: string) => {
        return value.trim();
      })
      .reduce<Array<string>>((accumulator: Array<string>, current: string) => {
        if (!current) {
          return accumulator;
        }

        const parts: Array<string> = current
          .split(/\s+/)
          .map((item: string) => {
            return item.trim();
          })
          .filter((item: string) => {
            return item.length > 0;
          });

        return accumulator.concat(parts);
      }, [])
  : [];
