import BadDataException from "../../Types/Exception/BadDataException";
import CronParser, { CronExpression } from "cron-parser";
import logger from "./Logger";
import CaptureSpan from "./Telemetry/CaptureSpan";

/**
 * Converts common human-readable interval strings to cron expressions.
 * Handles values like "1 minute", "5 minutes", "1 hour", "1 day", etc.
 */
function normalizeCronExpression(input: string): string {
  const trimmed = input.trim();

  // If it already looks like a cron expression (contains spaces and no letters
  // other than possible day-of-week names), return as-is
  if (trimmed.includes(" ") && !/^\d+\s+(minute|hour|day|week)/i.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(
    /^(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks)$/i,
  );
  if (!match) {
    return trimmed;
  }

  const value: number = parseInt(match[1], 10);
  const unit: string = match[2].toLowerCase();

  switch (unit) {
    case "minute":
    case "minutes":
      if (value === 1) {
        return "* * * * *";
      }
      return `*/${value} * * * *`;
    case "hour":
    case "hours":
      if (value === 1) {
        return "0 * * * *";
      }
      return `0 */${value} * * *`;
    case "day":
    case "days":
      if (value === 1) {
        return "0 0 * * *";
      }
      return `0 0 */${value} * *`;
    case "week":
    case "weeks":
      if (value === 1) {
        return "0 0 * * 0";
      }
      // For multi-week intervals, use a weekly cron as best-effort approximation
      return "0 0 * * 0";
    default:
      return trimmed;
  }
}

export default class CronTab {
  @CaptureSpan()
  public static getNextExecutionTime(crontab: string): Date {
    try {
      const normalizedCrontab: string = normalizeCronExpression(crontab);
      const interval: CronExpression = CronParser.parseExpression(
        normalizedCrontab,
      );
      const nextExecutionTime: Date = interval.next().toDate();
      return nextExecutionTime;
    } catch (error) {
      logger.error(error);
      throw new BadDataException(`Invalid cron expression: ${crontab}`);
    }
  }
}