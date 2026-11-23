import { SecurityAutomaticResponseOutcome } from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOutcome";
import {
  SecurityAutomaticResponseTimeToBlock,
  getPercentile,
  getTimeToBlockStats,
  summarizeSecurityAutomaticResponseTrial,
  summarizeTimeToBlock,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseSummary";
import { describe, expect, test } from "@jest/globals";

/*
 * What a policy's page says of it (#10350): a trial run's summary - each
 * address once, however many detections it had - and time to block, its
 * 50th and 95th percentiles over 30 days and day by day.
 */

const NOW: Date = new Date("2026-11-22T10:00:00.000Z");

describe("the trial run's summary", () => {
  test("counts each address once, by what the policy would have done", () => {
    expect(
      summarizeSecurityAutomaticResponseTrial([
        {
          value: "35.205.11.131",
          outcome: SecurityAutomaticResponseOutcome.Challenged,
        },
        {
          value: "35.205.11.131",
          outcome: SecurityAutomaticResponseOutcome.Challenged,
        },
        {
          value: "35.205.11.132",
          outcome: SecurityAutomaticResponseOutcome.Challenged,
        },
        {
          value: "35.205.11.133",
          outcome: SecurityAutomaticResponseOutcome.Blocked,
          doubtSeenAt: NOW,
        },
        {
          value: "198.51.100.4",
          outcome: SecurityAutomaticResponseOutcome.SparedSignedIn,
        },
        {
          value: "198.51.100.5",
          outcome: SecurityAutomaticResponseOutcome.SparedProtected,
        },
        {
          value: "198.51.100.6",
          outcome: SecurityAutomaticResponseOutcome.SparedCannotTell,
        },
        {
          value: "198.51.100.7",
          outcome: SecurityAutomaticResponseOutcome.StoppedAtLimit,
        },
        {
          value: "198.51.100.8",
          outcome: SecurityAutomaticResponseOutcome.StoppedAtLimit,
        },
      ]),
    ).toEqual({
      wouldActOn: 3,
      wouldHaveLifted: 1,
      sparedSignedIn: 1,
      sparedProtected: 1,
      sparedCannotTell: 1,
      wouldHaveStopped: 2,
    });
  });

  test("a trial that saw nothing says nothing would have happened", () => {
    expect(summarizeSecurityAutomaticResponseTrial([])).toEqual({
      wouldActOn: 0,
      wouldHaveLifted: 0,
      sparedSignedIn: 0,
      sparedProtected: 0,
      sparedCannotTell: 0,
      wouldHaveStopped: 0,
    });
  });
});

describe("percentiles", () => {
  test("by nearest rank", () => {
    const values: Array<number> = Array.from(
      { length: 100 },
      (_v: unknown, index: number) => {
        return index + 1;
      },
    );

    expect(getPercentile(values, 50)).toBe(50);
    expect(getPercentile(values, 95)).toBe(95);
    expect(getPercentile([41], 95)).toBe(41);
    expect(getPercentile([], 50)).toBeNull();
  });

  test("of times to block, whatever order they come in, never a negative or broken one", () => {
    expect(getTimeToBlockStats([90, 30, 41, -1, Number.NaN, 60])).toEqual({
      count: 4,
      p50InSeconds: 41,
      p95InSeconds: 90,
    });
  });
});

describe("time to block over 30 days", () => {
  test("counts each block on the day it took hold, and every day of the window", () => {
    const summary: SecurityAutomaticResponseTimeToBlock = summarizeTimeToBlock({
      rows: [
        {
          appliedAt: new Date("2026-11-22T09:00:00.000Z"),
          timeToBlockInSeconds: 41,
        },
        {
          appliedAt: new Date("2026-11-22T08:00:00.000Z"),
          timeToBlockInSeconds: 75,
        },
        {
          appliedAt: new Date("2026-11-20T08:00:00.000Z"),
          timeToBlockInSeconds: 30,
        },
        // Older than the window.
        {
          appliedAt: new Date("2026-10-01T08:00:00.000Z"),
          timeToBlockInSeconds: 999,
        },
        // Never took hold, or no first request known.
        { appliedAt: null, timeToBlockInSeconds: 12 },
        {
          appliedAt: new Date("2026-11-22T07:00:00.000Z"),
          timeToBlockInSeconds: null,
        },
      ],
      now: NOW,
      days: 30,
    });

    expect(summary.count).toBe(3);
    expect(summary.p50InSeconds).toBe(41);
    expect(summary.p95InSeconds).toBe(75);
    expect(summary.days).toHaveLength(30);
    expect(summary.days[0]!.day).toBe("2026-10-24");
    expect(summary.days[29]).toEqual({
      day: "2026-11-22",
      count: 2,
      p50InSeconds: 41,
      p95InSeconds: 75,
    });
    expect(summary.days[27]).toEqual({
      day: "2026-11-20",
      count: 1,
      p50InSeconds: 30,
      p95InSeconds: 30,
    });
    expect(summary.days[28]).toEqual({
      day: "2026-11-21",
      count: 0,
      p50InSeconds: null,
      p95InSeconds: null,
    });
  });
});
