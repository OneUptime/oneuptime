/** @timezone UTC */
import CronTab from "../../../Server/Utils/CronTab";
import logger from "../../../Server/Utils/Logger";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  FIVE_FIELD_SCHEDULES,
  OFFSETS_IN_A_MINUTE_MS,
  currentZone,
} from "../TestingUtils/CronTabMemoCases";
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
 * CronTab.getNextExecutionTimeAfter: a schedule's first run strictly after
 * any instant, past or future (TelemetryMonitorSchedule asks for the run
 * after a monitor's due time less its offset). These hold, in UTC (the
 * Kathmandu and London files beside this one hold zones with a quarter-hour
 * offset and daylight saving changes):
 *
 *  - at every offset of thousands of minutes, asked in and out of order,
 *    the answer is cron-parser's for that very instant, for a dozen
 *    five-field schedules and for schedules with seconds;
 *  - cron-parser is asked once per schedule and minute of five fields, and
 *    every time for six;
 *  - at most 1,000 schedule minutes are kept;
 *  - a schedule cron-parser refuses, or an instant that is not one, throws
 *    BadDataException and logs nothing.
 */

const START: number = Date.UTC(2026, 9, 27, 13, 41, 17, 250);
const MINUTE_IN_MS: number = 60 * 1000;

function cronParserNext(schedule: string, instantInMs: number): number {
  return CronParser.parseExpression(schedule, {
    currentDate: new Date(instantInMs),
  })
    .next()
    .toDate()
    .getTime();
}

// Every offset of each minute asked, against cron-parser; how many compared.
function expectAnswersToBeCronParsers(data: {
  minutes: Array<number>;
  schedules: Array<string>;
}): number {
  const differing: Array<string> = [];
  let compared: number = 0;

  for (const minuteStart of data.minutes) {
    for (const offset of OFFSETS_IN_A_MINUTE_MS) {
      const instant: number = minuteStart + offset;

      for (const schedule of data.schedules) {
        const answer: number = CronTab.getNextExecutionTimeAfter(
          schedule,
          new Date(instant),
        ).getTime();
        const expected: number = cronParserNext(schedule, instant);

        compared++;

        if (answer !== expected) {
          differing.push(
            `${schedule} after ${new Date(instant).toISOString()}: ${new Date(answer).toISOString()} instead of ${new Date(expected).toISOString()}`,
          );
        }
      }
    }
  }

  expect(differing.slice(0, 10)).toEqual([]);

  return compared;
}

function minutesFrom(start: number, count: number): Array<number> {
  const first: number = Math.floor(start / MINUTE_IN_MS) * MINUTE_IN_MS;

  return Array.from({ length: count }, (_: unknown, index: number): number => {
    return first + index * MINUTE_IN_MS;
  });
}

