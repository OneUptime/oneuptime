import Span, { SpanStatus } from "../../Models/AnalyticsModels/Span";
import InBetween from "../BaseDatabase/InBetween";
import Includes from "../BaseDatabase/Includes";
import Query from "../BaseDatabase/Query";
import Search from "../BaseDatabase/Search";
import OneUptimeDate from "../Date";
import Dictionary from "../Dictionary";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

export default interface MonitorStepTraceMonitor {
  attributes: Dictionary<string | number | boolean>;
  spanStatuses: Array<SpanStatus>;
  telemetryServiceIds: Array<ObjectID>;
  lastXSecondsOfSpans: number;
  spanName: string;
}

export class MonitorStepTraceMonitorUtil {
  public static toQuery(
    monitorStepTraceMonitor: MonitorStepTraceMonitor,
  ): Query<Span> {
    const query: Query<Span> = {};

    if (
      monitorStepTraceMonitor.telemetryServiceIds &&
      monitorStepTraceMonitor.telemetryServiceIds.length > 0
    ) {
      query.serviceId = new Includes(
        monitorStepTraceMonitor.telemetryServiceIds,
      );
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

    if (monitorStepTraceMonitor.lastXSecondsOfSpans) {
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveSeconds(
        endDate,
        monitorStepTraceMonitor.lastXSecondsOfSpans * -1,
      );
      query.startTime = new InBetween(startDate, endDate);
    }

    return query;
  }

  public static getDefault(): MonitorStepTraceMonitor {
    return {
      attributes: {},
      spanName: "",
      spanStatuses: [],
      telemetryServiceIds: [],
      lastXSecondsOfSpans: 60,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepTraceMonitor {
    return {
      attributes:
        (json["attributes"] as Dictionary<string | number | boolean>) || {},
      spanName: json["spanName"] as string,
      spanStatuses: json["spanStatuses"] as Array<SpanStatus>,
      telemetryServiceIds: ObjectID.fromJSONArray(
        json["telemetryServiceIds"] as Array<JSONObject>,
      ),
      lastXSecondsOfSpans: json["lastXSecondsOfSpans"] as number,
    };
  }

  public static toJSON(monitor: MonitorStepTraceMonitor): JSONObject {
    return {
      attributes: monitor.attributes,
      spanName: monitor.spanName,
      spanStatuses: monitor.spanStatuses,
      telemetryServiceIds: ObjectID.toJSONArray(monitor.telemetryServiceIds),
      lastXSecondsOfSpans: monitor.lastXSecondsOfSpans,
    };
  }
}
