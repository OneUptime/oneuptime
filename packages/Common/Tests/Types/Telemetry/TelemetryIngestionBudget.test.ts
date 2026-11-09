import ProductType from "../../../Types/MeteredPlan/ProductType";
import {
  computeTelemetryIngestionBudgetPercentUsed,
  formatTelemetryIngestionBudgetGB,
  formatTelemetryIngestionBudgetMBPerSecond,
  getEmptyTelemetryIngestionBudgetStoredSettings,
  getTelemetryIngestionBudgetDay,
  getTelemetryIngestionBudgetResetTime,
  getTelemetryIngestionBudgetResetTimeProblem,
  getTelemetryIngestionBudgetSignalFromSlug,
  getTelemetryIngestionBudgetSignalSlug,
  getTelemetryIngestionBudgetSignalWords,
  getTelemetryIngestionBudgetState,
  getTelemetryIngestionBudgetTimezone,
  getTelemetryIngestionBudgetTimezoneProblem,
  getTelemetryIngestionBudgetValueProblem,
  getTelemetryIngestionBudgetWarningBytes,
  getTelemetryIngestionBudgetWarningPercent,
  getTelemetryIngestionBudgetWarningPercentProblem,
  hasAnyTelemetryIngestionBudgetSetting,
  isTelemetryIngestionBudgetLimited,
  isTelemetryIngestionBudgetSignal,
  normalizeTelemetryIngestionBudgetValue,
  readTelemetryIngestionBudgetStoredSettings,
  readTelemetryIngestionBudgetStoredValue,
  resolveTelemetryIngestionBudget,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB,
  TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
  TELEMETRY_INGESTION_BUDGET_COLUMNS,
  TELEMETRY_INGESTION_BUDGET_DAILY_COLUMN_NAMES,
  TELEMETRY_INGESTION_BUDGET_DEFAULT_RESET_TIME,
  TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE,
  TELEMETRY_INGESTION_BUDGET_DEFAULT_WARNING_PERCENT,
  TELEMETRY_INGESTION_BUDGET_MAX_DAILY_GB,
  TELEMETRY_INGESTION_BUDGET_MAX_RATE_MB_PER_SECOND,
  TELEMETRY_INGESTION_BUDGET_RATE_COLUMN_NAMES,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  telemetryIngestionBudgetGBToBytes,
  telemetryIngestionBudgetMBToBytes,
  TelemetryIngestionBudgetDay,
  TelemetryIngestionBudgetLimitSource,
  TelemetryIngestionBudgetResolved,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStoredSettings,
  TelemetryIngestionBudgetValueKind,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import { describe, expect, test } from "@jest/globals";

/*
 * The shared vocabulary of telemetry ingestion budgets (issue #5917): which
 * signals have budgets, how the three levels resolve into the limit in force,
 * what may be saved, when a budget day starts and ends in any time zone, and
 * exactly when a budget counts as warned and as used up. The ingest gate, the
 * worker, the status API and both dashboards read these, so each is pinned
 * here once.
 */

const GB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB;
const MB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB;

const settings: (
  values: Partial<
    Record<
      TelemetryIngestionBudgetSignal,
      { daily?: number | null; rate?: number | null }
    >
  >,
) => TelemetryIngestionBudgetStoredSettings = (
  values: Partial<
    Record<
      TelemetryIngestionBudgetSignal,
      { daily?: number | null; rate?: number | null }
    >
  >,
): TelemetryIngestionBudgetStoredSettings => {
  const stored: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();

  for (const signal of Object.keys(values) as Array<TelemetryIngestionBudgetSignal>) {
    stored[signal] = {
      dailyBudgetInGB: values[signal]?.daily ?? null,
      rateLimitInMBPerSecond: values[signal]?.rate ?? null,
    };
  }

  return stored;
};

const day: (now: string, resetTime?: string, timezone?: string) => TelemetryIngestionBudgetDay = (
  now: string,
  resetTime?: string,
  timezone?: string,
): TelemetryIngestionBudgetDay => {
  return getTelemetryIngestionBudgetDay({
    now: new Date(now),
    resetTime: resetTime,
    timezone: timezone,
  });
};

const hours: (budgetDay: TelemetryIngestionBudgetDay) => number = (
  budgetDay: TelemetryIngestionBudgetDay,
): number => {
  return (
    (budgetDay.resetsAt.getTime() - budgetDay.startsAt.getTime()) / 3_600_000
  );
};

describe("TelemetryIngestionBudget signals", () => {
  test("covers the signals ingestion keys send, without session replay (it has budgets of its own)", () => {
    expect(TELEMETRY_INGESTION_BUDGET_SIGNALS).toEqual([
      ProductType.Logs,
      ProductType.Traces,
      ProductType.Metrics,
      ProductType.Profiles,
      ProductType.SecurityEvents,
    ]);
    expect(isTelemetryIngestionBudgetSignal(ProductType.SessionReplay)).toBe(
      false,
    );
    expect(isTelemetryIngestionBudgetSignal(ProductType.ActiveMonitoring)).toBe(
      false,
    );
    expect(isTelemetryIngestionBudgetSignal("Logs")).toBe(true);
  });

  test("spells each signal one way in keys and metric attributes, and reads it back", () => {
    const slugs: Array<string> = TELEMETRY_INGESTION_BUDGET_SIGNALS.map(
      (signal: TelemetryIngestionBudgetSignal): string => {
        return getTelemetryIngestionBudgetSignalSlug(signal);
      },
    );

    expect(slugs).toEqual([
      "logs",
      "traces",
      "metrics",
      "profiles",
      "security-events",
    ]);

    for (const signal of TELEMETRY_INGESTION_BUDGET_SIGNALS) {
      expect(
        getTelemetryIngestionBudgetSignalFromSlug(
          getTelemetryIngestionBudgetSignalSlug(signal),
        ),
      ).toBe(signal);
    }

    expect(getTelemetryIngestionBudgetSignalFromSlug("session-replay")).toBe(
      null,
    );
    expect(getTelemetryIngestionBudgetSignalWords(ProductType.SecurityEvents)).toBe(
      "security events",
    );
  });

  test("names the same two columns per signal on every level, ten in all", () => {
    expect(TELEMETRY_INGESTION_BUDGET_COLUMNS[ProductType.Logs]).toEqual({
      dailyBudgetInGB: "logsDailyIngestionBudgetInGB",
      rateLimitInMBPerSecond: "logsIngestionRateLimitInMBPerSecond",
    });
    expect(TELEMETRY_INGESTION_BUDGET_DAILY_COLUMN_NAMES).toHaveLength(5);
    expect(TELEMETRY_INGESTION_BUDGET_RATE_COLUMN_NAMES).toHaveLength(5);
    expect(new Set(TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES).size).toBe(10);
  });
});

describe("TelemetryIngestionBudget units", () => {
  test("GB and MB are binary, as on the Usage page", () => {
    expect(telemetryIngestionBudgetGBToBytes(1)).toBe(1073741824);
    expect(telemetryIngestionBudgetGBToBytes(0.5)).toBe(536870912);
    expect(telemetryIngestionBudgetMBToBytes(1)).toBe(1048576);
    expect(telemetryIngestionBudgetMBToBytes(2.5)).toBe(2621440);
  });

  test("rounds a fractional byte down, never up past the budget", () => {
    expect(telemetryIngestionBudgetGBToBytes(1e-9)).toBe(1);
    expect(telemetryIngestionBudgetMBToBytes(1e-7)).toBe(0);
  });
});

describe("TelemetryIngestionBudget stored values", () => {
  test("reads numbers, numeric text and the model's Decimal, and nothing else", () => {
    expect(readTelemetryIngestionBudgetStoredValue(10)).toBe(10);
    expect(readTelemetryIngestionBudgetStoredValue("2.50")).toBe(2.5);
    expect(readTelemetryIngestionBudgetStoredValue({ value: 3 })).toBe(3);
    expect(readTelemetryIngestionBudgetStoredValue(0)).toBe(0);
    expect(readTelemetryIngestionBudgetStoredValue(null)).toBe(null);
    expect(readTelemetryIngestionBudgetStoredValue(undefined)).toBe(null);
    expect(readTelemetryIngestionBudgetStoredValue("")).toBe(null);
    expect(readTelemetryIngestionBudgetStoredValue("  ")).toBe(null);
  });

  test("reads a bad value as not set, so a broken row lifts a limit rather than blocking a signal", () => {
    expect(readTelemetryIngestionBudgetStoredValue(-1)).toBe(null);
    expect(readTelemetryIngestionBudgetStoredValue("abc")).toBe(null);
    expect(readTelemetryIngestionBudgetStoredValue(Number.NaN)).toBe(null);
    expect(readTelemetryIngestionBudgetStoredValue(Infinity)).toBe(null);
    expect(readTelemetryIngestionBudgetStoredValue(true)).toBe(null);
  });

  test("reads every signal's two columns off a row", () => {
    const stored: TelemetryIngestionBudgetStoredSettings =
      readTelemetryIngestionBudgetStoredSettings({
        logsDailyIngestionBudgetInGB: "10",
        logsIngestionRateLimitInMBPerSecond: 5,
        securityEventsDailyIngestionBudgetInGB: 0,
        unrelatedColumn: 99,
      });

    expect(stored[ProductType.Logs]).toEqual({
      dailyBudgetInGB: 10,
      rateLimitInMBPerSecond: 5,
    });
    expect(stored[ProductType.SecurityEvents]).toEqual({
      dailyBudgetInGB: 0,
      rateLimitInMBPerSecond: null,
    });
    expect(stored[ProductType.Traces]).toEqual({
      dailyBudgetInGB: null,
      rateLimitInMBPerSecond: null,
    });
    expect(hasAnyTelemetryIngestionBudgetSetting(stored)).toBe(true);
    expect(
      hasAnyTelemetryIngestionBudgetSetting(
        readTelemetryIngestionBudgetStoredSettings({}),
      ),
    ).toBe(false);
    expect(hasAnyTelemetryIngestionBudgetSetting(null)).toBe(false);
    expect(readTelemetryIngestionBudgetStoredSettings(null)).toEqual(
      getEmptyTelemetryIngestionBudgetStoredSettings(),
    );
  });
});

describe("resolveTelemetryIngestionBudget", () => {
  test("is unlimited with nothing set anywhere - every install until an admin sets a budget", () => {
    const resolved: TelemetryIngestionBudgetResolved =
      resolveTelemetryIngestionBudget({
        signal: ProductType.Logs,
        instance: getEmptyTelemetryIngestionBudgetStoredSettings(),
        project: null,
        ingestionKey: null,
      });

    expect(resolved.project.dailyBudget).toEqual({ bytes: null, source: null });
    expect(resolved.project.rateLimit).toEqual({ bytes: null, source: null });
    expect(resolved.ingestionKey).toBe(null);
    expect(isTelemetryIngestionBudgetLimited(resolved)).toBe(false);
  });

  test("gives every project the instance default", () => {
    const resolved: TelemetryIngestionBudgetResolved =
      resolveTelemetryIngestionBudget({
        signal: ProductType.Logs,
        instance: settings({ [ProductType.Logs]: { daily: 50, rate: 20 } }),
        project: null,
        ingestionKey: null,
      });

    expect(resolved.project.dailyBudget).toEqual({
      bytes: 50 * GB,
      source: TelemetryIngestionBudgetLimitSource.Instance,
    });
    expect(resolved.project.rateLimit).toEqual({
      bytes: 20 * MB,
      source: TelemetryIngestionBudgetLimitSource.Instance,
    });
    expect(isTelemetryIngestionBudgetLimited(resolved)).toBe(true);
  });

  test("lets the instance admin's project override win, up or down", () => {
    const instance: TelemetryIngestionBudgetStoredSettings = settings({
      [ProductType.Traces]: { daily: 50 },
    });

    expect(
      resolveTelemetryIngestionBudget({
        signal: ProductType.Traces,
        instance: instance,
        project: settings({ [ProductType.Traces]: { daily: 200 } }),
        ingestionKey: null,
      }).project.dailyBudget,
    ).toEqual({
      bytes: 200 * GB,
      source: TelemetryIngestionBudgetLimitSource.Project,
    });

    expect(
      resolveTelemetryIngestionBudget({
        signal: ProductType.Traces,
        instance: instance,
        project: settings({ [ProductType.Traces]: { daily: 5 } }),
        ingestionKey: null,
      }).project.dailyBudget.bytes,
    ).toBe(5 * GB);
  });

  test("reads a project override of 0 as no limit for that project, lifting the default", () => {
    const resolved: TelemetryIngestionBudgetResolved =
      resolveTelemetryIngestionBudget({
        signal: ProductType.Metrics,
        instance: settings({ [ProductType.Metrics]: { daily: 50, rate: 10 } }),
        project: settings({ [ProductType.Metrics]: { daily: 0, rate: 0 } }),
        ingestionKey: null,
      });

    expect(resolved.project.dailyBudget).toEqual({
      bytes: null,
      source: TelemetryIngestionBudgetLimitSource.Project,
    });
    expect(resolved.project.rateLimit.bytes).toBe(null);
    expect(isTelemetryIngestionBudgetLimited(resolved)).toBe(false);
  });

  test("keeps signals apart: a logs budget limits nothing else", () => {
    const resolved: TelemetryIngestionBudgetResolved =
      resolveTelemetryIngestionBudget({
        signal: ProductType.Profiles,
        instance: settings({ [ProductType.Logs]: { daily: 1 } }),
        project: settings({ [ProductType.Traces]: { daily: 1 } }),
        ingestionKey: settings({ [ProductType.Metrics]: { daily: 1 } }),
      });

    expect(isTelemetryIngestionBudgetLimited(resolved)).toBe(false);
  });

  test("gives a key its own budget below the project's", () => {
    const resolved: TelemetryIngestionBudgetResolved =
      resolveTelemetryIngestionBudget({
        signal: ProductType.Logs,
        instance: settings({ [ProductType.Logs]: { daily: 50, rate: 20 } }),
        project: null,
        ingestionKey: settings({ [ProductType.Logs]: { daily: 10, rate: 5 } }),
      });

    expect(resolved.ingestionKey).toEqual({
      dailyBudget: {
        bytes: 10 * GB,
        source: TelemetryIngestionBudgetLimitSource.IngestionKey,
      },
      rateLimit: {
        bytes: 5 * MB,
        source: TelemetryIngestionBudgetLimitSource.IngestionKey,
      },
    });
  });

  test("holds a key's budget to the project's when the project's is lower: a key only subdivides", () => {
    const resolved: TelemetryIngestionBudgetResolved =
      resolveTelemetryIngestionBudget({
        signal: ProductType.Logs,
        instance: settings({ [ProductType.Logs]: { daily: 50 } }),
        project: settings({ [ProductType.Logs]: { daily: 4, rate: 1 } }),
        ingestionKey: settings({ [ProductType.Logs]: { daily: 10, rate: 5 } }),
      });

    expect(resolved.ingestionKey!.dailyBudget).toEqual({
      bytes: 4 * GB,
      source: TelemetryIngestionBudgetLimitSource.Project,
    });
    expect(resolved.ingestionKey!.rateLimit.bytes).toBe(1 * MB);
  });

  test("an equal key budget is the key's own, not clamped", () => {
    expect(
      resolveTelemetryIngestionBudget({
        signal: ProductType.Logs,
        instance: null,
        project: settings({ [ProductType.Logs]: { daily: 4 } }),
        ingestionKey: settings({ [ProductType.Logs]: { daily: 4 } }),
      }).ingestionKey!.dailyBudget.source,
    ).toBe(TelemetryIngestionBudgetLimitSource.IngestionKey);
  });

  test("lets a key limit itself where the project has no budget", () => {
    const resolved: TelemetryIngestionBudgetResolved =
      resolveTelemetryIngestionBudget({
        signal: ProductType.Traces,
        instance: null,
        project: null,
        ingestionKey: settings({ [ProductType.Traces]: { daily: 2 } }),
      });

    expect(resolved.project.dailyBudget.bytes).toBe(null);
    expect(resolved.ingestionKey!.dailyBudget.bytes).toBe(2 * GB);
    expect(isTelemetryIngestionBudgetLimited(resolved)).toBe(true);
  });

  test("a key that sets nothing for the signal adds no scope", () => {
    expect(
      resolveTelemetryIngestionBudget({
        signal: ProductType.Traces,
        instance: settings({ [ProductType.Traces]: { daily: 50 } }),
        project: null,
        ingestionKey: settings({ [ProductType.Logs]: { daily: 2 } }),
      }).ingestionKey,
    ).toBe(null);
  });
});

describe("getTelemetryIngestionBudgetValueProblem", () => {
  const problem: (
    value: unknown,
    kind?: TelemetryIngestionBudgetValueKind,
    allowZero?: boolean,
  ) => string | null = (
    value: unknown,
    kind: TelemetryIngestionBudgetValueKind = TelemetryIngestionBudgetValueKind.DailyBudget,
    allowZero: boolean = false,
  ): string | null => {
    return getTelemetryIngestionBudgetValueProblem({
      value: value,
      kind: kind,
      allowZero: allowZero,
    });
  };

  test("allows empty, which clears the limit", () => {
    expect(problem(null)).toBe(null);
    expect(problem(undefined)).toBe(null);
    expect(problem("")).toBe(null);
  });

  test("allows a positive amount, whole or not, and numeric text", () => {
    expect(problem(10)).toBe(null);
    expect(problem(0.5)).toBe(null);
    expect(problem("2.5")).toBe(null);
    expect(problem(TELEMETRY_INGESTION_BUDGET_MAX_DAILY_GB)).toBe(null);
    expect(
      problem(
        TELEMETRY_INGESTION_BUDGET_MAX_RATE_MB_PER_SECOND,
        TelemetryIngestionBudgetValueKind.RateLimit,
      ),
    ).toBe(null);
  });

  test("refuses 0 except where it means no limit (a project's override)", () => {
    expect(problem(0)).toMatch(/more than 0 GB per day/);
    expect(problem(0, TelemetryIngestionBudgetValueKind.RateLimit)).toMatch(
      /more than 0 MB per second/,
    );
    expect(problem(0, TelemetryIngestionBudgetValueKind.DailyBudget, true)).toBe(
      null,
    );
  });

  test("refuses negatives, text that is not a number, and values past the bound", () => {
    expect(problem(-1)).toMatch(/more than 0/);
    expect(problem(-1, TelemetryIngestionBudgetValueKind.DailyBudget, true)).toMatch(
      /0 or more GB per day/,
    );
    expect(problem("ten")).toMatch(/must be a number of GB per day/);
    expect(problem("  ")).toMatch(/must be a number/);
    expect(problem(Infinity)).toMatch(/must be a number/);
    expect(problem(TELEMETRY_INGESTION_BUDGET_MAX_DAILY_GB + 1)).toMatch(
      /at most 1,000,000 GB per day/,
    );
    expect(problem({})).toMatch(/must be a number/);
  });

  test("refuses an amount smaller than a byte", () => {
    expect(problem(1e-12)).toMatch(/at least one byte/);
    expect(problem(1e-9, TelemetryIngestionBudgetValueKind.RateLimit)).toMatch(
      /at least one byte/,
    );
  });

  test("normalizes what may be saved to a number or null", () => {
    expect(normalizeTelemetryIngestionBudgetValue("2.5")).toBe(2.5);
    expect(normalizeTelemetryIngestionBudgetValue(3)).toBe(3);
    expect(normalizeTelemetryIngestionBudgetValue("")).toBe(null);
    expect(normalizeTelemetryIngestionBudgetValue(null)).toBe(null);
  });
});

describe("reset time, time zone and warning threshold", () => {
  test("default to 00:00 UTC and 80%", () => {
    expect(TELEMETRY_INGESTION_BUDGET_DEFAULT_RESET_TIME).toBe("00:00");
    expect(TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE).toBe("UTC");
    expect(TELEMETRY_INGESTION_BUDGET_DEFAULT_WARNING_PERCENT).toBe(80);
    expect(getTelemetryIngestionBudgetResetTime(null)).toBe("00:00");
    expect(getTelemetryIngestionBudgetTimezone(undefined)).toBe("UTC");
    expect(getTelemetryIngestionBudgetWarningPercent(null)).toBe(80);
  });

  test("accept HH:MM on the 24-hour clock and store it zero-padded", () => {
    expect(getTelemetryIngestionBudgetResetTimeProblem("18:30")).toBe(null);
    expect(getTelemetryIngestionBudgetResetTimeProblem("0:00")).toBe(null);
    expect(getTelemetryIngestionBudgetResetTimeProblem("23:59")).toBe(null);
    expect(getTelemetryIngestionBudgetResetTime("9:05")).toBe("09:05");
    expect(getTelemetryIngestionBudgetResetTime(" 18:30 ")).toBe("18:30");
  });

  test("refuse a time of day that is not one, and read it as 00:00", () => {
    for (const value of ["24:00", "12:60", "noon", "1230", "12:3", 1230]) {
      expect(getTelemetryIngestionBudgetResetTimeProblem(value)).toMatch(
        /HH:MM/,
      );
      expect(getTelemetryIngestionBudgetResetTime(value)).toBe("00:00");
    }
  });

  test("accept IANA time zones only, and read anything else as UTC", () => {
    expect(getTelemetryIngestionBudgetTimezoneProblem("Europe/Berlin")).toBe(
      null,
    );
    expect(getTelemetryIngestionBudgetTimezoneProblem("Asia/Kolkata")).toBe(
      null,
    );
    expect(getTelemetryIngestionBudgetTimezoneProblem("Mars/Olympus")).toMatch(
      /IANA time zone/,
    );
    expect(getTelemetryIngestionBudgetTimezoneProblem(5)).toMatch(/IANA/);
    expect(getTelemetryIngestionBudgetTimezone("Mars/Olympus")).toBe("UTC");
    expect(getTelemetryIngestionBudgetTimezone(" America/New_York ")).toBe(
      "America/New_York",
    );
  });

  test("accept a whole warning percent from 1 to 99", () => {
    expect(getTelemetryIngestionBudgetWarningPercentProblem(1)).toBe(null);
    expect(getTelemetryIngestionBudgetWarningPercentProblem(99)).toBe(null);
    expect(getTelemetryIngestionBudgetWarningPercentProblem("90")).toBe(null);

    for (const value of [0, 100, 50.5, -5, "x"]) {
      expect(getTelemetryIngestionBudgetWarningPercentProblem(value)).toMatch(
        /from 1 to 99/,
      );
      expect(getTelemetryIngestionBudgetWarningPercent(value)).toBe(80);
    }

    expect(getTelemetryIngestionBudgetWarningPercent(90)).toBe(90);
  });
});

describe("getTelemetryIngestionBudgetDay", () => {
  test("runs from midnight UTC to midnight UTC by default", () => {
    const today: TelemetryIngestionBudgetDay = day("2026-11-09T13:45:00Z");

    expect(today.startsAt.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(today.resetsAt.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(today.id).toBe("20261109T0000Z");
    expect(hours(today)).toBe(24);
  });

  test("starts a new day exactly at the reset, not a millisecond earlier", () => {
    expect(day("2026-11-10T00:00:00.000Z").id).toBe("20261110T0000Z");
    expect(day("2026-11-09T23:59:59.999Z").id).toBe("20261109T0000Z");
  });

  test("resets at a configured time of day: before it, still yesterday's day", () => {
    const morning: TelemetryIngestionBudgetDay = day(
      "2026-11-09T05:00:00Z",
      "06:30",
    );

    expect(morning.startsAt.toISOString()).toBe("2026-11-08T06:30:00.000Z");
    expect(morning.resetsAt.toISOString()).toBe("2026-11-09T06:30:00.000Z");

    expect(day("2026-11-09T06:30:00Z", "06:30").startsAt.toISOString()).toBe(
      "2026-11-09T06:30:00.000Z",
    );
  });

  test("resets at local midnight in a time zone east of UTC", () => {
    // 00:00 in Kolkata (UTC+05:30) is 18:30 UTC the day before.
    const kolkata: TelemetryIngestionBudgetDay = day(
      "2026-11-09T20:00:00Z",
      "00:00",
      "Asia/Kolkata",
    );

    expect(kolkata.startsAt.toISOString()).toBe("2026-11-09T18:30:00.000Z");
    expect(kolkata.resetsAt.toISOString()).toBe("2026-11-10T18:30:00.000Z");

    expect(
      day("2026-11-09T18:29:59Z", "00:00", "Asia/Kolkata").startsAt.toISOString(),
    ).toBe("2026-11-08T18:30:00.000Z");
  });

  test("resets at local time in a time zone west of UTC", () => {
    // 18:00 in Los Angeles (UTC-08:00 in November) is 02:00 UTC the next day.
    const losAngeles: TelemetryIngestionBudgetDay = day(
      "2026-11-10T01:00:00Z",
      "18:00",
      "America/Los_Angeles",
    );

    expect(losAngeles.startsAt.toISOString()).toBe("2026-11-09T02:00:00.000Z");
    expect(losAngeles.resetsAt.toISOString()).toBe("2026-11-10T02:00:00.000Z");
  });

  test("is an hour shorter on the day daylight saving time starts", () => {
    // New York springs forward on 2026-03-08: 02:00 EST becomes 03:00 EDT.
    const springForward: TelemetryIngestionBudgetDay = day(
      "2026-03-08T12:00:00Z",
      "00:00",
      "America/New_York",
    );

    expect(springForward.startsAt.toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    expect(springForward.resetsAt.toISOString()).toBe(
      "2026-03-09T04:00:00.000Z",
    );
    expect(hours(springForward)).toBe(23);
  });

  test("is an hour longer on the day daylight saving time ends", () => {
    // New York falls back on 2026-11-01: 02:00 EDT becomes 01:00 EST.
    const fallBack: TelemetryIngestionBudgetDay = day(
      "2026-11-01T12:00:00Z",
      "00:00",
      "America/New_York",
    );

    expect(fallBack.startsAt.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(fallBack.resetsAt.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(hours(fallBack)).toBe(25);
  });

  test("moves a reset time the clock skips to as long after the jump", () => {
    // 02:30 does not exist in New York on 2026-03-08; it resets at 03:30 EDT.
    const skipped: TelemetryIngestionBudgetDay = day(
      "2026-03-08T07:00:00Z",
      "02:30",
      "America/New_York",
    );

    expect(skipped.startsAt.toISOString()).toBe("2026-03-07T07:30:00.000Z");
    expect(skipped.resetsAt.toISOString()).toBe("2026-03-08T07:30:00.000Z");

    const after: TelemetryIngestionBudgetDay = day(
      "2026-03-08T07:30:00Z",
      "02:30",
      "America/New_York",
    );

    expect(after.startsAt.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(after.resetsAt.toISOString()).toBe("2026-03-09T06:30:00.000Z");
  });

  test("resets the first time a reset time the clock passes twice comes round", () => {
    // 01:30 happens twice in New York on 2026-11-01: EDT, then EST.
    const first: TelemetryIngestionBudgetDay = day(
      "2026-11-01T05:30:00Z",
      "01:30",
      "America/New_York",
    );

    expect(first.startsAt.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(first.resetsAt.toISOString()).toBe("2026-11-02T06:30:00.000Z");

    // The second 01:30 (EST) is still inside that day.
    expect(day("2026-11-01T06:30:00Z", "01:30", "America/New_York").id).toBe(
      first.id,
    );
  });

  test("follows a southern-hemisphere zone, whose clocks change in April and October", () => {
    // Sydney ends daylight saving time on 2026-04-05 (03:00 AEDT -> 02:00 AEST).
    const sydney: TelemetryIngestionBudgetDay = day(
      "2026-04-05T06:00:00Z",
      "00:00",
      "Australia/Sydney",
    );

    expect(hours(sydney)).toBe(25);
    expect(sydney.startsAt.toISOString()).toBe("2026-04-04T13:00:00.000Z");
  });

  test("gives every period its own id, so changing the reset never resumes another day's counters", () => {
    const utc: string = day("2026-11-09T12:00:00Z").id;
    const evening: string = day("2026-11-09T12:00:00Z", "18:00").id;
    const berlin: string = day("2026-11-09T12:00:00Z", "00:00", "Europe/Berlin").id;

    expect(new Set([utc, evening, berlin]).size).toBe(3);
    expect(evening).toBe("20261108T1800Z");
    expect(berlin).toBe("20261108T2300Z");
  });

  test("reads a bad reset time or zone as midnight UTC", () => {
    expect(day("2026-11-09T12:00:00Z", "noon", "Mars/Olympus").id).toBe(
      "20261109T0000Z",
    );
  });

  test("always contains now, every hour of a year in a zone with daylight saving time", () => {
    const start: number = Date.parse("2026-01-01T00:00:00Z");

    for (let hour: number = 0; hour < 365 * 24; hour += 7) {
      const now: Date = new Date(start + hour * 3_600_000 + 1234);
      const budgetDay: TelemetryIngestionBudgetDay =
        getTelemetryIngestionBudgetDay({
          now: now,
          resetTime: "02:30",
          timezone: "Europe/London",
        });

      expect(budgetDay.startsAt.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(budgetDay.resetsAt.getTime()).toBeGreaterThan(now.getTime());
      expect(hours(budgetDay)).toBeGreaterThanOrEqual(23);
      expect(hours(budgetDay)).toBeLessThanOrEqual(25);
    }
  });
});

describe("warning, percent used and state", () => {
  const budget: number = 10 * GB;

  test("the warning is crossed at the threshold's byte, rounded up", () => {
    expect(
      getTelemetryIngestionBudgetWarningBytes({
        dailyBudgetBytes: budget,
        warningPercent: 80,
      }),
    ).toBe(Math.ceil(budget * 0.8));
    expect(
      getTelemetryIngestionBudgetWarningBytes({
        dailyBudgetBytes: 3,
        warningPercent: 50,
      }),
    ).toBe(2);
    expect(
      getTelemetryIngestionBudgetWarningBytes({
        dailyBudgetBytes: 1,
        warningPercent: 1,
      }),
    ).toBe(1);
  });

  test("is Ok just below the warning, Warning at it", () => {
    const warnAt: number = getTelemetryIngestionBudgetWarningBytes({
      dailyBudgetBytes: budget,
      warningPercent: 80,
    });

    expect(
      getTelemetryIngestionBudgetState({
        usedBytes: warnAt - 1,
        dailyBudgetBytes: budget,
        warningPercent: 80,
      }),
    ).toBe(TelemetryIngestionBudgetState.Ok);
    expect(
      getTelemetryIngestionBudgetState({
        usedBytes: warnAt,
        dailyBudgetBytes: budget,
        warningPercent: 80,
      }),
    ).toBe(TelemetryIngestionBudgetState.Warning);
  });

  test("is used up exactly at the budget: one byte below still accepts", () => {
    expect(
      getTelemetryIngestionBudgetState({
        usedBytes: budget - 1,
        dailyBudgetBytes: budget,
        warningPercent: 80,
      }),
    ).toBe(TelemetryIngestionBudgetState.Warning);
    expect(
      getTelemetryIngestionBudgetState({
        usedBytes: budget,
        dailyBudgetBytes: budget,
        warningPercent: 80,
      }),
    ).toBe(TelemetryIngestionBudgetState.Exhausted);
    expect(
      getTelemetryIngestionBudgetState({
        usedBytes: budget + 1,
        dailyBudgetBytes: budget,
        warningPercent: 80,
      }),
    ).toBe(TelemetryIngestionBudgetState.Exhausted);
  });

  test("has no state without a budget, and an unknown one without counters", () => {
    expect(
      getTelemetryIngestionBudgetState({
        usedBytes: 99 * GB,
        dailyBudgetBytes: null,
        warningPercent: 80,
      }),
    ).toBe(TelemetryIngestionBudgetState.NoBudget);
    expect(
      getTelemetryIngestionBudgetState({
        usedBytes: null,
        dailyBudgetBytes: budget,
        warningPercent: 80,
      }),
    ).toBe(TelemetryIngestionBudgetState.Unknown);
  });

  test("percent is rounded down so 100 means used up, and is not capped", () => {
    expect(
      computeTelemetryIngestionBudgetPercentUsed({
        usedBytes: budget - 1,
        dailyBudgetBytes: budget,
      }),
    ).toBe(99.99);
    expect(
      computeTelemetryIngestionBudgetPercentUsed({
        usedBytes: budget,
        dailyBudgetBytes: budget,
      }),
    ).toBe(100);
    expect(
      computeTelemetryIngestionBudgetPercentUsed({
        usedBytes: budget * 1.5,
        dailyBudgetBytes: budget,
      }),
    ).toBe(150);
    expect(
      computeTelemetryIngestionBudgetPercentUsed({
        usedBytes: -5,
        dailyBudgetBytes: budget,
      }),
    ).toBe(0);
  });

  test("has no percent without a budget or a count", () => {
    expect(
      computeTelemetryIngestionBudgetPercentUsed({
        usedBytes: 5,
        dailyBudgetBytes: null,
      }),
    ).toBe(null);
    expect(
      computeTelemetryIngestionBudgetPercentUsed({
        usedBytes: null,
        dailyBudgetBytes: budget,
      }),
    ).toBe(null);
    expect(
      computeTelemetryIngestionBudgetPercentUsed({
        usedBytes: 5,
        dailyBudgetBytes: 0,
      }),
    ).toBe(null);
  });
});

describe("formatting for sentences", () => {
  test("writes GB whole when whole, and short otherwise", () => {
    expect(formatTelemetryIngestionBudgetGB(10 * GB)).toBe("10 GB");
    expect(formatTelemetryIngestionBudgetGB(1.5 * GB)).toBe("1.5 GB");
    expect(formatTelemetryIngestionBudgetGB(GB / 2)).toBe("0.5 GB");
    expect(formatTelemetryIngestionBudgetGB(2048 * GB)).toBe("2,048 GB");
    expect(formatTelemetryIngestionBudgetGB(0)).toBe("0 GB");
  });

  test("writes a rate in MB per second", () => {
    expect(formatTelemetryIngestionBudgetMBPerSecond(5 * MB)).toBe(
      "5 MB per second",
    );
    expect(formatTelemetryIngestionBudgetMBPerSecond(MB / 4)).toBe(
      "0.25 MB per second",
    );
  });
});
