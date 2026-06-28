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
  DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
  clampTelemetryMonitorWindowSeconds,
} from "./TelemetryMonitorWindow";

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
}

export class MonitorStepProfileMonitorUtil {
  public static toQuery(
    monitorStepProfileMonitor: MonitorStepProfileMonitor,
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

    /*
     * Always apply a bounded rolling-time window so the count() can never
     * become an unbounded full-table scan (see TelemetryMonitorWindow).
     */
    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.addRemoveSeconds(
      endDate,
      clampTelemetryMonitorWindowSeconds(
        monitorStepProfileMonitor.lastXSecondsOfProfiles,
      ) * -1,
    );
    query.startTime = new InBetween(startDate, endDate);

    return query;
  }

  public static getDefault(): MonitorStepProfileMonitor {
    return {
      attributes: {},
      profileType: "",
      profileTypes: [],
      telemetryServiceIds: [],
      entityKeys: [],
      lastXSecondsOfProfiles: 60,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepProfileMonitor {
    return {
      attributes:
        (json["attributes"] as Dictionary<string | number | boolean>) || {},
      profileType: json["profileType"] as string,
      profileTypes: json["profileTypes"] as Array<string>,
      telemetryServiceIds: ObjectID.fromJSONArray(
        json["telemetryServiceIds"] as Array<JSONObject>,
      ),
      entityKeys: (json["entityKeys"] as Array<string>) || [],
      lastXSecondsOfProfiles:
        (json["lastXSecondsOfProfiles"] as number | undefined) ||
        DEFAULT_TELEMETRY_MONITOR_WINDOW_SECONDS,
    };
  }

  public static toJSON(monitor: MonitorStepProfileMonitor): JSONObject {
    return {
      attributes: monitor.attributes,
      profileType: monitor.profileType,
      profileTypes: monitor.profileTypes,
      telemetryServiceIds: ObjectID.toJSONArray(monitor.telemetryServiceIds),
      entityKeys: monitor.entityKeys || [],
      lastXSecondsOfProfiles: monitor.lastXSecondsOfProfiles,
    };
  }
}
