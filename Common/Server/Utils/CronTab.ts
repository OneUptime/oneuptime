import BadDataException from "../../Types/Exception/BadDataException";
import CronParser, { CronExpression } from "cron-parser";
import logger from "./Logger";
import CaptureSpan from "./Telemetry/CaptureSpan";

/**
 * Map of human-readable interval labels to their cron expression equivalents.
 */
const HUMAN_READABLE_TO_CRON: Record<string, string> = {
  "every minute": "* * * * *",
  "every 2 minutes": "*/2 * * * *",
  "every 5 minutes": "*/5 * * * *",
  "every 10 minutes": "*/10 * * * *",
  "every 15 minutes": "*/15 * * * *",
  "every 30 minutes": "*/30 * * * *",
  "every hour": "0 * * * *",
  "every day": "0 0 * * *",
  "every week": "0 0 * * 0",
};

/**
 * Try to convert a human-readable interval string (e.g. "5 minutes")
 * to a cron expression.
 */
function tryConvertHumanReadableInterval(input: string): string | null {
  const lower = input.toLowerCase().trim();

  // Check exact matches first
  if (HUMAN_READABLE_TO_CRON[lower]) {
    return HUMAN_READABLE_TO_CRON[lower];
  }

  // Match patterns like "5 minutes", "30 minutes", "1 hour", "1 day", "1 week"
  const minutesMatch = /^(\d+)\s*minutes?$/i.exec(lower);
  if (minutesMatch) {
    const minutes = parseInt(minutesMatch[1], 10);
    if (minutes > 0 && minutes <= 59 && minutes % 5 === 0 || minutes === 1 || minutes === 2) {
      return `*/${minutes} * * * *`;
    }
  }

  const hoursMatch = /^(\d+)\s*hours?$/i.exec(lower);
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1], 10);
    if (hours === 1) {
      return "0 * * * *";
    }
  }

  const daysMatch = /^(\d+)\s*days?$/i.exec(lower);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    if (days === 1) {
      return "0 0 * * *";
    }
  }

  const weeksMatch = /^(\d+)\s*weeks?$/i.exec(lower);
  if (weeksMatch) {
    const weeks = parseInt(weeksMatch[1], 10);
    if (weeks === 1) {
      return "0 0 * * 0";
    }
  }

  return null;
}

export default class CronTab {
  @CaptureSpan()
  public static getNextExecutionTime(crontab: string): Date {
    try {
      let expression = crontab;

      // Try to convert human-readable intervals to cron expressions
      const converted = tryConvertHumanReadableInterval(crontab);
      if (converted) {
        expression = converted;
      }

      const interval: CronExpression = CronParser.parseExpression(expression);
      const nextExecutionTime: Date = interval.next().toDate();
      return nextExecutionTime;
    } catch (error) {
      logger.error(error);
      throw new BadDataException(`Invalid cron expression: ${crontab}`);
    }
  }
}