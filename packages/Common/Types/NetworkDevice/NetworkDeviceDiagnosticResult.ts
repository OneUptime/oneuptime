import NetworkPathTrace from "../Monitor/NetworkMonitor/NetworkPathTrace";
import PingMonitorResponse from "../Monitor/PingMonitor/PingMonitorResponse";
import NetworkDeviceDiagnosticType from "./NetworkDeviceDiagnosticType";

/*
 * The shapes shared by the three parties to an on-demand device diagnostic
 * (OneUptime issue #3745): the server that stores the request and hands it
 * out, the probe that runs it, and the dashboard that renders the result.
 *
 * A diagnostic is a NetworkDeviceDiagnostic row. The dashboard creates one
 * with a device and a type; the server fills in the hostname and the probe
 * from the device; the probe's diagnostic job claims it, runs it, and posts
 * the result; the dashboard polls the row until it settles.
 */

/*
 * What a ping diagnostic produces. `pingResponse` reuses the Ping monitor's
 * packet statistics (min/avg/max RTT, jitter, packet loss) so the vocabulary
 * matches what the device's poll already charts. It is undefined when ping
 * itself could not run (no binary, no ICMP privileges, an unusable host) —
 * then `isOnline` is false and `failureCause` says why.
 *
 * A device that answered no echo is NOT a failed diagnostic: it is a
 * completed one with isOnline false and, usually, a pingResponse showing
 * 100% loss.
 */
export interface NetworkDeviceDiagnosticPingResult {
  isOnline: boolean;
  // Empty when the device answered.
  failureCause: string;
  pingResponse?: PingMonitorResponse | undefined;
}

/*
 * What the probe-ingest list endpoint hands the probe for one claimed
 * diagnostic — everything the probe needs to run it without another
 * round trip. Plain strings: it crosses the wire as JSON.
 */
export interface NetworkDeviceDiagnosticJob {
  id: string;
  projectId: string;
  networkDeviceId: string;
  diagnosticType: NetworkDeviceDiagnosticType | string;
  // The device's hostname or IP literal, copied from the device at create.
  hostname: string;
  /*
   * Ping: the per-reply wait. Traceroute: the deadline for the whole
   * trace. Always sent, so the probe never has to guess a default.
   */
  timeoutInMs: number;
  // Ping only. Echo requests to send.
  packetCount?: number | undefined;
  // Traceroute only. Hop limit.
  maxHops?: number | undefined;
}

/*
 * What the probe posts back for one diagnostic. Exactly one of
 * `pingResult` / `traceRouteResult` is set on a Completed report, matching
 * the job's type; a Failed report carries neither and a statusMessage.
 */
export interface NetworkDeviceDiagnosticReport {
  networkDeviceDiagnosticId: string;
  // NetworkDeviceDiagnosticStatus.Completed or .Failed.
  status: string;
  statusMessage?: string | undefined;
  pingResult?: NetworkDeviceDiagnosticPingResult | undefined;
  traceRouteResult?: NetworkPathTrace | undefined;
}

/*
 * Echo requests per ping diagnostic. Five, like a Ping monitor check: enough
 * for loss and jitter to mean something, few enough to answer in seconds.
 */
export const NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT: number = 5;

// Per-reply wait for a ping diagnostic; matches the device poll's default.
export const NETWORK_DEVICE_DIAGNOSTIC_PING_TIMEOUT_IN_MS: number = 5000;

// Whole-trace deadline for a traceroute diagnostic.
export const NETWORK_DEVICE_DIAGNOSTIC_TRACEROUTE_TIMEOUT_IN_MS: number = 30000;

export const NETWORK_DEVICE_DIAGNOSTIC_TRACEROUTE_MAX_HOPS: number = 30;

/*
 * A Pending diagnostic older than this is never claimed. Somebody asked for
 * it from a screen they have since left — the dashboard gives up waiting
 * long before this — so running it would spend the probe's time on an
 * answer nobody reads. The row itself is pruned by the service's retention.
 */
export const NETWORK_DEVICE_DIAGNOSTIC_CLAIM_WINDOW_IN_MINUTES: number = 10;

/*
 * Diagnostics are transient: the answer matters for the minutes somebody is
 * looking at it. Rows are hard-deleted after this many days, like
 * MonitorTest rows.
 */
export const NETWORK_DEVICE_DIAGNOSTIC_RETENTION_IN_DAYS: number = 2;

/*
 * How many diagnostics one list request hands a probe. Diagnostics are
 * interactive and rare; the cap only bounds a burst.
 */
export const NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT: number = 20;
