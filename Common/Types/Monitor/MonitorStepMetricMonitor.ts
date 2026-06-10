import Metric from "../../Models/AnalyticsModels/Metric";
import Includes from "../BaseDatabase/Includes";
import Query from "../BaseDatabase/Query";
import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

export default interface MonitorStepMetricMonitor {
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
  // Stable telemetry entity keys (host / pod / container / ...) — scopes
  // every metric query in this step to rows carrying any of these in their
  // entityKeys column. Optional: monitors saved before this field existed
  // have it undefined.
  entityKeys?: Array<string> | undefined;
}

export class MonitorStepMetricMonitorUtil {
  public static getDefault(): MonitorStepMetricMonitor {
    return {
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [],
      },
      rollingTime: RollingTime.Past1Minute,
      entityKeys: [],
    };
  }

  /*
   * Stamps the step's entity scope onto a per-queryConfig Query<Metric>.
   * Compiles to hasAny(entityKeys, [...]) server-side. Undefined/empty is
   * a no-op so monitors saved before the field existed are unaffected.
   */
  public static applyEntityScopeToQuery(
    query: Query<Metric>,
    monitor: MonitorStepMetricMonitor,
  ): Query<Metric> {
    if (monitor.entityKeys && monitor.entityKeys.length > 0) {
      query.entityKeys = new Includes(monitor.entityKeys);
    }

    return query;
  }

  public static fromJSON(json: JSONObject): MonitorStepMetricMonitor {
    return json as any as MonitorStepMetricMonitor;
  }

  public static toJSON(monitor: MonitorStepMetricMonitor): JSONObject {
    return monitor as any as JSONObject;
  }
}
