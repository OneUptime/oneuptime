import ExceptionInstance from "../../Models/AnalyticsModels/ExceptionInstance";
import InBetween from "../BaseDatabase/InBetween";
import Includes from "../BaseDatabase/Includes";
import Query from "../BaseDatabase/Query";
import Search from "../BaseDatabase/Search";
import OneUptimeDate from "../Date";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

export default interface MonitorStepExceptionMonitor {
  telemetryServiceIds: Array<ObjectID>;
  // Stable telemetry entity keys (host / pod / container / ...) — scopes
  // the monitor to exceptions carrying any of these in their entityKeys
  // column. Optional: monitors saved before this field existed have it
  // undefined.
  entityKeys?: Array<string> | undefined;
  exceptionTypes: Array<string>;
  message: string;
  includeResolved: boolean;
  includeArchived: boolean;
  lastXSecondsOfExceptions: number;
}

export class MonitorStepExceptionMonitorUtil {
  public static toAnalyticsQuery(
    monitorStepExceptionMonitor: MonitorStepExceptionMonitor,
  ): Query<ExceptionInstance> {
    const query: Query<ExceptionInstance> = {};

    if (
      monitorStepExceptionMonitor.telemetryServiceIds &&
      monitorStepExceptionMonitor.telemetryServiceIds.length > 0
    ) {
      query.primaryEntityId = new Includes(
        monitorStepExceptionMonitor.telemetryServiceIds,
      );
    }

    // Compiles to hasAny(entityKeys, [...]) server-side. Undefined/empty is a no-op.
    if (
      monitorStepExceptionMonitor.entityKeys &&
      monitorStepExceptionMonitor.entityKeys.length > 0
    ) {
      query.entityKeys = new Includes(monitorStepExceptionMonitor.entityKeys);
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

    if (monitorStepExceptionMonitor.lastXSecondsOfExceptions) {
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveSeconds(
        endDate,
        monitorStepExceptionMonitor.lastXSecondsOfExceptions * -1,
      );
      query.time = new InBetween(startDate, endDate);
    }

    return query;
  }

  public static getDefault(): MonitorStepExceptionMonitor {
    return {
      telemetryServiceIds: [],
      entityKeys: [],
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
      entityKeys: (json["entityKeys"] as Array<string>) || [],
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
      entityKeys: monitor.entityKeys || [],
      exceptionTypes: monitor.exceptionTypes,
      message: monitor.message,
      includeResolved: monitor.includeResolved,
      includeArchived: monitor.includeArchived,
      lastXSecondsOfExceptions: monitor.lastXSecondsOfExceptions,
    };
  }
}
