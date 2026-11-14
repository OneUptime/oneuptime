/*
 * Bounds how much of some kind of work runs at once in one process, and how
 * much of it one key - a project, a probe, a queue - may take.
 *
 * At most `maxRunning` callers hold a slot at once, and at most
 * `maxRunningPerKey` of them for any one key, so one busy key cannot occupy
 * every slot. The rest wait in arrival order, holding nothing else (no
 * database connection, no socket): a released slot goes to the first waiter
 * whose key is under its own limit, so a key at its limit never holds up
 * another key queued behind it. The queue is bounded too - per process and
 * per key - and a caller that finds it full, or waits longer than its wait
 * limit, is refused at once with the limiter's busy error rather than left
 * to hang.
 *
 * A caller whose AbortSignal fires while it waits gives up its place at once
 * and never starts (the abandoned error): a client that has gone must not
 * hold a place ahead of one that is still waiting.
 *
 * Per process: there is no cross-process coordination, so the bound for a
 * fleet is this times its replicas.
 *
 * Topology's reads (TopologyConcurrencyLimiter), the probes' scheduling
 * requests (Probe/ProbeSchedulingLimiter) and the Postgres connections queue
 * jobs borrow (Infrastructure/Postgres/QueueJobConnections) each have one.
 */

export interface KeyedConcurrencyLimits {
  // Callers holding a slot at once in this process.
  maxRunning: number;
  // Of those, at most this many for one key.
  maxRunningPerKey: number;
  // Callers waiting for a slot in this process; one more is refused.
  maxWaiting: number;
  // Of those, at most this many for one key, so it cannot fill the queue.
  maxWaitingPerKey: number;
  // Longest a caller waits for a slot before it is refused.
  maxWaitMs: number;
}

export interface KeyedConcurrencyLimiterOptions {
  limits: KeyedConcurrencyLimits;
  // What a refused caller gets: the queue was full, or it waited too long.
  busyError: () => Error;
  // What a caller gets whose signal fired before its work started.
  abandonedError: () => Error;
}

export interface KeyedConcurrencyWaitOptions {
  // Fires when the caller no longer wants the slot (its client went away).
  signal?: AbortSignal | undefined;
  // This caller's wait limit, in place of the limiter's maxWaitMs.
  maxWaitMs?: number | undefined;
}

// Gives a slot back. Safe to call more than once: only the first call counts.
export type KeyedConcurrencyRelease = () => void;

interface Waiter {
  key: string;
  start: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  detach: () => void;
}

export default class KeyedConcurrencyLimiter {
  private running: number = 0;
  private runningByKey: Map<string, number> = new Map<string, number>();
  /*
   * Arrival order. Invariant between calls: no waiter here could start (the
   * process is full, or its key is), so a caller that can start never
   * overtakes one that could have.
   */
  private waiting: Array<Waiter> = [];
  private waitingByKey: Map<string, number> = new Map<string, number>();

  public constructor(private options: KeyedConcurrencyLimiterOptions) {}

  public get limits(): KeyedConcurrencyLimits {
    return this.options.limits;
  }

  /*
   * Runs `work` once a slot for `key` is free, and frees it when the work
   * settles, however it settles. Throws the busy error without running
   * `work` when the queue is full or the wait too long, and the abandoned
   * error without running it when `signal` fires first (work that has
   * started runs to completion).
   */
  public async run<T>(
    key: string,
    work: () => Promise<T>,
    options?: KeyedConcurrencyWaitOptions | undefined,
  ): Promise<T> {
    const release: KeyedConcurrencyRelease = await this.acquire(key, options);
    try {
      // The slot can be handed over in the same tick the client leaves.
      if (options?.signal?.aborted) {
        throw this.options.abandonedError();
      }
      return await work();
    } finally {
      release();
    }
  }

