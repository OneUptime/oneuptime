import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

export interface CephResourceFilters {
  osdId?: string | undefined; // datapoint label `ceph_daemon` (e.g. "osd.3")
  poolName?: string | undefined; // datapoint label `pool` / `name`
}

export default interface MonitorStepCephMonitor {
  clusterIdentifier: string;
  resourceFilters: CephResourceFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepCephMonitorUtil {
  public static getDefault(): MonitorStepCephMonitor {
    return {
      clusterIdentifier: "",
      resourceFilters: {},
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [],
      },
      rollingTime: RollingTime.Past1Minute,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepCephMonitor {
    return json as any as MonitorStepCephMonitor;
  }

  public static toJSON(monitor: MonitorStepCephMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
