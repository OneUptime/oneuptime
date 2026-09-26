import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";

/*
 * Bounds the Topology API's database work in one API process.
 *
 * Every Topology request reads in its own snapshot on one pooled connection
 * (TopologyQueries.inReadOnlySnapshot), and a map build is among the heaviest
 * reads in the app — a whole-inventory pass that can take seconds on a large
 * project. The response cache shares a build between viewers of the same
 * (project, minute), but callers choose the minute and the drawer and
 * collection reads are not cached at all, so nothing else stops a burst of
 * them from taking the connection pool (shared with ingest, alerting and
 * every other request on the process) and the database CPU with it.
 *
 * So at most `maxRunning` of them run at once per process, and at most
 * `maxRunningPerProject` for any one project, so one busy project cannot
 * occupy every slot. The rest wait in arrival order WITHOUT holding a
 * connection: a released slot goes to the first waiter whose project is
 * under its own limit, so a project at its limit never holds up another
 * project queued behind it. The queue is bounded too — per process and per
 * project — and a request that finds it full, or waits longer than
 * `maxWaitMs`, is answered 429 (TooManyRequestsException) at once: the
 * Dashboard shows "busy, try again" rather than a request that hangs.
 *
 * A request whose client has gone (the drawer aborts the previous entity's
 * load on every click) gives up its queue place at once and never starts:
 * otherwise one person clicking through the drawer would queue dead reads
 * ahead of the one they are waiting for and fill their project's queue.
 *
 * Per process, like the response cache; there is no cross-process
 * coordination, so the cluster-wide bound is this times the API replicas.
 */

export const TOPOLOGY_BUSY_MESSAGE: string =
  "The topology service is busy. Try again in a moment.";

/* Sent as Retry-After with a 429 from the Topology API. */
export const TOPOLOGY_BUSY_RETRY_AFTER_SECONDS: number = 5;

export interface TopologyConcurrencyLimits {
  /* Topology reads (one snapshot each) running at once in this process. */
  maxRunning: number;
  /* Of those, at most this many for one project. */
  maxRunningPerProject: number;
  /* Requests waiting for a slot in this process; one more is a 429. */
  maxWaiting: number;
  /* Of those, at most this many for one project, so it cannot fill the queue. */
  maxWaitingPerProject: number;
  /* Longest a request waits for a slot before it is answered 429. */
  maxWaitMs: number;
}

export const TOPOLOGY_CONCURRENCY_LIMITS: TopologyConcurrencyLimits = {
  maxRunning: 4,
  maxRunningPerProject: 2,
  maxWaiting: 64,
  maxWaitingPerProject: 16,
  maxWaitMs: 30_000,
};

/* The caller went away before its read started; nobody is waiting for it. */
export class TopologyRequestAbandonedError extends Error {
  public constructor() {
    super("The Topology request was abandoned by its client.");
    this.name = "TopologyRequestAbandonedError";
  }
}

interface Waiter {
  projectId: string;
  start: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  detach: () => void;
}

export class TopologyConcurrencyLimiter {
  private running: number = 0;
  private runningByProject: Map<string, number> = new Map<string, number>();
  /*
   * Arrival order. Invariant between calls: no waiter here could start (the
   * process is full, or its project is), so a new request that can start
   * never overtakes one that could have.
   */
  private waiting: Array<Waiter> = [];

  public constructor(
    private limits: TopologyConcurrencyLimits = TOPOLOGY_CONCURRENCY_LIMITS,
  ) {}

  /*
   * Runs `work` once a slot for `projectId` is free, and frees it when the
   * work settles, however it settles. Throws TooManyRequestsException
   * without running `work` when the queue is full or the wait too long, and
   * TopologyRequestAbandonedError without running it when `signal` fires
   * first (a read that has started runs to completion).
   */
  public async run<T>(
    projectId: string,
    work: () => Promise<T>,
    signal?: AbortSignal | undefined,
  ): Promise<T> {
    await this.acquire(projectId, signal);
    try {
      if (signal?.aborted) {
        throw new TopologyRequestAbandonedError();
      }
      return await work();
    } finally {
      this.release(projectId);
    }
  }

  public runningCount(projectId?: string): number {
    if (projectId === undefined) {
      return this.running;
    }
    return this.runningByProject.get(projectId) || 0;
  }

  public waitingCount(projectId?: string): number {
    if (projectId === undefined) {
      return this.waiting.length;
    }
    return this.waiting.filter((waiter: Waiter): boolean => {
      return waiter.projectId === projectId;
    }).length;
  }

  private canStart(projectId: string): boolean {
    return (
      this.running < this.limits.maxRunning &&
      this.runningCount(projectId) < this.limits.maxRunningPerProject
    );
  }

  private take(projectId: string): void {
    this.running++;
    this.runningByProject.set(projectId, this.runningCount(projectId) + 1);
  }

  private acquire(
    projectId: string,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new TopologyRequestAbandonedError());
    }

    if (this.canStart(projectId)) {
      this.take(projectId);
      return Promise.resolve();
    }

    if (
      this.waiting.length >= this.limits.maxWaiting ||
      this.waitingCount(projectId) >= this.limits.maxWaitingPerProject
    ) {
      return Promise.reject(
        new TooManyRequestsException(TOPOLOGY_BUSY_MESSAGE),
      );
    }

    return new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void): void => {
        /* Leaves the queue (if still in it) and rejects with `error`. */
        const leave: (error: Error) => void = (error: Error): void => {
          const index: number = this.waiting.indexOf(waiter);
          if (index >= 0) {
            this.waiting.splice(index, 1);
            waiter.detach();
            reject(error);
          }
        };
        const onAbort: () => void = (): void => {
          leave(new TopologyRequestAbandonedError());
        };
        const waiter: Waiter = {
          projectId,
          start: resolve,
          timer: null,
          detach: (): void => {
            if (waiter.timer) {
              clearTimeout(waiter.timer);
            }
            signal?.removeEventListener("abort", onAbort);
          },
        };
        if (Number.isFinite(this.limits.maxWaitMs)) {
          waiter.timer = setTimeout((): void => {
            leave(new TooManyRequestsException(TOPOLOGY_BUSY_MESSAGE));
          }, this.limits.maxWaitMs);
        }
        signal?.addEventListener("abort", onAbort);
        this.waiting.push(waiter);
      },
    );
  }

  private release(projectId: string): void {
    this.running--;
    const remaining: number = this.runningCount(projectId) - 1;
    if (remaining > 0) {
      this.runningByProject.set(projectId, remaining);
    } else {
      this.runningByProject.delete(projectId);
    }
    this.startWaiters();
  }

  /* Hands free slots to waiters in arrival order, skipping full projects. */
  private startWaiters(): void {
    if (this.waiting.length === 0) {
      return;
    }
    const stillWaiting: Array<Waiter> = [];
    for (const waiter of this.waiting) {
      if (this.canStart(waiter.projectId)) {
        this.take(waiter.projectId);
        waiter.detach();
        waiter.start();
      } else {
        stillWaiting.push(waiter);
      }
    }
    this.waiting = stillWaiting;
  }
}

export default new TopologyConcurrencyLimiter();
