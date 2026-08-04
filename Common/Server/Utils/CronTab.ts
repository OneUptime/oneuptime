import BadDataException from "../../Types/Exception/BadDataException";
import CronParser, { CronExpression } from "cron-parser";
import logger from "./Logger";
import CaptureSpan from "./Telemetry/CaptureSpan";

export default class CronTab {
  /**
   * The next time the expression fires, strictly after `currentDate`
   * (defaults to now).
   *
   * Pass `currentDate` when scheduling a batch: every row in a batch should be
   * scheduled off one consistent clock, and the caller usually wants to nudge
   * the anchor forward slightly so a fire time that is milliseconds away is
   * skipped rather than scheduled. That matters for sub-minute monitoring
   * intervals, where computing from a raw "now" can land a nextPingAt 1ms in
   * the future and cause an immediate double-probe.
   */
  @CaptureSpan()
  public static getNextExecutionTime(
    crontab: string,
    currentDate?: Date | undefined,
  ): Date {
    try {
      const interval: CronExpression = currentDate
        ? CronParser.parseExpression(crontab, { currentDate: currentDate })
        : CronParser.parseExpression(crontab);
      const nextExecutionTime: Date = interval.next().toDate();
      return nextExecutionTime;
    } catch (error) {
      logger.error(error);
      throw new BadDataException(`Invalid cron expression: ${crontab}`);
    }
  }
}
