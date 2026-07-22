import MetricFormulaConfigData from "../Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import { MonitorStepType } from "./MonitorStep";

/**
 * Every monitor-step data key that carries a `metricViewConfig`. These are the
 * "metric-shaped" monitor types — the ones whose alert criteria evaluate a
 * metric query (CheckOn.MetricValue). The order here is not significant; a
 * given monitor step only ever populates one of these keys.
 *
 * Keeping this list in one place is what prevents the class of bug where a new
 * metric-shaped monitor type (e.g. Host, Podman, DockerSwarm, IoT) is wired
 * into the step form but forgotten in the criteria UI, leaving the "Which
 * metric query should this alert rule check?" dropdown blank ("No options").
 */
const METRIC_VIEW_CONFIG_KEYS: Array<keyof MonitorStepType> = [
  "metricMonitor",
  "hostMonitor",
  "kubernetesMonitor",
  "dockerMonitor",
  "dockerSwarmMonitor",
  "podmanMonitor",
  "proxmoxMonitor",
  "cephMonitor",
  "iotMonitor",
];

export default class MonitorStepMetricViewConfigUtil {
  /**
   * Resolve the `metricViewConfig` from whichever metric-shaped monitor sub-config
   * is populated on this monitor step. Returns undefined when the step is not
   * metric-shaped (or none of the metric configs is present).
   */
  public static getMetricViewConfig(
    monitorStepData: MonitorStepType | undefined,
  ): MetricsViewConfig | undefined {
    if (!monitorStepData) {
      return undefined;
    }

    /*
     * Each metric-shaped sub-config is an object with an optional
     * `metricViewConfig`. Index through a record view so the lookup stays
     * data-driven (see METRIC_VIEW_CONFIG_KEYS) without fighting the wide
     * union of MonitorStepType's value types.
     */
    const stepRecord: Record<
      string,
      { metricViewConfig?: MetricsViewConfig } | undefined
    > = monitorStepData as unknown as Record<
      string,
      { metricViewConfig?: MetricsViewConfig } | undefined
    >;

    for (const key of METRIC_VIEW_CONFIG_KEYS) {
      const subConfig: { metricViewConfig?: MetricsViewConfig } | undefined =
        stepRecord[key];

      if (subConfig?.metricViewConfig) {
        return subConfig.metricViewConfig;
      }
    }

    return undefined;
  }

  /**
   * Collect the distinct, non-empty metric variables (aliases) from the step's
   * query configs and formula configs. These become the options for the
   * criteria "Metric" dropdown. Empty variables are dropped and duplicates are
   * removed while preserving first-seen order.
   */
  public static getMetricVariables(
    monitorStepData: MonitorStepType | undefined,
  ): Array<string> {
    const metricViewConfig: MetricsViewConfig | undefined =
      this.getMetricViewConfig(monitorStepData);

    if (!metricViewConfig) {
      return [];
    }

    const variables: Array<string> = [];

    for (const queryConfig of metricViewConfig.queryConfigs || []) {
      variables.push(
        (queryConfig as MetricQueryConfigData).metricAliasData
          ?.metricVariable || "",
      );
    }

    for (const formulaConfig of metricViewConfig.formulaConfigs || []) {
      variables.push(
        (formulaConfig as MetricFormulaConfigData).metricAliasData
          ?.metricVariable || "",
      );
    }

    // Remove duplicates (first-seen order) and drop empty strings.
    return variables.filter((item: string, index: number): boolean => {
      return variables.indexOf(item) === index && item !== "";
    });
  }
}
