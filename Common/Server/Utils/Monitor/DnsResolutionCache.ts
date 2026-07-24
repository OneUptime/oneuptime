import dns from "dns";

/*
 * Small positive/negative DNS cache for correlating datagram source IPs
 * (SNMP traps, syslog) to NetworkDevices registered by DNS name instead of
 * IP address. Every trap from such a device used to be silently dropped —
 * the ingest paths match hostname == source IP by exact string — so this
 * cache lets them resolve the handful of DNS-named devices per probe
 * without hammering the resolver on every datagram.
 *
 * Failures are cached too (as an empty address list) so an unresolvable
 * hostname does not retry on every trap. The resolver and clock are
 * injectable for tests.
 */

interface DnsCacheEntry {
  addresses: Array<string>;
  expiresAt: number;
}

export type ResolveHostnameFunction = (
  hostname: string,
) => Promise<Array<string>>;

export type NowFunction = () => number;

/*
 * dns.lookup has no timeout of its own and runs on the shared libuv
 * threadpool, so a wedged resolver would otherwise stall the trap/syslog
 * ingest path. The race rejects after this budget; the failure is then
 * negative-cached like any other resolution error.
 */
const DEFAULT_RESOLVE_TIMEOUT_MS: number = 2000;

const defaultResolver: ResolveHostnameFunction = async (
  hostname: string,
): Promise<Array<string>> => {
  const lookup: Promise<Array<dns.LookupAddress>> = dns.promises.lookup(
    hostname,
    {
      all: true,
      verbatim: true,
    },
  );

  const timeout: Promise<never> = new Promise<never>(
    (_resolve: (value: never) => void, reject: (reason: Error) => void) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        reject(new Error(`DNS lookup for ${hostname} timed out`));
      }, DEFAULT_RESOLVE_TIMEOUT_MS);
      // Never keep the process alive just for this timer.
      timer.unref?.();
    },
  );

  const results: Array<dns.LookupAddress> = await Promise.race([
    lookup,
    timeout,
  ]);

  return results.map((result: dns.LookupAddress) => {
    return result.address;
  });
};

export class DnsResolutionCache {
  private cache: Map<string, DnsCacheEntry> = new Map<string, DnsCacheEntry>();

  private ttlInMs: number;
  private maxEntries: number;
  private resolver: ResolveHostnameFunction;
  private now: NowFunction;

  public constructor(options?: {
    ttlInMs?: number | undefined;
    maxEntries?: number | undefined;
    resolver?: ResolveHostnameFunction | undefined;
    now?: NowFunction | undefined;
  }) {
    this.ttlInMs = options?.ttlInMs ?? 5 * 60 * 1000;
    this.maxEntries = options?.maxEntries ?? 5000;
    this.resolver = options?.resolver ?? defaultResolver;
    this.now = options?.now ?? Date.now;
  }

  /*
   * Addresses for a hostname, from cache when fresh. Resolution errors
   * return (and cache) an empty list — callers treat that as "no match",
   * never as an exception.
   */
  public async resolve(hostname: string): Promise<Array<string>> {
    const key: string = hostname.toLowerCase();
    const nowInMs: number = this.now();

    const cached: DnsCacheEntry | undefined = this.cache.get(key);
    if (cached && cached.expiresAt > nowInMs) {
      return cached.addresses;
    }

    let addresses: Array<string> = [];
    try {
      addresses = await this.resolver(hostname);
    } catch {
      // Negative-cache resolution failures.
      addresses = [];
    }

    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      // Bound memory: evict the oldest entry (Map preserves insert order).
      const oldestKey: string | undefined = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      addresses: addresses,
      expiresAt: nowInMs + this.ttlInMs,
    });

    return addresses;
  }

  public clear(): void {
    this.cache.clear();
  }
}

export default DnsResolutionCache;
