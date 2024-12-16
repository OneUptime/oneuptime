import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";

export default interface MetricViewData extends MetricsViewConfig {
  startAndEndDate: InBetween<Date> | null;
}
