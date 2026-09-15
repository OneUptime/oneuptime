import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import NetworkPathTrace, {
  TraceRouteHop,
} from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import { NetworkTopologyNode } from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { NetworkDeviceDiagnosticPingResult } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import NetworkDeviceDiagnosticType from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticType";

/*
 * The pure half of the on-demand device diagnostics (issue #3745): the
 * polling constants, who may run one, and how a ping / traceroute result
 * reads once the probe has answered.
 *
 * Imports ONLY Common/Types. RouteMap, PageMap, Navigation and ModelAPI all
 * read `window` at module load (see LockedTelemetryScopeLink.test.ts for the
 * chain), and the App test suite runs in plain Node with static imports, so
 * anything that needs a route or an API call lives in the .tsx components
 * next door and this module stays testable without a browser stub.
 */

// How often the dashboard re-reads a diagnostic row while it is running.
export const DIAGNOSTIC_POLL_INTERVAL_IN_MS: number = 3000;

/*
 * How long the dashboard waits for the probe before giving up. A probe
 * claims within ten seconds of the row being created; a traceroute is
 * capped at thirty; two minutes is generous enough to survive a probe
 * mid-restart and short enough that a dead one is reported while the
 * operator is still looking.
 */
export const DIAGNOSTIC_TIMEOUT_IN_MS: number = 120000;

export const DIAGNOSTIC_MAX_POLL_ATTEMPTS: number = Math.ceil(
  DIAGNOSTIC_TIMEOUT_IN_MS / DIAGNOSTIC_POLL_INTERVAL_IN_MS,
);

/*
 * Rejected reads in a row before a run is called off with an error. One
 * failed read is almost always the API, not the probe: the row is still
 * being worked, and the read three seconds later will very likely answer.
 * Three in a row is a dead API, and the operator should hear about it.
 */
export const DIAGNOSTIC_MAX_CONSECUTIVE_POLL_FAILURES: number = 3;

/*
 * Only a managed node is a NetworkDevice row with a probe to run from; an
 * unmanaged neighbour has no row at all. Endpoints are never managed today
 * (NetworkTopologyUtil builds them isManaged: false); the kind check guards
 * against a future payload that marks one managed, because an endpoint
 * node's id is 'endpoint:<id>', not a NetworkDevice id, and must never be
 * turned into an ObjectID.
 */
export function canRunDiagnosticsOnNode(node: NetworkTopologyNode): boolean {
  return node.isManaged && node.kind !== "endpoint";
}

export type PingResultTone = "up" | "down" | "degraded";

export interface DiagnosticRow {
  label: string;
  value: string;
}

export interface PingResultSummary {
  headline: string;
  tone: PingResultTone;
  rows: Array<DiagnosticRow>;
}

export function formatMilliseconds(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "—";
  }

  return `${value.toFixed(1)} ms`;
}

/*
 * "0%" rather than "0.0%": packet loss out of five packets is a whole
 * number in practice, and a decimal there reads like false precision.
 */
export function formatPercent(value: number): string {
  if (Number.isInteger(value)) {
    return `${value}%`;
  }

  return `${value.toFixed(1)}%`;
}

export function describePingResult(
  result: NetworkDeviceDiagnosticPingResult,
  hostname?: string | undefined,
): PingResultSummary {
  const rows: Array<DiagnosticRow> = [];

  if (hostname) {
    rows.push({ label: "Host", value: hostname });
  }

  /*
   * No packet statistics at all: ping itself could not run (no binary, no
   * ICMP privilege, an unusable host). The cause is the whole story, so it
   * is the only row — min/avg/max of nothing would be a table of dashes.
   */
  if (!result.pingResponse) {
    if (result.failureCause) {
      rows.push({ label: "Reason", value: result.failureCause });
    }

    return {
      headline: result.isOnline ? "Reachable" : "Unreachable",
      tone: result.isOnline ? "up" : "down",
      rows,
    };
  }

  const loss: number = result.pingResponse.packetLossPercent;
  const isDown: boolean = !result.isOnline || loss >= 100;

  let headline: string = "Reachable";
  let tone: PingResultTone = "up";

  if (isDown) {
    headline = "Unreachable";
    tone = "down";
  } else if (loss > 0) {
    headline = "Reachable with packet loss";
    tone = "degraded";
  }

  if (isDown && result.failureCause) {
    rows.push({ label: "Reason", value: result.failureCause });
  }

  rows.push({
    label: "Average RTT",
    value: formatMilliseconds(result.pingResponse.avgRoundTripTimeInMs),
  });
  rows.push({
    label: "Min / Max RTT",
    value: `${formatMilliseconds(
      result.pingResponse.minRoundTripTimeInMs,
    )} / ${formatMilliseconds(result.pingResponse.maxRoundTripTimeInMs)}`,
  });
  rows.push({
    label: "Jitter",
    value: formatMilliseconds(result.pingResponse.jitterInMs),
  });
  rows.push({
    label: "Packet loss",
    value: `${formatPercent(loss)} (${result.pingResponse.packetsReceived}/${
      result.pingResponse.packetsSent
    } received)`,
  });

  return { headline, tone, rows };
}

