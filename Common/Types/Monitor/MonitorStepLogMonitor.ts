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
      telemetryServiceId: ObjectID.toJSONArray(monitor.telemetryServiceIds),
      lastXSecondsOfLogs: monitor.lastXSecondsOfLogs,
    };
  }
}
