import MetricQueryConfigData from "../../Metrics/MetricQueryConfigData";
import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * "Auto" defers to a metric-name heuristic in ValueFormatter
 * (`isHigherWorseMetric`) — that lets templates skip the field unless
 * they need to override. "HigherIsBetter" forces ↑ = green / ↓ = red
 * (e.g. uptime, throughput, success rate). "HigherIsWorse" inverts so a
 * rising incident count, error rate, latency, or restart count is shown
 * in red.
 */
export enum DashboardValueTrendDirection {
  Auto = "Auto",
  HigherIsBetter = "HigherIsBetter",
  HigherIsWorse = "HigherIsWorse",
}

export default interface DashboardValueComponent extends BaseComponent {
  componentType: DashboardComponentType.Value;
  componentId: ObjectID;
  arguments: {
    metricQueryConfig?: MetricQueryConfigData | undefined;
    title: string;
    warningThreshold?: number | undefined;
    criticalThreshold?: number | undefined;
    trendDirection?: DashboardValueTrendDirection | undefined;
    /*
     * Drop the unit suffix entirely. The widget already abbreviates units
     * ("Celsius" reads as "°C") and drops them on its own when even the
     * compact form would shrink the digits below a readable size, so this is
     * only needed when the title already says what the unit is. Undefined
     * means "decide automatically".
     */
    hideUnit?: boolean | undefined;
  };
}
