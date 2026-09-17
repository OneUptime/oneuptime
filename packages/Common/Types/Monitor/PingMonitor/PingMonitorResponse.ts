/*
 * Packet-level statistics captured by the Ping/IP monitor. Populated when
 * the probe sends multiple ICMP echo requests per check. All RTT values
 * are in milliseconds. Absent on older probes (single-echo pings) and when
 * ICMP is blocked and the probe falls back to TCP port checks, which keeps
 * the pipeline backwards-compatible.
 */
export default interface PingMonitorResponse {
  packetsSent: number;
  packetsReceived: number;
  packetLossPercent: number;
  minRoundTripTimeInMs?: number | undefined;
  maxRoundTripTimeInMs?: number | undefined;
  avgRoundTripTimeInMs?: number | undefined;
  /*
   * Jitter is the standard deviation of round-trip times across the
   * packets sent in this check.
   */
  jitterInMs?: number | undefined;
}
