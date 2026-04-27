import Metric from "../../Models/AnalyticsModels/Metric";
import FilterData from "../../UI/Components/Filters/Types/FilterData";
import GroupBy from "../BaseDatabase/GroupBy";
import MetricsQuery from "./MetricsQuery";

export default interface MetricQueryData {
  filterData: FilterData<MetricsQuery>;
  groupBy?: GroupBy<Metric> | undefined;
  /**
   * OpenTelemetry attribute keys (e.g. "host.name", "service.name") to
   * group this query by. Stored alongside groupBy because attributes
   * live inside a nested Map column and can't be expressed through
   * GroupBy<Metric>, which only references top-level columns.
   *
   * When set, the monitor worker emits one series per unique value
   * combination of these keys — enabling per-host (or per-service, per-
   * whatever) incident creation from a single metric monitor.
   */
  groupByAttributeKeys?: Array<string> | undefined;
}
