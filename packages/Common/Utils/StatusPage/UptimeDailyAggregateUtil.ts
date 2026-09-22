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

/*
 * What a monitor's day buckets add up to: the seconds something was recorded
 * for it, and how many of those were spent in a downtime status.
 */
export interface UptimeDailyAggregateTotals {
  coveredSeconds: number;
  downtimeSeconds: number;
}

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
    };
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
    };
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
   * Covered and downtime seconds over a monitor's day buckets.
   *
   * The server's uptime report reads its downtime from here, and its
   * percentage through getUptimePercent below, so the two figures on a
   * report row are always measured over the same seconds.
   *
   * A bucket's downtime is capped at its coverage: a bucket cannot be down
   * for longer than it was watched.
   */
  public static getTotals(data: {
    buckets: Array<UptimeDayBucket>;
    downtimeMonitorStatusIds: Array<ObjectID | string>;
  }): UptimeDailyAggregateTotals {
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

      downtimeSeconds += Math.min(downtimeInBucket, bucket.coveredSeconds);
    }

    return {
      coveredSeconds: coveredSeconds,
      downtimeSeconds: downtimeSeconds,
    };
  }

  /**
   * A monitor's uptime percentage over its day buckets, or null when the
   * buckets cover no time at all.
   *
   * The timeline rows this replaces arrive under a 10,000 row cap across
   * every monitor on a status page. On a page with a flapping monitor that
   * is a few days of a sixty day window, so a percentage computed from them
   * only saw those days: one status page read 99.876% for a monitor whose
   * sixty days, measured from the buckets, were 99.667%.
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
    const totals: UptimeDailyAggregateTotals =
      UptimeDailyAggregateUtil.getTotals({
        buckets: data.buckets,
        downtimeMonitorStatusIds: data.downtimeMonitorStatusIds,
      });

    if (!(totals.coveredSeconds > 0)) {
      return null;
    }

    const percent: number =
      ((totals.coveredSeconds - totals.downtimeSeconds) /
        totals.coveredSeconds) *
      100;

    return UptimeUtil.roundToPrecision({
      number: Math.min(100, Math.max(0, percent)),
      precision: data.precision,
    });
  }
}
