import Metric from "../../Models/AnalyticsModels/Metric";
import FilterData from "../../UI/Components/Filters/Types/FilterData";
import GroupBy from "../BaseDatabase/GroupBy";
import MetricsQuery from "./MetricsQuery";

export default interface MetricQueryData {
  filterData: FilterData<MetricsQuery>;
  /**
   * Restrict this query's aggregate to metrics emitted by these services
   * (their Service ids). Compiles to a `primaryEntityId IN (...)` predicate on
   * the Metric analytics table — `primaryEntityId` is the required "Service ID"
   * column, so this is the authoritative, index-aligned way to scope a metric
   * to a service (as opposed to a mutable `service.name` attribute filter).
   *
   * Populated when the user opens the metric detail page from a service-scoped
   * metric list, so the chart shows the same service's data the list did. Kept
   * as a sibling of `filterData` (not inside it) so the Advanced Filters form —
   * which rebuilds `filterData` on edit — preserves it across user edits.
   */
  serviceIds?: Array<string> | undefined;
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
