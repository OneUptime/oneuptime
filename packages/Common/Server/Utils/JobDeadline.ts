import TimeoutException from "../../Types/Exception/TimeoutException";

/*
 * WHEN A QUEUE JOB MUST STOP.
 *
 * A job runs with a time limit (QueueWorker.runJobWithTimeout), and the
 * limit used to do no more than mark the job failed: the job's own loops
 * went on reading and writing, holding database connections, while the
 * next run of the same job started beside them. On a slow database that is
 * how copies of every-minute jobs piled up.
 *
 * So the job is handed its deadline. It passes when the time limit runs
 * out, or earlier when whoever runs the job ends it (a cron run that lost
 * its lock, CronLock). A job that loops checks hasPassed() between pages
 * and items and stops there: what it did is kept, and the next run carries
 * on from what is still due. Work already in flight - one query, one page
 * being sent - is not cut off half way.
 *
 * A deadline can belong to another (a parent): it passes when its parent
 * does, and can also be ended on its own.
 */
export default class JobDeadline {
  private readonly controller: AbortController = new AbortController();

  private reason: Error | null = null;

  private readonly listeners: Set<(reason: Error) => void> = new Set<
    (reason: Error) => void
  >();

  private readonly detachFromParent: (() => void) | null = null;

  // When the time limit runs out; null for a deadline with no time limit.
  public readonly endsAt: Date | null;

  public constructor(data?: {
    endsAt?: Date | null | undefined;
    parent?: JobDeadline | null | undefined;
  }) {
    this.endsAt = data?.endsAt || data?.parent?.endsAt || null;

    const parent: JobDeadline | null | undefined = data?.parent;

    if (parent) {
      if (parent.hasPassed()) {
        this.end(parent.getReason()!);
      } else {
        this.detachFromParent = parent.onPassed((reason: Error) => {
          this.end(reason);
        });
      }
    }
  }

  // A deadline that never passes on its own, for work run outside a queue job.
  public static none(): JobDeadline {
    return new JobDeadline();
  }

  // Aborted once the deadline passes, for APIs that take an AbortSignal.
  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public hasPassed(): boolean {
    return this.reason !== null;
  }

  // Why it passed: the time limit ran out, or the run was ended. Null before.
  public getReason(): Error | null {
    return this.reason;
  }

  // How long is left of the time limit, in ms; null with no time limit.
  public getRemainingMs(now: Date = new Date()): number | null {
    if (!this.endsAt) {
      return null;
    }

    return Math.max(0, this.endsAt.getTime() - now.getTime());
  }

  /*
   * Ends the deadline now. The first reason stands: ending one that has
   * passed already changes nothing.
   */
  public end(reason?: Error | undefined): void {
    if (this.reason) {
      return;
    }

    this.reason =
      reason || new TimeoutException("The job ran out of time and stopped.");

    this.detachFromParent?.();

    const listeners: Array<(reason: Error) => void> = Array.from(
      this.listeners,
    );
    this.listeners.clear();

    this.controller.abort(this.reason);

    for (const listener of listeners) {
      try {
        listener(this.reason);
      } catch {
        // A listener that throws must not keep the others from hearing it.
      }
    }
  }

  /*
   * Calls `listener` once, when the deadline passes - at once if it has.
   * Returns a function that stops listening.
   */
  public onPassed(listener: (reason: Error) => void): () => void {
    if (this.reason) {
      listener(this.reason);
      return (): void => {
        // Nothing to stop: it was called already.
      };
    }

    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  // Throws why the deadline passed, once it has.
  public throwIfPassed(): void {
    if (this.reason) {
      throw this.reason;
    }
  }
}
