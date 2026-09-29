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
  /*
   * Stable telemetry entity keys (host / pod / container / ...) — scopes
   * the monitor to exceptions carrying any of these in their entityKeys
   * column. Optional: monitors saved before this field existed have it
   * undefined.
   */
  entityKeys?: Array<string> | undefined;
  /*
   * Deployment environments (the `deployment.environment` resource attribute,
   * stored on each occurrence's `environment` column). Matched exactly, like
   * the Exception Explorer's `env:` filter, so an occurrence with no
   * environment never matches a scoped monitor. Optional: monitors saved
   * before this field existed have it undefined, which means every
   * environment.
   */
  environments?: Array<string> | undefined;
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

    const environments: Array<string> =
      MonitorStepExceptionMonitorUtil.normalizeEnvironments(
        monitorStepExceptionMonitor.environments,
      );

    if (environments.length > 0) {
      query.environment = new Includes(environments);
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

  /*
   * Steps written through the API are stored without passing through
   * fromJSON, so this accepts what a caller might plausibly send — a list, or
   * a single environment as a bare string — and drops blanks and duplicates.
   * Values are trimmed but otherwise kept as-is: matching is exact and
   * case-sensitive, the same as the Explorer.
   */
  public static normalizeEnvironments(environments: unknown): Array<string> {
    const values: Array<unknown> = Array.isArray(environments)
      ? environments
      : typeof environments === "string"
        ? [environments]
        : [];

    const normalized: Array<string> = [];

    for (const value of values) {
      if (typeof value !== "string") {
        continue;
      }

      const environment: string = value.trim();

      if (environment && !normalized.includes(environment)) {
        normalized.push(environment);
      }
    }

    return normalized;
  }

  public static getDefault(): MonitorStepExceptionMonitor {
    return {
      telemetryServiceIds: [],
      entityKeys: [],
      environments: [],
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
      environments: MonitorStepExceptionMonitorUtil.normalizeEnvironments(
        json["environments"],
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
      entityKeys: monitor.entityKeys || [],
      environments: MonitorStepExceptionMonitorUtil.normalizeEnvironments(
        monitor.environments,
      ),
      exceptionTypes: monitor.exceptionTypes,
      message: monitor.message,
      includeResolved: monitor.includeResolved,
      includeArchived: monitor.includeArchived,
      lastXSecondsOfExceptions: monitor.lastXSecondsOfExceptions,
    };
  }
}
