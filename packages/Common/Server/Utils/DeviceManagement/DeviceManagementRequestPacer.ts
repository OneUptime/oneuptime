import { DeviceManagementBudgetSpent } from "./DeviceManagementTypes";

/*
 * THE PACE AND THE BUDGET OF ONE READ'S REQUESTS.
 *
 * Every device management API client (Esper's, Microsoft Intune's) sends
 * its requests one at a time, at most `requestsPerSecond`, and halves that
 * pace for the rest of the read when the service answers 429. Each request
 * counts against the read's budget - a number of requests and a deadline -
 * and one past it throws DeviceManagementBudgetSpent, which ends the read
 * where it is. A retry that the service names no wait for backs off
 * exponentially, with jitter, so the readers of many connections refused
 * together do not all come back in the same second.
 */
export interface DeviceManagementRequestPacerOptions {
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  random: () => number;
  requestsPerSecond: number;
  // After a 429 the pace halves, down to this.
  minRequestsPerSecond: number;
  // The longest a back-off waits when the service names no wait.
  maxBackoffSeconds: number;
  // The read's budget: requests, and until when (epoch ms).
  maxRequests?: number | undefined;
  deadlineMs?: number | undefined;
}

export default class DeviceManagementRequestPacer {
  private readonly options: DeviceManagementRequestPacerOptions;
  private readonly maxRequests: number;
  private readonly deadlineMs: number;
  private requestsPerSecond: number;
  private lastRequestStartedAt: number | null = null;
  private used: number = 0;

  public constructor(options: DeviceManagementRequestPacerOptions) {
    this.options = options;
    this.requestsPerSecond = Math.max(
      options.minRequestsPerSecond,
      options.requestsPerSecond,
    );
    this.maxRequests =
      options.maxRequests !== undefined && options.maxRequests >= 0
        ? options.maxRequests
        : Number.POSITIVE_INFINITY;
    this.deadlineMs =
      options.deadlineMs !== undefined
        ? options.deadlineMs
        : Number.POSITIVE_INFINITY;
  }

  // Requests made so far: what the read cost the tenant's budget.
  public getRequestCount(): number {
    return this.used;
  }

  public getRequestsPerSecond(): number {
    return this.requestsPerSecond;
  }

  // Whether the read's budget has room for this many more requests.
  public hasBudgetFor(requests: number): boolean {
    return (
      this.used + requests <= this.maxRequests &&
      this.options.now().getTime() < this.deadlineMs
    );
  }

  // The service asked to slow down: half the pace, for the rest of the read.
  public slowDown(): void {
    this.requestsPerSecond = Math.max(
      this.options.minRequestsPerSecond,
      this.requestsPerSecond / 2,
    );
  }

  /*
   * How long the n-th retry waits when the service names no wait: 2^n
   * seconds, capped, with up to half of it added or taken at random.
   */
  public backoffMs(attempt: number): number {
    const base: number = Math.min(
      this.options.maxBackoffSeconds,
      Math.pow(2, Math.max(0, attempt)),
    );
    const jitter: number =
      0.5 + Math.min(1, Math.max(0, this.options.random()));

    return Math.round(base * jitter * 1000);
  }

  /*
   * Waits for a request's turn: the budget first (spent: stop), then the
   * pace - requests start 1/requestsPerSecond apart.
   */
  public async takeTurn(): Promise<void> {
    const nowMs: number = this.options.now().getTime();

    if (this.used >= this.maxRequests || nowMs >= this.deadlineMs) {
      throw new DeviceManagementBudgetSpent();
    }

    if (this.lastRequestStartedAt !== null) {
      const spacingMs: number = 1000 / this.requestsPerSecond;
      const waitMs: number = this.lastRequestStartedAt + spacingMs - nowMs;

      if (waitMs > 0) {
        await this.options.sleep(waitMs);
      }
    }

    this.lastRequestStartedAt = Math.max(
      this.options.now().getTime(),
      (this.lastRequestStartedAt || 0) + 1000 / this.requestsPerSecond,
    );
    this.used++;
  }
}
