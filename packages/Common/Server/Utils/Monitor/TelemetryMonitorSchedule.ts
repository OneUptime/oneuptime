import CronParser, { CronExpression } from "cron-parser";
import ObjectID from "../../../Types/ObjectID";
import CronTab from "../CronTab";
import MonitoringIntervalValidator from "./MonitoringIntervalValidator";

/*
 * WHEN A TELEMETRY MONITOR IS EVALUATED (OneUptime issue #11060).
 *
 * A telemetry monitor's interval is a schedule: "* * * * *" for every
 * minute (and a monitor with none, as the Dashboard makes them), "*\/5 * *
 * * *" for every 5 minutes. Every monitor on a schedule used to be due at
 * the same instant - the start of each minute, of each 5 minutes - so every
 * evaluation in the installation started within the same few seconds and
 * read the telemetry store at once: one self-hosted install saw 94% of a
 * minute's metric reads start in its first 10 seconds, and ClickHouse above
 * 1,000% CPU while they ran.
 *
 * So each monitor runs at its own moment of its interval: its schedule's
 * runs, every one moved later by the same offset. The offset is the
 * monitor's place in its interval (getPhase, a hash of its ID, so the same
 * on every replica and after every restart) times how far its runs may be
 * moved (the spread):
 *
 *   - the time between two of its schedule's runs (its cadence), so a
 *     monitor checked every minute keeps to its own second of the minute,
 *     and one checked every 2 minutes is spread over both minutes;
 *   - and never more than TELEMETRY_MONITOR_MAX_SPREAD_MS, so a monitor
 *     checked every hour or every day is still checked within the first 5
 *     minutes of the hour or the day its schedule names.
 *
 * Moving every run by the same offset keeps the monitor's interval exactly:
 * its runs are as far apart as its schedule's are, each judging the window
 * that ends when it runs, so a window that covered the time between two
 * checks still does. Only when in its interval each check runs changes, and
 * by at most the spread - and so does when an incident or alert it opens
 * opens.
 *
 * A schedule faster than once a minute (a 6-field cron stored before
 * MonitoringIntervalValidator refused them) runs every minute, as it did
 * when the sweep ran once a minute.
 */

// The schedule of a monitor with no interval, or one that cannot be read.
export const EVERY_MINUTE_SCHEDULE: string = "* * * * *";

// The furthest into its interval a monitor's runs are moved.
export const TELEMETRY_MONITOR_MAX_SPREAD_MS: number = 5 * 60 * 1000;

// The shortest cadence a telemetry monitor is evaluated at.
export const TELEMETRY_MONITOR_MIN_CADENCE_MS: number = 60 * 1000;

/*
 * The instant a schedule's cadence is measured from: always the same one,
 * so a schedule whose runs are not evenly spaced ("0,10 * * * *") has the
 * same cadence in every process and at every time, and with it the same
 * offsets.
 */
export const CADENCE_REFERENCE_DATE: Date = new Date(
  Date.UTC(2026, 0, 5, 0, 0, 0),
);

// Runs read to find a schedule's cadence: the shortest gap between them.
const CADENCE_RUNS: number = 7;

const MAX_KEPT_READINGS: number = 1000;

export interface TelemetryMonitorScheduleReading {
  // The schedule the monitor runs on.
  cron: string;
  // The shortest time between two of its runs.
  cadenceInMs: number;
  // How far into its interval each of its runs may be moved.
  spreadInMs: number;
  /*
   * False when the monitor has an interval that cannot be read as a
   * schedule: it then runs every minute, as it always has.
   */
  isReadable: boolean;
}

const keptReadings: Map<string, TelemetryMonitorScheduleReading> = new Map();