  /*
   * Takes a slot for `key`, waiting for one if need be, and hands back the
   * function that gives it back - for a slot held across more than one
   * promise (a pooled connection, from its checkout to its release). Refused
   * as run() is.
   */
  public acquire(
    key: string,
    options?: KeyedConcurrencyWaitOptions | undefined,
  ): Promise<KeyedConcurrencyRelease> {
    const signal: AbortSignal | undefined = options?.signal;

    if (signal?.aborted) {
      return Promise.reject(this.options.abandonedError());
    }

    if (this.canStart(key)) {
      this.take(key);
      return Promise.resolve(this.releaseOnce(key));
    }

    if (
      this.waiting.length >= this.limits.maxWaiting ||
      this.waitingCount(key) >= this.limits.maxWaitingPerKey
    ) {
      return Promise.reject(this.options.busyError());
    }

    const maxWaitMs: number = Math.max(
      0,
      options?.maxWaitMs ?? this.limits.maxWaitMs,
    );

    return new Promise<KeyedConcurrencyRelease>(
      (
        resolve: (release: KeyedConcurrencyRelease) => void,
        reject: (error: Error) => void,
      ): void => {
        // Leaves the queue (if still in it) and rejects with `error`.
        const leave: (error: Error) => void = (error: Error): void => {
          const index: number = this.waiting.indexOf(waiter);
          if (index >= 0) {
            this.waiting.splice(index, 1);
            this.countWaiting(key, -1);
            waiter.detach();
            reject(error);
          }
        };
        const onAbort: () => void = (): void => {
          leave(this.options.abandonedError());
        };
        const waiter: Waiter = {
          key,
          start: (): void => {
            resolve(this.releaseOnce(key));
          },
          timer: null,
          detach: (): void => {
            if (waiter.timer) {
              clearTimeout(waiter.timer);
            }
            signal?.removeEventListener("abort", onAbort);
          },
        };
        if (Number.isFinite(maxWaitMs)) {
          waiter.timer = setTimeout((): void => {
            leave(this.options.busyError());
          }, maxWaitMs);
        }
        signal?.addEventListener("abort", onAbort);
        this.waiting.push(waiter);
        this.countWaiting(key, 1);
      },
    );
  }

  public runningCount(key?: string): number {
    if (key === undefined) {
      return this.running;
    }
    return this.runningByKey.get(key) || 0;
  }

  public waitingCount(key?: string): number {
    if (key === undefined) {
      return this.waiting.length;
    }
    return this.waitingByKey.get(key) || 0;
  }

  private canStart(key: string): boolean {
    return (
      this.running < this.limits.maxRunning &&
      this.runningCount(key) < this.limits.maxRunningPerKey
    );
  }

  private take(key: string): void {
    this.running++;
    this.runningByKey.set(key, this.runningCount(key) + 1);
  }

  private countWaiting(key: string, change: number): void {
    const remaining: number = this.waitingCount(key) + change;
    if (remaining > 0) {
      this.waitingByKey.set(key, remaining);
    } else {
      this.waitingByKey.delete(key);
    }
  }

  private releaseOnce(key: string): KeyedConcurrencyRelease {
    let released: boolean = false;
    return (): void => {
      if (released) {
        return;
      }
      released = true;
      this.release(key);
    };
  }

  private release(key: string): void {
    this.running--;
    const remaining: number = this.runningCount(key) - 1;
    if (remaining > 0) {
      this.runningByKey.set(key, remaining);
    } else {
      this.runningByKey.delete(key);
    }
    this.startWaiters();
  }

  // Hands free slots to waiters in arrival order, skipping full keys.
  private startWaiters(): void {
    if (this.waiting.length === 0) {
      return;
    }
    const stillWaiting: Array<Waiter> = [];
    for (const waiter of this.waiting) {
      if (this.canStart(waiter.key)) {
        this.take(waiter.key);
        this.countWaiting(waiter.key, -1);
        waiter.detach();
        waiter.start();
      } else {
        stillWaiting.push(waiter);
      }
    }
    this.waiting = stillWaiting;
  }
}
