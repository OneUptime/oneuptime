import MetricAliasData from "./MetricAliasData";
import MetricFormulaData from "./MetricFormulaData";
import { MetricChartType } from "./MetricQueryConfigData";

export default interface MetricFormulaConfigData {
  metricAliasData: MetricAliasData;
  metricFormulaData: MetricFormulaData;
  chartType?: MetricChartType | undefined;
  warningThreshold?: number | undefined;
  criticalThreshold?: number | undefined;
}
