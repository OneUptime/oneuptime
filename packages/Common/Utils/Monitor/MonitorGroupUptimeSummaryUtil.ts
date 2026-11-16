import { JSONObject } from "../../Types/JSON";
import { MonitorGroupUptimeSummary } from "../../Types/Monitor/MonitorGroupUptimeSummary";
import ObjectID from "../../Types/ObjectID";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import UptimeDailyAggregateUtil from "../StatusPage/UptimeDailyAggregateUtil";
import UptimeUtil from "../Uptime/UptimeUtil";

/*
 * A monitor group's uptime history (Types/Monitor/MonitorGroupUptimeSummary,
 * issue #6886) on the wire, both directions in one place.
 *
 * PLAIN on purpose, like MonitorUptimeSummaryUtil and UptimeDailyAggregateUtil
 * (whose bucket encoding this shares): ISO strings, numbers and id strings,
 * none of the typed JSON envelopes, which would triple the payload.
 */

const toSeconds: (value: unknown) => number = (value: unknown): number => {
  const seconds: number = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

const toDateOrNull: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return null;
  }

  const date: Date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export default class MonitorGroupUptimeSummaryUtil {
  public static toJSON(summary: MonitorGroupUptimeSummary): JSONObject {
    return {
      monitorGroupId: summary.monitorGroupId.toString(),
      timezone: summary.timezone,
      generatedAt: summary.generatedAt.toISOString(),
      startDate: summary.startDate.toISOString(),
      endDate: summary.endDate.toISOString(),
      buckets: UptimeDailyAggregateUtil.bucketsToJSON(summary.buckets),
      coveredSeconds: summary.coveredSeconds,
      downtimeSeconds: summary.downtimeSeconds,
    };
  }

  /*
   * Total: never throws. Null when the payload is not a summary at all, so
   * the page can draw from the group's rows rather than an empty strip that
   * looks like a group with no history. A malformed bucket is skipped, and a
   * total that is not a positive number reads as none.
   */
  public static fromJSON(
    json: JSONObject | null | undefined,
  ): MonitorGroupUptimeSummary | null {
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return null;
    }

    const monitorGroupId: unknown = json["monitorGroupId"];

    if (typeof monitorGroupId !== "string" || !monitorGroupId) {
      return null;
    }

    const startDate: Date | null = toDateOrNull(json["startDate"]);
    const endDate: Date | null = toDateOrNull(json["endDate"]);

    if (!startDate || !endDate || !Array.isArray(json["buckets"])) {
      return null;
    }

    return {
      monitorGroupId: new ObjectID(monitorGroupId),
      timezone:
        typeof json["timezone"] === "string" && json["timezone"]
          ? (json["timezone"] as string)
          : "UTC",
      generatedAt: toDateOrNull(json["generatedAt"]) || endDate,
      startDate: startDate,
      endDate: endDate,
      buckets: UptimeDailyAggregateUtil.bucketsFromJSON(json["buckets"]),
      coveredSeconds: toSeconds(json["coveredSeconds"]),
      downtimeSeconds: toSeconds(json["downtimeSeconds"]),
    };
  }

  /*
   * The group's uptime over its days, or null when nothing was recorded in
   * them - its monitors off, or not checked yet - so the page shows no
   * percentage rather than the 100% that no time at all reads as.
   */
  public static getUptimePercent(data: {
    summary: MonitorGroupUptimeSummary;
    precision: UptimePrecision;
  }): number | null {
    return UptimeUtil.calculateUptimePercentOfCoveredSeconds({
      coveredSeconds: data.summary.coveredSeconds,
      downtimeSeconds: Math.min(
        data.summary.downtimeSeconds,
        data.summary.coveredSeconds,
      ),
      precision: data.precision,
    });
  }
}
