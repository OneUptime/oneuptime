import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import Monitor from "../../Models/DatabaseModels/Monitor";
import CronTab from "../CronTab";
import MonitoringIntervalUtil from "./MonitoringIntervalUtil";

/*
 * "Is this monitor being checked on time?" for the monitor overview.
 *
 * The cadence comes from the same reading of Monitor.monitoringInterval the
 * scheduler uses (MonitoringIntervalUtil), so a monitor storing a legacy
 * "5m" is judged against five minutes, as it is actually probed, and an
 * unreadable value falls back to one minute, as the scheduler does.
 */

export enum MonitorCheckFreshness {
  // A result arrived within the cadence plus grace.
  Fresh = "Fresh",
  // Nothing arrived for longer than the cadence plus grace.
  Stale = "Stale",
  // Never reported, and still young enough that this is expected.
  AwaitingFirstResult = "AwaitingFirstResult",
  // Not on a schedule right now (paused, no probe, or push-based).
  NotScheduled = "NotScheduled",
  // The results could not be read, so nothing can be said.
  Unknown = "Unknown",
}

export interface MonitorCheckFreshnessResult {
  freshness: MonitorCheckFreshness;
  // How far past due the check is, when Stale.
  overdueSeconds: number | null;
  // How old the newest result is, when there is one.
  resultAgeSeconds: number | null;
}

export interface MonitorScheduledRun {
  // The first run the schedule has after the given time.
  runAt: Date;
  // Seconds from that run to the one after it.
  spacingSeconds: number;
}

export interface MonitorResultLateness {
  // Seconds past the time the next result was due; negative while not due.
  lateSeconds: number;
  // How late it may be before it counts as overdue.
  graceSeconds: number;
}

const secondsBetween: (later: Date, earlier: Date) => number = (
  later: Date,
  earlier: Date,
): number => {
  return (later.getTime() - earlier.getTime()) / 1000;
};

const toWholeSeconds: (seconds: number) => number = (
  seconds: number,
): number => {
  return Math.max(0, Math.floor(seconds));
};

export default class MonitorCheckScheduleUtil {
  /*
   * The scheduler's fallback when an interval cannot be read (see
   * MonitorProbeService.resolveNextPingAt and the telemetry worker).
   */
  public static readonly DEFAULT_CADENCE_SECONDS: number = 60;

  /*
   * Seconds between two consecutive runs after `from`, or null when the
   * interval is empty or unreadable. Measured from the schedule rather than
   * parsed from the text, so a custom cron gets its real spacing.
   */
  public static getCadenceSeconds(data: {
    monitoringInterval: string | null | undefined;
    from: Date;
  }): number | null {
    try {
      const cron: string | null = MonitoringIntervalUtil.toCronOrNull(
        data.monitoringInterval,
      );

      if (!cron) {
        return null;
      }

      const runs: Array<Date> = CronTab.getNextExecutionTimes(
        cron,
        2,
        data.from,
      );
      const first: Date | undefined = runs[0];
      const second: Date | undefined = runs[1];

      if (!first || !second) {
        return null;
      }

      const cadence: number = secondsBetween(second, first);

      return cadence > 0 ? cadence : null;
    } catch {
      return null;
    }
  }

  public static resolveCadenceSeconds(data: {
    monitoringInterval: string | null | undefined;
    from: Date;
  }): number {
    return (
      MonitorCheckScheduleUtil.getCadenceSeconds(data) ??
      MonitorCheckScheduleUtil.DEFAULT_CADENCE_SECONDS
    );
  }

  /*
   * The first run the schedule has after `after`, and the spacing of the
   * schedule at that point. Null when the interval is empty or unreadable.
   */
  public static getNextRunAfter(data: {
    monitoringInterval: string | null | undefined;
    after: Date;
  }): MonitorScheduledRun | null {
    try {
      const cron: string | null = MonitoringIntervalUtil.toCronOrNull(
        data.monitoringInterval,
      );

      if (!cron) {
        return null;
      }

      const runs: Array<Date> = CronTab.getNextExecutionTimes(
        cron,
        2,
        data.after,
      );
      const first: Date | undefined = runs[0];
      const second: Date | undefined = runs[1];

      if (!first || !second) {
        return null;
      }

      const spacingSeconds: number = secondsBetween(second, first);

      return spacingSeconds > 0
        ? { runAt: first, spacingSeconds: spacingSeconds }
        : null;
    } catch {
      return null;
    }
  }

