import MonitorCheckBudget, {
  MAX_MONITOR_DIAGNOSTICS_BUDGET_IN_MS,
  MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS,
  MIN_MONITOR_CHECK_BUDGET_IN_MS,
  MONITOR_CHECK_BUDGET_INTERVAL_FRACTION,
  MONITOR_CHECK_RETRY_DELAY_IN_MS,
  MONITOR_DIAGNOSTICS_BUDGET_FRACTION,
} from "../../../Types/Monitor/MonitorCheckBudget";
import { DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS } from "../../../Types/Monitor/MonitorStep";
import { describe, expect, it } from "@jest/globals";

/*
 * These tests pin down the arithmetic that keeps a monitor check inside its
 * own monitoring interval. The bug they guard against: a Ping monitor on a
 * 1-minute interval whose target stopped responding spent 60s per attempt ×
 * 3 attempts, so every result arrived ~3 minutes late and the monitor looked
 * like it had skipped intervals before catching up.
 */

const FIXED_FROM: Date = new Date(Date.UTC(2026, 6, 24, 13, 8, 30));

const EVERY_MINUTE: string = "* * * * *";
const EVERY_FIVE_MINUTES: string = "*/5 * * * *";
const EVERY_HOUR: string = "0 * * * *";

describe("MonitorCheckBudget.getMonitoringIntervalInMs", () => {
  it("derives 1 minute from an every-minute cron", () => {
    expect(
      MonitorCheckBudget.getMonitoringIntervalInMs(EVERY_MINUTE, FIXED_FROM),
    ).toBe(60 * 1000);
  });

  it("derives 5 minutes from an every-5-minutes cron", () => {
    expect(
      MonitorCheckBudget.getMonitoringIntervalInMs(
        EVERY_FIVE_MINUTES,
        FIXED_FROM,
      ),
    ).toBe(5 * 60 * 1000);
  });

  it("derives 1 hour from an hourly cron", () => {
    expect(
      MonitorCheckBudget.getMonitoringIntervalInMs(EVERY_HOUR, FIXED_FROM),
    ).toBe(60 * 60 * 1000);
  });

  it("derives the interval regardless of where in the minute sampling starts", () => {
    const midMinute: Date = new Date(Date.UTC(2026, 6, 24, 13, 8, 59, 750));

    expect(
      MonitorCheckBudget.getMonitoringIntervalInMs(EVERY_MINUTE, midMinute),
    ).toBe(60 * 1000);
  });

  it("takes the SMALLEST gap when the cron fires at uneven spacing", () => {
    /*
     * "0 0,1 * * *" alternates between a 1-hour and a 23-hour gap. Budgeting
     * for the tighter of the two is the safe direction to be wrong in.
     */
    expect(
      MonitorCheckBudget.getMonitoringIntervalInMs("0 0,1 * * *", FIXED_FROM),
    ).toBe(60 * 60 * 1000);
  });

  it("returns null for an unparseable cron expression", () => {
    expect(
      MonitorCheckBudget.getMonitoringIntervalInMs("not-a-cron", FIXED_FROM),
    ).toBeNull();
    expect(
      MonitorCheckBudget.getMonitoringIntervalInMs("* * *", FIXED_FROM),
    ).toBeNull();
    expect(
      MonitorCheckBudget.getMonitoringIntervalInMs("99 * * * *", FIXED_FROM),
    ).toBeNull();
  });

  it("returns null for missing, empty or whitespace-only input", () => {
    expect(MonitorCheckBudget.getMonitoringIntervalInMs(undefined)).toBeNull();
    expect(MonitorCheckBudget.getMonitoringIntervalInMs(null)).toBeNull();
    expect(MonitorCheckBudget.getMonitoringIntervalInMs("")).toBeNull();
    expect(MonitorCheckBudget.getMonitoringIntervalInMs("   ")).toBeNull();
  });

  it("returns null for a non-string value", () => {
    expect(
      MonitorCheckBudget.getMonitoringIntervalInMs(42 as unknown as string),
    ).toBeNull();
  });
});

