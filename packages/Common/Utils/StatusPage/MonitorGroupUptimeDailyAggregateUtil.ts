import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  MonitorGroupUptimeDaily,
  MonitorGroupUptimeDailyAggregate,
  UptimeDayBucket,
} from "../../Types/StatusPage/UptimeDailyAggregate";
import UptimeDailyAggregateUtil from "./UptimeDailyAggregateUtil";

/*
 * Each monitor group's day buckets on a status page: the overview payload's
 * `monitorGroupUptimeDailyAggregate`.
 *
 *   {
 *     "monitorGroups": [
 *       { "monitorGroupId": "...", "buckets": [ ...as uptimeDailyAggregate's... ] }
 *     ],
 *     "timezone": "Asia/Shanghai"
 *   }
 *
 * A group's bucket says how long the GROUP spent in each status that day -
 * the worst status among its monitors at each instant - so its durations add
 * up to the time at least one of its monitors was recorded that day, and
 * never to more than the day (issue #6697). The buckets are cut on the same
 * grid, in the same zone, as the monitors' uptimeDailyAggregate.
 *
 * PLAIN on purpose, like UptimeDailyAggregateUtil's format (whose bucket
 * encoding this shares): ISO strings, numbers and id strings, none of the
 * typed JSON envelopes. Both directions live here so the encoding is defined
 * once.
 */
export default class MonitorGroupUptimeDailyAggregateUtil {
  /**
   * The project's statuses in the order a monitor group's day is merged by,
   * the worst LAST: every status that does not count as downtime on the
   * page, then every one that does, each part in the project's order of
   * statuses (priority), and by id where two share a priority.
   *
   * So at an instant two monitors disagree, the group takes the worse of
   * their statuses - the docs' "one monitor going Offline makes the whole
   * group Offline" - and a monitor in a downtime status always makes the
   * group down. With the page's downtime statuses at the top of the
   * project's order, which is how pages count Offline and Degraded, this is
   * the project's order unchanged. Otherwise a status above them that is not
   * down - a custom "Maintenance" - would hide another monitor's outage, and
   * the group's days would add up to less downtime than its uptime
   * percentage counts (MonitorStatusTimelineService.getMergedDowntimeSeconds).
   */
  public static getRankedMonitorStatusIds(data: {
    monitorStatuses: Array<MonitorStatus>;
    downtimeMonitorStatusIds: Array<ObjectID | string>;
  }): Array<string> {
    const downtimeIds: Set<string> = new Set<string>(
      data.downtimeMonitorStatusIds.map((id: ObjectID | string): string => {
        return id.toString();
      }),
    );

    const seen: Set<string> = new Set<string>();
    const statuses: Array<{
      id: string;
      isDowntime: boolean;
      priority: number;
    }> = [];

    for (const status of data.monitorStatuses) {
      const id: string = (status.id || status._id || "").toString();

      if (!id || seen.has(id)) {
        continue;
      }

      seen.add(id);
      statuses.push({
        id: id,
        isDowntime: downtimeIds.has(id),
        priority:
          typeof status.priority === "number" &&
          Number.isFinite(status.priority)
            ? status.priority
            : 0,
      });
    }

    statuses.sort(
      (
        a: { id: string; isDowntime: boolean; priority: number },
        b: { id: string; isDowntime: boolean; priority: number },
      ): number => {
        if (a.isDowntime !== b.isDowntime) {
          return a.isDowntime ? 1 : -1;
        }

        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }

        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      },
    );

