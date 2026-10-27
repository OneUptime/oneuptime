import OldestKeyCursor from "../../Utils/OldestKeyCursor";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/*
 * How often, at most, a cache looks through all of its entries for expired
 * ones, on a read or a write. An expired entry can never be read again, yet
 * it used to stay in memory until a read of its own key or until enough newer
 * entries pushed it out - for a 15-second status page overview, until 500
 * newer overviews had been built. A pass over 10,000 entries takes well under
 * a millisecond, so once a second costs nothing a caller can see.
 */
export const EXPIRED_ENTRY_SWEEP_INTERVAL_MS: number = 1_000;

/**
 * Bounded, in-process TTL cache. Entries expire after their TTL - a read
 * past it misses and drops the entry, and expired entries are swept out at
 * most once per EXPIRED_ENTRY_SWEEP_INTERVAL_MS on any read or write - and
 * the oldest entry is evicted when capacity is reached (Map preserves
 * insertion order, which we use as a coarse LRU on writes).
 *
 * The sweep drops only entries that can no longer be read, before a write
 * makes room, so a read returns the same value it did without it: a cache
 * that is full of expired entries no longer evicts a live one to make room.
 *
 * A cache full of live entries finds its oldest through one iterator kept
 * between writes (Utils/OldestKeyCursor), not a new keys().next() per write,
 * which walked past every slot evicted before it: about 10 microseconds a
 * write at 10,000 entries, against under one. The entry evicted is the same.
 *
 * Each process holds its own copy — there is no cross-process invalidation.
 * Callers that need stronger consistency should pair the TTL with an explicit
 * `delete()` on writes to the underlying data.
 */
export default class InMemoryTTLCache<T> {
  private store: Map<string, CacheEntry<T>> = new Map();
  private oldestKeys: OldestKeyCursor<string> = new OldestKeyCursor<string>(
    this.store,
  );
  private maxEntries: number;
  private lastSweepAt: number = Number.NEGATIVE_INFINITY;

  public constructor(maxEntries: number = 10_000) {
    this.maxEntries = maxEntries;
  }

  public set(key: string, value: T, ttlMs: number): void {
    const now: number = Date.now();

    this.sweepExpiredEntriesWhenDue(now);

    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest: string | undefined = this.oldestKeys.takeOldest();
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: now + ttlMs });
  }

  public get(key: string): T | undefined {
    const now: number = Date.now();

    this.sweepExpiredEntriesWhenDue(now);

    const entry: CacheEntry<T> | undefined = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (now > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  public has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  public delete(key: string): void {
    this.store.delete(key);
  }

  // Deletes every entry whose key starts with `prefix`.
  public deleteByPrefix(prefix: string): void {
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  public clear(): void {
    this.store.clear();
    this.oldestKeys.reset();
  }

  public size(): number {
    return this.store.size;
  }

  /*
   * Drops every entry whose TTL has passed - exactly the entries a read
   * would already miss - once EXPIRED_ENTRY_SWEEP_INTERVAL_MS has gone by
   * since the last sweep. A clock that moved backwards sweeps at once rather
   * than waiting for it to catch up.
   */
  private sweepExpiredEntriesWhenDue(now: number): void {
    if (
      now - this.lastSweepAt < EXPIRED_ENTRY_SWEEP_INTERVAL_MS &&
      now >= this.lastSweepAt
    ) {
      return;
    }

    this.lastSweepAt = now;

    if (this.store.size === 0) {
      return;
    }

    // Deleting the entry being visited is safe while iterating a Map.
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}
