/*
 * Runs `work` over the items with at most `limit` running at once, and
 * returns each item's outcome in the items' order: its value, or the error
 * it threw. One item's failure never stops the others - a Region the
 * account has not opted in to, a subscription the app cannot read.
 */

export type Settled<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export async function mapWithConcurrency<TItem, TResult>(
  items: Array<TItem>,
  limit: number,
  work: (item: TItem, index: number) => Promise<TResult>,
): Promise<Array<Settled<TResult>>> {
  const results: Array<Settled<TResult>> = new Array(items.length);
  let next: number = 0;

  const worker: () => Promise<void> = async (): Promise<void> => {
    while (next < items.length) {
      const index: number = next;
      next++;

      try {
        results[index] = { ok: true, value: await work(items[index]!, index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };

  const workers: Array<Promise<void>> = [];

  for (let count: number = 0; count < Math.max(1, limit); count++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  return results;
}
