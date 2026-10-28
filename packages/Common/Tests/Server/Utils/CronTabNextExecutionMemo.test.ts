/** @timezone UTC */
import CronTab from "../../../Server/Utils/CronTab";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  currentZone,
  expectKeptAnswersToBeCronParsers,
} from "../TestingUtils/CronTabMemoCases";
import { fastestRun, FastestRun } from "../../Helpers/FastestRun";
import CronParser from "cron-parser";
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
 * CronTab.getNextExecutionTime keeps its answer for the rest of the minute.
 *
 * Every monitor check asks when the monitor is due next, and cron-parser
 * takes 40 to 270 microseconds a question. A schedule of five fields runs
 * at whole minutes only, so its next run is the same from any instant of a
 * minute. These hold, in UTC (the zone files beside this one hold Kathmandu,
 * a quarter-hour offset, and London across its daylight saving changes):
 *
 *  - at every offset of thousands of minutes, the kept answer is
 *    cron-parser's for that instant, for a dozen schedules;
 *  - within a minute cron-parser is asked once per schedule, and again in
 *    the next minute, or when the clock goes back;
 *  - a schedule with seconds (six fields) and a schedule cron-parser
 *    refuses are never kept, and the latter still throws each time;
 *  - at most 1,000 schedules are kept;
 *  - an answer kept is several times faster than cron-parser's.
 */

const START: number = Date.UTC(2026, 9, 27, 13, 41, 17, 250);

describe("CronTab.getNextExecutionTime keeps its answer for the minute", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: START });
    CronTab.clearNextExecutionMemo();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    CronTab.clearNextExecutionMemo();
  });

  test("this file runs in UTC", () => {
    expect(currentZone()).toBe("UTC");
    expect(new Date(START).getTimezoneOffset()).toBe(0);
  });

  test("at every offset of every minute, the answer is cron-parser's for that instant", () => {
    const compared: number = expectKeptAnswersToBeCronParsers({
      starts: [
        START,
        // A year, a leap day and a month turning over.
        Date.UTC(2026, 11, 31, 23, 40, 0),
        Date.UTC(2028, 1, 28, 23, 50, 0),
        Date.UTC(2026, 9, 31, 23, 50, 0),
      ],
      minutes: 30,
    });

    expect(compared).toBeGreaterThan(10000);
  });

  test("within a minute cron-parser is asked once a schedule; the next minute again", () => {
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(
      CronParser,
      "parseExpression",
    );

    const first: Date = CronTab.getNextExecutionTime("* * * * *");

    jest.setSystemTime(START + 20000);
    const second: Date = CronTab.getNextExecutionTime("* * * * *");

    jest.setSystemTime(START + 30000);
    CronTab.getNextExecutionTime("*/5 * * * *");
    CronTab.getNextExecutionTime("*/5 * * * *");

    expect(parse).toHaveBeenCalledTimes(2);
    expect(second.getTime()).toBe(first.getTime());
    expect(first.toISOString()).toBe("2026-10-27T13:42:00.000Z");
    // Each answer is a Date of its own.
    expect(second).not.toBe(first);

    // The next minute asks again.
    jest.setSystemTime(Date.UTC(2026, 9, 27, 13, 42, 0, 0));
    expect(CronTab.getNextExecutionTime("* * * * *").toISOString()).toBe(
      "2026-10-27T13:43:00.000Z",
    );
    expect(parse).toHaveBeenCalledTimes(3);

    // So does a clock that went back a minute.
    jest.setSystemTime(START - 60000);
    expect(CronTab.getNextExecutionTime("* * * * *").toISOString()).toBe(
      "2026-10-27T13:41:00.000Z",
    );
    expect(parse).toHaveBeenCalledTimes(4);
  });

  test("a schedule with seconds is never kept", () => {
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(
      CronParser,
      "parseExpression",
    );

    const first: Date = CronTab.getNextExecutionTime("*/30 * * * * *");

    jest.setSystemTime(START + 15000);
    const second: Date = CronTab.getNextExecutionTime("*/30 * * * * *");

    expect(parse).toHaveBeenCalledTimes(2);
    expect(first.toISOString()).toBe("2026-10-27T13:41:30.000Z");
    expect(second.toISOString()).toBe("2026-10-27T13:42:00.000Z");
    expect(CronTab.getNextExecutionMemoSize()).toBe(0);
  });

  test("a schedule cron-parser refuses throws every time and is never kept", () => {
    for (let attempt: number = 0; attempt < 3; attempt++) {
      expect(() => {
        CronTab.getNextExecutionTime("not a schedule at all");
      }).toThrow(BadDataException);
      expect(() => {
        CronTab.getNextExecutionTime("61 * * * *");
      }).toThrow("Invalid cron expression: 61 * * * *");
    }

    expect(CronTab.getNextExecutionMemoSize()).toBe(0);
  });

  test("at most 1,000 schedules are kept", () => {
    for (let minute: number = 0; minute < 60; minute++) {
      for (let hour: number = 0; hour < 24; hour++) {
        CronTab.getNextExecutionTime(`${minute} ${hour} * * *`);
        expect(CronTab.getNextExecutionMemoSize()).toBeLessThanOrEqual(1000);
      }
    }

    // 1,440 schedules asked; the answers are still right after the reset.
    jest.setSystemTime(START + 5000);
    expect(CronTab.getNextExecutionTime("0 14 * * *").toISOString()).toBe(
      "2026-10-27T14:00:00.000Z",
    );
  });

  test("an answer kept is several times faster than cron-parser's", () => {
    // Timed on the real clock: fake timers stop performance.now too.
    jest.useRealTimers();
    const calls: number = 2000;

    const parsed: FastestRun<number> = fastestRun({
      run: (): number => {
        let total: number = 0;

        for (let index: number = 0; index < calls; index++) {
          total += CronParser.parseExpression("* * * * *", {
            currentDate: new Date(Date.now()),
          })
            .next()
            .toDate()
            .getTime();
        }

        return total;
      },
      limitInMs: 0,
    });

    const kept: FastestRun<number> = fastestRun({
      run: (): number => {
        let total: number = 0;

        for (let index: number = 0; index < calls; index++) {
          total += CronTab.getNextExecutionTime("* * * * *").getTime();
        }

        return total;
      },
      limitInMs: 0,
    });

    expect(kept.result).toBeGreaterThan(0);
    // Measured about 50 times faster; five leaves room for a busy runner.
    expect(kept.inMs * 5).toBeLessThan(parsed.inMs);
  });
});
