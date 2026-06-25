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
     * Include non-root spans. Off by default so "Request Count" matches the
     * traces explorer, which is root-spans-only.
     */
    includeChildSpans?: boolean | undefined;
  };
}