export interface TraceRouteSummary {
  headline: string;
  // The trace's own failure message, when it recorded one.
  note: string | undefined;
  // What the probe's resolver said about the hostname, when it looked it up.
  dnsLine: string | undefined;
  hops: Array<TraceRouteHop>;
}

export function describeTraceRoute(trace: NetworkPathTrace): TraceRouteSummary {
  const hops: Array<TraceRouteHop> = trace.traceRoute?.hops || [];

  let headline: string = "Did not reach the destination";

  if (trace.traceRoute?.isComplete) {
    headline = `Reached the destination in ${hops.length} ${
      hops.length === 1 ? "hop" : "hops"
    }`;
  } else if (trace.traceRoute?.failedHop !== undefined) {
    headline = `Route broke at hop ${trace.traceRoute.failedHop}`;
  }

  let dnsLine: string | undefined = undefined;

  if (trace.dnsLookup) {
    dnsLine = trace.dnsLookup.isSuccess
      ? `${
          trace.dnsLookup.hostName
        } resolved to ${trace.dnsLookup.resolvedAddresses.join(", ")} in ${
          trace.dnsLookup.resolvedInMS
        } ms`
      : `Lookup for ${trace.dnsLookup.hostName} failed${
          trace.dnsLookup.errorMessage
            ? ` — ${trace.dnsLookup.errorMessage}`
            : ""
        }`;
  }

  return {
    headline,
    note: trace.traceRoute?.failureMessage || undefined,
    dnsLine,
    hops,
  };
}

/*
 * What the drawer says when the row never settles. Names the probe when the
 * caller knows it, because "your probe" sends the operator to the probe list
 * and "probe Rack 3" sends them to the right one.
 */
export function diagnosticTimeoutMessage(
  type: NetworkDeviceDiagnosticType,
  probeName?: string | undefined,
): string {
  const probe: string = probeName
    ? `The probe "${probeName}"`
    : "This device's probe";

  const what: string =
    type === NetworkDeviceDiagnosticType.Traceroute ? "traceroute" : "ping";

  return `${probe} did not report a ${what} result within two minutes. Check that the probe is online and running a version that supports on-demand diagnostics.`;
}

export interface LatencyPoint {
  time: string;
  value: number;
}

export interface LatencySummary {
  latest: number;
  min: number;
  max: number;
  avg: number;
  count: number;
}

/*
 * Aggregate rows to sparkline points, oldest first. The aggregate API
 * returns buckets in whatever order ClickHouse grouped them, and a
 * sparkline drawn from an unsorted series zigzags.
 */
export function latencyPointsFromAggregates(
  data: Array<AggregateModel>,
): Array<LatencyPoint> {
  return data
    .filter((row: AggregateModel): boolean => {
      return (
        typeof row.value === "number" &&
        !Number.isNaN(row.value) &&
        Boolean(row.timestamp)
      );
    })
    .map((row: AggregateModel): LatencyPoint => {
      const time: Date = new Date(row.timestamp);

      return {
        time: Number.isNaN(time.getTime())
          ? String(row.timestamp)
          : time.toISOString(),
        value: row.value,
      };
    })
    .sort((a: LatencyPoint, b: LatencyPoint): number => {
      return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
    });
}

// Points are expected oldest first; the last one is "now".
export function summarizeLatencySeries(
  points: Array<LatencyPoint>,
): LatencySummary | undefined {
  if (points.length === 0) {
    return undefined;
  }

  let min: number = Number.POSITIVE_INFINITY;
  let max: number = Number.NEGATIVE_INFINITY;
  let sum: number = 0;

  for (const point of points) {
    min = Math.min(min, point.value);
    max = Math.max(max, point.value);
    sum += point.value;
  }

  return {
    latest: points[points.length - 1]!.value,
    min,
    max,
    avg: sum / points.length,
    count: points.length,
  };
}
