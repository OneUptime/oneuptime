import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import DataToProcess from "./DataToProcess";

/**
 * MonitorLogTimeUtil
 *
 * The "Monitored At" column of a monitor log should say when the check was
 * taken, not when the server got round to writing the row. Those two are the
 * same thing for a healthy monitor, but a failing check spends its whole retry
 * budget before reporting, so ingest time can be tens of seconds — historically
 * minutes — after the check actually ran. Reading the check's own timestamp
 * off the payload keeps the column honest.
 *
 * Probe clocks are not trusted blindly: a probe with a skewed clock could
 * otherwise write rows into the future or into a long-past ClickHouse
 * partition, so anything outside a sane window falls back to server time.
 */

// A check timestamp may not be ahead of server time by more than this.
export const MAX_MONITOR_LOG_CLOCK_SKEW_IN_MS: number = 60 * 1000;

/*
 * Nor further behind it than this. Generous enough to cover the slowest
 * legitimate check plus queue time, tight enough that a badly skewed probe
 * cannot scatter rows across old partitions.
 */
export const MAX_MONITOR_LOG_LAG_IN_MS: number = 30 * 60 * 1000;

export default class MonitorLogTimeUtil {
  /**
   * The moment to stamp a monitor log row with: the check's own `monitoredAt`
   * when the payload carries a usable one, and server time otherwise.
   */
  public static getMonitorLogTime(
    dataToProcess: DataToProcess | undefined,
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Date {
    const monitoredAt: Date | null = this.parseMonitoredAt(dataToProcess);

    if (!monitoredAt) {
      return now;
    }

    const skewInMs: number = monitoredAt.getTime() - now.getTime();

    if (skewInMs > MAX_MONITOR_LOG_CLOCK_SKEW_IN_MS) {
      // Ahead of the server — the probe's clock is wrong, not the server's.
      return now;
    }

    if (-skewInMs > MAX_MONITOR_LOG_LAG_IN_MS) {
      // Too stale to be a real check timestamp.
      return now;
    }

    return monitoredAt;
  }

  /**
   * `monitoredAt` reaches the server as JSON, so it can be a Date, an ISO
   * string or an epoch number depending on the path it took. Returns null for
   * payloads that carry no usable timestamp.
   */
  private static parseMonitoredAt(
    dataToProcess: DataToProcess | undefined,
  ): Date | null {
    const rawValue: unknown = (dataToProcess as JSONObject | undefined)?.[
      "monitoredAt"
    ];

    if (rawValue === undefined || rawValue === null) {
      return null;
    }

    if (rawValue instanceof Date) {
      return isNaN(rawValue.getTime()) ? null : rawValue;
    }

    if (typeof rawValue === "string" || typeof rawValue === "number") {
      const parsed: Date = new Date(rawValue);
      return isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
  }
}
