import { Moment } from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../Types/JSON";
import {
  MonitorUptimeSummary,
  MonitorUptimeSummaryStatus,
  MonitorUptimeWindowKey,
  MonitorUptimeWindowTotal,
} from "../../Types/Monitor/MonitorUptimeSummary";
import ObjectID from "../../Types/ObjectID";
import {
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../../Types/StatusPage/UptimeDailyAggregate";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import { formatDurationCompact } from "../Slo/SloDuration";
import UptimeUtil from "../Uptime/UptimeUtil";

/*
 * Reading and presenting a monitor's uptime summary (see
 * Types/Monitor/MonitorUptimeSummary.ts for why it is a server aggregate).
 *
 * The rule every function here keeps: time that was never recorded is not
 * uptime. A window with no covered seconds is "No data", a window that is
 * only partly covered says so, and "100%" is reserved for a window with
 * exactly zero downtime.
 */

export type UptimeWindowKind = "Measured" | "NoData";

/*
 * Why the time in a window may not have been measured, even though the
 * status timeline covers it: the open timeline row keeps the last status
 * while monitoring is paused, while nothing is checking, and before the
 * first check has completed. See
 * MonitorOverviewPresentationUtil.getUptimeCaveat.
 */
export type MonitorUptimeCaveat = "paused" | "not-checking" | "no-results";

const CAVEAT_SUFFIX: Record<MonitorUptimeCaveat, string> = {
  paused: " · includes paused time",
  "not-checking": " · includes time with no checks running",
  "no-results": " · no check has completed yet",
};

export interface UptimeWindowPresentation {
  key: MonitorUptimeWindowKey;
  kind: UptimeWindowKind;
  // Null for NoData, so nobody can render a number that was never measured.
  uptimePercent: number | null;
  valueText: string;
  description: string;
  downtimeSeconds: number;
  coveredSeconds: number;
  windowSeconds: number;
  isPartial: boolean;
}

const WINDOW_KEYS: Array<string> = Object.values(MonitorUptimeWindowKey);

// Used to trim "99.950" to "99.95" and "98.000" to "98".
const TRAILING_ZEROS: RegExp = /0+$/;
const TRAILING_POINT: RegExp = /\.$/;

// A finite, non-negative number, or 0. Wire values are never trusted.
const toSeconds: (value: unknown) => number = (value: unknown): number => {
  const numeric: number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }

  return numeric;
};

const toDateOrNull: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const parsed: Date = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const durationsToJSON: (durations: Array<UptimeStatusDuration>) => JSONArray = (
  durations: Array<UptimeStatusDuration>,
): JSONArray => {
  return durations.map((duration: UptimeStatusDuration): JSONObject => {
    return {
      monitorStatusId: duration.monitorStatusId.toString(),
      seconds: duration.seconds,
    };
  });
};

const durationsFromJSON: (raw: unknown) => Array<UptimeStatusDuration> = (
  raw: unknown,
): Array<UptimeStatusDuration> => {
  const durations: Array<UptimeStatusDuration> = [];

  if (!Array.isArray(raw)) {
    return durations;
  }

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const statusId: unknown = (item as JSONObject)["monitorStatusId"];

    if (typeof statusId !== "string" || !statusId) {
      continue;
    }

    durations.push({
      monitorStatusId: new ObjectID(statusId),
      seconds: toSeconds((item as JSONObject)["seconds"]),
    });
  }

  return durations;
};

export default class MonitorUptimeSummaryUtil {
  /*
   * How much of a window may be missing before it is called partial. The
   * aggregate clips its last bucket to now(), and the request that produced
   * it takes a moment, so a fully covered window can come back a few seconds
   * short. A minute is well past that and well short of anything a person
   * would call a gap.
   */
  public static readonly COVERAGE_TOLERANCE_SECONDS: number = 60;