  /*
   * How late the result after `lastResultAt` is. Judged against the run the
   * schedule wanted after that result, not against the spacing around now:
   * a schedule with gaps ("every 5 minutes, 9 to 5 on weekdays") would
   * otherwise read as overdue through every night and weekend, because at
   * 20:00 its runs are still five minutes apart. Without a readable
   * interval the result is due one cadence after it arrived, as before.
   */
  public static getResultLateness(data: {
    lastResultAt: Date;
    monitoringInterval?: string | null | undefined;
    cadenceSeconds: number;
    now: Date;
  }): MonitorResultLateness {
    const nextRun: MonitorScheduledRun | null =
      MonitorCheckScheduleUtil.getNextRunAfter({
        monitoringInterval: data.monitoringInterval,
        after: data.lastResultAt,
      });

    if (nextRun) {
      return {
        lateSeconds: secondsBetween(data.now, nextRun.runAt),
        graceSeconds: MonitorCheckScheduleUtil.getGraceSeconds(
          nextRun.spacingSeconds,
        ),
      };
    }

    const cadenceSeconds: number = Number.isFinite(data.cadenceSeconds)
      ? Math.max(0, data.cadenceSeconds)
      : MonitorCheckScheduleUtil.DEFAULT_CADENCE_SECONDS;
    // A timestamp from the future (clock skew) counts as just now.
    const ageSeconds: number = Math.max(
      0,
      secondsBetween(data.now, data.lastResultAt),
    );

    return {
      lateSeconds: ageSeconds - cadenceSeconds,
      graceSeconds: MonitorCheckScheduleUtil.getGraceSeconds(cadenceSeconds),
    };
  }

  /*
   * "Every 5 minutes". An empty or unreadable interval is described as the
   * schedule it actually gets, which is every minute.
   */
  public static describeInterval(
    monitoringInterval: string | null | undefined,
  ): string {
    const cron: string | null =
      MonitoringIntervalUtil.toCronOrNull(monitoringInterval);

    if (!cron) {
      return "Every minute";
    }

    return CronTab.getHumanReadableDescription(cron) || "Every minute";
  }

  /*
   * How late a result may be before the overview calls it overdue. Probes
   * claim work in batches and a busy probe runs behind, so a check is not
   * late the second its cadence elapses: allow two cadences, and never less
   * than five minutes.
   */
  public static getGraceSeconds(cadenceSeconds: number): number {
    if (!Number.isFinite(cadenceSeconds) || cadenceSeconds < 0) {
      return 300;
    }

    return Math.max(300, 2 * cadenceSeconds);
  }

