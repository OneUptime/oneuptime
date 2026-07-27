import CronTab from "../../Utils/CronTab";

/**
 * MonitorCheckBudget
 *
 * A single monitor check has to finish inside its own monitoring interval.
 * If it does not, checks overlap: the scheduler hands the monitor out again
 * (nextPingAt is claimed up-front) while the previous check is still running,
 * every result lands late, and the monitor looks like it silently skipped
 * several intervals before "catching up".
 *
 * That is exactly what an unreachable Ping target used to cause. The monitor's
 * request timeout (60s by default) was handed to `ping` as the per-reply wait
 * and then multiplied by the retry count, so one check against a black-holed
 * IP cost ~3 minutes — three times the interval of a 1-minute monitor.
 *
 * These helpers turn "request timeout" + "monitoring interval" into a concrete
 * wall-clock budget for one check, and then split that budget across the
 * retry attempts. Everything here is pure and isomorphic so both the probe and
 * the tests can reason about the arithmetic without a clock.
 */

/*
 * A check may consume at most this fraction of its monitoring interval. The
 * remainder is headroom for fetching the monitor list, reporting the result
 * back to the ingest API, and ordinary scheduler jitter.
 */
export const MONITOR_CHECK_BUDGET_INTERVAL_FRACTION: number = 0.8;

/*
 * Floor for the interval-derived budget. Guards against a pathological cron
 * (or a future sub-minute interval) squeezing checks down to nothing.
 */
export const MIN_MONITOR_CHECK_BUDGET_IN_MS: number = 5000;

/*
 * Share of a check's budget reserved for post-failure diagnostics (the
 * traceroute + DNS lookup captured when a network check fails). Diagnostics
 * run after the verdict is known, so they must not be able to push the check
 * past its interval.
 */
export const MONITOR_DIAGNOSTICS_BUDGET_FRACTION: number = 0.25;

export const MAX_MONITOR_DIAGNOSTICS_BUDGET_IN_MS: number = 20000;

// Backoff between two attempts of the same check.
export const MONITOR_CHECK_RETRY_DELAY_IN_MS: number = 1000;

// No attempt is ever given less than this, however tight the budget is.
export const MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS: number = 1000;

/*
 * How many upcoming fire times are sampled to derive the interval. Cron
 * expressions are not required to be evenly spaced ("0 0,1 * * *" alternates
 * between 1 hour and 23 hours), so the smallest gap in the sample is used —
 * budgeting for the tightest interval is the safe direction to be wrong in.
 */
const INTERVAL_SAMPLE_COUNT: number = 5;

export interface MonitorCheckBudgetOptions {
  // The user-configured per-check timeout, in milliseconds.
  requestTimeoutInMs: number;
  // The monitor's monitoring interval, as a cron expression.
  monitoringInterval?: string | null | undefined;
  // Overridable for deterministic tests.
  from?: Date | undefined;
}

export interface MonitorCheckAttemptTimeoutOptions {
  // Wall-clock budget the attempts have to share.
  budgetInMs: number;
  // Total number of attempts the check is allowed to make (not extra tries).
  retryCount: number;
  retryDelayInMs?: number | undefined;
  minAttemptTimeoutInMs?: number | undefined;
}

export default class MonitorCheckBudget {
  /**
   * The monitor's interval in milliseconds, or null when the expression is
   * missing / unparseable (in which case the caller keeps the configured
   * timeout as-is rather than guessing).
   */
  public static getMonitoringIntervalInMs(
    monitoringInterval?: string | null | undefined,
    from: Date = new Date(),
  ): number | null {
    if (
      !monitoringInterval ||
      typeof monitoringInterval !== "string" ||
      monitoringInterval.trim() === ""
    ) {
      return null;
    }

    let fireTimes: Array<Date> = [];

    try {
      fireTimes = CronTab.getNextExecutionTimes(
        monitoringInterval,
        INTERVAL_SAMPLE_COUNT,
        from,
      );
    } catch {
      return null;
    }

    if (fireTimes.length < 2) {
      return null;
    }

    let smallestGapInMs: number = Number.POSITIVE_INFINITY;

    for (let i: number = 1; i < fireTimes.length; i++) {
      const gapInMs: number =
        fireTimes[i]!.getTime() - fireTimes[i - 1]!.getTime();

      if (gapInMs > 0 && gapInMs < smallestGapInMs) {
        smallestGapInMs = gapInMs;
      }
    }

    if (!isFinite(smallestGapInMs)) {
      return null;
    }

    return smallestGapInMs;
  }

