import ExceptionInstance from "../../Models/AnalyticsModels/ExceptionInstance";
import InBetween from "../BaseDatabase/InBetween";
import Includes from "../BaseDatabase/Includes";
import IncludesNone from "../BaseDatabase/IncludesNone";
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
  /*
   * Exception types the monitor does not count, whatever else matches:
   * matched exactly and case-sensitively, like `exceptionTypes`. A mobile
   * app's App Crashes leaves out ANR and Hang, so a freeze is never paged
   * as a crash too (#9713). A type both kept and left out is left out.
   * Optional: monitors saved before this field existed have it undefined,
   * which leaves nothing out.
   */
  excludedExceptionTypes?: Array<string> | undefined;
  /*
   * Only the occurrences nothing caught: an occurrence's `escaped` flag,
   * which ingest sets from a span's exception event, a log's
   * `exception.escaped` and a mobile app's crash, ANR or hang - the
   * Exceptions explorer's Unhandled. An occurrence that does not say counts
   * as handled. Optional: monitors saved before this field existed have it
   * undefined, which counts both.
   */
  unhandledOnly?: boolean | undefined;
  message: string;
  includeResolved: boolean;
  includeArchived: boolean;
  lastXSecondsOfExceptions: number;
}

export class MonitorStepExceptionMonitorUtil {
  /*
   * `evaluateUntil` ends the window earlier than now: a telemetry check
   * judges only data OneUptime has finished reading while its ingest queue
   * is behind (ReceivingCoverage.planTelemetryEvaluation, issue #2825).
   */
  public static toAnalyticsQuery(
    monitorStepExceptionMonitor: MonitorStepExceptionMonitor,
    evaluateUntil?: Date | undefined,
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
      MonitorStepExceptionMonitorUtil.hasEntityFilter(
        monitorStepExceptionMonitor,
      )
    ) {
      query.entityKeys = new Includes(monitorStepExceptionMonitor.entityKeys!);
    }

    const environments: Array<string> =
      MonitorStepExceptionMonitorUtil.normalizeEnvironments(
        monitorStepExceptionMonitor.environments,
      );

    if (environments.length > 0) {
      query.environment = new Includes(environments);
    }

    /*
     * The types kept, less the types left out: one predicate on the column,
     * as a query holds one. Kept types and none left out is `IN (...)` as it
     * always was; types left out alone is `NOT IN (...)`; both is the kept
     * types that are not left out - and when every kept type is left out,
     * an empty `IN`, which matches nothing, as the two lists together say.
     */
    const keptTypes: Array<string> =
      MonitorStepExceptionMonitorUtil.getKeptExceptionTypes(
        monitorStepExceptionMonitor,
      );
    const excludedTypes: Array<string> =
      MonitorStepExceptionMonitorUtil.normalizeExceptionTypes(
        monitorStepExceptionMonitor.excludedExceptionTypes,
      );

    if (
      keptTypes.length > 0 ||
      MonitorStepExceptionMonitorUtil.keepsNoType(monitorStepExceptionMonitor)
    ) {
      query.exceptionType = new Includes(keptTypes);
    } else if (excludedTypes.length > 0) {
      query.exceptionType = new IncludesNone(excludedTypes);
    }

    if (
      MonitorStepExceptionMonitorUtil.isUnhandledOnly(
        monitorStepExceptionMonitor,
      )
    ) {
      query.escaped = true;
    }

    if (monitorStepExceptionMonitor.message) {
      query.message = new Search(monitorStepExceptionMonitor.message);
    }

    if (monitorStepExceptionMonitor.lastXSecondsOfExceptions) {
      const endDate: Date = evaluateUntil || OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveSeconds(
        endDate,
        monitorStepExceptionMonitor.lastXSecondsOfExceptions * -1,
      );
      query.time = new InBetween(startDate, endDate);
    }

