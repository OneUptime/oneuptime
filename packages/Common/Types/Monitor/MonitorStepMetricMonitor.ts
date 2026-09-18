import { JSONObject } from "../JSON";
import MetricFormulaConfigData from "../Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import ObjectID from "../ObjectID";
import RollingTime from "../RollingTime/RollingTime";

export default interface MonitorStepMetricMonitor {
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
  /*
   * Optional telemetry-resource scope. Historically generic metric monitors
   * queried every matching series in the project; recommendation-created RUM
   * monitors need to watch one application, whose id is stored in Metric as
   * primaryEntityId. Optional keeps every existing project-wide metric
   * monitor behaving exactly as before.
   */
  telemetryServiceIds?: Array<ObjectID> | undefined;
}

export class MonitorStepMetricMonitorUtil {
  public static getDefault(): MonitorStepMetricMonitor {
    return {
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [],
      },
      rollingTime: RollingTime.Past1Minute,
      telemetryServiceIds: [],
    };
  }

  /**
   * Resolve a metric view config that is ALWAYS safe to render from.
   *
   * `metricViewConfig` is typed as required, but nothing enforces that at
   * runtime: monitor steps are persisted as free-form JSON and rehydrated with
   * a plain cast (see MonitorStep.fromJSON), so a step written by an older
   * build — or by the API, a seed, or an import — can carry a `metricMonitor`
   * with no `metricViewConfig` at all, or with `queryConfigs` set to null.
   *
   * Dereferencing such a value while rendering threw "Cannot read properties
   * of undefined (reading 'queryConfigs')", which unmounted the whole React
   * tree and left the user on a blank white page. Always go through this
   * helper instead of reading `metricViewConfig` directly.
   */
  public static getMetricViewConfig(
    monitorStepMetricMonitor: MonitorStepMetricMonitor | undefined | null,
  ): MetricsViewConfig {
    const metricViewConfig: MetricsViewConfig | undefined | null =
      monitorStepMetricMonitor?.metricViewConfig;

    return {
      queryConfigs: Array.isArray(metricViewConfig?.queryConfigs)
        ? (metricViewConfig.queryConfigs as Array<MetricQueryConfigData>)
        : [],
      formulaConfigs: Array.isArray(metricViewConfig?.formulaConfigs)
        ? (metricViewConfig.formulaConfigs as Array<MetricFormulaConfigData>)
        : [],
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepMetricMonitor {
    const monitorStepMetricMonitor: MonitorStepMetricMonitor =
      json as any as MonitorStepMetricMonitor;

    /*
     * Normalize on the way in so no consumer ever receives a half-built
     * config. Persisted JSON is not schema-checked, so this is the single
     * choke point where a malformed metricViewConfig becomes renderable.
     */
    return {
      ...monitorStepMetricMonitor,
      metricViewConfig: this.getMetricViewConfig(monitorStepMetricMonitor),
      rollingTime:
        monitorStepMetricMonitor?.rollingTime || RollingTime.Past1Minute,
      ...(json["telemetryServiceIds"]
        ? {
            telemetryServiceIds: ObjectID.fromJSONArray(
              json["telemetryServiceIds"] as Array<JSONObject>,
            ),
          }
        : {}),
    };
  }

  public static toJSON(monitor: MonitorStepMetricMonitor): JSONObject {
    return {
      ...(monitor as any as JSONObject),
      ...(monitor.telemetryServiceIds !== undefined
        ? {
            telemetryServiceIds: ObjectID.toJSONArray(
              monitor.telemetryServiceIds,
            ),
          }
        : {}),
    };
  }
}