describe("MonitorCheckBudget.getCheckBudgetInMs", () => {
  it("caps the default 60s timeout to 80% of a 1-minute interval", () => {
    expect(
      MonitorCheckBudget.getCheckBudgetInMs({
        requestTimeoutInMs: DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS,
        monitoringInterval: EVERY_MINUTE,
        from: FIXED_FROM,
      }),
    ).toBe(60 * 1000 * MONITOR_CHECK_BUDGET_INTERVAL_FRACTION);
  });

  it("leaves the timeout alone when the interval is roomy", () => {
    // 80% of 5 minutes is 4 minutes, so the 60s timeout is the binding limit.
    expect(
      MonitorCheckBudget.getCheckBudgetInMs({
        requestTimeoutInMs: DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS,
        monitoringInterval: EVERY_FIVE_MINUTES,
        from: FIXED_FROM,
      }),
    ).toBe(DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS);
  });

  it("never stretches a check beyond the configured timeout", () => {
    // A user asking for 2s does not get 48s just because the interval allows it.
    expect(
      MonitorCheckBudget.getCheckBudgetInMs({
        requestTimeoutInMs: 2000,
        monitoringInterval: EVERY_MINUTE,
        from: FIXED_FROM,
      }),
    ).toBe(2000);
  });

  it("falls back to the configured timeout when the interval is unknown", () => {
    expect(
      MonitorCheckBudget.getCheckBudgetInMs({
        requestTimeoutInMs: 30000,
        monitoringInterval: undefined,
        from: FIXED_FROM,
      }),
    ).toBe(30000);

    expect(
      MonitorCheckBudget.getCheckBudgetInMs({
        requestTimeoutInMs: 30000,
        monitoringInterval: "garbage",
        from: FIXED_FROM,
      }),
    ).toBe(30000);
  });

  it("keeps the interval-derived budget at or above the floor", () => {
    /*
     * A hypothetical very tight interval must not squeeze checks down to
     * nothing — the floor wins over the 80% fraction.
     */
    const budget: number = MonitorCheckBudget.getCheckBudgetInMs({
      requestTimeoutInMs: DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS,
      monitoringInterval: "*/2 * * * * *", // every 2 seconds
      from: FIXED_FROM,
    });

    expect(budget).toBe(MIN_MONITOR_CHECK_BUDGET_IN_MS);
  });

  it("handles a zero, negative or non-finite timeout without going negative", () => {
    for (const requestTimeoutInMs of [0, -5000, NaN, Infinity]) {
      expect(
        MonitorCheckBudget.getCheckBudgetInMs({
          requestTimeoutInMs,
          monitoringInterval: EVERY_MINUTE,
          from: FIXED_FROM,
        }),
      ).toBe(MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS);
    }
  });
});

describe("MonitorCheckBudget diagnostics / reachability split", () => {
  it("reserves a quarter of the budget for post-failure diagnostics", () => {
    expect(MonitorCheckBudget.getDiagnosticsBudgetInMs(48000)).toBe(
      48000 * MONITOR_DIAGNOSTICS_BUDGET_FRACTION,
    );
    expect(MonitorCheckBudget.getReachabilityBudgetInMs(48000)).toBe(36000);
  });

  it("caps the diagnostics reserve so a long check does not over-reserve", () => {
    expect(MonitorCheckBudget.getDiagnosticsBudgetInMs(600000)).toBe(
      MAX_MONITOR_DIAGNOSTICS_BUDGET_IN_MS,
    );
  });

  it("always leaves the two slices adding up to the whole budget", () => {
    for (const budget of [5000, 12000, 48000, 60000, 240000]) {
      expect(
        MonitorCheckBudget.getDiagnosticsBudgetInMs(budget) +
          MonitorCheckBudget.getReachabilityBudgetInMs(budget),
      ).toBe(budget);
    }
  });

  it("degrades safely for a zero or negative budget", () => {
    expect(MonitorCheckBudget.getDiagnosticsBudgetInMs(0)).toBe(0);
    expect(MonitorCheckBudget.getDiagnosticsBudgetInMs(-1)).toBe(0);
    expect(MonitorCheckBudget.getReachabilityBudgetInMs(0)).toBe(
      MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS,
    );
  });
});

