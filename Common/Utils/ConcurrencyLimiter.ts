/**
 * Run an async worker over a list of items while never keeping more than
 * `concurrencyLimit` workers in flight at once.
 *
 * This is the bounded-fan-out primitive used by background jobs (e.g. the
 * telemetry-monitor evaluator) so that a tick with hundreds of due monitors
 * cannot launch hundreds of simultaneous ClickHouse queries and exhaust the
 * connection pool / saturate the server. Wall-clock is the slowest
 * `ceil(items / limit)` waves rather than a single all-at-once burst.
 *
 * Semantics mirror Promise.allSettled: every item is processed, one worker
 * throwing never aborts the others, and the returned array is aligned with
 * the input by index (result[i] corresponds to items[i]). Use the settled
 * shape to decide per-item success/failure at the call site.
 */
export default async function runWithConcurrency<TItem, TResult>(
  items: Array<TItem>,
  concurrencyLimit: number,
  worker: (item: TItem, index: number) => Promise<TResult>,
): Promise<Array<PromiseSettledResult<TResult>>> {
  const results: Array<PromiseSettledResult<TResult>> = new Array(items.length);

  if (items.length === 0) {
    return results;
  }

  /*
   * Clamp to at least 1 so a misconfigured (0 / negative / NaN) limit still
   * makes forward progress serially instead of deadlocking on an empty pool.
   */
  const limit: number =
    Number.isFinite(concurrencyLimit) && concurrencyLimit >= 1
      ? Math.floor(concurrencyLimit)
      : 1;

  // Shared cursor every lane pulls the next index from.
  let nextIndex: number = 0;

  const runLane: () => Promise<void> = async (): Promise<void> => {
    for (;;) {
      const currentIndex: number = nextIndex;
      nextIndex++;

      if (currentIndex >= items.length) {
        return;
      }

      try {
        const value: TResult = await worker(items[currentIndex]!, currentIndex);
        results[currentIndex] = { status: "fulfilled", value };
      } catch (reason) {
        results[currentIndex] = { status: "rejected", reason };
      }
    }
  };

  const laneCount: number = Math.min(limit, items.length);
  const lanes: Array<Promise<void>> = [];
  for (let i: number = 0; i < laneCount; i++) {
    lanes.push(runLane());
  }

  await Promise.all(lanes);

  return results;
}
