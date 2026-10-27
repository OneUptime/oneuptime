/** @timezone Asia/Kathmandu */
import CronTab from "../../../Server/Utils/CronTab";
import {
  currentZone,
  expectKeptAnswersToBeCronParsers,
} from "../TestingUtils/CronTabMemoCases";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * CronTab.getNextExecutionTime's answer kept for the minute
 * (CronTabNextExecutionMemo.test.ts), in a zone a quarter hour off the
 * hour: Kathmandu is UTC+05:45, so its hours start at :15 past a UTC hour
 * and "0 * * * *" runs at a quarter past in UTC. A local minute still
 * starts with a UTC one, so the kept answer is cron-parser's at every
 * offset of every minute.
 */
describe("CronTab.getNextExecutionTime in Asia/Kathmandu", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: Date.UTC(2026, 9, 27, 8, 0, 0) });
    CronTab.clearNextExecutionMemo();
  });

  afterEach(() => {
    jest.useRealTimers();
    CronTab.clearNextExecutionMemo();
  });

  test("this file runs in Asia/Kathmandu, UTC+05:45", () => {
    // Node names it by its older spelling too.
    expect(["Asia/Kathmandu", "Asia/Katmandu"]).toContain(currentZone());
    expect(new Date(Date.UTC(2026, 9, 27)).getTimezoneOffset()).toBe(-345);
  });

  test("an hourly schedule runs at a quarter past in UTC, as cron-parser says", () => {
    jest.setSystemTime(Date.UTC(2026, 9, 27, 8, 20, 30));

    expect(CronTab.getNextExecutionTime("0 * * * *").toISOString()).toBe(
      "2026-10-27T09:15:00.000Z",
    );
  });

  test("at every offset of every minute, the answer is cron-parser's for that instant", () => {
    const compared: number = expectKeptAnswersToBeCronParsers({
      starts: [
        Date.UTC(2026, 9, 27, 8, 0, 0),
        // The local day turning over (00:00 local is 18:15 UTC).
        Date.UTC(2026, 9, 27, 17, 30, 0),
        // The local year turning over.
        Date.UTC(2026, 11, 31, 17, 50, 0),
      ],
      minutes: 40,
    });

    expect(compared).toBeGreaterThan(10000);
  });
});