  /**
   * Wall-clock budget for one whole check — every attempt, every backoff and
   * any post-failure diagnostics included. It is the configured request
   * timeout, capped so the check still fits inside its own interval.
   */
  public static getCheckBudgetInMs(data: MonitorCheckBudgetOptions): number {
    const requestTimeoutInMs: number = Math.floor(data.requestTimeoutInMs);

    if (!isFinite(requestTimeoutInMs) || requestTimeoutInMs <= 0) {
      return MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS;
    }

    const intervalInMs: number | null = this.getMonitoringIntervalInMs(
      data.monitoringInterval,
      data.from,
    );

    if (intervalInMs === null) {
      return requestTimeoutInMs;
    }

    const intervalBudgetInMs: number = Math.max(
      MIN_MONITOR_CHECK_BUDGET_IN_MS,
      Math.floor(intervalInMs * MONITOR_CHECK_BUDGET_INTERVAL_FRACTION),
    );

    /*
     * Never stretch beyond what the user asked for — the interval only ever
     * tightens the budget.
     */
    return Math.min(requestTimeoutInMs, intervalBudgetInMs);
  }

  /**
   * Slice of the check budget held back for post-failure diagnostics.
   */
  public static getDiagnosticsBudgetInMs(checkBudgetInMs: number): number {
    if (!isFinite(checkBudgetInMs) || checkBudgetInMs <= 0) {
      return 0;
    }

    return Math.min(
      MAX_MONITOR_DIAGNOSTICS_BUDGET_IN_MS,
      Math.floor(checkBudgetInMs * MONITOR_DIAGNOSTICS_BUDGET_FRACTION),
    );
  }

  /**
   * Slice of the check budget the reachability attempts get to share.
   */
  public static getReachabilityBudgetInMs(checkBudgetInMs: number): number {
    if (!isFinite(checkBudgetInMs) || checkBudgetInMs <= 0) {
      return MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS;
    }

    return Math.max(
      MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS,
      checkBudgetInMs - this.getDiagnosticsBudgetInMs(checkBudgetInMs),
    );
  }

  /**
   * How many of the configured attempts the budget can actually pay for, once
   * each attempt is given at least the minimum timeout and each gap between
   * them the backoff. Always at least one: a check that cannot afford a single
   * attempt still has to try once and report something.
   */
  public static getAffordableAttemptCount(
    data: MonitorCheckAttemptTimeoutOptions,
  ): number {
    const configuredAttempts: number = Math.max(
      1,
      Math.floor(data.retryCount || 1),
    );

    const minAttemptTimeoutInMs: number =
      data.minAttemptTimeoutInMs ?? MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS;

    const retryDelayInMs: number =
      data.retryDelayInMs ?? MONITOR_CHECK_RETRY_DELAY_IN_MS;

    /*
     * n attempts cost n × minTimeout + (n - 1) × delay, so the largest n the
     * budget covers is (budget + delay) / (minTimeout + delay).
     */
    const affordableAttempts: number = Math.floor(
      (data.budgetInMs + retryDelayInMs) /
        (minAttemptTimeoutInMs + retryDelayInMs),
    );

    return Math.max(1, Math.min(configuredAttempts, affordableAttempts));
  }

  /**
   * Timeout for a single attempt, so that every attempt the budget can afford
   * plus the backoffs between them fit inside `budgetInMs`.
   */
  public static getAttemptTimeoutInMs(
    data: MonitorCheckAttemptTimeoutOptions,
  ): number {
    const minAttemptTimeoutInMs: number =
      data.minAttemptTimeoutInMs ?? MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS;

    const attempts: number = this.getAffordableAttemptCount(data);

    const retryDelayInMs: number =
      data.retryDelayInMs ?? MONITOR_CHECK_RETRY_DELAY_IN_MS;

    const budgetForAttemptsInMs: number =
      data.budgetInMs - (attempts - 1) * retryDelayInMs;

    return Math.max(
      minAttemptTimeoutInMs,
      Math.floor(budgetForAttemptsInMs / attempts),
    );
  }

  /**
   * Absolute moment a check must be finished by.
   */
  public static getDeadlineAt(startedAt: Date, budgetInMs: number): Date {
    return new Date(startedAt.getTime() + Math.max(0, budgetInMs));
  }

  /**
   * Milliseconds left before `deadlineAt`. Never negative, so callers can
   * safely treat it as "how much time may I still spend".
   */
  public static getRemainingBudgetInMs(
    deadlineAt: Date,
    now: Date = new Date(),
  ): number {
    return Math.max(0, deadlineAt.getTime() - now.getTime());
  }
}