    return query;
  }

  /*
   * Whether the monitor is scoped to infrastructure entities: its occurrence
   * query then keeps only the occurrences that carry one of them
   * (toAnalyticsQuery). An entity is a property of each occurrence, not of
   * the exception group, so the new and regressed exceptions such a monitor
   * counts are the groups of those occurrences
   * (ExceptionMonitorMeasureReader).
   */
  public static hasEntityFilter(
    monitorStepExceptionMonitor: Pick<
      MonitorStepExceptionMonitor,
      "entityKeys"
    >,
  ): boolean {
    return Boolean(
      monitorStepExceptionMonitor.entityKeys &&
        monitorStepExceptionMonitor.entityKeys.length > 0,
    );
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

  /*
   * Exception types as the query matches them: a list, or a single type as
   * a bare string (what a step written through the API might hold, since
   * MonitorStep.fromJSON stores it raw), trimmed, blanks and duplicates
   * dropped. Matched exactly and case-sensitively, as the explorer's type
   * filter is, so nothing else is changed.
   */
  public static normalizeExceptionTypes(
    exceptionTypes: unknown,
  ): Array<string> {
    return MonitorStepExceptionMonitorUtil.normalizeEnvironments(
      exceptionTypes,
    );
  }

  /*
   * The types the monitor keeps: its Exception Types less the ones it
   * leaves out. Empty both when it keeps every type (no Exception Types)
   * and when it leaves out every type it keeps; toAnalyticsQuery tells the
   * two apart.
   */
  public static getKeptExceptionTypes(
    monitorStepExceptionMonitor: Pick<
      MonitorStepExceptionMonitor,
      "exceptionTypes" | "excludedExceptionTypes"
    >,
  ): Array<string> {
    const excluded: Array<string> =
      MonitorStepExceptionMonitorUtil.normalizeExceptionTypes(
        monitorStepExceptionMonitor.excludedExceptionTypes,
      );

    return MonitorStepExceptionMonitorUtil.normalizeExceptionTypes(
      monitorStepExceptionMonitor.exceptionTypes,
    ).filter((exceptionType: string): boolean => {
      return !excluded.includes(exceptionType);
    });
  }

  /*
   * Whether every type the monitor keeps is one it leaves out, so that no
   * exception can match: both lists name the same types. False when it
   * keeps every type (no Exception Types).
   */
  public static keepsNoType(
    monitorStepExceptionMonitor: Pick<
      MonitorStepExceptionMonitor,
      "exceptionTypes" | "excludedExceptionTypes"
    >,
  ): boolean {
    return (
      MonitorStepExceptionMonitorUtil.normalizeExceptionTypes(
        monitorStepExceptionMonitor.exceptionTypes,
      ).length > 0 &&
      MonitorStepExceptionMonitorUtil.getKeptExceptionTypes(
        monitorStepExceptionMonitor,
      ).length === 0
    );
  }

  /*
   * Whether the monitor counts only unhandled exceptions. Only an explicit
   * yes counts - true, or "true" from a step written through the API - so
   * a step saved before the field existed counts both, as it did.
   */
  public static isUnhandledOnly(
    monitorStepExceptionMonitor: Pick<
      MonitorStepExceptionMonitor,
      "unhandledOnly"
    >,
  ): boolean {
    const value: unknown = monitorStepExceptionMonitor.unhandledOnly;

    return (
      value === true ||
      (typeof value === "string" && value.trim().toLowerCase() === "true")
    );
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

  /*
   * The two filters #9713 added, left out when unset - as a step saved
   * before they existed is - so every other step reads and writes exactly
   * as it did.
   */
  private static getOptionalFilters(source: {
    excludedExceptionTypes?: unknown;
    unhandledOnly?: unknown;
  }): Pick<
    MonitorStepExceptionMonitor,
    "excludedExceptionTypes" | "unhandledOnly"
  > {
    const excludedExceptionTypes: Array<string> =
      MonitorStepExceptionMonitorUtil.normalizeExceptionTypes(
        source.excludedExceptionTypes,
      );
    const unhandledOnly: boolean =
      MonitorStepExceptionMonitorUtil.isUnhandledOnly({
        unhandledOnly: source.unhandledOnly as boolean | undefined,
      });

    return {
      ...(excludedExceptionTypes.length > 0
        ? { excludedExceptionTypes: excludedExceptionTypes }
        : {}),
      ...(unhandledOnly ? { unhandledOnly: true } : {}),
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
      ...MonitorStepExceptionMonitorUtil.getOptionalFilters({
        excludedExceptionTypes: json["excludedExceptionTypes"],
        unhandledOnly: json["unhandledOnly"],
      }),
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
      ...MonitorStepExceptionMonitorUtil.getOptionalFilters(monitor),
      message: monitor.message,
      includeResolved: monitor.includeResolved,
      includeArchived: monitor.includeArchived,
      lastXSecondsOfExceptions: monitor.lastXSecondsOfExceptions,
    };
  }
}
