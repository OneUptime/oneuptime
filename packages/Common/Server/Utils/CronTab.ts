import BadDataException from "../../Types/Exception/BadDataException";
import CronParser, { CronExpression } from "cron-parser";
import logger from "./Logger";
import CaptureSpan from "./Telemetry/CaptureSpan";

/*
 * THE NEXT RUN OF A SCHEDULE, WORKED OUT ONCE A MINUTE.
 *
 * Every monitor check asks when the monitor is due next (the probe claim,
 * the telemetry monitor sweep), and cron-parser takes 40 to 270
 * microseconds to answer - it walks a calendar in luxon. Thousands of
 * monitors share a handful of schedules ("* * * * *" most of all), and a
 * schedule of five fields runs only at whole minutes, so its next run is the
 * same from any instant of one minute: the first run after the minute
 * starts (CronTabNextExecutionMemo.test.ts holds it to cron-parser at every
 * offset of a minute, in zones with half and quarter hour offsets and
 * across daylight saving changes). So the answer is kept for the rest of the
 * minute, per schedule and time zone, and worked out again in the next.
 *
 * Kept only where a local minute starts with a UTC one - every zone today,
 * not the local mean times of a century ago - and for at most
 * MAX_MEMO_ENTRIES schedules; a schedule with seconds (six fields) or
 * anything cron-parser refuses is never kept.
 */
const MAX_MEMO_ENTRIES: number = 1000;
const MINUTE_IN_MS: number = 60 * 1000;

interface NextExecutionMemo {
  minute: number;
  nextExecutionTimeInMs: number;
}

const nextExecutionMemo: Map<string, NextExecutionMemo> = new Map();

const WHITESPACE: RegExp = /\s+/;

function isWholeMinuteSchedule(crontab: string): boolean {
  return crontab.trim().split(WHITESPACE).length === 5;
}

export default class CronTab {
  @CaptureSpan()
  public static getNextExecutionTime(crontab: string): Date {
    const nowInMs: number = Date.now();
    const minute: number = Math.floor(nowInMs / MINUTE_IN_MS);
    const memoKey: string = `${process.env["TZ"] || ""}\n${crontab}`;
    const memo: NextExecutionMemo | undefined = nextExecutionMemo.get(memoKey);

    if (memo && memo.minute === minute) {
      return new Date(memo.nextExecutionTimeInMs);
    }

    let nextExecutionTime: Date;

    try {
      const interval: CronExpression = CronParser.parseExpression(crontab, {
        currentDate: new Date(nowInMs),
      });
      nextExecutionTime = interval.next().toDate();
    } catch (error) {
      logger.error(error);
      throw new BadDataException(`Invalid cron expression: ${crontab}`);
    }

    if (
      typeof crontab === "string" &&
      isWholeMinuteSchedule(crontab) &&
      new Date(minute * MINUTE_IN_MS).getSeconds() === 0
    ) {
      if (nextExecutionMemo.size >= MAX_MEMO_ENTRIES) {
        nextExecutionMemo.clear();
      }

      nextExecutionMemo.set(memoKey, {
        minute: minute,
        nextExecutionTimeInMs: nextExecutionTime.getTime(),
      });
    }

    return nextExecutionTime;
  }

  // Forget every kept answer (tests).
  public static clearNextExecutionMemo(): void {
    nextExecutionMemo.clear();
  }

  // How many schedules have an answer kept (tests).
  public static getNextExecutionMemoSize(): number {
    return nextExecutionMemo.size;
  }

  /**
   * Longest gap (in seconds) between two consecutive runs of this cron.
   *
   * Used to reason about how much data an evaluation window can possibly
   * contain: a monitor polled once every five minutes produces at most one
   * sample per five minutes, so "all values over the last 5 minutes" can
   * never be backed by more than one sample. Callers use this to decide
   * whether a window is actually covered by data or is merely still
   * filling up.
   *
   * The *longest* gap is deliberate. Irregular expressions (say
   * `0,1,30 * * * *`) have both very short and very long gaps; taking the
   * shortest would make callers demand data at a cadence the cron does not
   * actually deliver, and they would wait forever.
   *
   * Returns null when the expression is missing or unparseable so callers
   * can fall back to inferring the cadence from the data itself.
   */
  @CaptureSpan()
  public static getIntervalInSeconds(
    crontab: string | undefined | null,
    referenceDate?: Date | undefined,
  ): number | null {
    if (!crontab) {
      return null;
    }

    try {
      const interval: CronExpression = CronParser.parseExpression(crontab, {
        currentDate: referenceDate || new Date(),
      });

      /*
       * Six executions -> five gaps. Enough to cover a full hour-wrap for
       * every interval offered in the UI without walking the schedule far
       * into the future.
       */
      const executionTimes: Array<Date> = [];

      for (let i: number = 0; i < 6; i++) {
        executionTimes.push(interval.next().toDate());
      }

      let longestGapInSeconds: number = 0;

      for (let i: number = 1; i < executionTimes.length; i++) {
        const gapInSeconds: number =
          (executionTimes[i]!.getTime() - executionTimes[i - 1]!.getTime()) /
          1000;

        if (gapInSeconds > longestGapInSeconds) {
          longestGapInSeconds = gapInSeconds;
        }
      }

      if (longestGapInSeconds <= 0) {
        return null;
      }

      return longestGapInSeconds;
    } catch (error) {
      /*
       * Debug rather than error: this runs on the criteria-evaluation hot
       * path, and monitors created before the interval was a cron (or
       * through a Terraform example using the "Every 5 minutes" label) would
       * otherwise log on every single check. Callers treat null as "cadence
       * unknown" and fall back to inferring it from the data.
       */
      logger.debug(error);
      return null;
    }
  }
}
