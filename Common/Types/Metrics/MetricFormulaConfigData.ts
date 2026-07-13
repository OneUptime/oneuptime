import MetricAliasData from "./MetricAliasData";
import MetricFormulaData from "./MetricFormulaData";
import { MetricChartType } from "./MetricQueryConfigData";

export default interface MetricFormulaConfigData {
  metricAliasData: MetricAliasData;
  metricFormulaData: MetricFormulaData;
  chartType?: MetricChartType | undefined;
  warningThreshold?: number | undefined;
  criticalThreshold?: number | undefined;
  /*
   * Optional user-chosen color for the formula's series, stored as a hex
   * string (e.g. "#6366f1"). Unset = auto-assigned from the chart palette.
   */
  color?: string | undefined;
}
