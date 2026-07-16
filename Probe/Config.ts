import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import Port from "Common/Types/Port";
import NumberUtil from "Common/Utils/Number";

if (!process.env["PROBE_INGEST_URL"] && !process.env["ONEUPTIME_URL"]) {
  logger.error("PROBE_INGEST_URL or ONEUPTIME_URL is not set");
  process.exit(1);
}

export const ONEUPTIME_BASE_URL: URL = URL.fromString(
  process.env["ONEUPTIME_URL"] ||
    process.env["PROBE_INGEST_URL"] ||
    "https://oneuptime.com",
);

export let PROBE_INGEST_URL: URL = URL.fromString(
  ONEUPTIME_BASE_URL.toString(),
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

/*
 * Optional inbound ingress for IncomingRequest (heartbeat) monitors.
 * If set, the probe binds an HTTP listener on this port that accepts
 * /heartbeat/:secretkey and /incoming-request/:secretkey requests and
 * forwards them to the OneUptime instance. Lets services in private
 * networks send heartbeats to a local probe instead of the public URL.
 * Unset (or 0) disables the listener.
 */
export const PROBE_INGRESS_PORT: Port | null = process.env["PROBE_INGRESS_PORT"]
  ? new Port(
      NumberUtil.parseNumberWithDefault({
        value: process.env["PROBE_INGRESS_PORT"],
        defaultValue: 0,
        min: 0,
      }),
    )
  : null;

/*
 * SNMP trap receiver. The probe listens for SNMP traps/informs (v1 and
 * v2c) on the configured UDP port and forwards them to the OneUptime
 * instance, where they are matched against SNMP monitors by source IP and
 * evaluated against trap criteria — link-down incidents in seconds instead
 * of waiting for the next poll. Point your devices' trap destination at
 * this probe.
 *
 * On by default: inside a container the port is unreachable until the
 * operator publishes it, and a failed bind (port in use, or no privilege
 * for ports < 1024 outside Docker) logs an error and leaves polling
 * untouched. Set PROBE_SNMP_TRAP_RECEIVER_ENABLED=false to opt out.
 */
export const PROBE_SNMP_TRAP_RECEIVER_ENABLED: boolean =
  process.env["PROBE_SNMP_TRAP_RECEIVER_ENABLED"] !== "false";

export const PROBE_SNMP_TRAP_RECEIVER_PORT: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_SNMP_TRAP_RECEIVER_PORT"],
    defaultValue: 162,
    min: 1,
  });

// Safety valve: max traps forwarded per minute before dropping (per probe).
export const PROBE_SNMP_TRAP_RATE_LIMIT_PER_MINUTE: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_SNMP_TRAP_RATE_LIMIT_PER_MINUTE"],
    defaultValue: 300,
    min: 1,
  });

/*
 * Syslog receiver. The probe listens for syslog messages (RFC 3164 and
 * RFC 5424) on the configured UDP port, batches them, and forwards them to
 * the OneUptime instance, where they are correlated to Network Devices by
 * source IP and written into the telemetry Logs pipeline. Point your
 * devices' syslog destination at this probe.
 *
 * Off by default: opt in with PROBE_SYSLOG_RECEIVER_ENABLED=true. The
 * default port is 5140 rather than the standard 514 because ports < 1024
 * need privileges outside Docker; a failed bind (port in use, or no
 * privilege) logs an error and leaves polling untouched.
 */
export const PROBE_SYSLOG_RECEIVER_ENABLED: boolean =
  process.env["PROBE_SYSLOG_RECEIVER_ENABLED"] === "true";

export const PROBE_SYSLOG_RECEIVER_PORT: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_SYSLOG_RECEIVER_PORT"],
    defaultValue: 5140,
    min: 1,
  });

// Safety valve: max syslog messages forwarded per minute before dropping (per probe).
export const PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE"],
    defaultValue: 600,
    min: 1,
  });

/*
 * NetFlow receiver. The probe listens for NetFlow v5 export datagrams on
 * the configured UDP port, parses the flow records, batches them, and
 * forwards them to the OneUptime instance, where they are correlated to
 * Network Devices by the exporter's source IP and written into the
 * ClickHouse network-flow table. Point your devices' NetFlow v5 export
 * destination at this probe.
 *
 * Off by default: opt in with PROBE_NETFLOW_RECEIVER_ENABLED=true. Port
 * 2055 is the conventional NetFlow collector port (above 1024, so no
 * privileges needed); a failed bind (port in use) logs an error and
 * leaves polling untouched.
 */
export const PROBE_NETFLOW_RECEIVER_ENABLED: boolean =
  process.env["PROBE_NETFLOW_RECEIVER_ENABLED"] === "true";

export const PROBE_NETFLOW_RECEIVER_PORT: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_NETFLOW_RECEIVER_PORT"],
    defaultValue: 2055,
    min: 1,
  });

// Safety valve: max NetFlow DATAGRAMS accepted per minute before dropping
// (per probe). One datagram carries up to 30 flow records.
export const PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE"],
    defaultValue: 300,
    min: 1,
  });

export const PROBE_INGRESS_FORWARD_TIMEOUT_MS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_INGRESS_FORWARD_TIMEOUT_MS"],
    defaultValue: 10000,
    min: 1000,
  });

export const PROBE_INGRESS_FORWARD_RETRY_LIMIT: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_INGRESS_FORWARD_RETRY_LIMIT"],
    defaultValue: 3,
    min: 0,
  });

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