  /*
   * Adds day buckets up into one window. Durations are merged per status
   * and ordered largest first, which is the order a legend wants.
   */
  public static sumBuckets(data: {
    key: MonitorUptimeWindowKey;
    buckets: Array<UptimeDayBucket>;
    startDate: Date;
    endDate: Date;
  }): MonitorUptimeWindowTotal {
    let windowSeconds: number = 0;
    let coveredSeconds: number = 0;
    const secondsByStatusId: Map<string, number> = new Map<string, number>();

    for (const bucket of data.buckets || []) {
      windowSeconds += toSeconds(bucket.daySeconds);
      coveredSeconds += toSeconds(bucket.coveredSeconds);

      for (const duration of bucket.statusDurations || []) {
        const statusId: string = duration.monitorStatusId.toString();

        secondsByStatusId.set(
          statusId,
          (secondsByStatusId.get(statusId) || 0) + toSeconds(duration.seconds),
        );
      }
    }

    const statusDurations: Array<UptimeStatusDuration> = Array.from(
      secondsByStatusId.entries(),
    )
      .map((entry: [string, number]): UptimeStatusDuration => {
        return { monitorStatusId: new ObjectID(entry[0]), seconds: entry[1] };
      })
      .sort((a: UptimeStatusDuration, b: UptimeStatusDuration): number => {
        if (b.seconds !== a.seconds) {
          return b.seconds - a.seconds;
        }

        // A stable order for equal durations, so the legend does not shuffle.
        return a.monitorStatusId
          .toString()
          .localeCompare(b.monitorStatusId.toString());
      });

    return {
      key: data.key,
      startDate: data.startDate,
      endDate: data.endDate,
      windowSeconds: windowSeconds,
      coveredSeconds: coveredSeconds,
      statusDurations: statusDurations,
    };
  }

  /*
   * Downtime is time in any status that is not marked operational, which is
   * how the status page and the old overview counted it. A "Degraded" status
   * is downtime here.
   */
  public static getDowntimeStatusIds(
    statuses: Array<MonitorUptimeSummaryStatus>,
  ): Set<string> {
    const ids: Set<string> = new Set<string>();

    for (const status of statuses || []) {
      if (!status.isOperationalState) {
        ids.add(status.id.toString());
      }
    }

    return ids;
  }

  /*
   * `caveat` notes time the window counts but nothing measured. The older
   * `isPausedNow: true` is read as the "paused" caveat; a given `caveat`,
   * including null, wins over it.
   */
  public static getWindowPresentation(data: {
    window: MonitorUptimeWindowTotal | undefined;
    downtimeStatusIds: Set<string>;
    caveat?: MonitorUptimeCaveat | null | undefined;
    isPausedNow?: boolean | undefined;
  }): UptimeWindowPresentation | null {
    const window: MonitorUptimeWindowTotal | undefined = data.window;
    let caveat: MonitorUptimeCaveat | null = data.isPausedNow ? "paused" : null;

    if (data.caveat !== undefined) {
      caveat = data.caveat;
    }

    if (!window) {
      return null;
    }

    const coveredSeconds: number = toSeconds(window.coveredSeconds);
    const windowSeconds: number = toSeconds(window.windowSeconds);

    if (coveredSeconds < 1) {
      return {
        key: window.key,
        kind: "NoData",
        uptimePercent: null,
        valueText: "No data",
        description: "Nothing recorded in this window",
        downtimeSeconds: 0,
        coveredSeconds: coveredSeconds,
        windowSeconds: windowSeconds,
        // Partial describes a measured window; this one was not measured.
        isPartial: false,
      };
    }

    let downtimeSeconds: number = 0;

    for (const duration of window.statusDurations || []) {
      if (data.downtimeStatusIds.has(duration.monitorStatusId.toString())) {
        downtimeSeconds += toSeconds(duration.seconds);
      }
    }

    // Durations can never honestly exceed the time that was recorded.
    downtimeSeconds = Math.min(downtimeSeconds, coveredSeconds);

    /*
     * Multiply before dividing: (1999 / 2000) * 100 is 99.94999..., which
     * the floor in formatUptimePercent would turn into 99.949.
     */
    const uptimePercent: number =
      ((coveredSeconds - downtimeSeconds) * 100) / coveredSeconds;

    const isPartial: boolean =
      coveredSeconds <
      windowSeconds - MonitorUptimeSummaryUtil.COVERAGE_TOLERANCE_SECONDS;

    let description: string =
      downtimeSeconds > 0
        ? `Down ${formatDurationCompact(downtimeSeconds)}`
        : "No downtime";

    if (isPartial) {
      description += ` · measured over ${formatDurationCompact(coveredSeconds)}`;
    }

    if (caveat) {
      description += CAVEAT_SUFFIX[caveat];
    }

    return {
      key: window.key,
      kind: "Measured",
      uptimePercent: uptimePercent,
      valueText: MonitorUptimeSummaryUtil.formatUptimePercent({
        uptimePercent: uptimePercent,
        downtimeSeconds: downtimeSeconds,
      }),
      description: description,
      downtimeSeconds: downtimeSeconds,
      coveredSeconds: coveredSeconds,
      windowSeconds: windowSeconds,
      isPartial: isPartial,
    };
  }

