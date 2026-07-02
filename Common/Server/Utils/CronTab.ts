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
   * Best-effort probe interval (in minutes) for a monitoring cron
   * expression, computed as the gap between the next two executions.
   * Returns null for invalid crons or non-positive gaps so callers can
   * fall back gracefully. For irregular schedules this is the local
   * interval at the current time, which is a reasonable approximation.
   */
  @CaptureSpan()
  public static getIntervalInMinutes(crontab: string): number | null {
    try {
      const interval: CronExpression = CronParser.parseExpression(crontab);
      const first: Date = interval.next().toDate();
      const second: Date = interval.next().toDate();
      const diffInMinutes: number =
        (second.getTime() - first.getTime()) / (1000 * 60);
      return diffInMinutes > 0 ? diffInMinutes : null;
    } catch (error) {
      logger.error(error);
      return null;
    }
  }
}
