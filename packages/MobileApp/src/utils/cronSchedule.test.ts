import { describe, expect, test } from "@jest/globals";
import {
  getNextCronRuns,
  isValidCronExpression,
  isVariableCronExpression,
} from "./cronSchedule";

/*
 * The app's copy of CronTab's reading of a schedule (Common/Utils/CronTab):
 * what is a schedule, and when it runs next, in UTC. The app asks it when a
 * monitor's first result is due (utils/monitorFirstCheck); Common's suite
 * holds it to CronTab schedule for schedule (MonitorHealthMobileParity).
 * This suite says what it does in the app's own words.
 */

function runs(expression: string, after: string, count: number = 3): string[] {
  return getNextCronRuns(expression, count, new Date(after)).map(
    (run: Date): string => {
      return run.toISOString();
    },
  );
}

describe("isValidCronExpression", () => {
  test.each([
    "* * * * *",
    "*/5 * * * *",
    "0 */2 * * *",
    "0 9 * * 1",
    "*/5 9-17 * * 1-5",
    "15,45 * * * *",
    "5/15 * * * *",
    "0 0 1 jan,jul *",
    "0 12 * * mon-fri",
    "0 0 * * 7",
    "0 */5 * * * *",
    "  */5 * * * *  ",
    "*/5  *  *  *  *",
    // Never runs, but reads as a schedule, as CronTab reads it.
    "0 0 30 2 *",
  ])("%j is a schedule", (expression: string) => {
    expect(isValidCronExpression(expression)).toBe(true);
  });

  test.each([
    "",
    "   ",
    "* * * *",
    "* * * * * * *",
    "61 * * * *",
    "* 24 * * *",
    "* * 0 * *",
    "* * * 13 *",
    "* * * * 8",
    "*/0 * * * *",
    "5-1 * * * *",
    "1,,2 * * * *",
    "*/5/2 * * * *",
    "1-2-3 * * * *",
    "/5 * * * *",
    "0 0 * foo *",
    "0 0 L * *",
    "@hourly",
    "5m",
    "Every 5 minutes",
  ])("%j is not", (expression: string) => {
    expect(isValidCronExpression(expression)).toBe(false);
  });

  test("a workflow variable is no schedule until the server resolves it", () => {
    expect(isVariableCronExpression("{{schedule}}")).toBe(true);
    expect(isVariableCronExpression("*/5 {{hour}} * * *")).toBe(true);
    expect(isValidCronExpression("{{schedule}}")).toBe(false);
    expect(isVariableCronExpression("*/5 * * * *")).toBe(false);
  });

  test("what is not text is no schedule", () => {
    for (const value of [null, undefined, 5, {}]) {
      expect(isValidCronExpression(value as unknown as string)).toBe(false);
      expect(isVariableCronExpression(value as unknown as string)).toBe(false);
    }
  });
});

describe("getNextCronRuns", () => {
  test("every five minutes runs on the five, after the moment given", () => {
    expect(runs("*/5 * * * *", "2026-11-16T12:01:30.000Z")).toEqual([
      "2026-11-16T12:05:00.000Z",
      "2026-11-16T12:10:00.000Z",
      "2026-11-16T12:15:00.000Z",
    ]);
  });

  test("a run at the very moment given is not the next one", () => {
    expect(runs("*/5 * * * *", "2026-11-16T12:05:00.000Z", 1)).toEqual([
      "2026-11-16T12:10:00.000Z",
    ]);
  });

  test("hourly and daily schedules roll over the hour, the day, the month and the year", () => {
    expect(runs("0 * * * *", "2026-12-31T23:30:00.000Z", 2)).toEqual([
      "2027-01-01T00:00:00.000Z",
      "2027-01-01T01:00:00.000Z",
    ]);
    expect(runs("0 0 * * *", "2026-11-30T12:00:00.000Z", 2)).toEqual([
      "2026-12-01T00:00:00.000Z",
      "2026-12-02T00:00:00.000Z",
    ]);
  });

  test("weekdays: Monday at nine, from a Monday afternoon, is a week off", () => {
    // 16 November 2026 is a Monday.
    expect(runs("0 9 * * 1", "2026-11-16T12:00:00.000Z", 2)).toEqual([
      "2026-11-23T09:00:00.000Z",
      "2026-11-30T09:00:00.000Z",
    ]);
    expect(runs("0 9 * * mon", "2026-11-16T12:00:00.000Z", 1)).toEqual(
      runs("0 9 * * 1", "2026-11-16T12:00:00.000Z", 1),
    );
  });

  test("Sunday is 0, 7 and sun alike", () => {
    const sunday: string[] = runs("0 0 * * 0", "2026-11-16T12:00:00.000Z", 1);

    expect(sunday).toEqual(["2026-11-22T00:00:00.000Z"]);
    expect(runs("0 0 * * 7", "2026-11-16T12:00:00.000Z", 1)).toEqual(sunday);
    expect(runs("0 0 * * sun", "2026-11-16T12:00:00.000Z", 1)).toEqual(sunday);
  });

  test("a day of the month and a day of the week, both restricted, either one runs", () => {
    // The 1st to the 7th, or any Monday.
    expect(runs("0 0 1-7 * 1", "2026-11-08T12:00:00.000Z", 3)).toEqual([
      "2026-11-09T00:00:00.000Z",
      "2026-11-16T00:00:00.000Z",
      "2026-11-23T00:00:00.000Z",
    ]);
  });

  test("a step from a value runs from it to the end of the range", () => {
    expect(runs("50/5 * * * *", "2026-11-16T12:00:00.000Z", 3)).toEqual([
      "2026-11-16T12:50:00.000Z",
      "2026-11-16T12:55:00.000Z",
      "2026-11-16T13:50:00.000Z",
    ]);
  });

  test("a sixth field is seconds", () => {
    expect(runs("30 */5 * * * *", "2026-11-16T12:01:00.000Z", 2)).toEqual([
      "2026-11-16T12:05:30.000Z",
      "2026-11-16T12:10:30.000Z",
    ]);
  });

  test("the 29th of February waits for a leap year", () => {
    expect(runs("0 0 29 2 *", "2026-11-16T12:00:00.000Z", 2)).toEqual([
      "2028-02-29T00:00:00.000Z",
      "2032-02-29T00:00:00.000Z",
    ]);
  });

  test("a schedule that never runs has no next run", () => {
    expect(runs("0 0 30 2 *", "2026-11-16T12:00:00.000Z", 1)).toEqual([]);
  });

  test("an expression that is no schedule throws, as CronTab's does", () => {
    expect(() => {
      getNextCronRuns("5m", 1, new Date());
    }).toThrow();
  });
});