  /*
   * "100%" only when downtime is exactly zero. Anything else is floored to
   * three decimals and capped at 99.999, so 43 seconds of downtime in 30
   * days can never round up into a perfect score.
   */
  public static formatUptimePercent(data: {
    uptimePercent: number;
    downtimeSeconds: number;
  }): string {
    if (!(data.downtimeSeconds > 0)) {
      return "100%";
    }

    const rawPercent: number = Number.isFinite(data.uptimePercent)
      ? data.uptimePercent
      : 0;

    /*
     * Strip floating-point noise before flooring, or 99.95 stored as
     * 99.94999999999999 would read 99.949.
     */
    const cleanPercent: number = Math.round(rawPercent * 1e9) / 1e9;

    let value: number = UptimeUtil.roundToPrecision({
      number: cleanPercent,
      precision: UptimePrecision.THREE_DECIMAL,
    });

    if (value >= 100) {
      value = 99.999;
    }

    value = Math.max(0, value);

    const text: string = value
      .toFixed(3)
      .replace(TRAILING_ZEROS, "")
      .replace(TRAILING_POINT, "");

    return `${text}%`;
  }

  public static getWindow(
    summary: MonitorUptimeSummary,
    key: MonitorUptimeWindowKey,
  ): MonitorUptimeWindowTotal | undefined {
    return (summary.windows || []).find((window: MonitorUptimeWindowTotal) => {
      return window.key === key;
    });
  }

  /*
   * Plain ISO and id strings, like UptimeDailyAggregateUtil, and for the
   * same reason: the typed JSON envelopes would triple the payload.
   */
  public static toJSON(summary: MonitorUptimeSummary): JSONObject {
    return {
      monitorId: summary.monitorId.toString(),
      timezone: summary.timezone,
      generatedAt: summary.generatedAt.toISOString(),
      startDate: summary.startDate.toISOString(),
      endDate: summary.endDate.toISOString(),
      buckets: summary.buckets.map((bucket: UptimeDayBucket): JSONObject => {
        return {
          bucketStart: bucket.bucketStart.toISOString(),
          bucketEnd: bucket.bucketEnd.toISOString(),
          daySeconds: bucket.daySeconds,
          coveredSeconds: bucket.coveredSeconds,
          statusDurations: durationsToJSON(bucket.statusDurations),
        };
      }),
      windows: summary.windows.map(
        (window: MonitorUptimeWindowTotal): JSONObject => {
          return {
            key: window.key,
            startDate: window.startDate.toISOString(),
            endDate: window.endDate.toISOString(),
            windowSeconds: window.windowSeconds,
            coveredSeconds: window.coveredSeconds,
            statusDurations: durationsToJSON(window.statusDurations),
          };
        },
      ),
      isComplete: summary.isComplete,
      completeFrom: summary.completeFrom
        ? summary.completeFrom.toISOString()
        : null,
      statuses: summary.statuses.map(
        (status: MonitorUptimeSummaryStatus): JSONObject => {
          return {
            id: status.id.toString(),
            name: status.name,
            color: status.color,
            isOperationalState: status.isOperationalState,
            isOfflineState: status.isOfflineState,
            priority: status.priority,
          };
        },
      ),
    };
  }

  /*
   * Total: never throws. Null when the payload is not a summary at all, so
   * the page can say "could not be read" instead of drawing an empty strip
   * that looks like a monitor with no history. Malformed parts inside a
   * valid summary are skipped one by one.
   */
  public static fromJSON(
    json: JSONObject | null | undefined,
  ): MonitorUptimeSummary | null {
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return null;
    }

    const monitorId: unknown = json["monitorId"];

    if (typeof monitorId !== "string" || !monitorId) {
      return null;
    }

    const startDate: Date | null = toDateOrNull(json["startDate"]);
    const endDate: Date | null = toDateOrNull(json["endDate"]);

    if (!startDate || !endDate) {
      return null;
    }

    const rawBuckets: unknown = json["buckets"];

    if (!Array.isArray(rawBuckets)) {
      return null;
    }

    const buckets: Array<UptimeDayBucket> = [];

    for (const rawBucket of rawBuckets) {
      if (!rawBucket || typeof rawBucket !== "object") {
        continue;
      }

      const bucket: JSONObject = rawBucket as JSONObject;
      const bucketStart: Date | null = toDateOrNull(bucket["bucketStart"]);
      const bucketEnd: Date | null = toDateOrNull(bucket["bucketEnd"]);

      if (!bucketStart || !bucketEnd) {
        continue;
      }

      buckets.push({
        bucketStart: bucketStart,
        bucketEnd: bucketEnd,
        daySeconds: toSeconds(bucket["daySeconds"]),
        coveredSeconds: toSeconds(bucket["coveredSeconds"]),
        statusDurations: durationsFromJSON(bucket["statusDurations"]),
      });
    }

