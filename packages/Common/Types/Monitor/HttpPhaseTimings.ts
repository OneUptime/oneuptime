/*
 * Per-phase breakdown of an HTTP(S) check, all in milliseconds. Captured by
 * the probe from socket events on the initial connection of the request.
 * Every field is optional: phases are absent when they don't apply (no TLS
 * on plain HTTP, no DNS lookup when the target is an IP address) or when the
 * request went through a proxy, where per-phase timing would be misleading.
 * When the check follows redirects, the phases describe the first connection
 * and the download phase absorbs the rest of the exchange.
 */
export default interface HttpPhaseTimings {
  dnsLookupInMs?: number | undefined;
  tcpConnectInMs?: number | undefined;
  tlsHandshakeInMs?: number | undefined;
  timeToFirstByteInMs?: number | undefined;
  downloadInMs?: number | undefined;
}
