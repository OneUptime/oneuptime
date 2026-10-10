import ProbeAttempt from "../../Probe/ProbeAttempt";
import RequestFailedDetails from "../../Probe/RequestFailedDetails";
import NtpLeapIndicator from "./NtpLeapIndicator";

/*
 * What one NTP check found: a probe sent an SNTP client request (RFC 4330 /
 * RFC 5905, mode 3) to the server's UDP port and read the reply.
 *
 * Three questions, kept apart because each one fails for different reasons:
 *
 *   - isOnline: did the server answer THIS request with an NTP server reply?
 *     A reply that is malformed, in the wrong mode, or that does not echo
 *     the request's transmit timestamp back is ignored as if it never came,
 *     so a stale or spoofed packet cannot make a dead server look alive.
 *   - isSynchronized: is the time it serves usable? Stratum 1 to 15, a leap
 *     indicator other than 3 (alarm) and real timestamps in the reply. A
 *     kiss-o'-death (stratum 0) or a stratum 16 server answers, but is not
 *     synchronized.
 *   - clockOffsetInMs: how far its clock is from the probe's, computed from
 *     the four timestamps of the exchange.
 *
 * Every field below the first block is optional: a server that never answered
 * has no stratum, and a kiss-o'-death carries no usable time.
 */
export default interface NtpMonitorResponse {
  isOnline: boolean;
  isSynchronized: boolean;
  /*
   * From sending the request to receiving its reply, in milliseconds,
   * measured on the probe's monotonic clock. A DNS lookup is not included;
   * it is in dnsLookupInMs.
   */
  responseTimeInMs: number;
  failureCause: string;
  isTimeout?: boolean | undefined;
  // For a server that did not answer: where it failed (lookup, no reply, ...).
  requestFailedDetails?: RequestFailedDetails | undefined;

  // The address the request was sent to (after any DNS lookup), and its port.
  serverAddress?: string | undefined;
  port?: number | undefined;
  // Only for a host name: how long resolving it took.
  dnsLookupInMs?: number | undefined;

  // The reply's header, as the server sent it.
  version?: number | undefined;
  leapIndicator?: NtpLeapIndicator | undefined;
  // As sent: 0 is a kiss-o'-death or "unspecified", 16 is unsynchronized.
  stratum?: number | undefined;
  // With stratum 0: the four-letter kiss code, such as RATE or DENY.
  kissCode?: string | undefined;
  /*
   * What the server synchronizes to: a source name such as GPS or PPS at
   * stratum 1, the upstream server's IPv4 address (or a hash of its IPv6
   * address) from stratum 2 on.
   */
  referenceId?: string | undefined;
  // The server's poll interval, in seconds (2 to the poll exponent).
  pollIntervalInSeconds?: number | undefined;
  // The precision of the server's clock, in milliseconds.
  precisionInMs?: number | undefined;
  // Round trip to the primary reference clock, and the server's error bound.
  rootDelayInMs?: number | undefined;
  rootDispersionInMs?: number | undefined;
  // When the server's clock was last set or corrected (ISO 8601).
  referenceTime?: string | undefined;
  // The server's time when it sent the reply (ISO 8601).
  serverTime?: string | undefined;

  /*
   * How far the server's clock is from the probe's, in milliseconds:
   * positive when the server is ahead, negative when it is behind. Only set
   * when the reply carried real timestamps.
   */
  clockOffsetInMs?: number | undefined;
  // The network round trip of the exchange, without the server's own time.
  roundTripDelayInMs?: number | undefined;

  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
}
