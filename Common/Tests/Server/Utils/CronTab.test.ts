import CronTab from "../../../Server/Utils/CronTab";
import { describe, expect, it } from "@jest/globals";

describe("CronTab", () => {
  it("should return the next execution time for a given cron expression", () => {
    const crontab: string = "*/5 * * * *";

    const nextExecutionTime: Date = CronTab.getNextExecutionTime(crontab);

    const now: Date = new Date();
    const expectedNextExecutionTime: Date = new Date(
      now.getTime() + 5 * 60 * 1000,
    );

    const toleranceInMilliseconds: number = 5000;
    const differenceInMilliseconds: number =
      nextExecutionTime.getTime() - expectedNextExecutionTime.getTime();
    expect(differenceInMilliseconds).toBeLessThan(toleranceInMilliseconds);
  });

  it("should return the next execution time for a daily cron expression", () => {
    const crontab: string = "0 0 * * *";

    const nextExecutionTime: Date = CronTab.getNextExecutionTime(crontab);

    const now: Date = new Date();
    const expectedNextExecutionTime: Date = new Date(
      now.getTime() + 24 * 60 * 60 * 1000,
    );

    const toleranceInMilliseconds: number = 5000;
    const differenceInMilliseconds: number =
      nextExecutionTime.getTime() - expectedNextExecutionTime.getTime();
    expect(differenceInMilliseconds).toBeLessThan(toleranceInMilliseconds);
  });

  it("should throw an error when the cron expression is invalid", () => {
    const crontab: string = "invalid";

    expect(() => {
      CronTab.getNextExecutionTime(crontab);
    }).toThrowError(`Invalid cron expression: ${crontab}`);
  });

  /*
   * Sub-minute monitoring intervals are 6-field expressions with a leading
   * seconds field, and MonitorProbeService schedules nextPingAt off an
   * explicit anchor rather than a bare "now" so a fire time milliseconds away
   * cannot be scheduled. Both behaviours are pinned here.
   */
  describe("sub-minute expressions and the explicit anchor", () => {
    it("resolves a seconds expression without rounding up to the next minute", () => {
      const nextExecutionTime: Date = CronTab.getNextExecutionTime(
        "*/20 * * * * *",
        new Date(Date.UTC(2026, 0, 1, 12, 0, 7)),
      );

      expect(nextExecutionTime.toISOString()).toBe("2026-01-01T12:00:20.000Z");
    });

    it("honours the anchor rather than the wall clock", () => {
      const nextExecutionTime: Date = CronTab.getNextExecutionTime(
        "*/20 * * * * *",
        new Date(Date.UTC(2026, 0, 1, 12, 0, 21)),
      );

      expect(nextExecutionTime.toISOString()).toBe("2026-01-01T12:00:40.000Z");
    });

    it("returns a fire time strictly after the anchor", () => {
      const nextExecutionTime: Date = CronTab.getNextExecutionTime(
        "*/10 * * * * *",
        new Date(Date.UTC(2026, 0, 1, 12, 0, 10)),
      );

      expect(nextExecutionTime.toISOString()).toBe("2026-01-01T12:00:20.000Z");
    });

    it("still works with no anchor at all - the signature stays backwards compatible", () => {
      const before: Date = new Date();
      const nextExecutionTime: Date =
        CronTab.getNextExecutionTime("*/10 * * * * *");

      expect(nextExecutionTime.getTime()).toBeGreaterThan(before.getTime());
      expect(
        nextExecutionTime.getTime() - before.getTime(),
      ).toBeLessThanOrEqual(10000);
    });

    it("throws the same message for an invalid expression when an anchor is passed", () => {
      expect(() => {
        CronTab.getNextExecutionTime("invalid", new Date());
      }).toThrowError("Invalid cron expression: invalid");
    });
  });
});
