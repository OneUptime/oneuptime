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

/*
 * Ceilings on a log monitor's group-by. Mirrors MetricService's
 * MAX_GROUP_BY_ATTRIBUTE_KEYS / MAX_GROUP_BY_ATTRIBUTE_KEY_LENGTH: a key is
 * an attribute name, and more keys than this would split every log into
 * its own group anyway.
 */
export const MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTES: number = 10;
export const MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTE_LENGTH: number = 256;

// Ceilings on the attributes that name the log which resolves a group.
export const MAX_LOG_MONITOR_RESOLVED_BY_ATTRIBUTES: number = 10;
export const MAX_LOG_MONITOR_RESOLVED_BY_VALUE_LENGTH: number = 1024;

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
  /*
   * Attribute keys to group the matching logs by - e.g. ["con_name"] for
   * one group per IPsec tunnel. When set, the logs in the window are
   * counted per distinct combination of these attributes' values, the
   * criteria is evaluated per group, and each group raises (and resolves)
   * its own alert or incident, the way a metric monitor's Group By does.
   * Optional: monitors saved before this field existed - and monitors that
   * leave it empty - count every matching log together, as they always
   * have. Read it through MonitorStepLogMonitorUtil.getGroupByAttributes.
   */
  groupByAttributes?: Array<string> | undefined;
  /*
   * The log that says a group has recovered - e.g. { "event.name":
   * "interface.up" } on a monitor that counts interface.down per interface.
   *
   * Only read on a grouped monitor. Without it, a group's alert resolves
   * when its logs stop: right for "too many errors", wrong for "the link
   * went down", where silence means nothing was said, not that the link is
   * back. With it, a group stops breaching once a log with these attributes
   * arrives for it after its last matching log, its alert or incident is
   * resolved then, and never just because the window moved on.
   *
   * Optional: monitors saved before this field existed, and monitors that
   * leave it empty, resolve as they always have. Read it through
   * MonitorStepLogMonitorUtil.getResolvedByAttributes.
   */
  resolvedByAttributes?: Dictionary<string | number | boolean> | undefined;
}

export class MonitorStepLogMonitorUtil {
  /*
   * `evaluateUntil` ends the window earlier than now: a telemetry check
   * judges only data OneUptime has finished reading while its ingest queue
   * is behind (ReceivingCoverage.planTelemetryEvaluation, issue #2825).
   */
  public static toQuery(
    monitorStepLogMonitor: MonitorStepLogMonitor,
    evaluateUntil?: Date | undefined,
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

    if (monitorStepLogMonitor.lastXSecondsOfLogs) {
      const endDate: Date = evaluateUntil || OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveSeconds(
        endDate,
        monitorStepLogMonitor.lastXSecondsOfLogs * -1,
      );
      query.time = new InBetween(startDate, endDate);
    }

    return query;
  }

  /*
   * The keys this monitor groups by, cleaned up: trimmed, de-duplicated,
   * empty and over-long keys dropped, and at most
   * MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTES of them. Steps reach the worker as
   * the raw JSON they were saved as, so anything may be here. An empty
   * array means "not grouped".
   *
   * "__proto__" is refused: the keys become the keys of a plain label
   * object, where it would replace the prototype instead of naming a
   * group.
   */
  public static getGroupByAttributes(
    monitorStepLogMonitor:
      | Pick<MonitorStepLogMonitor, "groupByAttributes">
      | undefined
      | null,
  ): Array<string> {
    const rawKeys: unknown = monitorStepLogMonitor?.groupByAttributes;

    if (!Array.isArray(rawKeys)) {
      return [];
    }

    const keys: Array<string> = [];

    for (const rawKey of rawKeys) {
      if (typeof rawKey !== "string") {
        continue;
      }

      const key: string = rawKey.trim();

      if (
        !key ||
        key.length > MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTE_LENGTH ||
        key === "__proto__" ||
        keys.includes(key)
      ) {
        continue;
      }

      keys.push(key);

      if (keys.length >= MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTES) {
        break;
      }
    }

    return keys;
  }

