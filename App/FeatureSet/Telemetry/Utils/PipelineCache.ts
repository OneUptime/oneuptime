import InMemoryTTLCache from "Common/Server/Infrastructure/InMemoryTTLCache";

interface PendingLoad<T> {
  promise: Promise<T>;
  startedAt: number;
}

/** Shares overlapping loads without keeping a second copy of a project's config. */
export default class PipelineCache<T> {
  private readonly cache: InMemoryTTLCache<T>;
  private readonly loading: Map<string, PendingLoad<T>> = new Map();

  public constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
  ) {
    this.cache = new InMemoryTTLCache<T>(maxEntries);
  }

  public async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const cached: T | undefined = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const existing: PendingLoad<T> | undefined = this.loading.get(key);
    const now: number = Date.now();
    if (
      existing &&
      now >= existing.startedAt &&
      now - existing.startedAt <= this.ttlMs
    ) {
      return existing.promise;
    }
    /*
     * A stalled database request must not pin all future loads for this project.
     * Its original callers still receive its outcome; later callers may retry.
     */
    this.loading.delete(key);

    let tracked: boolean = false;
    // Defer the loader until the promise is registered, including sync failures.
    const pending: Promise<T> = Promise.resolve()
      .then(load)
      .then((value: T): T => {
        /*
         * Start freshness at completion: a slow load must still get a full TTL.
         * A superseded slow load must not overwrite newer configuration.
         */
        if (tracked && this.loading.get(key)?.promise === pending) {
          this.cache.set(key, value, this.ttlMs);
        }
        return value;
      })
      .finally((): void => {
        if (this.loading.get(key)?.promise === pending) {
          this.loading.delete(key);
        }
      });

    /*
     * Cap auxiliary state too. Overflow projects still receive their result,
     * but do not populate the cache or share work until a slot becomes free.
     * Without ownership, an old overflow load could overwrite a newer result.
     */
    if (this.loading.size < this.maxEntries) {
      tracked = true;
      this.loading.set(key, { promise: pending, startedAt: now });
    }

    return pending;
  }
}
