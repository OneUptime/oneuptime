import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

export interface PodmanContainerFilters {
  containerName?: string | undefined;
  containerImage?: string | undefined;
  hostName?: string | undefined;
}

export default interface MonitorStepPodmanMonitor {
  hostIdentifier: string;
  containerFilters: PodmanContainerFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepPodmanMonitorUtil {
  public static getDefault(): MonitorStepPodmanMonitor {
    return {
      hostIdentifier: "",
      containerFilters: {},
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [],
      },
      rollingTime: RollingTime.Past1Minute,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepPodmanMonitor {
    return json as any as MonitorStepPodmanMonitor;
  }

  public static toJSON(monitor: MonitorStepPodmanMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
