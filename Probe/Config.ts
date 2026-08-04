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

/*
 * How often the probe asks the server for monitors that are due.
 *
 * This is the ceiling on how fast any monitor can actually be checked: a
 * monitor set to run every 20 seconds goes due three times a minute, and if
 * the probe only asks for work once a minute it is checked once a minute no
 * matter what its interval says. The default of 10 seconds matches the
 * fastest monitoring interval OneUptime offers, so sub-minute monitors work
 * out of the box.
 *
 * Raising it trades check punctuality for fewer control-plane requests: at 60
 * the probe behaves exactly as it did before sub-minute intervals existed, and
 * no monitor is checked more than once a minute. It also raises throughput -
 * the probe claims up to PROBE_MONITOR_FETCH_LIMIT monitors per fetch, so a
 * 10-second cadence claims six times as many monitors per minute as a
 * 60-second one.
 */
export const PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS"],
    defaultValue: 10,
    min: 10,
    max: 60,
  });

/*
 * Only divisors of 60 give an even grid - "*\/45 * * * * *" would fire at :00
 * and :45, alternating 45- and 15-second gaps. Anything else falls back to the
 * default rather than silently producing a lumpy schedule.
 */
const MONITOR_FETCH_CRON_BY_INTERVAL: Record<number, string> = {
  10: "*/10 * * * * *",
  12: "*/12 * * * * *",
  15: "*/15 * * * * *",
  20: "*/20 * * * * *",
  30: "*/30 * * * * *",
  60: "* * * * *",
};

export const PROBE_MONITOR_FETCH_CRON: string = ((): string => {
  const cron: string | undefined =
    MONITOR_FETCH_CRON_BY_INTERVAL[PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS];

  if (cron) {
    return cron;
  }

  logger.warn(
    `PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS=${PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS} does not divide 60 evenly. Falling back to 10 seconds. Supported values: ${Object.keys(
      MONITOR_FETCH_CRON_BY_INTERVAL,
    ).join(", ")}.`,
  );

  return MONITOR_FETCH_CRON_BY_INTERVAL[10]!;
})();

/*
 * A small random delay before each fetch so several workers in the same probe
 * do not hit the server in lockstep. It has to stay well inside one tick -
 * jitter larger than the interval turns a 20-second monitor into anything
 * between 15 and 105 seconds, which is precisely the bug sub-minute intervals
 * are meant to fix. Concurrent claims are already safe by design: the server
 * claims with FOR UPDATE SKIP LOCKED, so workers never collide.
 */
export const PROBE_MONITOR_FETCH_JITTER_IN_MS: number = Math.floor(
  (PROBE_MONITOR_FETCH_INTERVAL_IN_SECONDS * 1000) / 10,
);

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

/*
 * Hard deadline for every control-plane request the probe sends to the
 * OneUptime server (alive heartbeat, monitor/discovery/network-device list
 * fetches, result ingest, registration). Axios's default timeout is 0 —
 * infinite — so without this a server that accepts the TCP connection but
 * never responds wedges the request forever, and because these calls run
 * from cron ticks with no overlap guard, a new hung request piles on every
 * minute while the probe's lastAlive quietly goes stale and the dashboard
 * flags a perfectly healthy probe as Disconnected. A bounded failure is
 * loud (logged, and retried on the next tick); an unbounded hang is silent.
 */
export const PROBE_API_REQUEST_TIMEOUT_IN_MS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_API_REQUEST_TIMEOUT_IN_MS"],
    defaultValue: 45000,
    min: 1000,
  });

/*
 * A control-plane request that is merely SLOW is the leading indicator of
 * the one that eventually crosses the deadline above and gets this probe
 * flagged Disconnected. Anything over this threshold is logged with its
 * elapsed time so the trend is visible before the cliff.
 */
export const PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS"],
    defaultValue: 10000,
    min: 100,
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

/*
 * Safety valve: max NetFlow DATAGRAMS accepted per minute before dropping
 * (per probe). One datagram carries up to 30 flow records.
 */
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