  /*
   * The attributes of the log that resolves a group, cleaned up: keys
   * trimmed, empty keys and empty values dropped, values as the strings
   * a log's attributes hold, and at most
   * MAX_LOG_MONITOR_RESOLVED_BY_ATTRIBUTES of them. An empty object means
   * "groups resolve when their logs stop".
   *
   * A grouped monitor only: with nothing to group by there is no group for
   * a log to resolve, so the field is ignored rather than half-applied.
   */
  public static getResolvedByAttributes(
    monitorStepLogMonitor:
      | Pick<
          MonitorStepLogMonitor,
          "groupByAttributes" | "resolvedByAttributes"
        >
      | undefined
      | null,
  ): Dictionary<string> {
    const cleaned: Dictionary<string> = {};
    const raw: unknown = monitorStepLogMonitor?.resolvedByAttributes;

    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      MonitorStepLogMonitorUtil.getGroupByAttributes(monitorStepLogMonitor)
        .length === 0
    ) {
      return cleaned;
    }

    for (const rawKey of Object.keys(raw as Dictionary<unknown>)) {
      const key: string = rawKey.trim();
      const rawValue: unknown = (raw as Dictionary<unknown>)[rawKey];

      if (
        !key ||
        key.length > MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTE_LENGTH ||
        key === "__proto__" ||
        Object.prototype.hasOwnProperty.call(cleaned, key)
      ) {
        continue;
      }

      if (
        typeof rawValue !== "string" &&
        typeof rawValue !== "number" &&
        typeof rawValue !== "boolean"
      ) {
        continue;
      }

      const value: string = String(rawValue).trim();

      if (!value || value.length > MAX_LOG_MONITOR_RESOLVED_BY_VALUE_LENGTH) {
        continue;
      }

      cleaned[key] = value;

      if (
        Object.keys(cleaned).length >= MAX_LOG_MONITOR_RESOLVED_BY_ATTRIBUTES
      ) {
        break;
      }
    }

    return cleaned;
  }

  // Whether this monitor's groups are resolved by a log, not by silence.
  public static isResolvedByLog(
    monitorStepLogMonitor:
      | Pick<
          MonitorStepLogMonitor,
          "groupByAttributes" | "resolvedByAttributes"
        >
      | undefined
      | null,
  ): boolean {
    return (
      Object.keys(
        MonitorStepLogMonitorUtil.getResolvedByAttributes(
          monitorStepLogMonitor,
        ),
      ).length > 0
    );
  }

  /*
   * The logs that resolve this monitor's groups: the same telemetry
   * services, entities and time window as the logs it counts, with the
   * Resolved By attributes in place of its own filters. The text and
   * severity filters describe the problem, not the recovery, so they are
   * left out.
   */
  public static toResolvedByQuery(
    monitorStepLogMonitor: MonitorStepLogMonitor,
    evaluateUntil?: Date | undefined,
  ): Query<Log> {
    return MonitorStepLogMonitorUtil.toQuery(
      {
        ...monitorStepLogMonitor,
        attributes: MonitorStepLogMonitorUtil.getResolvedByAttributes(
          monitorStepLogMonitor,
        ),
        body: "",
        severityTexts: [],
      },
      evaluateUntil,
    );
  }

  public static getDefault(): MonitorStepLogMonitor {
    return {
      attributes: {},
      body: "",
      severityTexts: [],
      telemetryServiceIds: [],
      entityKeys: [],
      lastXSecondsOfLogs: 60,
      groupByAttributes: [],
      resolvedByAttributes: {},
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
      lastXSecondsOfLogs: json["lastXSecondsOfLogs"] as number,
      // Absent on monitors saved before group-by existed: not grouped.
      groupByAttributes: MonitorStepLogMonitorUtil.getGroupByAttributes({
        groupByAttributes: json["groupByAttributes"] as Array<string>,
      }),
      /*
       * Kept as saved, whether or not the monitor is grouped right now: a
       * form that has Group By cleared for a moment must not lose what was
       * typed here. The readers above decide whether it applies.
       */
      resolvedByAttributes:
        (json["resolvedByAttributes"] as Dictionary<
          string | number | boolean
        >) || {},
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
      groupByAttributes:
        MonitorStepLogMonitorUtil.getGroupByAttributes(monitor),
      resolvedByAttributes: monitor.resolvedByAttributes || {},
    };
  }
}
