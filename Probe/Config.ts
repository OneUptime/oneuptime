import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import Port from "Common/Types/Port";
import NumberUtil from "Common/Utils/Number";
import {
  MAX_NODE_TIMER_DELAY_IN_MS,
  MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS,
  SYNTHETIC_MONITOR_WORKER_STARTUP_ALLOWANCE_IN_MS,
} from "./Utils/Monitors/SyntheticRuntime/Limits";

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
 * How many NetworkDevice SNMP walks this probe runs at once.
 *
 * This is the probe half of the fleet's poll cadence, and it has to be read
 * against the server's NETWORK_DEVICE_POLL_FETCH_LIMIT: the server claims a
 * batch and advances every claimed device's nextPollAt whether or not the
 * walk happens, so a probe that cannot get through a batch inside its
 * one-minute cycle does not poll those devices late, it skips them.
 *
 * The old value was 5, which put a hard ~5-walks-per-round-trip ceiling on a
 * probe and left large fleets minutes behind their configured intervals.
 * SNMP walks are UDP round trips that spend nearly all their time waiting,
 * so a much wider fan-out costs little.
 */
export const PROBE_NETWORK_DEVICE_POLL_CONCURRENCY: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_NETWORK_DEVICE_POLL_CONCURRENCY"],
    defaultValue: 25,
    min: 1,
  });

export const HOSTNAME: string = process.env["HOSTNAME"] || "localhost";

export const PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS"],
    defaultValue: 60000,
    min: 1,
    max: MAX_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS,
  });

export const PROBE_SYNTHETIC_MONITOR_MAX_CONCURRENCY: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_SYNTHETIC_MONITOR_MAX_CONCURRENCY"],
    defaultValue: 4,
    min: 1,
  });

export const PROBE_SYNTHETIC_MONITOR_MAX_PROCESS_TREE_RSS_BYTES: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_SYNTHETIC_MONITOR_MAX_PROCESS_TREE_RSS_BYTES"],
    defaultValue: 1536 * 1024 * 1024,
    min: 64 * 1024 * 1024,
  });

export const PROBE_SYNTHETIC_MONITOR_MAX_DISK_BYTES: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_SYNTHETIC_MONITOR_MAX_DISK_BYTES"],
    defaultValue: 256 * 1024 * 1024,
    min: 64 * 1024 * 1024,
  });

export const PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED: boolean =
  process.env["PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED"] === "true";

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

/*
 * Hard ceiling on ONE monitor's full check inside the probing loop — every
 * step, every retry, and the ingest POST that reports each step's result.
 *
 * The probe fires all of a batch's checks into a Promise.allSettled and
 * waits. A monitor implementation that never settles therefore never
 * releases the worker probing it: no ingest POST, no monitor log, nothing
 * to grep for — and the server already advanced nextPingAt when it claimed
 * the monitor, so the row keeps looking correctly scheduled while the check
 * silently never happens again. The SSL monitor shipping without a timeout
 * of any kind was one such implementation (OneUptime issue #3225); this
 * deadline is the layer that makes the next one survivable.
 *
 * Deliberately generous. Every monitor type enforces its own, far tighter
 * timeout (a step is capped at 60s and retried at most 3 times), so a check
 * that crosses this line means the implementation is wedged rather than the
 * target being slow. Crossing it costs that monitor exactly one cycle —
 * the worker logs it and moves on.
 */
const MONITOR_CHECK_TIMEOUT_BASELINE_IN_MS: number = 15 * 60 * 1000;

/*
 * ...but never tighter than a synthetic script is allowed to legitimately
 * run for. An operator who raises the synthetic timeout must not silently
 * get their synthetic monitors abandoned mid-script by this deadline, so
 * the floor tracks that setting plus the worker startup allowance and the
 * ingest POST that follows the script. Clamped to the largest delay a Node
 * timer can represent: above that setTimeout overflows and fires ~immediately,
 * which would abandon every check on its first tick.
 */
export const PROBE_MONITOR_CHECK_TIMEOUT_IN_MS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_MONITOR_CHECK_TIMEOUT_IN_MS"],
    defaultValue: Math.min(
      MAX_NODE_TIMER_DELAY_IN_MS,
      Math.max(
        MONITOR_CHECK_TIMEOUT_BASELINE_IN_MS,
        PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS +
          SYNTHETIC_MONITOR_WORKER_STARTUP_ALLOWANCE_IN_MS +
          PROBE_API_REQUEST_TIMEOUT_IN_MS,
      ),
    ),
    min: 1000,
    max: MAX_NODE_TIMER_DELAY_IN_MS,
  });

/*
 * Hard ceiling on ONE network discovery sweep, for exactly the reason
 * PROBE_MONITOR_CHECK_TIMEOUT_IN_MS exists — and the discovery job needs it
 * more, not less.
 *
 * The discovery cron holds a single-flight guard across the WHOLE cycle
 * (Jobs/Discovery/FetchScans.ts): list fetch, sweep, and result upload. Every
 * HTTP call in that cycle carries PROBE_API_REQUEST_TIMEOUT_IN_MS, but the
 * sweep between them had no deadline of any kind. A sweep opens one ICMP
 * child process and one UDP SNMP session per address — up to
 * ScanTargetUtil.MAX_SCAN_HOSTS of them — so it is exactly the kind of code
 * where one non-settling promise is plausible, and a single one of those
 * strands the guard set. Not for a cycle: FOREVER. Every later scan then sits
 * in "Pending" until someone restarts the probe container, with nothing in
 * the product to say why (OneUptime issue #3287).
 *
 * The number is a wall-clock budget with two sides to fit between.
 *
 * The floor is the slowest sweep that is still legitimately working. At
 * MAX_SCAN_HOSTS (32,768) with SubnetScanner's 32 workers, the documented
 * worst case is a full 1s-per-host ICMP pass (~17 min) followed by a full
 * 2s-per-host SNMP pass over every address (~34 min) when the ICMP-filtered
 * fallback triggers — ~51 min, before SNMP v3's extra engine-discovery round
 * trip.
 *
 * The ceiling is the server: it declares an In Progress scan abandoned after
 * 2 hours (Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans.ts). The
 * probe has to give up FIRST, or a wedged sweep is reaped server-side while
 * the probe is still holding its guard — the scan reads Failed while
 * discovery on that probe stays stopped.
 *
 * 90 minutes sits between the two: comfortably above any sweep that is
 * genuinely making progress, and comfortably below the server's window, so
 * a scan that crosses this line is reported by the probe itself, with its
 * own reason, and the next tick fetches again.
 */
export const PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS: number =
  NumberUtil.parseNumberWithDefault({
    value: process.env["PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS"],
    defaultValue: 90 * 60 * 1000,
    min: 1000,
    max: MAX_NODE_TIMER_DELAY_IN_MS,
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
  process.env["HTTP_PROXY_URL"] ||
  process.env["http_proxy"] ||
  process.env["HTTP_PROXY"] ||
  null;

/*
 * HTTPS_PROXY_URL: Proxy for HTTPS requests
 * Format: http://[username:password@]proxy.example.com:port
 * Example: http://proxy.example.com:8080
 * Example with auth: http://user:pass@proxy.example.com:8080
 */
export const HTTPS_PROXY_URL: string | null =
  process.env["HTTPS_PROXY_URL"] ||
  process.env["https_proxy"] ||
  process.env["HTTPS_PROXY"] ||
  null;

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
