/*
 * In-process cache for the Topology maps' serialized responses.
 *
 * Opening the Topology page, switching back to it and every other viewer of
 * the same project inside a minute ask for the same thing: the maps for one
 * project, as of one (minute-floored) range start. Building one reads the
 * whole inventory, so the serialized JSON is kept for a short TTL and handed
 * out as the string it already is — no re-serialization per request.
 *
 * Concurrent cold requests for one key share a single build (single flight):
 * the first caller runs it, everyone arriving while it is in flight awaits the
 * same promise. A failed build is never cached; its followers see the same
 * failure and the next request starts over.
 *
 * Bounded by a byte budget rather than an entry count: a large estate's
 * infrastructure payload is tens of megabytes, so a count bound says nothing
 * about memory. Oldest entries are evicted first (Map iteration order is
 * insertion order), and a single value over the whole budget is simply not
 * kept. Per process, with no cross-process invalidation — the TTL is the
 * staleness bound, and the maps already show data up to a minute old.
 *
 * Authorization is NOT this module's concern: callers must authorize the
 * request before asking for a key, so a cache hit never skips a check.
 */

export const TOPOLOGY_RESPONSE_CACHE_TTL_MS: number = 60_000;

/* ~256 MB, counting two bytes per UTF-16 code unit (the worst case in V8). */
export const TOPOLOGY_RESPONSE_CACHE_MAX_BYTES: number = 256 * 1024 * 1024;

/* One cached response per (route, project, minute-floored range start). */
export function topologyResponseCacheKey(data: {
  route: string;
  projectId: string;
  rangeStart: Date;
}): string {
  return `${data.route}|${data.projectId}|${data.rangeStart.getTime()}`;
}

interface CacheEntry {
  value: string;
  bytes: number;
  expiresAt: number;
}

export class TopologyResponseCache {
  private store: Map<string, CacheEntry> = new Map<string, CacheEntry>();
  private bytes: number = 0;
  private inFlight: Map<string, Promise<string>> = new Map<
    string,
    Promise<string>
  >();

  public constructor(
    private ttlMs: number = TOPOLOGY_RESPONSE_CACHE_TTL_MS,
    private maxBytes: number = TOPOLOGY_RESPONSE_CACHE_MAX_BYTES,
    private now: () => number = (): number => {
      return Date.now();
    },
  ) {}

  /* The cached value for `key`, or the result of `build` (shared, cached). */
  public async getOrBuild(
    key: string,
    build: () => Promise<string>,
  ): Promise<string> {
    const cached: string | undefined = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const running: Promise<string> | undefined = this.inFlight.get(key);
    if (running) {
      return await running;
    }

    /*
     * Wrapped so a `build` that throws synchronously still yields a promise
     * to register and settle; otherwise the key would never be released.
     */
    const promise: Promise<string> = (async (): Promise<string> => {
      const value: string = await build();
      this.set(key, value);
      return value;
    })();

    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    }
  }

  public get(key: string): string | undefined {
    const entry: CacheEntry | undefined = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (this.now() > entry.expiresAt) {
      this.delete(key);
      return undefined;
    }
    return entry.value;
  }

  public set(key: string, value: string): void {
    this.delete(key);

    const bytes: number = value.length * 2;
    if (bytes > this.maxBytes) {
      return;
    }

    this.sweepExpired();

    while (this.store.size > 0 && this.bytes + bytes > this.maxBytes) {
      const oldest: string | undefined = this.store.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.delete(oldest);
    }

    this.store.set(key, {
      value,
      bytes,
      expiresAt: this.now() + this.ttlMs,
    });
    this.bytes += bytes;
  }

  public delete(key: string): void {
    const entry: CacheEntry | undefined = this.store.get(key);
    if (!entry) {
      return;
    }
    this.bytes -= entry.bytes;
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
    this.inFlight.clear();
    this.bytes = 0;
  }

  public size(): number {
    return this.store.size;
  }

  public byteSize(): number {
    return this.bytes;
  }

  public inFlightCount(): number {
    return this.inFlight.size;
  }

  private sweepExpired(): void {
    const now: number = this.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.delete(key);
      }
    }
  }
}

export default new TopologyResponseCache();
