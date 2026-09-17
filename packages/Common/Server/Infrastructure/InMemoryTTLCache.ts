interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Bounded, in-process TTL cache. Entries expire on read after their TTL and the
 * oldest entry is evicted when capacity is reached (Map preserves insertion
 * order, which we use as a coarse LRU on writes).
 *
 * Each process holds its own copy — there is no cross-process invalidation.
 * Callers that need stronger consistency should pair the TTL with an explicit
 * `delete()` on writes to the underlying data.
 */
export default class InMemoryTTLCache<T> {
  private store: Map<string, CacheEntry<T>> = new Map();
  private maxEntries: number;

  public constructor(maxEntries: number = 10_000) {
    this.maxEntries = maxEntries;
  }

  public set(key: string, value: T, ttlMs: number): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest: string | undefined = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  public get(key: string): T | undefined {
    const entry: CacheEntry<T> | undefined = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
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

  public clear(): void {
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }
}
