import BadDataException from "../../Types/Exception/BadDataException";
import CronParser, { CronExpression } from "cron-parser";
import logger from "./Logger";
import CaptureSpan from "./Telemetry/CaptureSpan";

export default class CronTab {
  @CaptureSpan()
  public static getNextExecutionTime(crontab: string): Date {
    try {
      const interval: CronExpression = CronParser.parseExpression(crontab);
      const nextExecutionTime: Date = interval.next().toDate();
      return nextExecutionTime;
    } catch (error) {
      logger.error(error);
      throw new BadDataException(`Invalid cron expression: ${crontab}`);
    }
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
