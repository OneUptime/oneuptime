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

  it("should handle human-readable interval '1 minute'", () => {
    const crontab: string = "1 minute";

    const nextExecutionTime: Date = CronTab.getNextExecutionTime(crontab);

    const now: Date = new Date();
    const toleranceInMilliseconds: number = 60000;
    const differenceInMilliseconds: number =
      nextExecutionTime.getTime() - now.getTime();
    expect(differenceInMilliseconds).toBeLessThan(toleranceInMilliseconds);
    expect(differenceInMilliseconds).toBeGreaterThan(0);
  });

  it("should handle human-readable interval '5 minutes'", () => {
    const crontab: string = "5 minutes";

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

  it("should handle human-readable interval '1 hour'", () => {
    const crontab: string = "1 hour";

    const nextExecutionTime: Date = CronTab.getNextExecutionTime(crontab);

    const now: Date = new Date();
    const expectedNextExecutionTime: Date = new Date(
      now.getTime() + 60 * 60 * 1000,
    );

    const toleranceInMilliseconds: number = 60000;
    const differenceInMilliseconds: number =
      nextExecutionTime.getTime() - expectedNextExecutionTime.getTime();
    expect(differenceInMilliseconds).toBeLessThan(toleranceInMilliseconds);
  });
});