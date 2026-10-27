/** @timezone Europe/London */
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
 * (CronTabNextExecutionMemo.test.ts), in London across both daylight saving
 * changes of 2026: on 29 March 01:00 UTC the clocks go forward an hour (a
 * local hour that never happens), on 25 October 01:00 UTC back an hour (a
 * local hour that happens twice). Through both, the kept answer is
 * cron-parser's at every offset of every minute.
 */
describe("CronTab.getNextExecutionTime in Europe/London", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: Date.UTC(2026, 2, 28, 23, 0, 0) });
    CronTab.clearNextExecutionMemo();
  });

  afterEach(() => {
    jest.useRealTimers();
    CronTab.clearNextExecutionMemo();
  });

  test("this file runs in Europe/London, with summer time", () => {
    expect(currentZone()).toBe("Europe/London");
    expect(new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset()).toBe(0);
    expect(new Date(Date.UTC(2026, 6, 15)).getTimezoneOffset()).toBe(-60);
  });

  test("across the clocks going forward, the answer is cron-parser's", () => {
    const compared: number = expectKeptAnswersToBeCronParsers({
      starts: [Date.UTC(2026, 2, 29, 0, 30, 0)],
      minutes: 60,
    });

    expect(compared).toBeGreaterThan(5000);
  });

  test("across the clocks going back, the answer is cron-parser's", () => {
    const compared: number = expectKeptAnswersToBeCronParsers({
      starts: [Date.UTC(2026, 9, 25, 0, 30, 0)],
      minutes: 60,
    });

    expect(compared).toBeGreaterThan(5000);
  });
});