describe("MonitorCheckBudget.getAttemptTimeoutInMs", () => {
  it("splits the budget across attempts and their backoffs", () => {
    // 36000 - 2 backoffs of 1000 = 34000, over 3 attempts.
    expect(
      MonitorCheckBudget.getAttemptTimeoutInMs({
        budgetInMs: 36000,
        retryCount: 3,
      }),
    ).toBe(Math.floor(34000 / 3));
  });

  it("gives a single attempt the whole budget", () => {
    expect(
      MonitorCheckBudget.getAttemptTimeoutInMs({
        budgetInMs: 36000,
        retryCount: 1,
      }),
    ).toBe(36000);
  });

  it("keeps attempts × timeout + backoffs inside the budget", () => {
    for (const budgetInMs of [2000, 5000, 12000, 36000, 45000, 60000]) {
      for (const retryCount of [1, 2, 3, 5, 10]) {
        const attempts: number = MonitorCheckBudget.getAffordableAttemptCount({
          budgetInMs,
          retryCount,
        });

        const attemptTimeoutInMs: number =
          MonitorCheckBudget.getAttemptTimeoutInMs({
            budgetInMs,
            retryCount,
          });

        const worstCaseInMs: number =
          attemptTimeoutInMs * attempts +
          (attempts - 1) * MONITOR_CHECK_RETRY_DELAY_IN_MS;

        expect(worstCaseInMs).toBeLessThanOrEqual(budgetInMs);
      }
    }
  });

  it("never returns less than the minimum attempt timeout", () => {
    expect(
      MonitorCheckBudget.getAttemptTimeoutInMs({
        budgetInMs: 100,
        retryCount: 10,
      }),
    ).toBe(MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS);
  });

  it("honours a caller-supplied minimum", () => {
    expect(
      MonitorCheckBudget.getAttemptTimeoutInMs({
        budgetInMs: 100,
        retryCount: 10,
        minAttemptTimeoutInMs: 7500,
      }),
    ).toBe(7500);
  });

  it("honours a caller-supplied retry delay", () => {
    // 36000 - 2 backoffs of 5000 = 26000, over 3 attempts.
    expect(
      MonitorCheckBudget.getAttemptTimeoutInMs({
        budgetInMs: 36000,
        retryCount: 3,
        retryDelayInMs: 5000,
      }),
    ).toBe(Math.floor(26000 / 3));
  });

  it("treats a zero retry count as one attempt", () => {
    expect(
      MonitorCheckBudget.getAttemptTimeoutInMs({
        budgetInMs: 20000,
        retryCount: 0,
      }),
    ).toBe(20000);
  });
});

describe("MonitorCheckBudget.getAffordableAttemptCount", () => {
  it("affords every configured attempt when the budget is roomy", () => {
    expect(
      MonitorCheckBudget.getAffordableAttemptCount({
        budgetInMs: 36000,
        retryCount: 3,
      }),
    ).toBe(3);
  });

  it("drops the attempts a tight budget cannot pay for", () => {
    /*
     * 5s at a 1s minimum with 1s backoffs pays for 3 attempts
     * (3 × 1000 + 2 × 1000), not the 5 configured.
     */
    expect(
      MonitorCheckBudget.getAffordableAttemptCount({
        budgetInMs: 5000,
        retryCount: 5,
      }),
    ).toBe(3);
  });

  it("always keeps at least one attempt", () => {
    expect(
      MonitorCheckBudget.getAffordableAttemptCount({
        budgetInMs: 0,
        retryCount: 3,
      }),
    ).toBe(1);

    expect(
      MonitorCheckBudget.getAffordableAttemptCount({
        budgetInMs: -5000,
        retryCount: 3,
      }),
    ).toBe(1);
  });

  it("never invents attempts beyond the configured retry count", () => {
    expect(
      MonitorCheckBudget.getAffordableAttemptCount({
        budgetInMs: 600000,
        retryCount: 2,
      }),
    ).toBe(2);
  });

  it("accounts for a caller-supplied minimum and backoff", () => {
    // 30s at a 9s minimum with 1s backoffs pays for 3 attempts.
    expect(
      MonitorCheckBudget.getAffordableAttemptCount({
        budgetInMs: 30000,
        retryCount: 5,
        minAttemptTimeoutInMs: 9000,
        retryDelayInMs: 1000,
      }),
    ).toBe(3);
  });
});

