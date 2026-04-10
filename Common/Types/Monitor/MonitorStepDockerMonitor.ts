import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

export interface DockerContainerFilters {
  containerName?: string | undefined;
  containerImage?: string | undefined;
  hostName?: string | undefined;
}

export default interface MonitorStepDockerMonitor {
  hostIdentifier: string;
  containerFilters: DockerContainerFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepDockerMonitorUtil {
  public static getDefault(): MonitorStepDockerMonitor {
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

  public static fromJSON(json: JSONObject): MonitorStepDockerMonitor {
    return json as any as MonitorStepDockerMonitor;
  }

  public static toJSON(monitor: MonitorStepDockerMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