  /*
   * `now` must be on the server's clock: every time compared with it
   * (results, claims, creation) was stamped by the server, so a browser
   * clock that runs fast would otherwise read as every check being late.
   * With `monitoringInterval`, a result is due at the schedule's first run
   * after it (see getResultLateness); without it, one cadence after it.
   */
  public static getCheckFreshness(data: {
    isScheduled: boolean;
    isKnown: boolean;
    lastResultAt: Date | undefined;
    nextCheckAt: Date | undefined;
    cadenceSeconds: number;
    createdAt: Date | undefined;
    now: Date;
    monitoringInterval?: string | null | undefined;
  }): MonitorCheckFreshnessResult {
    const resultAgeSeconds: number | null = data.lastResultAt
      ? toWholeSeconds(secondsBetween(data.now, data.lastResultAt))
      : null;

    if (!data.isScheduled) {
      return {
        freshness: MonitorCheckFreshness.NotScheduled,
        overdueSeconds: null,
        resultAgeSeconds: resultAgeSeconds,
      };
    }

    if (!data.isKnown) {
      return {
        freshness: MonitorCheckFreshness.Unknown,
        overdueSeconds: null,
        resultAgeSeconds: resultAgeSeconds,
      };
    }

    const cadenceSeconds: number = Number.isFinite(data.cadenceSeconds)
      ? Math.max(0, data.cadenceSeconds)
      : MonitorCheckScheduleUtil.DEFAULT_CADENCE_SECONDS;
    const graceSeconds: number =
      MonitorCheckScheduleUtil.getGraceSeconds(cadenceSeconds);

    if (!data.lastResultAt) {
      /*
       * A monitor that has never reported is only "waiting" while it is
       * young. Once its first scheduled run after creation is further back
       * than the grace, the first result is overdue like any other.
       */
      if (data.createdAt) {
        const lateness: MonitorResultLateness =
          MonitorCheckScheduleUtil.getResultLateness({
            lastResultAt: data.createdAt,
            monitoringInterval: data.monitoringInterval,
            cadenceSeconds: cadenceSeconds,
            now: data.now,
          });

        if (lateness.lateSeconds > lateness.graceSeconds) {
          return {
            freshness: MonitorCheckFreshness.Stale,
            overdueSeconds: toWholeSeconds(lateness.lateSeconds),
            resultAgeSeconds: null,
          };
        }
      }

      return {
        freshness: MonitorCheckFreshness.AwaitingFirstResult,
        overdueSeconds: null,
        resultAgeSeconds: null,
      };
    }

    // A timestamp from the future (clock skew) counts as just now.
    const ageSeconds: number = Math.max(
      0,
      secondsBetween(data.now, data.lastResultAt),
    );
    const lateness: MonitorResultLateness =
      MonitorCheckScheduleUtil.getResultLateness({
        lastResultAt: data.lastResultAt,
        monitoringInterval: data.monitoringInterval,
        cadenceSeconds: cadenceSeconds,
        now: data.now,
      });

    if (lateness.lateSeconds > lateness.graceSeconds) {
      return {
        freshness: MonitorCheckFreshness.Stale,
        overdueSeconds: toWholeSeconds(lateness.lateSeconds),
        resultAgeSeconds: toWholeSeconds(ageSeconds),
      };
    }

    /*
     * The scheduler's own promise: if the next run was due longer ago than
     * the grace, the check is late even when the last result is recent (a
     * long cadence with a stuck probe).
     */
    if (data.nextCheckAt) {
      const pastDueSeconds: number = secondsBetween(data.now, data.nextCheckAt);

      if (pastDueSeconds > graceSeconds) {
        return {
          freshness: MonitorCheckFreshness.Stale,
          overdueSeconds: toWholeSeconds(pastDueSeconds),
          resultAgeSeconds: toWholeSeconds(ageSeconds),
        };
      }
    }

    return {
      freshness: MonitorCheckFreshness.Fresh,
      overdueSeconds: null,
      resultAgeSeconds: toWholeSeconds(ageSeconds),
    };
  }

  /*
   * The newest sign of life from any family: a probe result, a heartbeat, an
   * email, an agent report or a telemetry evaluation. The overview reloads
   * the evaluation log only when this moves.
   */
  public static getLatestSignalAt(data: {
    monitor: Monitor;
    probeLastResultAt: Date | undefined;
  }): Date | undefined {
    const candidates: Array<Date | undefined> = [
      MonitorCheckScheduleUtil.parseDate(data.probeLastResultAt),
      MonitorCheckScheduleUtil.parseDate(
        (
          data.monitor.incomingMonitorRequest as
            | { incomingRequestReceivedAt?: unknown }
            | undefined
        )?.incomingRequestReceivedAt,
      ),
      MonitorCheckScheduleUtil.parseDate(
        data.monitor.incomingEmailMonitorLastEmailReceivedAt,
      ),
      MonitorCheckScheduleUtil.parseDate(
        data.monitor.serverMonitorRequestReceivedAt,
      ),
      MonitorCheckScheduleUtil.parseDate(
        data.monitor.telemetryMonitorLastMonitorAt,
      ),
    ];

    let latest: Date | undefined = undefined;

    for (const candidate of candidates) {
      if (candidate && (!latest || candidate.getTime() > latest.getTime())) {
        latest = candidate;
      }
    }

    return latest;
  }

  /*
   * A timestamp as it may arrive in a JSON column or a probe response: a
   * Date, an ISO string, or a typed { _type: "DateTime", value } envelope.
   * Anything unreadable is undefined rather than an Invalid Date, which
   * would poison every comparison it touched.
   */
  public static parseDate(value: unknown): Date | undefined {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }

    try {
      let parsed: Date | undefined = undefined;

      if (value instanceof Date) {
        parsed = value;
      } else if (typeof value === "string" || typeof value === "object") {
        parsed = OneUptimeDate.fromString(value as string | JSONObject);
      } else if (typeof value === "number") {
        parsed = new Date(value);
      }

      if (!parsed || Number.isNaN(parsed.getTime())) {
        return undefined;
      }

      return parsed;
    } catch {
      return undefined;
    }
  }
}
