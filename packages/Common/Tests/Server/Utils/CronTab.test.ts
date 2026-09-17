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
   * getIntervalInSeconds answers "how long can a monitor go between checks",
   * which is what over-time criteria use to tell a window that is genuinely
   * all-breaching from one that has simply not filled up yet.
   */
  describe("getIntervalInSeconds", () => {
    // Fixed so the walk over upcoming executions never touches the wall clock.
    const referenceDate: Date = new Date("2026-08-20T12:00:00.000Z");

    it("returns 60 seconds for an every-minute schedule", () => {
      expect(CronTab.getIntervalInSeconds("* * * * *", referenceDate)).toBe(60);
    });

    it("returns 300 seconds for an every-five-minute schedule", () => {
      expect(CronTab.getIntervalInSeconds("*/5 * * * *", referenceDate)).toBe(
        300,
      );
    });

    it("returns 3600 seconds for an hourly schedule", () => {
      expect(CronTab.getIntervalInSeconds("0 * * * *", referenceDate)).toBe(
        3600,
      );
    });

    it("returns a day for a daily schedule", () => {
      expect(CronTab.getIntervalInSeconds("0 0 * * *", referenceDate)).toBe(
        24 * 60 * 60,
      );
    });

    /*
     * An irregular schedule has both short and long gaps. The longest one is
     * what callers need: demanding data at the shortest cadence would make
     * them wait for samples the schedule never produces.
     */
    it("reports the longest gap for an irregular schedule", () => {
      // Fires at :00 :01 :30 - gaps of 1, 29 and 30 minutes.
      expect(
        CronTab.getIntervalInSeconds("0,1,30 * * * *", referenceDate),
      ).toBe(30 * 60);
    });

    it("is unaffected by which point in the schedule it starts from", () => {
      const fromMidCycle: number | null = CronTab.getIntervalInSeconds(
        "*/5 * * * *",
        new Date("2026-08-20T12:02:37.000Z"),
      );

      expect(fromMidCycle).toBe(300);
    });

    it("handles a schedule that wraps the hour", () => {
      /*
       * An every-seven-minute schedule fires at :00 :07 ... :56 and then
       * :00 of the next hour, so the wrap gap is only four minutes - the
       * seven minute gap still governs.
       */
      expect(CronTab.getIntervalInSeconds("*/7 * * * *", referenceDate)).toBe(
        7 * 60,
      );
    });

    /*
     * Every preset the monitoring-interval picker offers, so a new one added
     * to the dropdown without a matching gap here shows up as a failure
     * rather than as silently unknown cadence.
     */
    it("resolves every interval the monitor picker offers", () => {
      const presets: Record<string, number> = {
        "* * * * *": 60,
        "*/2 * * * *": 120,
        "*/5 * * * *": 300,
        "*/10 * * * *": 600,
        "*/15 * * * *": 900,
        "*/30 * * * *": 1800,
        "0 * * * *": 3600,
        "0 0 * * *": 24 * 60 * 60,
        "0 0 * * 0": 7 * 24 * 60 * 60,
      };

      for (const expression of Object.keys(presets)) {
        expect(CronTab.getIntervalInSeconds(expression, referenceDate)).toBe(
          presets[expression],
        );
      }
    });

    /*
     * monitoringInterval is free text and this repo's own Terraform examples
     * write the human label, so the label form must degrade to "unknown"
     * rather than throwing on the criteria hot path.
     */
    it("returns null for the human label form", () => {
      expect(
        CronTab.getIntervalInSeconds("Every 5 minutes", referenceDate),
      ).toBeNull();
    });

    it("returns null for an unparseable expression", () => {
      expect(
        CronTab.getIntervalInSeconds("not-a-cron", referenceDate),
      ).toBeNull();
    });

    it("returns null when no schedule is configured", () => {
      expect(CronTab.getIntervalInSeconds(undefined)).toBeNull();
      expect(CronTab.getIntervalInSeconds(null)).toBeNull();
      expect(CronTab.getIntervalInSeconds("")).toBeNull();
    });

    it("falls back to the wall clock when no reference date is given", () => {
      expect(CronTab.getIntervalInSeconds("*/5 * * * *")).toBe(300);
    });
  });
});
