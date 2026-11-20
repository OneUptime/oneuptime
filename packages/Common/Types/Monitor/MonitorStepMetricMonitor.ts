import { JSONObject } from "../JSON";
import MetricFormulaConfigData from "../Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import ObjectID from "../ObjectID";
import RollingTime from "../RollingTime/RollingTime";
import MonitorStepRollingTime from "./MonitorStepRollingTime";

/*
 * How a Metrics monitor's step is written (issue #7712): with the query
 * builder's queries and formulas, or as one PromQL expression, the way an
 * alert rule is written for Prometheus. Stored; never rename one.
 */
export enum MetricMonitorQueryLanguage {
  Builder = "Builder",
  PromQL = "PromQL",
}

/*
 * The name a PromQL step's expression goes by where a criteria names what
 * it compares (CriteriaFilter.metricMonitorOptions.metricAlias): a PromQL
 * step has one expression, and every criteria compares it.
 */
export const PROMQL_METRIC_ALIAS: string = "promql";

/*
 * The most series one PromQL step judges per check, and so the most it
 * opens incidents and alerts for at once: the per-criteria cap every
 * monitor that fans out per entity has (PerEntityCriteriaFanOut's
 * MaxEntitiesPerCriteria, 100). An expression that returns more is judged
 * on the series that already have an open incident or alert first, then on
 * the rest in label order, up to this many; the others are left out of
 * that check, open nothing and resolve nothing.
 */
export const PROMQL_MONITOR_MAX_SERIES: number = 100;

export default interface MonitorStepMetricMonitor {
  /*
   * Builder (the default, and every step written before PromQL could be)
   * reads metricViewConfig; PromQL evaluates promQLQuery instead. A step
   * switched from one to the other keeps the other's settings, so
   * switching back finds them as they were.
   */
  queryLanguage?: MetricMonitorQueryLanguage | undefined;
  /*
   * The PromQL expression a PromQL step evaluates over the project's
   * metrics (PromQLEngine), at each step of its window. Every series it
   * returns is judged on its own and opens its own incident or alert,
   * named by the series' labels.
   */
  promQLQuery?: string | undefined;
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
  /*
   * Judge each series on its latest data point in the window, not on every
   * point in it - as an IoT Device monitor's Device Offline does
   * (MonitorStepIoTMonitor). Absent (false) on every monitor that does not
   * ask for it, which judges its whole window, as before.
   *
   * What it is for: a reading taken on a schedule slower than the monitor
   * looks, such as the minutes since each managed device last checked in,
   * written by every read of its device management connection (every 15
   * minutes by default, up to an hour apart: ManagedDeviceCheckIn). The
   * window has to be long enough to hold one read at the longest interval,
   * and judged whole it would hold a device's old readings for that long:
   * an alert would open an hour after the device stopped and resolve an
   * hour after it came back. Judged on its latest reading, it opens with
   * the first reading that says the device stopped, and resolves with the
   * first that says it checked in again. A series with no point in the
   * window still has none, so its no-data policy decides as before.
   */
  judgeLatestReading?: boolean | undefined;
}

export class MonitorStepMetricMonitorUtil {
  // Whether the step is written in PromQL (issue #7712).
  public static isPromQL(
    monitorStepMetricMonitor: MonitorStepMetricMonitor | undefined | null,
  ): boolean {
    return (
      monitorStepMetricMonitor?.queryLanguage ===
      MetricMonitorQueryLanguage.PromQL
    );
  }

  // The PromQL expression the step evaluates, trimmed; empty when none.
  public static getPromQLQuery(
    monitorStepMetricMonitor: MonitorStepMetricMonitor | undefined | null,
  ): string {
    const query: unknown = monitorStepMetricMonitor?.promQLQuery;

    return typeof query === "string" ? query.trim() : "";
  }

  /*
   * The queries a PromQL step is judged as: one, its expression, under
   * PROMQL_METRIC_ALIAS. What the criteria evaluator, the rule editor and
   * the records the step opens read for it, so a criteria compares the
   * expression's value and a root cause names the expression. Never
   * stored: the step keeps the builder's queries as they were.
   */
  public static getPromQLViewConfig(query: string): MetricsViewConfig {
    return {
      queryConfigs: [
        {
          id: PROMQL_METRIC_ALIAS,
          metricAliasData: {
            metricVariable: PROMQL_METRIC_ALIAS,
            title: query,
            description: undefined,
            legend: undefined,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: {},
          },
        },
      ],
      formulaConfigs: [],
    };
  }

  /*
   * The queries the step is judged with: a PromQL step's expression
   * (getPromQLViewConfig), else the builder's (getMetricViewConfig). The
   * builder's own editor, and anything that writes the step back, reads
   * getMetricViewConfig, so a PromQL step never stores its expression as
   * a query.
   */
  public static getEvaluatedViewConfig(
    monitorStepMetricMonitor: MonitorStepMetricMonitor | undefined | null,
  ): MetricsViewConfig {
    if (MonitorStepMetricMonitorUtil.isPromQL(monitorStepMetricMonitor)) {
      return MonitorStepMetricMonitorUtil.getPromQLViewConfig(
        MonitorStepMetricMonitorUtil.getPromQLQuery(monitorStepMetricMonitor),
      );
    }

    return MonitorStepMetricMonitorUtil.getMetricViewConfig(
      monitorStepMetricMonitor,
    );
  }

  // Whether the step reads its window as one value per query (above).
  public static aggregatesWholeWindow(
    monitorStepMetricMonitor: MonitorStepMetricMonitor | undefined | null,
  ): boolean {
    return monitorStepMetricMonitor?.aggregatesWholeWindow === true;
  }

  // Whether each series is judged on its latest reading (above).
  public static judgesLatestReading(
    monitorStepMetricMonitor: MonitorStepMetricMonitor | undefined | null,
  ): boolean {
    return monitorStepMetricMonitor?.judgeLatestReading === true;
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
