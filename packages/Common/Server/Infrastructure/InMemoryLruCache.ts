import { EXPIRED_ENTRY_SWEEP_INTERVAL_MS } from "./InMemoryTTLCache";
import OldestKeyMap from "../../Utils/OldestKeyMap";

/*
 * A bounded, in-process cache of entries that each run out, which lets go of
 * the entry used least recently when it is full - full by count, or by the
 * bytes its entries hold together (sizeOf). An entry bigger than
 * maxEntryBytes is never kept: it is served as it was made.
 *
 * InMemoryTTLCache bounds the number of entries only, which is right for
 * small values. A cache of values that can be large - a status page's
 * images, its settings with its images in them, its lists - needs its bytes
 * bounded too, or a few pages with big images would hold more memory than
 * the process has.
 *
 * An entry read is the most recently used. Expired entries can never be
 * read again; they are let go of on a write, at most once per
 * EXPIRED_ENTRY_SWEEP_INTERVAL_MS, so a cache of pages nobody views any more
 * does not hold their bytes until newer ones push them out. The oldest key
 * is found in constant time (Utils/OldestKeyMap).
 *
 * Each process holds its own copy.
 */

export interface InMemoryLruCacheLimits<T> {
  // At most how many entries.
  maxEntries: number;
  // At most how many bytes, every entry's together; Infinity for no bound.
  maxBytes: number;
  // An entry bigger than this is never kept; Infinity for no bound.
  maxEntryBytes: number;
  // What an entry counts for against maxBytes and maxEntryBytes.
  sizeOf: (value: T) => number;
}

interface Entry<T> {
  value: T;
  bytes: number;
  expiresAt: number;
}

export default class InMemoryLruCache<T> {
  // Least recently used first.
  private entries: OldestKeyMap<string, Entry<T>> = new OldestKeyMap<
    string,
    Entry<T>
  >();

  private keptBytes: number = 0;
  private lastSweepAt: number = Number.NEGATIVE_INFINITY;

  /*
   * The limits are asked for on every write, so a caller can keep them in
   * settings that change (tests do).
   */
  public constructor(
    private readonly limits: () => InMemoryLruCacheLimits<T>,
  ) {}

  // An entry's value while it is within its life, made the most recently used.
  public get(key: string): T | undefined {
    const entry: Entry<T> | undefined = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    this.remove(key);

    if (Date.now() >= entry.expiresAt) {
      return undefined;
    }

    this.entries.set(key, entry);
    this.keptBytes += entry.bytes;

    return entry.value;
  }

  /*
   * Keeps a value for ttlMs, letting go of the least recently used entries
   * for room. False when it was not kept: too big, or no life to keep.
   */
  public set(key: string, value: T, ttlMs: number): boolean {
    const limits: InMemoryLruCacheLimits<T> = this.limits();

    this.remove(key);
    this.sweepExpiredWhenDue();

    const bytes: number = Math.max(0, limits.sizeOf(value));

    if (
      ttlMs <= 0 ||
      limits.maxEntries <= 0 ||
      bytes > limits.maxEntryBytes ||
      bytes > limits.maxBytes
    ) {
      return false;
    }

    while (
      this.entries.size > 0 &&
      (this.entries.size >= limits.maxEntries ||
        this.keptBytes + bytes > limits.maxBytes)
    ) {
      const oldest: string | undefined = this.entries.oldestKey();

      if (oldest === undefined) {
        break;
      }

      this.remove(oldest);
    }

    this.entries.set(key, {
      value: value,
      bytes: bytes,
      expiresAt: Date.now() + ttlMs,
    });
    this.keptBytes += bytes;

    return true;
  }

  public delete(key: string): void {
    this.remove(key);
  }

  public clear(): void {
    this.entries.clear();
    this.keptBytes = 0;
    this.lastSweepAt = Number.NEGATIVE_INFINITY;
  }

  // How many entries, and bytes of them, are kept.
  public size(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.keptBytes };
  }

  /*
   * Lets go of every entry whose life is over, at most once per
   * EXPIRED_ENTRY_SWEEP_INTERVAL_MS. A clock that moved backwards sweeps at
   * once.
   */
  private sweepExpiredWhenDue(): void {
    const now: number = Date.now();

    if (
      now - this.lastSweepAt < EXPIRED_ENTRY_SWEEP_INTERVAL_MS &&
      now >= this.lastSweepAt
    ) {
      return;
    }

    this.lastSweepAt = now;

    for (const [key, entry] of Array.from(this.entries.entries())) {
      if (now >= entry.expiresAt) {
        this.remove(key);
      }
    }
  }

  private remove(key: string): void {
    const entry: Entry<T> | undefined = this.entries.get(key);

    if (!entry) {
      return;
    }

    this.entries.delete(key);
    this.keptBytes -= entry.bytes;
  }
}
