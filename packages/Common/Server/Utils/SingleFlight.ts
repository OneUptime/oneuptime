/*
 * In-process de-duplication of concurrent identical work.
 *
 * A Redis fence admits one writer per window across the FLEET, but every
 * caller still pays a Redis round trip to discover it lost. That is the wrong
 * unit of work when the duplicate callers are in the same process: an ingest
 * pod running hundreds of concurrent jobs re-resolves the same handful of
 * services on every batch, so hundreds of coroutines independently ask Redis
 * the same question and then throw the answer away.
 *
 * SingleFlight collapses them first. The first caller for a key runs the work;
 * everyone who arrives while it is still in flight awaits the SAME promise and
 * gets the same result. Per pod, N concurrent duplicates cost one Redis round
 * trip and at most one database write instead of N of each — which is what
 * turns fleet-wide write amplification from (pods x jobs) into (pods).
 *
 * Deliberately unbounded in time but not in size: entries live only for the
 * duration of the work itself and are removed in a `finally`, so the map holds
 * exactly the set of operations currently running. There is no eviction policy
 * to get wrong and nothing to leak if work hangs beyond a caller's patience —
 * the entry is released when the underlying promise settles either way.
 *
 * This is a per-process optimisation and NOT a correctness mechanism: nothing
 * here coordinates across pods. It composes with a distributed fence, it does
 * not replace one.
 */
export default class SingleFlight {
  private static inflight: Map<string, Promise<unknown>> = new Map<
    string,
    Promise<unknown>
  >();

  /**
   * Run `work` for `key`, or join the run already in flight for it.
   *
   * Followers observe whatever the leader observes, including a rejection.
   * That is intentional: these callers asked for identical work, so they are
   * entitled to identical outcomes, and a follower silently retrying a failure
   * the leader just hit would re-create the stampede this exists to prevent.
   */
  public static async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing: Promise<unknown> | undefined = this.inflight.get(key);

    if (existing) {
      return (await existing) as T;
    }

    /*
     * Invoke through a wrapper so a `work` that throws SYNCHRONOUSLY still
     * produces a promise to register and await. Calling it bare would throw
     * past the bookkeeping below and leave the key registered forever.
     */
    const promise: Promise<T> = (async () => {
      return await work();
    })();

    this.inflight.set(key, promise);

    try {
      return await promise;
    } finally {
      /*
       * Only clear the entry if it is still ours. A follower cannot install a
       * new one (it awaited instead), but a later leader can, and blindly
       * deleting here would evict that live run and let the next caller start
       * a duplicate of work already underway.
       */
      if (this.inflight.get(key) === promise) {
        this.inflight.delete(key);
      }
    }
  }

  /** Number of operations currently in flight. For tests and diagnostics. */
  public static inflightCount(): number {
    return this.inflight.size;
  }

  /** Drop all bookkeeping. For tests only. */
  public static clear(): void {
    this.inflight.clear();
  }
}
