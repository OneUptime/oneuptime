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

  it("should return the interval in minutes for an every-minute cron", () => {
    expect(CronTab.getIntervalInMinutes("* * * * *")).toBe(1);
  });

  it("should return the interval in minutes for an every-5-minutes cron", () => {
    expect(CronTab.getIntervalInMinutes("*/5 * * * *")).toBe(5);
  });

  it("should return the interval in minutes for an every-15-minutes cron", () => {
    expect(CronTab.getIntervalInMinutes("*/15 * * * *")).toBe(15);
  });

  it("should return null for an invalid cron expression interval", () => {
    expect(CronTab.getIntervalInMinutes("not-a-cron")).toBeNull();
  });
});
