import InBetween from "../BaseDatabase/InBetween";
import MetricsViewConfig from "./MetricsViewConfig";

export default interface MetricViewData extends MetricsViewConfig {
  startAndEndDate: InBetween<Date> | null;
}
