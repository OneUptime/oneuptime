import Profile from "../../Models/AnalyticsModels/Profile";
import InBetween from "../BaseDatabase/InBetween";
import Includes from "../BaseDatabase/Includes";
import Query from "../BaseDatabase/Query";
import Search from "../BaseDatabase/Search";
import OneUptimeDate from "../Date";
import Dictionary from "../Dictionary";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

export default interface MonitorStepProfileMonitor {
  attributes: Dictionary<string | number | boolean>;
  profileTypes: Array<string>;
  telemetryServiceIds: Array<ObjectID>;
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
      query.serviceId = new Includes(
        monitorStepProfileMonitor.telemetryServiceIds,
      );
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
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveSeconds(
        endDate,
        monitorStepProfileMonitor.lastXSecondsOfProfiles * -1,
      );
      query.startTime = new InBetween(startDate, endDate);
    }

    return query;
  }

  public static getDefault(): MonitorStepProfileMonitor {
    return {
      attributes: {},
      profileType: "",
      profileTypes: [],
      telemetryServiceIds: [],
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
      lastXSecondsOfProfiles: json["lastXSecondsOfProfiles"] as number,
    };
  }

  public static toJSON(monitor: MonitorStepProfileMonitor): JSONObject {
    return {
      attributes: monitor.attributes,
      profileType: monitor.profileType,
      profileTypes: monitor.profileTypes,
      telemetryServiceIds: ObjectID.toJSONArray(monitor.telemetryServiceIds),
      lastXSecondsOfProfiles: monitor.lastXSecondsOfProfiles,
    };
  }
}
