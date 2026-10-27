import CronTab from "../../../Server/Utils/CronTab";
import CronParser from "cron-parser";
import { expect, jest } from "@jest/globals";

/*
 * What CronTabNextExecutionMemo*.test.ts hold CronTab.getNextExecutionTime
 * to, in the zone each runs in: at every offset of every minute asked - its
 * first millisecond, the next, the second after, its middle and its last
 * millisecond - the kept answer is the one cron-parser gives for that very
 * instant, and within a minute cron-parser is asked once per schedule.
 *
 * Not a test file itself (jest only collects *.test.ts). Each caller runs
 * under fake timers (jest.useFakeTimers), which this moves.
 */

export const FIVE_FIELD_SCHEDULES: Array<string> = [
  "* * * * *",
  "*/2 * * * *",
  "*/5 * * * *",
  "*/7 * * * *",
  "15,45 * * * *",
  "0 * * * *",
  "30 * * * *",
  "0 */6 * * *",
  "0 0 * * *",
  "30 2 * * *",
  "0 9 * * 1-5",
  "0 0 1 * *",
];

export const OFFSETS_IN_A_MINUTE_MS: Array<number> = [
  0, 1, 999, 1000, 30000, 59000, 59999,
];

const MINUTE_IN_MS: number = 60 * 1000;

function cronParserNext(schedule: string, instantInMs: number): number {
  return CronParser.parseExpression(schedule, {
    currentDate: new Date(instantInMs),
  })
    .next()
    .toDate()
    .getTime();
}

/*
 * For each start and each of `minutes` minutes after it, every offset of
 * the minute: CronTab's answer against cron-parser's. Returns how many
 * instants were compared.
 */
export function expectKeptAnswersToBeCronParsers(data: {
  starts: Array<number>;
  minutes: number;
  schedules?: Array<string>;
}): number {
  const schedules: Array<string> = data.schedules || FIVE_FIELD_SCHEDULES;
  const differing: Array<string> = [];
  let compared: number = 0;

  CronTab.clearNextExecutionMemo();

  for (const start of data.starts) {
    for (let minute: number = 0; minute < data.minutes; minute++) {
      const minuteStart: number =
        Math.floor(start / MINUTE_IN_MS) * MINUTE_IN_MS + minute * MINUTE_IN_MS;

      for (const offset of OFFSETS_IN_A_MINUTE_MS) {
        const instant: number = minuteStart + offset;

        jest.setSystemTime(instant);

        for (const schedule of schedules) {
          const kept: number =
            CronTab.getNextExecutionTime(schedule).getTime();
          const expected: number = cronParserNext(schedule, instant);

          compared++;

          if (kept !== expected) {
            differing.push(
              `${schedule} at ${new Date(instant).toISOString()}: ${new Date(kept).toISOString()} instead of ${new Date(expected).toISOString()}`,
            );
          }
        }
      }
    }
  }

  expect(differing.slice(0, 10)).toEqual([]);

  return compared;
}

// The zone this jest worker runs in, as Intl reads it.
export function currentZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
