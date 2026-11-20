/*
 * Runs `work` over the items with at most `limit` running at once, and
 * returns each item's outcome in the items' order: its value, or the error
 * it threw. One item's failure never stops the others - a Region the
 * account has not opted in to, a subscription the app cannot read.
 */

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

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

/*
 * AT MOST SO MANY AT ONCE, PER KEY - FEWER ONCE THE CLOUD SAYS IT IS BUSY.
 *
 * A cloud's own limits are often per place, not per caller: Azure Monitor
 * answers "too many queries are in flight" for a subscription's region
 * whatever else the read is doing elsewhere. Work that shares a key (a
 * subscription and Region) runs `limit` at a time, and each time the cloud
 * says it is busy (slowDown) that key's limit halves, to one at least, for
 * the rest of the work - so a read that met a throttle asks it gently from
 * then on, while other keys go on at their own pace. Waiters are served in
 * the order they came.
 */
export class CloudKeyedLimiter {
  private readonly initialLimit: number;
  private readonly limits: Map<string, number> = new Map();
  private readonly running: Map<string, number> = new Map();
  private readonly waiting: Map<string, Array<() => void>> = new Map();

  public constructor(limit: number) {
    this.initialLimit = Math.max(1, Math.floor(limit));
  }

  // How many of the key's may run at once now.
  public getLimit(key: string): number {
    return this.limits.get(key) ?? this.initialLimit;
  }

  // The cloud said the key's place is busy: half as many of its at once from now.
  public slowDown(key: string): void {
    this.limits.set(key, Math.max(1, Math.floor(this.getLimit(key) / 2)));
  }

  public async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    await this.acquire(key);

    try {
      return await work();
    } finally {
      this.release(key);
    }
  }

  private async acquire(key: string): Promise<void> {
    if ((this.running.get(key) || 0) < this.getLimit(key)) {
      this.running.set(key, (this.running.get(key) || 0) + 1);
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      const queue: Array<() => void> = this.waiting.get(key) || [];
      queue.push(resolve);
      this.waiting.set(key, queue);
    });
  }

  // A slot freed: the next waiter takes it, while the key's limit allows.
  private release(key: string): void {
    const running: number = Math.max(0, (this.running.get(key) || 0) - 1);
    const queue: Array<() => void> = this.waiting.get(key) || [];

    if (queue.length > 0 && running < this.getLimit(key)) {
      const next: () => void = queue.shift()!;
      this.running.set(key, running + 1);
      next();
      return;
    }

    this.running.set(key, running);
  }
}
