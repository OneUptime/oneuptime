import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

export default interface MonitorStepMetricMonitor {
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
}

export class MonitorStepMetricMonitorUtil {

  public static getDefault(): MonitorStepMetricMonitor {
    return {
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: []
      },
      rollingTime: RollingTime.Past1Minute
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepMetricMonitor {
    return (json as any) as MonitorStepMetricMonitor;
  }

  public static toJSON(monitor: MonitorStepMetricMonitor): JSONObject {
    return (monitor as any) as JSONObject;
  }
}