    const windows: Array<MonitorUptimeWindowTotal> = [];
    const rawWindows: unknown = json["windows"];

    if (Array.isArray(rawWindows)) {
      for (const rawWindow of rawWindows) {
        if (!rawWindow || typeof rawWindow !== "object") {
          continue;
        }

        const window: JSONObject = rawWindow as JSONObject;
        const key: unknown = window["key"];
        const windowStart: Date | null = toDateOrNull(window["startDate"]);
        const windowEnd: Date | null = toDateOrNull(window["endDate"]);

        if (
          typeof key !== "string" ||
          !WINDOW_KEYS.includes(key) ||
          !windowStart ||
          !windowEnd
        ) {
          continue;
        }

        windows.push({
          key: key as MonitorUptimeWindowKey,
          startDate: windowStart,
          endDate: windowEnd,
          windowSeconds: toSeconds(window["windowSeconds"]),
          coveredSeconds: toSeconds(window["coveredSeconds"]),
          statusDurations: durationsFromJSON(window["statusDurations"]),
        });
      }
    }

    const statuses: Array<MonitorUptimeSummaryStatus> = [];
    const rawStatuses: unknown = json["statuses"];

    if (Array.isArray(rawStatuses)) {
      for (const rawStatus of rawStatuses) {
        if (!rawStatus || typeof rawStatus !== "object") {
          continue;
        }

        const status: JSONObject = rawStatus as JSONObject;
        const id: unknown = status["id"];
        const name: unknown = status["name"];

        if (typeof id !== "string" || !id || typeof name !== "string") {
          continue;
        }

        const priority: unknown = status["priority"];

        statuses.push({
          id: new ObjectID(id),
          name: name,
          color: typeof status["color"] === "string" ? status["color"] : "",
          isOperationalState: status["isOperationalState"] === true,
          isOfflineState: status["isOfflineState"] === true,
          priority:
            typeof priority === "number" && Number.isFinite(priority)
              ? priority
              : null,
        });
      }
    }

    return {
      monitorId: new ObjectID(monitorId),
      timezone:
        typeof json["timezone"] === "string" && json["timezone"]
          ? (json["timezone"] as string)
          : "UTC",
      generatedAt: toDateOrNull(json["generatedAt"]) || endDate,
      startDate: startDate,
      endDate: endDate,
      buckets: buckets,
      windows: windows,
      /*
       * Absent means complete, as in UptimeDailyAggregateUtil: only an
       * explicit false greys out the older bars.
       */
      isComplete: json["isComplete"] !== false,
      completeFrom: toDateOrNull(json["completeFrom"]),
      statuses: statuses,
    };
  }

  /*
   * The zone the day buckets are cut in. Missing means UTC; anything that
   * is not an IANA name is refused rather than silently read as UTC, because
   * a caller who sent "Europe/Lodnon" would otherwise get bars that are off
   * by an hour and no hint why. The canonical spelling is returned, so the
   * value handed to the database is always one it knows.
   */
  public static parseTimezone(raw: unknown): string {
    if (typeof raw !== "string") {
      return "UTC";
    }

    const trimmed: string = raw.trim();

    if (!trimmed) {
      return "UTC";
    }

    let zoneName: string | null = null;

    try {
      zoneName = Moment.tz.zone(trimmed)?.name || null;
    } catch {
      zoneName = null;
    }

    if (!zoneName) {
      throw new BadDataException(
        "timezone must be an IANA time zone name, for example Europe/London.",
      );
    }

    return zoneName;
  }

  /*
   * The zone to cut day buckets in, as one parseTimezone accepts. A browser
   * can carry newer zone data than the bundled moment-timezone (for example
   * America/Coyhaique, added in tzdata 2025b); the server would refuse such
   * a zone on every load, so it is swapped for moment's own guess, which
   * matches the browser's offsets from the data it has. The page labels
   * days with moment too, so both cut days on the same boundaries. UTC is
   * the last resort.
   */
  public static getBrowserTimezone(): string {
    let zone: string | undefined = undefined;

    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = undefined;
    }

    const known: string | null = MonitorUptimeSummaryUtil.toKnownZone(zone);

    if (known) {
      return known;
    }

    try {
      return (
        MonitorUptimeSummaryUtil.toKnownZone(Moment.tz.guess(true)) || "UTC"
      );
    } catch {
      return "UTC";
    }
  }

  private static toKnownZone(zone: string | undefined): string | null {
    if (!zone) {
      return null;
    }

    try {
      return Moment.tz.zone(zone) ? zone : null;
    } catch {
      return null;
    }
  }
}
