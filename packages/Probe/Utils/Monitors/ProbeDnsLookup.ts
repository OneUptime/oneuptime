import dns from "dns";

/*
 * The name lookup the Port and SSL checks hand to their socket.
 *
 * With no family given, Node's net.connect asks getaddrinfo with
 * dns.ADDRCONFIG, and glibc then drops every AAAA answer on a machine with no
 * global IPv6 address. On a probe without IPv6, an IPv6-only name therefore
 * failed as "getaddrinfo ENOTFOUND" and was reported as the customer's DNS
 * name not resolving, when the name resolves fine and it is the probe that
 * cannot reach it. Without the hint the addresses come back, connect() fails
 * on the probe with EADDRNOTAVAIL or ENETUNREACH, and
 * Common/Utils/ProbeNetworkFailureUtil words that as the probe's failure.
 * A name that really does not exist still fails ENOTFOUND.
 *
 * Only that one hint changes. Node still asks for every address and keeps
 * its automatic family selection, so a dual-stack name still falls back to
 * IPv4. The HTTP monitors never had this problem: they resolve through
 * EgressGuard, whose lookup passes no hints.
 *
 * dns.lookup always calls back asynchronously, and that matters: tls.connect
 * throws a TypeError of its own, hiding the real connect error, when a
 * lookup answers synchronously and every address then fails at connect().
 */
export default class ProbeDnsLookup {
  public static lookupWithoutAddrConfig(
    hostname: string,
    options: dns.LookupOptions,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | Array<dns.LookupAddress>,
      family?: number,
    ) => void,
  ): void {
    const lookupOptions: dns.LookupOptions = {
      ...options,
      hints: (options?.hints || 0) & ~dns.ADDRCONFIG,
    };

    dns.lookup(hostname, lookupOptions, callback);
  }
}
