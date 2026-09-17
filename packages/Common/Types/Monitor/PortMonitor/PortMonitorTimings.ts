/*
 * Per-phase breakdown of a Port monitor connection, in milliseconds. DNS is
 * absent when the destination is already an IP address. Fields are optional
 * so partial timing evidence can be represented when a connection fails.
 */
export default interface PortMonitorTimings {
  dnsLookupInMs?: number | undefined;
  tcpConnectInMs?: number | undefined;
  totalConnectionInMs?: number | undefined;
}
