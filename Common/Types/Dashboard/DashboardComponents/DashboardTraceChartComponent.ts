import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardTraceChartComponent extends BaseComponent {
  componentType: DashboardComponentType.TraceChart;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    /*
     * Span aggregation to chart — one of the trace analytics metrics:
     * count, errorCount, avgDuration, p50Duration, p90Duration,
     * p95Duration, p99Duration, minDuration, maxDuration.
     */
    metric?: string | undefined;
    // Substring filter on span name (e.g. "/Shipment/ShipShipment").
    spanNameContains?: string | undefined;
    /*
     * Attribute equality filters, ANDed. The structured editor stores a
     * key/value record (e.g. { "url.host": "torginol.starship.online" }).
     * A legacy "key=value; key2=value2" string is still read for widgets
     * saved before the structured editor existed.
     */
    attributeFilters?:
      | string
      | Record<string, string | number | boolean>
      | undefined;
    /*
     * Optional split dimension: a span attribute key (e.g. url.host,
     * resource.service.instance.id) or a top-level column (name,
     * primaryEntityId, statusCode, kind). One series per value.
     */
    groupByAttribute?: string | undefined;
    // Cap on the number of series when split (default 10).
    topLimit?: number | undefined;
    /*
     * Optional user-chosen lead color for the chart, stored as a hex string
     * (e.g. "#6366f1"). Single-series → the series color; split charts → the
     * first unpinned series, with the rest following the default palette.
     * Same semantics as MetricQueryConfigData.color on the metric Chart
     * widget. Unset = Auto (default palette).
     */
    color?: string | undefined;
    /*
     * Per-series color pins for split charts, keyed by "key=value" segment
     * (e.g. { "url.host=api.example.com": "#10b981" }) — the same storage
     * shape as MetricQueryConfigData.colorsByGroup, so the shared
     * SeriesGroupColorSelector editor works unchanged. Unpinned series fall
     * back to `color` (lead) then the default palette.
     */
    colorsByGroup?: Record<string, string> | undefined;
    /*
     * Include non-root spans. Off by default so "Request Count" matches the
     * traces explorer, which is root-spans-only.
     */
    includeChildSpans?: boolean | undefined;
  };
}
