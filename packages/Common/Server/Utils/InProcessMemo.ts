/*
 * Bounded, TTL-bearing in-process memo — the L1 layer in front of a Redis
 * (GlobalCache) or Postgres lookup on a hot path.
 *
 * The telemetry ingest worker resolves the same handful of entities (hosts,
 * clusters, services, retention configs) once per resource block per job, and
 * a hostmetrics payload carries hundreds of resource blocks. Redis answers
 * each of those lookups correctly but each answer still costs a serialized
 * network round trip, so at fleet concurrency the round trips — not the
 * answers — are what the workers spend their time on. A short-TTL in-process
 * Map in front of the shared cache collapses the steady state to zero network
 * cost per lookup, exactly as the existing service-resolution / project-
 * retention memos in OpenTelemetryIngestService already do. This class is
 * that pattern extracted so the eleven autoDiscover* paths, the maintenance
 * fence, host resolution and the resource-retention lookup share one
 * implementation instead of growing eleven hand-rolled copies (the
 * ResourceHeartbeat header documents where hand-copying that shape ends up).
 *
 * Design constraints, in order:
 *
 *   - BOUNDED. The keys are attacker-influenced (resource attributes from
 *     collectors), so an unbounded map is a memory leak with a network
 *     trigger. At the cap the OLDEST entry is evicted — Map preserves insert
 *     order, so eviction is O(1) with no bookkeeping to get wrong. Same
 *     approach as DnsResolutionCache.
 *
 *   - SHORT TTL. This memo is never invalidated cross-process (GlobalCache
 *     has no pub/sub primitive), so the TTL is the staleness bound. Callers
 *     keep it modest — 60 seconds is the established norm on the ingest
 *     path — and document what an entry going stale for that long means for
 *     their data.
 *
 *   - NOT a correctness mechanism. Nothing here coordinates across pods; it
 *     composes with the distributed layer underneath, it never replaces it.
 *     (SingleFlight makes the same disclaimer for the concurrent-dedupe
 *     dimension; this class covers the sequential-repeat dimension.)
 *
 * The clock is injectable for tests; the default reads Date.now() lazily so
 * jest's Date.now spies work against instances constructed at module load.
 */

export type NowFunction = () => number;

export interface InProcessMemoOptions {
  /** How long an entry stays valid. The staleness bound — keep it short. */
  ttlInMs: number;
  /** Maximum entries held; the oldest entry is evicted at the cap. */
  maxEntries?: number | undefined;
  /** Clock override for tests. */
  now?: NowFunction | undefined;
}

interface MemoEntry<TValue> {
  value: TValue;
  expiresAtMs: number;
}

export default class InProcessMemo<TValue> {
  private entries: Map<string, MemoEntry<TValue>> = new Map<
    string,
    MemoEntry<TValue>
  >();

  private ttlInMs: number;
  private maxEntries: number;
  private now: NowFunction;

  public constructor(options: InProcessMemoOptions) {
    this.ttlInMs = options.ttlInMs;
    this.maxEntries = options.maxEntries ?? 10_000;
    /*
     * Wrapped rather than stored as a bare `Date.now` reference so a test
     * that spies on Date.now after this instance was constructed (module-
     * level memos are constructed at import time) still steers the clock.
     */
    this.now =
      options.now ??
      ((): number => {
        return Date.now();
      });
  }

  /**
   * The memoed value, or undefined when absent or expired. An expired entry
   * is deleted on read so steady churn cannot pin dead entries under the cap.
   */
  public get(key: string): TValue | undefined {
    const entry: MemoEntry<TValue> | undefined = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAtMs <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Store `value` for the configured TTL — or for `ttlInMsOverride` when the
   * caller's staleness bound varies per entry (e.g. a memo whose lifetime
   * must never exceed the specific Redis window it is fronting) — evicting
   * the oldest entry at the cap.
   */
  public set(key: string, value: TValue, ttlInMsOverride?: number): void {
    if (this.entries.has(key)) {
      /*
       * Re-insert rather than update in place so Map insert order keeps
       * approximating write recency and eviction stays oldest-first.
       */
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxEntries) {
      const oldestKey: string | undefined = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(key, {
      value: value,
      expiresAtMs: this.now() + (ttlInMsOverride ?? this.ttlInMs),
    });
  }

  /**
   * Drop one entry immediately — the local half of an explicit cross-layer
   * invalidation (e.g. releasing a maintenance fence this process observed).
   */
  public delete(key: string): void {
    this.entries.delete(key);
  }

  /** Drop everything. For tests. */
  public clear(): void {
    this.entries.clear();
  }

  /** Number of live-or-expired entries held. For tests and diagnostics. */
  public size(): number {
    return this.entries.size;
  }
}