const fnv1a32: (text: string) => number = (text: string): number => {
  let hash: number = 0x811c9dc5;

  for (let index: number = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
};

// Murmur3's finalizer: every bit of the ID moves every bit of the phase.
const mix32: (value: number) => number = (value: number): number => {
  let hash: number = value;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;

  return hash >>> 0;
};

export default class TelemetryMonitorSchedule {
  /*
   * The monitor's place in its interval, from 0 (its schedule's own run)
   * up to but not including 1 (just before the next): a hash of its ID,
   * evenly spread over the monitors of an installation.
   */
  public static getPhase(monitorId: ObjectID | string): number {
    const id: string = monitorId.toString().trim().toLowerCase();

    return mix32(fnv1a32(id)) / 0x100000000;
  }

  /*
   * What a monitor's interval means for when it runs. Read as the probe
   * scheduler reads one (MonitorProbeService.resolveNextPingAt): as a cron
   * expression first, then as a cadence ("5m", "Every 5 minutes"). None, or
   * one that cannot be read, is every minute.
   */
  public static read(
    monitoringInterval: string | null | undefined,
  ): TelemetryMonitorScheduleReading {
    const key: string = `${process.env["TZ"] || ""}\n${monitoringInterval ?? ""}`;
    const kept: TelemetryMonitorScheduleReading | undefined =
      keptReadings.get(key);

    if (kept) {
      return kept;
    }

    const reading: TelemetryMonitorScheduleReading =
      TelemetryMonitorSchedule.readNew(monitoringInterval);

    if (keptReadings.size >= MAX_KEPT_READINGS) {
      keptReadings.clear();
    }

    keptReadings.set(key, reading);

    return reading;
  }

  // How far into its interval the monitor's runs are moved, in ms.
  public static getOffsetInMs(data: {
    monitorId: ObjectID | string;
    reading: TelemetryMonitorScheduleReading;
  }): number {
    return Math.floor(
      TelemetryMonitorSchedule.getPhase(data.monitorId) *
        data.reading.spreadInMs,
    );
  }

  /*
   * The monitor's first run strictly after `after`: the first run of its
   * schedule after `after` less its offset, moved by its offset. Its runs
   * are its schedule's, each the same offset later, so they are exactly as
   * far apart as its schedule's.
   *
   * `onUnreadable` is told when the monitor has an interval that cannot be
   * read: it then runs every minute.
   */
  public static getNextRunAt(data: {
    monitorId: ObjectID | string;
    monitoringInterval: string | null | undefined;
    after: Date;
    onUnreadable?: (() => void) | undefined;
  }): Date {
    const reading: TelemetryMonitorScheduleReading =
      TelemetryMonitorSchedule.read(data.monitoringInterval);

    if (!reading.isReadable) {
      data.onUnreadable?.();
    }

    const offsetInMs: number = TelemetryMonitorSchedule.getOffsetInMs({
      monitorId: data.monitorId,
      reading: reading,
    });

    const from: Date = new Date(data.after.getTime() - offsetInMs);
    let run: Date;

    try {
      run = CronTab.getNextExecutionTimeAfter(reading.cron, from);
    } catch {
      // Read once already, so only an unlikely calendar walk ends here.
      run = CronTab.getNextExecutionTimeAfter(EVERY_MINUTE_SCHEDULE, from);
    }

    return new Date(run.getTime() + offsetInMs);
  }

  // Forget every kept reading (tests).
  public static clearReadings(): void {
    keptReadings.clear();
  }

  private static readNew(
    monitoringInterval: string | null | undefined,
  ): TelemetryMonitorScheduleReading {
    const everyMinute: (
      isReadable: boolean,
    ) => TelemetryMonitorScheduleReading = (
      isReadable: boolean,
    ): TelemetryMonitorScheduleReading => {
      return {
        cron: EVERY_MINUTE_SCHEDULE,
        cadenceInMs: TELEMETRY_MONITOR_MIN_CADENCE_MS,
        spreadInMs: Math.min(
          TELEMETRY_MONITOR_MIN_CADENCE_MS,
          TELEMETRY_MONITOR_MAX_SPREAD_MS,
        ),
        isReadable: isReadable,
      };
    };

    if (typeof monitoringInterval !== "string" || !monitoringInterval.trim()) {
      return everyMinute(true);
    }

    for (const cron of [
      monitoringInterval,
      MonitoringIntervalValidator.normalizeForRead(monitoringInterval),
    ]) {
      if (!cron) {
        continue;
      }

      const cadenceInMs: number | null =
        TelemetryMonitorSchedule.readCadenceInMs(cron);

      if (cadenceInMs === null) {
        continue;
      }

      // Faster than once a minute: every minute, as the sweep always ran it.
      if (cadenceInMs < TELEMETRY_MONITOR_MIN_CADENCE_MS) {
        return everyMinute(true);
      }

      return {
        cron: cron,
        cadenceInMs: cadenceInMs,
        spreadInMs: Math.min(cadenceInMs, TELEMETRY_MONITOR_MAX_SPREAD_MS),
        isReadable: true,
      };
    }

    return everyMinute(false);
  }

  /*
   * The shortest gap between a schedule's runs after CADENCE_REFERENCE_DATE,
   * or null when cron-parser cannot read it or it has no runs.
   */
  private static readCadenceInMs(cron: string): number | null {
    try {
      const expression: CronExpression = CronParser.parseExpression(cron, {
        currentDate: CADENCE_REFERENCE_DATE,
      });

      let previous: number = expression.next().toDate().getTime();
      let shortest: number = Number.POSITIVE_INFINITY;

      for (let run: number = 1; run < CADENCE_RUNS; run++) {
        const next: number = expression.next().toDate().getTime();
        shortest = Math.min(shortest, next - previous);
        previous = next;
      }

      return Number.isFinite(shortest) && shortest > 0 ? shortest : null;
    } catch {
      return null;
    }
  }
}
