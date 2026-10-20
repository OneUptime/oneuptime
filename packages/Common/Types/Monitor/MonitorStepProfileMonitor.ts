import Profile from "../../Models/AnalyticsModels/Profile";
import InBetween from "../BaseDatabase/InBetween";
import Includes from "../BaseDatabase/Includes";
import Query from "../BaseDatabase/Query";
import Search from "../BaseDatabase/Search";
import OneUptimeDate from "../Date";
import Dictionary from "../Dictionary";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import {
  ProfileCategory,
  getQueryProfileTypes,
} from "../../Utils/Profiles/ProfileTypes";

export default interface MonitorStepProfileMonitor {
  attributes: Dictionary<string | number | boolean>;
  profileTypes: Array<string>;
  telemetryServiceIds: Array<ObjectID>;
  /*
   * Stable telemetry entity keys (host / pod / container / ...) — scopes
   * the monitor to profiles carrying any of these in their entityKeys
   * column. Optional: monitors saved before this field existed have it
   * undefined.
   */
  entityKeys?: Array<string> | undefined;
  lastXSecondsOfProfiles: number;
  profileType: string;
  /*
   * The code the "Function Share" criteria measures: text a stack frame
   * contains - a function's name, or a file or package path - in any case.
   * Optional: monitors saved before this field existed have it undefined,
   * and a Profile Count monitor does not need it.
   */
  functionName?: string | undefined;
}

// The longest function text a Profiles monitor matches on.
export const PROFILE_MONITOR_FUNCTION_MAX_LENGTH: number = 500;

export class MonitorStepProfileMonitorUtil {
  /*
   * `evaluateUntil` ends the window earlier than now: a telemetry check
   * judges only data OneUptime has finished reading while its ingest queue
   * is behind (ReceivingCoverage.planTelemetryEvaluation, issue #2825).
   */
  public static toQuery(
    monitorStepProfileMonitor: MonitorStepProfileMonitor,
    evaluateUntil?: Date | undefined,
  ): Query<Profile> {
    const query: Query<Profile> = {};

    if (
      monitorStepProfileMonitor.telemetryServiceIds &&
      monitorStepProfileMonitor.telemetryServiceIds.length > 0
    ) {
      query.primaryEntityId = new Includes(
        monitorStepProfileMonitor.telemetryServiceIds,
      );
    }

    // Compiles to hasAny(entityKeys, [...]) server-side. Undefined/empty is a no-op.
    if (
      monitorStepProfileMonitor.entityKeys &&
      monitorStepProfileMonitor.entityKeys.length > 0
    ) {
      query.entityKeys = new Includes(monitorStepProfileMonitor.entityKeys);
    }

    if (
      monitorStepProfileMonitor.attributes &&
      Object.keys(monitorStepProfileMonitor.attributes).length > 0
    ) {
      query.attributes = monitorStepProfileMonitor.attributes;
    }

    if (
      monitorStepProfileMonitor.profileTypes &&
      monitorStepProfileMonitor.profileTypes.length > 0
    ) {
      query.profileType = new Includes(monitorStepProfileMonitor.profileTypes);
    }

    if (monitorStepProfileMonitor.profileType) {
      query.profileType = new Search(monitorStepProfileMonitor.profileType);
    }

    if (monitorStepProfileMonitor.lastXSecondsOfProfiles) {
      const endDate: Date = evaluateUntil || OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveSeconds(
        endDate,
        monitorStepProfileMonitor.lastXSecondsOfProfiles * -1,
      );
      query.startTime = new InBetween(startDate, endDate);
    }

    return query;
  }

  /*
   * A new Profiles monitor reads CPU time over the last five minutes: long
   * enough to hold several uploads of every profiler OneUptime knows (they
   * upload every 5 to 60 seconds), so a share does not swing with one
   * upload more or less.
   */
  public static getDefault(): MonitorStepProfileMonitor {
    return {
      attributes: {},
      profileType: "",
      profileTypes: [...(getQueryProfileTypes(ProfileCategory.Cpu) || [])],
      telemetryServiceIds: [],
      entityKeys: [],
      lastXSecondsOfProfiles: 300,
      functionName: "",
    };
  }

  /*
   * The function text, read as the monitor stores it: trimmed, and empty
   * when it is not text.
   */
  public static getFunctionName(
    monitorStepProfileMonitor: MonitorStepProfileMonitor | undefined,
  ): string {
    const value: unknown = monitorStepProfileMonitor?.functionName;

    return typeof value === "string"
      ? value.trim().substring(0, PROFILE_MONITOR_FUNCTION_MAX_LENGTH)
      : "";
  }

  public static fromJSON(json: JSONObject): MonitorStepProfileMonitor {
    const monitor: MonitorStepProfileMonitor = {
      attributes:
        (json["attributes"] as Dictionary<string | number | boolean>) || {},
      profileType: json["profileType"] as string,
      profileTypes: json["profileTypes"] as Array<string>,
      telemetryServiceIds: ObjectID.fromJSONArray(
        json["telemetryServiceIds"] as Array<JSONObject>,
      ),
      entityKeys: (json["entityKeys"] as Array<string>) || [],
      lastXSecondsOfProfiles: json["lastXSecondsOfProfiles"] as number,
    };

    if (typeof json["functionName"] === "string") {
      monitor.functionName = json["functionName"] as string;
    }

    return monitor;
  }

  public static toJSON(monitor: MonitorStepProfileMonitor): JSONObject {
    return {
      attributes: monitor.attributes,
      profileType: monitor.profileType,
      profileTypes: monitor.profileTypes,
      telemetryServiceIds: ObjectID.toJSONArray(monitor.telemetryServiceIds),
      entityKeys: monitor.entityKeys || [],
      lastXSecondsOfProfiles: monitor.lastXSecondsOfProfiles,
      functionName: MonitorStepProfileMonitorUtil.getFunctionName(monitor),
    };
  }
}