    return statuses.map(
      (status: { id: string; isDowntime: boolean; priority: number }) => {
        return status.id;
      },
    );
  }

  public static toJSON(
    aggregate: MonitorGroupUptimeDailyAggregate,
  ): JSONObject {
    return {
      monitorGroups: aggregate.monitorGroups.map(
        (monitorGroup: MonitorGroupUptimeDaily): JSONObject => {
          return {
            monitorGroupId: monitorGroup.monitorGroupId.toString(),
            buckets: UptimeDailyAggregateUtil.bucketsToJSON(
              monitorGroup.buckets,
            ),
          };
        },
      ) as JSONArray,
      timezone: UptimeDailyAggregateUtil.getTimezone({
        monitors: [],
        isComplete: true,
        completeFrom: null,
        timezone: aggregate.timezone,
      }),
    };
  }

  /**
   * Parse the wire format.
   *
   * Total by design, like UptimeDailyAggregateUtil.fromJSON: a missing or
   * malformed field comes back empty, and an entry without a group id is
   * skipped. Empty is also what a server that predates the field sends, and
   * a group then keeps the bars it is painted from its rows.
   */
  public static fromJSON(
    json: JSONObject | undefined | null,
  ): MonitorGroupUptimeDailyAggregate {
    const timezone: string = UptimeDailyAggregateUtil.getTimezone({
      monitors: [],
      isComplete: true,
      completeFrom: null,
      timezone:
        json && typeof json === "object" && typeof json["timezone"] === "string"
          ? (json["timezone"] as string)
          : undefined,
    });

    const empty: MonitorGroupUptimeDailyAggregate = {
      monitorGroups: [],
      timezone: timezone,
    };

    if (!json || typeof json !== "object") {
      return empty;
    }

    const rawMonitorGroups: unknown = json["monitorGroups"];

    if (!Array.isArray(rawMonitorGroups)) {
      return empty;
    }

    const monitorGroups: Array<MonitorGroupUptimeDaily> = [];

    for (const rawMonitorGroup of rawMonitorGroups) {
      if (!rawMonitorGroup || typeof rawMonitorGroup !== "object") {
        continue;
      }

      const monitorGroup: JSONObject = rawMonitorGroup as JSONObject;
      const monitorGroupId: unknown = monitorGroup["monitorGroupId"];

      if (typeof monitorGroupId !== "string" || !monitorGroupId) {
        continue;
      }

      monitorGroups.push({
        monitorGroupId: new ObjectID(monitorGroupId),
        buckets: UptimeDailyAggregateUtil.bucketsFromJSON(
          monitorGroup["buckets"],
        ),
      });
    }

    return {
      monitorGroups: monitorGroups,
      timezone: timezone,
    };
  }

  /**
   * One monitor group's buckets, or undefined when the aggregate has none
   * for it - a server that predates them, or a group whose resource shows
   * neither its history nor its uptime. Undefined rather than empty, so a
   * caller can tell "no reading" (paint from the rows) from a reading of
   * days nothing was recorded on (no data).
   */
  public static getBucketsForMonitorGroup(
    aggregate: MonitorGroupUptimeDailyAggregate | undefined | null,
    monitorGroupId: ObjectID | string,
  ): Array<UptimeDayBucket> | undefined {
    if (!aggregate) {
      return undefined;
    }

    const wanted: string = monitorGroupId.toString();

    return aggregate.monitorGroups.find(
      (monitorGroup: MonitorGroupUptimeDaily) => {
        return monitorGroup.monitorGroupId.toString() === wanted;
      },
    )?.buckets;
  }

  /*
   * The window every group's buckets cover together, as
   * UptimeDailyAggregateUtil.getWindow reads the monitors': null when there
   * are no buckets at all.
   */
  public static getWindow(
    aggregate: MonitorGroupUptimeDailyAggregate | undefined | null,
  ): { startDate: Date; endDate: Date } | null {
    return UptimeDailyAggregateUtil.getWindow({
      monitors: (aggregate?.monitorGroups || []).map(
        (monitorGroup: MonitorGroupUptimeDaily) => {
          return {
            monitorId: monitorGroup.monitorGroupId,
            buckets: monitorGroup.buckets,
          };
        },
      ),
      isComplete: true,
      completeFrom: null,
      timezone: aggregate?.timezone,
    });
  }
}
