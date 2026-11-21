import { RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE } from "../../../Types/Rum/RumClientKind";
import ServiceType from "../../../Types/Telemetry/ServiceType";

/*
 * NO INVENTORY FROM A RUM CLIENT'S ROWS (issue #10539).
 *
 * Some discovery reads stored rows rather than a resource: a database from
 * the CLIENT spans that call it (DatabaseEndpointDiscovery), a queue from
 * messaging spans and broker metrics (MessageQueueDiscovery). What a row
 * says there is its span's or its datapoint's own attributes, which
 * PinRumClientResource leaves as sent, so the resource allowlist alone does
 * not stop a key copied out of a page or an app from sending ten CLIENT
 * spans to "prod-db.internal" and having a database added to the project.
 *
 * So these queries read no row of a RUM client: none filed under a RUM
 * application, and none whose resource is stamped as a RUM client, which
 * everything a Browser or Mobile key writes is - with or without a service
 * name, so with or without an application to be filed under. A browser or
 * a mobile app calls no database or broker directly, so nothing real is
 * lost.
 */

// The stamp as a stored row carries it: its resource's, prefixed.
export const RUM_CLIENT_ROW_ATTRIBUTE_KEY: string = `resource.${RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE}`;

/*
 * ClickHouse predicate over a Span, Log or Metric row: true when the row is
 * not a RUM client's. `primaryEntityType` is Nullable, and a row with none
 * is not a RUM application's, so it is read as '' - a bare `!=` would drop
 * it. Both names are OneUptime's own constants, never user input.
 */
export function notRumClientRowSql(): string {
  return `(ifNull(primaryEntityType, '') != '${ServiceType.RealUserMonitor}' AND NOT has(attributeKeys, '${RUM_CLIENT_ROW_ATTRIBUTE_KEY}'))`;
}
