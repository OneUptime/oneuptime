import { JSONObject } from "../JSON";
import MetricFormulaConfigData from "../Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import ObjectID from "../ObjectID";
import RollingTime from "../RollingTime/RollingTime";
import MonitorStepRollingTime from "./MonitorStepRollingTime";

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
  /*
   * Read each query as ONE value over the whole window - the sum, the
   * average, the highest or the lowest of every point in it, as its
   * aggregation says - and compute the formulas from those values, instead
   * of one value a minute. Absent (false) on every monitor that does not
   * ask for it, which reads its window a minute at a time, as before.
   *
   * What it is for: counts and shares of counts, read the same whatever
   * period their points stand for. A cloud's failed requests over its
   * requests, read a minute at a time, is the share of each minute that
   * has points: an AWS read-only connection writes one point per
   * CloudWatch period of five minutes, a streamed one a point a minute,
   * and CloudWatch writes no point at all for a period with no failure -
   * so a quiet window with one bad minute reads as the bad minute. Read
   * whole, it is the window's own share, and a count is the window's
   * total, on either connection (CloudAlertTemplates).
   */
  aggregatesWholeWindow?: boolean | undefined;
}

export class MonitorStepMetricMonitorUtil {
  // Whether the step reads its window as one value per query (above).
  public static aggregatesWholeWindow(
    monitorStepMetricMonitor: MonitorStepMetricMonitor | undefined | null,
  ): boolean {
    return monitorStepMetricMonitor?.aggregatesWholeWindow === true;
  }

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
    /*
     * A rolling time written another way ("15 minutes") is read as the one
     * it means (MonitorStepRollingTime).
     */
    const monitorStepMetricMonitor: MonitorStepMetricMonitor =
      MonitorStepRollingTime.readSettings(
        json,
      ) as any as MonitorStepMetricMonitor;

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
