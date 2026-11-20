import Span, { SpanStatus } from "../../Models/AnalyticsModels/Span";
import GreaterThanOrEqual from "../BaseDatabase/GreaterThanOrEqual";
import InBetween from "../BaseDatabase/InBetween";
import Includes from "../BaseDatabase/Includes";
import Query from "../BaseDatabase/Query";
import Search from "../BaseDatabase/Search";
import OneUptimeDate from "../Date";
import Dictionary from "../Dictionary";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import { MonitorStepLogMonitorUtil } from "./MonitorStepLogMonitor";

export default interface MonitorStepTraceMonitor {
  attributes: Dictionary<string | number | boolean>;
  spanStatuses: Array<SpanStatus>;
  telemetryServiceIds: Array<ObjectID>;
  /*
   * Stable telemetry entity keys (host / pod / container / ...) — scopes
   * the monitor to spans carrying any of these in their entityKeys column.
   * Optional: monitors saved before this field existed have it undefined.
   */
  entityKeys?: Array<string> | undefined;
  lastXSecondsOfSpans: number;
  spanName: string;
  /*
   * Only the spans that took at least this many milliseconds: a cold start
   * of five seconds or more (the RUM "Slow Cold Start" recommendation), a
   * checkout slower than its budget. A count of slow spans is how a Traces
   * monitor alerts on latency, since its criteria count spans.
   *
   * Optional: monitors saved before this field existed, and monitors that
   * leave it empty, count spans of any duration. Read it through
   * MonitorStepTraceMonitorUtil.getMinimumDurationInMs, which drops
   * anything that is not a positive number.
   */
  minimumDurationInMs?: number | undefined;
  /*
   * Attribute keys to group the matching spans by - e.g.
   * ["resource.app.installation.id"] for one group per install of a
   * mobile app (#9711). When set, the spans in the window are counted per
   * distinct combination of these attributes' values, the criteria is
   * evaluated per group, and each group raises (and resolves) its own
   * alert or incident, as a grouped Logs monitor's do.
   *
   * A grouped monitor whose criteria can match no span at all ("fewer than
   * 1") also counts the groups seen in the week before its window and quiet
   * in it, as 0: a device that stopped sending spans has no span to make
   * a group of (TraceGroupAbsence). Optional: monitors saved before this
   * field existed, and monitors that leave it empty, count every matching
   * span together, as they always have. Read it through
   * MonitorStepTraceMonitorUtil.getGroupByAttributes.
   */
  groupByAttributes?: Array<string> | undefined;
}

// Nanoseconds in a millisecond: spans store their duration in nanoseconds.
const NANOSECONDS_PER_MILLISECOND: number = 1_000_000;

export class MonitorStepTraceMonitorUtil {
  /*
   * `evaluateUntil` ends the window earlier than now: a telemetry check
   * judges only data OneUptime has finished reading while its ingest queue
   * is behind (ReceivingCoverage.planTelemetryEvaluation, issue #2825).
   */
  public static toQuery(
    monitorStepTraceMonitor: MonitorStepTraceMonitor,
    evaluateUntil?: Date | undefined,
  ): Query<Span> {
    const query: Query<Span> = {};

    if (
      monitorStepTraceMonitor.telemetryServiceIds &&
      monitorStepTraceMonitor.telemetryServiceIds.length > 0
    ) {
      query.primaryEntityId = new Includes(
        monitorStepTraceMonitor.telemetryServiceIds,
      );
    }

    // Compiles to hasAny(entityKeys, [...]) server-side. Undefined/empty is a no-op.
    if (
      monitorStepTraceMonitor.entityKeys &&
      monitorStepTraceMonitor.entityKeys.length > 0
    ) {
      query.entityKeys = new Includes(monitorStepTraceMonitor.entityKeys);
    }

    if (
      monitorStepTraceMonitor.attributes &&
      Object.keys(monitorStepTraceMonitor.attributes).length > 0
    ) {
      query.attributes = monitorStepTraceMonitor.attributes;
    }

    if (
      monitorStepTraceMonitor.spanStatuses &&
      monitorStepTraceMonitor.spanStatuses.length > 0
    ) {
      query.statusCode = new Includes(monitorStepTraceMonitor.spanStatuses);
    }

    if (monitorStepTraceMonitor.spanName) {
      query.name = new Search(monitorStepTraceMonitor.spanName);
    }

    const minimumDurationInMs: number | null =
      MonitorStepTraceMonitorUtil.getMinimumDurationInMs(
        monitorStepTraceMonitor,
      );

    if (minimumDurationInMs !== null) {
      query.durationUnixNano = new GreaterThanOrEqual<number>(
        Math.round(minimumDurationInMs * NANOSECONDS_PER_MILLISECOND),
      );
    }

    if (monitorStepTraceMonitor.lastXSecondsOfSpans) {
      const endDate: Date = evaluateUntil || OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveSeconds(
        endDate,
        monitorStepTraceMonitor.lastXSecondsOfSpans * -1,
      );
      query.startTime = new InBetween(startDate, endDate);
    }

    return query;
  }

