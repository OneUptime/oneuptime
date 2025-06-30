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
}
