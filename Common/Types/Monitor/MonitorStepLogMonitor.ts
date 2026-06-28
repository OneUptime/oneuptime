import Log from "../../Models/AnalyticsModels/Log";
import InBetween from "../BaseDatabase/InBetween";
import Includes from "../BaseDatabase/Includes";
import Query from "../BaseDatabase/Query";
import Search from "../BaseDatabase/Search";
import OneUptimeDate from "../Date";
import Dictionary from "../Dictionary";
import { JSONObject } from "../JSON";
import LogSeverity from "../Log/LogSeverity";
import ObjectID from "../ObjectID";
import {
  DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
  clampTelemetryMonitorWindowSeconds,
} from "./TelemetryMonitorWindow";

export default interface MonitorStepLogMonitor {
  attributes: Dictionary<string | number | boolean>;
  body: string;
  severityTexts: Array<LogSeverity>;
  telemetryServiceIds: Array<ObjectID>;
  /*
   * Stable telemetry entity keys (host / pod / container / ...) — scopes
   * the monitor to logs carrying any of these in their entityKeys column.
   * Optional: monitors saved before this field existed have it undefined.
   */
  entityKeys?: Array<string> | undefined;
  lastXSecondsOfLogs: number;
}

export class MonitorStepLogMonitorUtil {
  public static toQuery(
    monitorStepLogMonitor: MonitorStepLogMonitor,
  ): Query<Log> {
    const query: Query<Log> = {};

    if (
      monitorStepLogMonitor.telemetryServiceIds &&
      monitorStepLogMonitor.telemetryServiceIds.length > 0
    ) {
      query.primaryEntityId = new Includes(
        monitorStepLogMonitor.telemetryServiceIds,
      );
    }

    // Compiles to hasAny(entityKeys, [...]) server-side. Undefined/empty is a no-op.
    if (
      monitorStepLogMonitor.entityKeys &&
      monitorStepLogMonitor.entityKeys.length > 0
    ) {
      query.entityKeys = new Includes(monitorStepLogMonitor.entityKeys);
    }

    if (
      monitorStepLogMonitor.attributes &&
      Object.keys(monitorStepLogMonitor.attributes).length > 0
    ) {
      query.attributes = monitorStepLogMonitor.attributes;
    }

    if (
      monitorStepLogMonitor.severityTexts &&
      monitorStepLogMonitor.severityTexts.length > 0
    ) {
      query.severityText = new Includes(monitorStepLogMonitor.severityTexts);
    }

    if (monitorStepLogMonitor.body) {
      query.body = new Search(monitorStepLogMonitor.body);
    }

    /*
     * Always apply a bounded rolling-time window. clampTelemetryMonitorWindowSeconds
     * coalesces a missing / zero / invalid value to a safe default and caps an
     * absurdly large one, so the count() can never become an unbounded full-table
     * scan (see TelemetryMonitorWindow).
     */
    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.addRemoveSeconds(
      endDate,
      clampTelemetryMonitorWindowSeconds(
        monitorStepLogMonitor.lastXSecondsOfLogs,
      ) * -1,
    );
    query.time = new InBetween(startDate, endDate);

    return query;
  }

  public static getDefault(): MonitorStepLogMonitor {
    return {
      attributes: {},
      body: "",
      severityTexts: [],
      telemetryServiceIds: [],
      entityKeys: [],
      lastXSecondsOfLogs: 60,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepLogMonitor {
    return {
      attributes:
        (json["attributes"] as Dictionary<string | number | boolean>) || {},
      body: json["body"] as string,
      severityTexts: json["severityTexts"] as Array<LogSeverity>,
      telemetryServiceIds: ObjectID.fromJSONArray(
        json["telemetryServiceIds"] as Array<JSONObject>,
      ),
      entityKeys: (json["entityKeys"] as Array<string>) || [],
      lastXSecondsOfLogs:
        (json["lastXSecondsOfLogs"] as number | undefined) ||
        DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
    };
  }

  public static toJSON(monitor: MonitorStepLogMonitor): JSONObject {
    return {
      attributes: monitor.attributes,
      body: monitor.body,
      severityTexts: monitor.severityTexts,
      telemetryServiceIds: ObjectID.toJSONArray(monitor.telemetryServiceIds),
      entityKeys: monitor.entityKeys || [],
      lastXSecondsOfLogs: monitor.lastXSecondsOfLogs,
    };
  }
}
