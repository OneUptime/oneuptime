import ObjectID from "../../Types/ObjectID";
import { JSONArray, JSONObject } from "../../Types/JSON";
import {
  MonitorUptimeDailyAggregate,
  UptimeDailyAggregate,
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../../Types/StatusPage/UptimeDailyAggregate";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import UptimeUtil from "../Uptime/UptimeUtil";
import moment from "moment-timezone";

/*
 * The zone buckets are cut in when nobody said otherwise. The server's SQL
 * has always defaulted to it, so an aggregate without a zone is a UTC one.
 */
export const DEFAULT_UPTIME_AGGREGATE_TIMEZONE: string = "UTC";

/*
 * Wire format for the uptime aggregate.
 *
 * Deliberately PLAIN: ISO strings and id strings, not this codebase's typed
 * JSON envelopes ({ _type: "DateTime", value: ... }).
 *
 * The envelopes are what made the thing this replaces unshippable. One
 * MonitorStatusTimeline row serializes to ~431 bytes almost entirely of
 * envelope, so the 254,550 rows a real status page matched in its 60-day
 * window came to ~105 MB - into a response held in a 500-entry in-memory
 * cache on the hottest public endpoint. The aggregate's whole purpose is to
 * be small, and wrapping every number in an envelope would give most of that
 * back.
 *
 * Both directions live here so the encoding is defined once. The client
 * parses with fromJSON; nothing should hand-roll either half.
 */
export default class UptimeDailyAggregateUtil {
  public static toJSON(aggregate: UptimeDailyAggregate): JSONObject {
    return {
      monitors: aggregate.monitors.map(
        (monitor: MonitorUptimeDailyAggregate): JSONObject => {
          return {
            monitorId: monitor.monitorId.toString(),
            buckets: monitor.buckets.map((bucket: UptimeDayBucket) => {
              return {
                bucketStart: bucket.bucketStart.toISOString(),
                bucketEnd: bucket.bucketEnd.toISOString(),
                daySeconds: bucket.daySeconds,
                coveredSeconds: bucket.coveredSeconds,
                statusDurations: bucket.statusDurations.map(
                  (duration: UptimeStatusDuration) => {
                    return {
                      monitorStatusId: duration.monitorStatusId.toString(),
                      seconds: duration.seconds,
                    };
                  },
                ),
              };
            }),
          };
        },
      ) as JSONArray,
      isComplete: aggregate.isComplete,
      completeFrom: aggregate.completeFrom
        ? aggregate.completeFrom.toISOString()
        : null,
      timezone: UptimeDailyAggregateUtil.getTimezone(aggregate),
    };
  }

  /**
   * The zone an aggregate's day buckets were cut in: the one it says, when
   * that is a zone moment knows, and UTC otherwise.
   *
   * Never the viewer's own zone. Falling back to "local" is exactly the
   * mismatch this field exists to remove - bars drawn on one set of day
   * boundaries and painted from buckets cut on another.
   */
  public static getTimezone(
    aggregate: UptimeDailyAggregate | undefined | null,
  ): string {
    const timezone: unknown = aggregate?.timezone;

    if (UptimeDailyAggregateUtil.isValidTimezone(timezone)) {
      return timezone as string;
    }

    return DEFAULT_UPTIME_AGGREGATE_TIMEZONE;
  }

  public static isValidTimezone(timezone: unknown): boolean {
    return (
      typeof timezone === "string" &&
      timezone.trim() !== "" &&
      moment.tz.zone(timezone) !== null
    );
  }

  /**
   * Parse the wire format.
   *
   * Total by design: a missing or malformed aggregate comes back as an empty
   * one rather than throwing. A status page that cannot parse its bars should
   * render them as "no data", which is honest, rather than failing to render
   * at all or - worse - falling back to something that looks like uptime.
   */
  public static fromJSON(
    json: JSONObject | undefined | null,
  ): UptimeDailyAggregate {
    const empty: UptimeDailyAggregate = {
      monitors: [],
      isComplete: true,
      completeFrom: null,
      timezone: DEFAULT_UPTIME_AGGREGATE_TIMEZONE,
    };

    if (!json || typeof json !== "object") {
      return empty;
    }

    const rawMonitors: unknown = json["monitors"];

    if (!Array.isArray(rawMonitors)) {
      return empty;
    }

    const monitors: Array<MonitorUptimeDailyAggregate> = [];

    for (const rawMonitor of rawMonitors) {
      const monitor: JSONObject = rawMonitor as JSONObject;
      const monitorId: unknown = monitor["monitorId"];

      if (typeof monitorId !== "string" || !monitorId) {
        continue;
      }

      const rawBuckets: unknown = monitor["buckets"];
      const buckets: Array<UptimeDayBucket> = [];

      if (Array.isArray(rawBuckets)) {
        for (const rawBucket of rawBuckets) {
          const bucket: JSONObject = rawBucket as JSONObject;

          const bucketStart: Date = new Date(bucket["bucketStart"] as string);
          const bucketEnd: Date = new Date(bucket["bucketEnd"] as string);

          if (
            Number.isNaN(bucketStart.getTime()) ||
            Number.isNaN(bucketEnd.getTime())
          ) {
            continue;
          }

          const rawDurations: unknown = bucket["statusDurations"];
          const statusDurations: Array<UptimeStatusDuration> = [];

          if (Array.isArray(rawDurations)) {
            for (const rawDuration of rawDurations) {
              const duration: JSONObject = rawDuration as JSONObject;
              const statusId: unknown = duration["monitorStatusId"];

              if (typeof statusId !== "string" || !statusId) {
                continue;
              }

              statusDurations.push({
                monitorStatusId: new ObjectID(statusId),
                seconds: Number(duration["seconds"]) || 0,
              });
            }
          }

          buckets.push({
            bucketStart: bucketStart,
            bucketEnd: bucketEnd,
            daySeconds: Number(bucket["daySeconds"]) || 0,
            coveredSeconds: Number(bucket["coveredSeconds"]) || 0,
            statusDurations: statusDurations,
          });
        }
      }

      monitors.push({
        monitorId: new ObjectID(monitorId),
        buckets: buckets,
      });
    }

    const completeFromRaw: unknown = json["completeFrom"];
    let completeFrom: Date | null = null;

    if (typeof completeFromRaw === "string" && completeFromRaw) {
      const parsed: Date = new Date(completeFromRaw);

      if (!Number.isNaN(parsed.getTime())) {
        completeFrom = parsed;
      }
    }

    return {
      monitors: monitors,
      /*
       * Absent means complete. An older server that does not send the field
       * has no cap in this path either, so treating it as incomplete would
       * grey out every bar on a perfectly healthy page.
       */
      isComplete: json["isComplete"] !== false,
      completeFrom: completeFrom,
      /*
       * Absent or unrecognised means UTC: a server that predates the field
       * cut its buckets in UTC, and drawing them on any other day boundaries
       * would pair every bar with the wrong reading.
       */
      timezone: UptimeDailyAggregateUtil.isValidTimezone(json["timezone"])
        ? (json["timezone"] as string)
        : DEFAULT_UPTIME_AGGREGATE_TIMEZONE,
    };
  }

  /**
   * The window the server actually bucketed: from the earliest bucket's
   * start (the window start, clipped) to the latest bucket's end (the
   * server's "now" when it built the payload). Null when there are no
   * buckets at all.
   *
   * A strip painted from these buckets must be drawn over THIS window, not
   * over one the browser works out for itself, or its first and last bars
   * can have no bucket and be painted as no data:
   *
   *   - The server's window is exactly N x 24 hours (its process runs in
   *     UTC). The browser's "N days ago" is N calendar days in the
   *     VISITOR's zone, an hour longer or shorter whenever a DST change
   *     falls in the window - enough, for an hour each day, to add a UTC day
   *     in front of the first bucket or to drop the first bucket.
   *
   *   - The payload is cached for 15 s and refetched every minute, and the
   *     visitor's clock can be wrong. Just after UTC midnight the browser
   *     already draws the new day while the newest bucket is still
   *     yesterday's, and today's bar - the one that was grey in the first
   *     place - has nothing to be painted from.
   *
   * Every monitor gets the same bucket grid (the SQL cross-joins monitors
   * with buckets), so one window serves every strip on the page.
   */
  public static getWindow(
    aggregate: UptimeDailyAggregate | undefined | null,
  ): { startDate: Date; endDate: Date } | null {
    let startTime: number | null = null;
    let endTime: number | null = null;

    for (const monitor of aggregate?.monitors || []) {
      for (const bucket of monitor.buckets) {
        const bucketStart: number = bucket.bucketStart.getTime();
        const bucketEnd: number = bucket.bucketEnd.getTime();

        if (startTime === null || bucketStart < startTime) {
          startTime = bucketStart;
        }

        if (endTime === null || bucketEnd > endTime) {
          endTime = bucketEnd;
        }
      }
    }

    if (startTime === null || endTime === null || endTime < startTime) {
      return null;
    }

    return { startDate: new Date(startTime), endDate: new Date(endTime) };
  }

  /**
   * The buckets for one monitor, or an empty list.
   */
  public static getBucketsForMonitor(
    aggregate: UptimeDailyAggregate | undefined | null,
    monitorId: ObjectID | string,
  ): Array<UptimeDayBucket> {
    if (!aggregate) {
      return [];
    }

    const wanted: string = monitorId.toString();

    const monitor: MonitorUptimeDailyAggregate | undefined =
      aggregate.monitors.find((m: MonitorUptimeDailyAggregate) => {
        return m.monitorId.toString() === wanted;
      });

    return monitor ? monitor.buckets : [];
  }

  /**
   * A monitor's uptime percentage over its day buckets, or null when the
   * buckets cover no time at all.
   *
   * This is the figure shown next to the bars, and it has to come from the
   * same place the bars do. It used to be computed from the timeline rows
   * the page receives, which arrive under a 10,000 row cap across every
   * monitor on the page. On a page with a flapping monitor that is a few
   * days of a sixty day window, so the percentage only saw those days: one
   * status page read 99.876% for a monitor whose sixty days, measured from
   * the buckets, were 99.667%.
   *
   * Downtime over the seconds actually COVERED, not over the window: a
   * monitor younger than the window is measured from its first reading, as
   * UptimeUtil.getTotalDowntimeInSeconds measures it from its first event.
   * Clamped to [0, 100], then rounded down to the precision the way every
   * other uptime figure is.
   */
  public static getUptimePercent(data: {
    buckets: Array<UptimeDayBucket>;
    downtimeMonitorStatusIds: Array<ObjectID | string>;
    precision: UptimePrecision;
  }): number | null {
    const downtimeIds: Set<string> = new Set<string>(
      data.downtimeMonitorStatusIds.map((id: ObjectID | string): string => {
        return id.toString();
      }),
    );

    let coveredSeconds: number = 0;
    let downtimeSeconds: number = 0;

    for (const bucket of data.buckets) {
      if (!(bucket.coveredSeconds > 0)) {
        continue;
      }

      coveredSeconds += bucket.coveredSeconds;

      let downtimeInBucket: number = 0;

      for (const duration of bucket.statusDurations) {
        if (
          duration.seconds > 0 &&
          downtimeIds.has(duration.monitorStatusId.toString())
        ) {
          downtimeInBucket += duration.seconds;
        }
      }

      // a bucket cannot be down for longer than it was watched.
      downtimeSeconds += Math.min(downtimeInBucket, bucket.coveredSeconds);
    }

    if (!(coveredSeconds > 0)) {
      return null;
    }

    const percent: number =
      ((coveredSeconds - downtimeSeconds) / coveredSeconds) * 100;

    return UptimeUtil.roundToPrecision({
      number: Math.min(100, Math.max(0, percent)),
      precision: data.precision,
    });
  }
}