describe("MonitorCheckBudget deadlines", () => {
  it("puts the deadline one budget after the start", () => {
    expect(MonitorCheckBudget.getDeadlineAt(FIXED_FROM, 36000).getTime()).toBe(
      FIXED_FROM.getTime() + 36000,
    );
  });

  it("never moves the deadline backwards for a negative budget", () => {
    expect(MonitorCheckBudget.getDeadlineAt(FIXED_FROM, -1000).getTime()).toBe(
      FIXED_FROM.getTime(),
    );
  });

  it("reports the time left before the deadline", () => {
    const deadlineAt: Date = new Date(FIXED_FROM.getTime() + 30000);

    expect(
      MonitorCheckBudget.getRemainingBudgetInMs(deadlineAt, FIXED_FROM),
    ).toBe(30000);

    expect(
      MonitorCheckBudget.getRemainingBudgetInMs(
        deadlineAt,
        new Date(FIXED_FROM.getTime() + 25000),
      ),
    ).toBe(5000);
  });

  it("clamps a passed deadline to zero rather than going negative", () => {
    expect(
      MonitorCheckBudget.getRemainingBudgetInMs(
        FIXED_FROM,
        new Date(FIXED_FROM.getTime() + 90000),
      ),
    ).toBe(0);
  });
});

describe("MonitorCheckBudget end-to-end: the reported regression", () => {
  interface Scenario {
    label: string;
    monitoringInterval: string;
    retryCount: number;
  }

  const SCENARIOS: Array<Scenario> = [
    {
      label: "1-minute interval",
      monitoringInterval: EVERY_MINUTE,
      retryCount: 3,
    },
    {
      label: "5-minute interval",
      monitoringInterval: EVERY_FIVE_MINUTES,
      retryCount: 3,
    },
  ];

  it.each(SCENARIOS)(
    "keeps a fully-failing check inside the $label",
    ({ monitoringInterval, retryCount }: Scenario) => {
      const intervalInMs: number = MonitorCheckBudget.getMonitoringIntervalInMs(
        monitoringInterval,
        FIXED_FROM,
      )!;

      const checkBudgetInMs: number = MonitorCheckBudget.getCheckBudgetInMs({
        requestTimeoutInMs: DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS,
        monitoringInterval,
        from: FIXED_FROM,
      });

      const reachabilityBudgetInMs: number =
        MonitorCheckBudget.getReachabilityBudgetInMs(checkBudgetInMs);

      const attemptTimeoutInMs: number =
        MonitorCheckBudget.getAttemptTimeoutInMs({
          budgetInMs: reachabilityBudgetInMs,
          retryCount,
        });

      // Every attempt times out, every backoff is paid, then diagnostics run.
      const worstCaseCheckInMs: number =
        attemptTimeoutInMs * retryCount +
        (retryCount - 1) * MONITOR_CHECK_RETRY_DELAY_IN_MS +
        MonitorCheckBudget.getDiagnosticsBudgetInMs(checkBudgetInMs);

      expect(worstCaseCheckInMs).toBeLessThanOrEqual(checkBudgetInMs);
      expect(worstCaseCheckInMs).toBeLessThan(intervalInMs);
    },
  );

  it("is a real improvement on the old unbudgeted behaviour", () => {
    const retryCount: number = 3;

    /*
     * Before the fix: the full request timeout was spent per attempt, so a
     * dead host cost timeout × retries — over three minutes on the defaults.
     */
    const oldWorstCaseInMs: number =
      DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS * retryCount +
      (retryCount - 1) * MONITOR_CHECK_RETRY_DELAY_IN_MS;

    expect(oldWorstCaseInMs).toBeGreaterThan(3 * 60 * 1000);

    const checkBudgetInMs: number = MonitorCheckBudget.getCheckBudgetInMs({
      requestTimeoutInMs: DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS,
      monitoringInterval: EVERY_MINUTE,
      from: FIXED_FROM,
    });

    expect(checkBudgetInMs).toBeLessThan(60 * 1000);
  });
});
