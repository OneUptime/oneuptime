import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

export interface ProxmoxResourceFilters {
  nodeName?: string | undefined;
  guestId?: string | undefined; // datapoint label `id` (e.g. "qemu/100", "lxc/101")
  guestName?: string | undefined;
}

export default interface MonitorStepProxmoxMonitor {
  clusterIdentifier: string;
  resourceFilters: ProxmoxResourceFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepProxmoxMonitorUtil {
  public static getDefault(): MonitorStepProxmoxMonitor {
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

  public static fromJSON(json: JSONObject): MonitorStepProxmoxMonitor {
    return json as any as MonitorStepProxmoxMonitor;
  }

  public static toJSON(monitor: MonitorStepProxmoxMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
