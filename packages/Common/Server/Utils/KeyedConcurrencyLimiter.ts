/*
 * Bounds how much of some kind of work runs at once in one process, and how
 * much of it one key - a project, a probe, a queue - may take.
 *
 * At most `maxRunning` callers hold a slot at once, and at most
 * `maxRunningPerKey` of them for any one key, so one busy key cannot occupy
 * every slot. The rest wait, holding nothing else (no database connection,
 * no socket), and a released slot goes to a waiter whose key is under its
 * own limit, so a key at its limit never holds up another key queued behind
 * it. Which waiter, `order` says: the first to arrive ("arrival", the
 * default), or the one whose key holds the fewest slots now
 * ("fewest-running", the first of those to arrive) - fair share: keys that
 * compete for the slots end up with equal shares, however many callers
 * each sends, and a key alone may use every slot, where a fixed
 * maxRunningPerKey below maxRunning can only cap it. The queue is bounded
 * too - per process and per key - and a caller that finds it full, or waits
 * longer than its wait limit, is refused at once with the limiter's busy
 * error rather than left to hang.
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

// Why a caller was refused.
export enum KeyedConcurrencyRefusal {
  // The queue - the process's, or its key's - was full when it arrived.
  QueueFull = "queue-full",
  // It waited its whole wait limit for a slot.
  WaitedTooLong = "waited-too-long",
}

// Which waiter a released slot goes to.
export enum KeyedConcurrencyOrder {
  // The first to arrive that may start.
  Arrival = "arrival",
  // The one whose key holds the fewest slots now; the first to arrive of those.
  FewestRunning = "fewest-running",
}

export interface KeyedConcurrencyLimiterOptions {
  limits: KeyedConcurrencyLimits;
  // What a refused caller gets: the queue was full, or it waited too long.
  busyError: (reason: KeyedConcurrencyRefusal) => Error;
  // What a caller gets whose signal fired before its work started.
  abandonedError: () => Error;
  // Arrival unless said: see the comment at the top.
  order?: KeyedConcurrencyOrder | undefined;
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
      return Promise.reject(
        this.options.busyError(KeyedConcurrencyRefusal.QueueFull),
      );
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
            leave(
              this.options.busyError(KeyedConcurrencyRefusal.WaitedTooLong),
            );
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

  // Hands free slots to waiters, in the limiter's order, skipping full keys.
  private startWaiters(): void {
    if (this.waiting.length === 0) {
      return;
    }

    if (this.options.order === KeyedConcurrencyOrder.FewestRunning) {
      this.startWaitersOfFewestRunningKeys();
      return;
    }

    const stillWaiting: Array<Waiter> = [];
    for (const waiter of this.waiting) {
      if (this.canStart(waiter.key)) {
        this.startWaiter(waiter);
      } else {
        stillWaiting.push(waiter);
      }
    }
    this.waiting = stillWaiting;
  }

  /*
   * One slot at a time, to the waiter whose key holds the fewest now - the
   * first to arrive of those - while a waiter may start. The queue is
   * bounded (maxWaiting), so this stays a short walk.
   */
  private startWaitersOfFewestRunningKeys(): void {
    for (;;) {
      let chosen: number = -1;
      let chosenRunning: number = Infinity;

      for (let index: number = 0; index < this.waiting.length; index++) {
        const key: string = this.waiting[index]!.key;
        const running: number = this.runningCount(key);

        if (running < chosenRunning && this.canStart(key)) {
          chosen = index;
          chosenRunning = running;
        }
      }

      if (chosen < 0) {
        return;
      }

      const waiter: Waiter = this.waiting.splice(chosen, 1)[0]!;
      this.startWaiter(waiter);
    }
  }

  private startWaiter(waiter: Waiter): void {
    this.take(waiter.key);
    this.countWaiting(waiter.key, -1);
    waiter.detach();
    waiter.start();
  }
}