describe("CronTab.getNextExecutionTimeAfter", () => {
  beforeEach(() => {
    CronTab.clearNextExecutionMemo();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    CronTab.clearNextExecutionMemo();
  });

  test("this file runs in UTC", () => {
    expect(currentZone()).toBe("UTC");
  });

  test("at every offset of every minute, the answer is cron-parser's for that instant", () => {
    const compared: number = expectAnswersToBeCronParsers({
      minutes: [
        ...minutesFrom(START, 40),
        // A year, a leap day and a month turning over.
        ...minutesFrom(Date.UTC(2026, 11, 31, 23, 40, 0), 30),
        ...minutesFrom(Date.UTC(2028, 1, 28, 23, 50, 0), 20),
        ...minutesFrom(Date.UTC(2026, 9, 31, 23, 50, 0), 20),
      ],
      schedules: FIVE_FIELD_SCHEDULES,
    });

    expect(compared).toBeGreaterThan(9000);
  });

  test("asked out of order - instants in the past and the future, back and forth - each answer is still cron-parser's", () => {
    const minutes: Array<number> = minutesFrom(START, 30);
    // A fixed shuffle: every minute, far from the order they come in.
    const shuffled: Array<number> = minutes.map(
      (_: number, index: number): number => {
        return minutes[(index * 17) % minutes.length]!;
      },
    );

    expect(new Set(shuffled).size).toBe(minutes.length);

    // Warm the memo going forwards, then ask again shuffled.
    expectAnswersToBeCronParsers({
      minutes: minutes,
      schedules: FIVE_FIELD_SCHEDULES,
    });
    expectAnswersToBeCronParsers({
      minutes: shuffled,
      schedules: FIVE_FIELD_SCHEDULES,
    });

    // A day, a week and a year back from now.
    expectAnswersToBeCronParsers({
      minutes: [
        START - 24 * 60 * MINUTE_IN_MS,
        START - 7 * 24 * 60 * MINUTE_IN_MS,
        START - 365 * 24 * 60 * MINUTE_IN_MS,
      ].map((instant: number): number => {
        return Math.floor(instant / MINUTE_IN_MS) * MINUTE_IN_MS;
      }),
      schedules: FIVE_FIELD_SCHEDULES,
    });
  });

  test("the run after an instant that is itself a run is the one after it, never the instant", () => {
    const run: Date = new Date(Date.UTC(2026, 9, 27, 14, 0, 0));

    expect(
      CronTab.getNextExecutionTimeAfter("* * * * *", run).toISOString(),
    ).toBe("2026-10-27T14:01:00.000Z");
    expect(
      CronTab.getNextExecutionTimeAfter("*/5 * * * *", run).toISOString(),
    ).toBe("2026-10-27T14:05:00.000Z");
    expect(
      CronTab.getNextExecutionTimeAfter("0 * * * *", run).toISOString(),
    ).toBe("2026-10-27T15:00:00.000Z");

    // A millisecond before, the run itself.
    expect(
      CronTab.getNextExecutionTimeAfter(
        "0 * * * *",
        new Date(run.getTime() - 1),
      ).toISOString(),
    ).toBe("2026-10-27T14:00:00.000Z");
  });

  test("a schedule with seconds is cron-parser's at every instant, and never kept", () => {
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(
      CronParser,
      "parseExpression",
    );

    const sixFields: Array<string> = [
      "*/30 * * * * *",
      "0 * * * * *",
      "15,45 * * * * *",
    ];

    const compared: number = expectAnswersToBeCronParsers({
      minutes: minutesFrom(START, 5),
      schedules: sixFields,
    });

    expect(CronTab.getNextExecutionAfterMemoSize()).toBe(0);

    // Once for CronTab's answer and once for the comparison, every time.
    expect(parse).toHaveBeenCalledTimes(compared * 2);
  });

  test("cron-parser is asked once per schedule and minute: every other instant of the minute is the kept answer", () => {
    const parse: ReturnType<typeof jest.spyOn> = jest.spyOn(
      CronParser,
      "parseExpression",
    );

    const minuteStart: number = Math.floor(START / MINUTE_IN_MS) * MINUTE_IN_MS;

    for (const offset of OFFSETS_IN_A_MINUTE_MS) {
      CronTab.getNextExecutionTimeAfter(
        "*/5 * * * *",
        new Date(minuteStart + offset),
      );
      CronTab.getNextExecutionTimeAfter(
        "0 * * * *",
        new Date(minuteStart + offset),
      );
    }

    expect(parse).toHaveBeenCalledTimes(2);

    // The minute before and the minute after are minutes of their own.
    CronTab.getNextExecutionTimeAfter("*/5 * * * *", new Date(minuteStart - 1));
    CronTab.getNextExecutionTimeAfter(
      "*/5 * * * *",
      new Date(minuteStart + MINUTE_IN_MS),
    );

    expect(parse).toHaveBeenCalledTimes(4);
    expect(CronTab.getNextExecutionAfterMemoSize()).toBe(4);
  });

  test("the kept answers are another memo than getNextExecutionTime's, and cleared with it", () => {
    jest.useFakeTimers({ now: START });

    try {
      CronTab.getNextExecutionTime("* * * * *");
      CronTab.getNextExecutionTimeAfter("* * * * *", new Date(START));

      expect(CronTab.getNextExecutionMemoSize()).toBe(1);
      expect(CronTab.getNextExecutionAfterMemoSize()).toBe(1);

      CronTab.clearNextExecutionMemo();

      expect(CronTab.getNextExecutionMemoSize()).toBe(0);
      expect(CronTab.getNextExecutionAfterMemoSize()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test("at most 1,000 schedule minutes are kept", () => {
    const minuteStart: number = Math.floor(START / MINUTE_IN_MS) * MINUTE_IN_MS;

    for (let minute: number = 0; minute < 2500; minute++) {
      CronTab.getNextExecutionTimeAfter(
        "* * * * *",
        new Date(minuteStart + minute * MINUTE_IN_MS),
      );

      expect(CronTab.getNextExecutionAfterMemoSize()).toBeLessThanOrEqual(1000);
    }

    // Still cron-parser's answer after the memo was cleared on the way.
    expect(
      CronTab.getNextExecutionTimeAfter(
        "* * * * *",
        new Date(minuteStart + 2499 * MINUTE_IN_MS + 30000),
      ).getTime(),
    ).toBe(minuteStart + 2500 * MINUTE_IN_MS);
  });

  test("a schedule cron-parser refuses throws BadDataException every time, is never kept, and logs nothing", () => {
    for (let attempt: number = 0; attempt < 3; attempt++) {
      expect(() => {
        CronTab.getNextExecutionTimeAfter("not a schedule", new Date(START));
      }).toThrow(BadDataException);
      expect(() => {
        CronTab.getNextExecutionTimeAfter("61 * * * *", new Date(START));
      }).toThrow(BadDataException);
    }

    expect(CronTab.getNextExecutionAfterMemoSize()).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("an instant that is not one throws BadDataException instead of walking the calendar", () => {
    expect(() => {
      CronTab.getNextExecutionTimeAfter("* * * * *", new Date(Number.NaN));
    }).toThrow(BadDataException);
    expect(() => {
      CronTab.getNextExecutionTimeAfter(
        undefined as unknown as string,
        new Date(START),
      );
    }).toThrow(BadDataException);
  });
});
