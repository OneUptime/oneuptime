import MetricFormulaConfigData from "./MetricFormulaConfigData";
import MetricQueryConfigData from "./MetricQueryConfigData";

export default interface MetricsViewConfig {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
}