  /*
   * The step's duration floor in milliseconds, or null when it has none: a
   * value left empty, zero, negative, not finite or not a number at all (a
   * step written through the API is stored without passing through
   * fromJSON, so this accepts a numeric string too).
   */
  public static getMinimumDurationInMs(
    monitorStepTraceMonitor: Pick<
      MonitorStepTraceMonitor,
      "minimumDurationInMs"
    >,
  ): number | null {
    const raw: unknown = monitorStepTraceMonitor.minimumDurationInMs;

    let value: number = NaN;

    if (typeof raw === "number") {
      value = raw;
    } else if (typeof raw === "string" && raw.trim().length > 0) {
      value = Number(raw);
    }

    return Number.isFinite(value) && value > 0 ? value : null;
  }

  /*
   * The keys this monitor groups its spans by, cleaned up as a Logs
   * monitor's are (MonitorStepLogMonitorUtil.getGroupByAttributes):
   * trimmed, de-duplicated, empty, over-long and "__proto__" keys dropped,
   * at most ten. An empty array means "not grouped".
   */
  public static getGroupByAttributes(
    monitorStepTraceMonitor:
      | Pick<MonitorStepTraceMonitor, "groupByAttributes">
      | undefined
      | null,
  ): Array<string> {
    return MonitorStepLogMonitorUtil.getGroupByAttributes({
      groupByAttributes: monitorStepTraceMonitor?.groupByAttributes,
    });
  }

  public static getDefault(): MonitorStepTraceMonitor {
    return {
      attributes: {},
      spanName: "",
      spanStatuses: [],
      telemetryServiceIds: [],
      entityKeys: [],
      lastXSecondsOfSpans: 60,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepTraceMonitor {
    const minimumDurationInMs: number | null =
      MonitorStepTraceMonitorUtil.getMinimumDurationInMs({
        minimumDurationInMs: json["minimumDurationInMs"] as number | undefined,
      });
    const groupByAttributes: Array<string> =
      MonitorStepTraceMonitorUtil.getGroupByAttributes({
        groupByAttributes: json["groupByAttributes"] as Array<string>,
      });

    return {
      attributes:
        (json["attributes"] as Dictionary<string | number | boolean>) || {},
      spanName: json["spanName"] as string,
      spanStatuses: json["spanStatuses"] as Array<SpanStatus>,
      telemetryServiceIds: ObjectID.fromJSONArray(
        json["telemetryServiceIds"] as Array<JSONObject>,
      ),
      entityKeys: (json["entityKeys"] as Array<string>) || [],
      lastXSecondsOfSpans: json["lastXSecondsOfSpans"] as number,
      // Left out when there is none, as a step saved before it existed is.
      ...(minimumDurationInMs !== null ? { minimumDurationInMs } : {}),
      ...(groupByAttributes.length > 0 ? { groupByAttributes } : {}),
    };
  }

  public static toJSON(monitor: MonitorStepTraceMonitor): JSONObject {
    const minimumDurationInMs: number | null =
      MonitorStepTraceMonitorUtil.getMinimumDurationInMs(monitor);
    const groupByAttributes: Array<string> =
      MonitorStepTraceMonitorUtil.getGroupByAttributes(monitor);

    return {
      attributes: monitor.attributes,
      spanName: monitor.spanName,
      spanStatuses: monitor.spanStatuses,
      telemetryServiceIds: ObjectID.toJSONArray(monitor.telemetryServiceIds),
      entityKeys: monitor.entityKeys || [],
      lastXSecondsOfSpans: monitor.lastXSecondsOfSpans,
      // Left out when there is none, as a step saved before it existed is.
      ...(minimumDurationInMs !== null ? { minimumDurationInMs } : {}),
      ...(groupByAttributes.length > 0 ? { groupByAttributes } : {}),
    };
  }
}
