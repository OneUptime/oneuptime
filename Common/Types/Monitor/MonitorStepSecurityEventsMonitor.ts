import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import InBetween from "../BaseDatabase/InBetween";
import Includes from "../BaseDatabase/Includes";
import Query from "../BaseDatabase/Query";
import Search from "../BaseDatabase/Search";
import OneUptimeDate from "../Date";
import Dictionary from "../Dictionary";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import OcsfSeverity from "../SecurityEvent/OcsfSeverity";

export default interface MonitorStepSecurityEventsMonitor {
  attributes: Dictionary<string | number | boolean>;
  messageContains: string;
  severityNames: Array<OcsfSeverity>;
  classNames: Array<string>;
  telemetryServiceIds: Array<ObjectID>;
  lastXSecondsOfEvents: number;
}

export class MonitorStepSecurityEventsMonitorUtil {
  public static toQuery(
    monitorStep: MonitorStepSecurityEventsMonitor,
  ): Query<SecurityEvent> {
    const query: Query<SecurityEvent> = {};

    if (
      monitorStep.telemetryServiceIds &&
      monitorStep.telemetryServiceIds.length > 0
    ) {
      query.primaryEntityId = new Includes(monitorStep.telemetryServiceIds);
    }

    if (
      monitorStep.attributes &&
      Object.keys(monitorStep.attributes).length > 0
    ) {
      query.attributes = monitorStep.attributes;
    }

    if (monitorStep.severityNames && monitorStep.severityNames.length > 0) {
      query.severityName = new Includes(monitorStep.severityNames);
    }

    if (monitorStep.classNames && monitorStep.classNames.length > 0) {
      query.className = new Includes(monitorStep.classNames);
    }

    if (monitorStep.messageContains) {
      query.message = new Search(monitorStep.messageContains);
    }

    if (monitorStep.lastXSecondsOfEvents) {
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveSeconds(
        endDate,
        monitorStep.lastXSecondsOfEvents * -1,
      );
      query.time = new InBetween(startDate, endDate);
    }

    return query;
  }

  public static getDefault(): MonitorStepSecurityEventsMonitor {
    return {
      attributes: {},
      messageContains: "",
      severityNames: [],
      classNames: [],
      telemetryServiceIds: [],
      lastXSecondsOfEvents: 60,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepSecurityEventsMonitor {
    return {
      attributes:
        (json["attributes"] as Dictionary<string | number | boolean>) || {},
      messageContains: (json["messageContains"] as string) || "",
      severityNames: (json["severityNames"] as Array<OcsfSeverity>) || [],
      classNames: (json["classNames"] as Array<string>) || [],
      telemetryServiceIds: ObjectID.fromJSONArray(
        json["telemetryServiceIds"] as Array<JSONObject>,
      ),
      lastXSecondsOfEvents: (json["lastXSecondsOfEvents"] as number) || 60,
    };
  }

  public static toJSON(monitor: MonitorStepSecurityEventsMonitor): JSONObject {
    return {
      attributes: monitor.attributes,
      messageContains: monitor.messageContains,
      severityNames: monitor.severityNames,
      classNames: monitor.classNames,
      telemetryServiceIds: ObjectID.toJSONArray(monitor.telemetryServiceIds),
      lastXSecondsOfEvents: monitor.lastXSecondsOfEvents,
    };
  }
}
