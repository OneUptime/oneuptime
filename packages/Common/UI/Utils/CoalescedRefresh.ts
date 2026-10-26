/*
 * A REFRESH THAT MANY EVENTS ASK FOR, RUN ONCE FOR ALL OF THEM.
 *
 * The header's counts (open incidents, alerts and episodes) are read again
 * whenever the realtime connection says a record of their kind changed. A
 * bulk action that resolves 4,594 alerts sends 4,594 such events - and every
 * one used to read the count again, thousands of count requests competing
 * with the very writes they were counting.
 *
 * request() runs the refresh at once when it has not run for minIntervalInMs
 * and is not running, so a single change still shows straight away. A
 * request while it runs, or within the interval, waits: however many arrive,
 * exactly one more refresh runs once the interval has passed and the one
 * running has finished - so the last change is always counted.
 */

export interface CoalescedRefreshTimers {
  now: () => number;
  setTimeout: (callback: () => void, delayInMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const SYSTEM_TIMERS: CoalescedRefreshTimers = {
  now: (): number => {
    return Date.now();
  },
  setTimeout: (callback: () => void, delayInMs: number): unknown => {
    return setTimeout(callback, delayInMs);
  },
  clearTimeout: (handle: unknown): void => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface CoalescedRefreshOptions {
  refresh: () => Promise<void>;
  minIntervalInMs: number;
  timers?: CoalescedRefreshTimers | undefined;
}

export default class CoalescedRefresh {
  private readonly refresh: () => Promise<void>;
  private readonly minIntervalInMs: number;
  private readonly timers: CoalescedRefreshTimers;

  private isRunning: boolean = false;
  // Asked for while a refresh ran: one more runs after it.
  private isAskedAgain: boolean = false;
  private timer: unknown = null;
  private lastStartedAt: number | null = null;
  private isStopped: boolean = false;

  public constructor(options: CoalescedRefreshOptions) {
    this.refresh = options.refresh;
    this.minIntervalInMs = Math.max(0, options.minIntervalInMs);
    this.timers = options.timers || SYSTEM_TIMERS;
  }

  public request(): void {
    if (this.isStopped) {
      return;
    }

    if (this.isRunning) {
      this.isAskedAgain = true;
      return;
    }

    // One is waiting already: it will count this change too.
    if (this.timer !== null) {
      return;
    }

    const waitInMs: number =
      this.lastStartedAt === null
        ? 0
        : Math.max(
            0,
            this.lastStartedAt + this.minIntervalInMs - this.timers.now(),
          );

    if (waitInMs === 0) {
      void this.run();
      return;
    }

    this.timer = this.timers.setTimeout((): void => {
      this.timer = null;
      void this.run();
    }, waitInMs);
  }

  // Nothing runs after this: the page that asked has gone.
  public stop(): void {
    this.isStopped = true;
    this.isAskedAgain = false;

    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async run(): Promise<void> {
    if (this.isStopped) {
      return;
    }

    this.isRunning = true;
    this.isAskedAgain = false;
    this.lastStartedAt = this.timers.now();

    try {
      await this.refresh();
    } catch {
      // A refresh that failed is tried again by the next change.
    } finally {
      this.isRunning = false;
    }

    if (this.isAskedAgain) {
      this.isAskedAgain = false;
      this.request();
    }
  }
}
