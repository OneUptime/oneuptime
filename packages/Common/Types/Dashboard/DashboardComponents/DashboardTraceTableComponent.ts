import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardTraceTableComponent extends BaseComponent {
  componentType: DashboardComponentType.TraceTable;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
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
     * The dimension to break the table into rows by: a span attribute key
     * (e.g. url.host, resource.service.instance.id) or a top-level column
     * (name, primaryEntityId, statusCode, kind). One row per value. Unlike
     * the trace chart's optional split, this is REQUIRED — the table is a
     * "top dimensions" breakdown, so an unset group-by renders an empty
     * prompt instead of a query.
     */
    groupByAttribute?: string | undefined;
    // Cap on the number of rows (default 10).
    topLimit?: number | undefined;
    /*
     * Include non-root spans. Off by default so "Requests" matches the
     * traces explorer, which is root-spans-only.
     */
    includeChildSpans?: boolean | undefined;
  };
}
