import { LlmConnectionPullState } from "../../../Types/LlmObservability/LlmConnectionRecords";
import { LlmUsageWindow } from "./LlmConnectorTypes";

/*
 * Provider accounts are read by UTC day: every provider here can total a day
 * (OpenAI and Anthropic cost only ever come by day), a budget is a UTC day,
 * and a day's figure stays one point however often it is read.
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

/*
 * How many of the most recent days are read again on every read, today
 * included: the providers keep adding to today and may still correct the
 * day or two before it (late usage, Anthropic's "occasionally longer"
 * delays, OpenAI cost lines that settle after the day ends).
 */
export const LLM_USAGE_REOPEN_DAYS: number = 3;

export default class LlmUsageDays {
  public static startOfUtcDay(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  public static addDays(day: Date, days: number): Date {
    return new Date(day.getTime() + days * DAY_IN_MS);
  }

  // Whole days from one day start to another.
  public static daysBetween(startDay: Date, endDay: Date): number {
    return Math.round((endDay.getTime() - startDay.getTime()) / DAY_IN_MS);
  }

  // Every day start in [startDay, endDay).
  public static listDays(startDay: Date, endDay: Date): Array<Date> {
    const days: Array<Date> = [];

    for (
      let day: Date = LlmUsageDays.startOfUtcDay(startDay);
      day.getTime() < endDay.getTime();
      day = LlmUsageDays.addDays(day, 1)
    ) {
      days.push(day);
    }

    return days;
  }

  // "YYYY-MM-DD" of a UTC day.
  public static toIsoDate(day: Date): string {
    return LlmUsageDays.startOfUtcDay(day).toISOString().substring(0, 10);
  }

  // A day start read back from a provider's Unix seconds; null if not one.
  public static fromUnixSeconds(value: unknown): Date | null {
    const seconds: number = Number(value);

    if (!Number.isFinite(seconds) || seconds <= 0) {
      return null;
    }

    return LlmUsageDays.startOfUtcDay(new Date(seconds * 1000));
  }

  // A day start read back from an RFC 3339 / ISO time; null if not one.
  public static fromIsoTime(value: unknown): Date | null {
    if (typeof value !== "string" || !value) {
      return null;
    }

    const time: number = Date.parse(value);

    if (!Number.isFinite(time)) {
      return null;
    }

    return LlmUsageDays.startOfUtcDay(new Date(time));
  }

  /*
   * The days the next read of a provider account covers.
   *
   *   - The first read goes back `backfillDays` days, today included.
   *   - Later reads start LLM_USAGE_REOPEN_DAYS before the last read's day,
   *     so days still changing are read again and days missed while the
   *     connection was off or failing are caught up - but never further back
   *     than the first read would go, so a connection switched off for a year
   *     does not try to read the year.
   *   - Every read ends after today.
   */
  public static nextWindow(data: {
    now: Date;
    state: LlmConnectionPullState;
    backfillDays: number;
  }): LlmUsageWindow {
    const today: Date = LlmUsageDays.startOfUtcDay(data.now);
    const endDay: Date = LlmUsageDays.addDays(today, 1);
    const earliest: Date = LlmUsageDays.addDays(
      today,
      -(Math.max(1, data.backfillDays) - 1),
    );

    const lastRead: Date | null = LlmUsageDays.fromIsoTime(data.state.cursor);

    if (!lastRead || lastRead.getTime() > today.getTime()) {
      return { startDay: earliest, endDay };
    }

    const reopened: Date = LlmUsageDays.addDays(
      lastRead,
      -(LLM_USAGE_REOPEN_DAYS - 1),
    );

    return {
      startDay:
        reopened.getTime() < earliest.getTime() ? earliest : reopened,
      endDay,
    };
  }
}
