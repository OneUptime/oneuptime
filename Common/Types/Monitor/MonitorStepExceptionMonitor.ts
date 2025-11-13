import TelemetryException from "../../Models/DatabaseModels/TelemetryException";
import InBetween from "../BaseDatabase/InBetween";
import Includes from "../BaseDatabase/Includes";
import Query from "../BaseDatabase/Query";
import Search from "../BaseDatabase/Search";
import OneUptimeDate from "../Date";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

export default interface MonitorStepExceptionMonitor {
  telemetryServiceIds: Array<ObjectID>;
  exceptionTypes: Array<string>;
  message: string;
  includeResolved: boolean;
  includeArchived: boolean;
  lastXSecondsOfExceptions: number;
}

export class MonitorStepExceptionMonitorUtil {
  public static toQuery(
    monitorStepExceptionMonitor: MonitorStepExceptionMonitor,
  ): Query<TelemetryException> {
    const query: Query<TelemetryException> = {};

    if (
      monitorStepExceptionMonitor.telemetryServiceIds &&
      monitorStepExceptionMonitor.telemetryServiceIds.length > 0
    ) {
      query.telemetryServiceId = new Includes(
        monitorStepExceptionMonitor.telemetryServiceIds,
      );
    }

    if (
      monitorStepExceptionMonitor.exceptionTypes &&
      monitorStepExceptionMonitor.exceptionTypes.length > 0
    ) {
      query.exceptionType = new Includes(
        monitorStepExceptionMonitor.exceptionTypes,
      );
    }

    if (monitorStepExceptionMonitor.message) {
      query.message = new Search(monitorStepExceptionMonitor.message);
    }

    if (!monitorStepExceptionMonitor.includeResolved) {
      query.isResolved = false;
    }

    if (!monitorStepExceptionMonitor.includeArchived) {
      query.isArchived = false;
    }

    if (monitorStepExceptionMonitor.lastXSecondsOfExceptions) {
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveSeconds(
        endDate,
        monitorStepExceptionMonitor.lastXSecondsOfExceptions * -1,
      );
      query.lastSeenAt = new InBetween(startDate, endDate);
    }

    return query;
  }

  public static getDefault(): MonitorStepExceptionMonitor {
    return {
      telemetryServiceIds: [],
      exceptionTypes: [],
      message: "",
      includeResolved: false,
      includeArchived: false,
      lastXSecondsOfExceptions: 60,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepExceptionMonitor {
    return {
      telemetryServiceIds: ObjectID.fromJSONArray(
        (json["telemetryServiceIds"] as Array<JSONObject>) || [],
      ),
      exceptionTypes: (json["exceptionTypes"] as Array<string>) || [],
      message: (json["message"] as string) || "",
      includeResolved: Boolean(json["includeResolved"]) || false,
      includeArchived: Boolean(json["includeArchived"]) || false,
      lastXSecondsOfExceptions:
        (json["lastXSecondsOfExceptions"] as number | undefined) || 60,
    };
  }

  public static toJSON(monitor: MonitorStepExceptionMonitor): JSONObject {
    return {
      telemetryServiceIds: ObjectID.toJSONArray(monitor.telemetryServiceIds),
      exceptionTypes: monitor.exceptionTypes,
      message: monitor.message,
      includeResolved: monitor.includeResolved,
      includeArchived: monitor.includeArchived,
      lastXSecondsOfExceptions: monitor.lastXSecondsOfExceptions,
    };
  }
}
