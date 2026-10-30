import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

export default interface MonitorStepHostMonitor {
  hostIdentifier: string;
  /*
   * The resource's id. Bound on every write and read by the worker, so a
   * rename keeps the monitor on its resource (InfrastructureResourceBinding).
   */
  resourceId?: string | undefined;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepHostMonitorUtil {
  public static getDefault(): MonitorStepHostMonitor {
    return {
      hostIdentifier: "",
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [],
      },
      rollingTime: RollingTime.Past1Minute,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepHostMonitor {
    return json as any as MonitorStepHostMonitor;
  }

  public static toJSON(monitor: MonitorStepHostMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
