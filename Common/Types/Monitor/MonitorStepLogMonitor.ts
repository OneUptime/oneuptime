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

export default interface MonitorStepLogMonitor {
  attributes: Dictionary<string | number | boolean>;
  body: string;
  severityTexts: Array<LogSeverity>;
  telemetryServiceIds: Array<ObjectID>;
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
      query.serviceId = new Includes(monitorStepLogMonitor.telemetryServiceIds);
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

    if (monitorStepLogMonitor.lastXSecondsOfLogs) {
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveSeconds(
        endDate,
        monitorStepLogMonitor.lastXSecondsOfLogs * -1,
      );
      query.time = new InBetween(startDate, endDate);
    }

    return query;
  }

  public static getDefault(): MonitorStepLogMonitor {
    return {
      attributes: {},
      body: "",
      severityTexts: [],
      telemetryServiceIds: [],
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
      lastXSecondsOfLogs: json["lastXSecondsOfLogs"] as number,
    };
  }

  public static toJSON(monitor: MonitorStepLogMonitor): JSONObject {
    return {
      attributes: monitor.attributes,
      body: monitor.body,
      severityTexts: monitor.severityTexts,
      telemetryServiceIds: ObjectID.toJSONArray(monitor.telemetryServiceIds),
      lastXSecondsOfLogs: monitor.lastXSecondsOfLogs,
    };
  }
}
