/**
 * In-flight request coalescer.
 *
 * When N panels on a dashboard mount simultaneously and ask for identical
 * data, this lets only one underlying request fly. Subsequent callers with
 * the same key receive the same Promise. Once the Promise settles the
 * entry is dropped, so subsequent calls re-fetch (no stale caching here —
 * we only deduplicate concurrent requests).
 *
 * Generic over the result type. Construct one per logical fetch surface
 * (e.g. a single instance for metrics, another for logs).
 */
export default class QueryCoalescer<TResult> {
  private inFlight: Map<string, Promise<TResult>> = new Map<
    string,
    Promise<TResult>
  >();

  public async run(
    key: string,
    fetcher: () => Promise<TResult>,
  ): Promise<TResult> {
    const existing: Promise<TResult> | undefined = this.inFlight.get(key);
    if (existing) {
      return existing;
    }
    const promise: Promise<TResult> = fetcher();
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  public size(): number {
    return this.inFlight.size;
  }

  public clear(): void {
    this.inFlight.clear();
  }
}
