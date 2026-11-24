import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { getDashboardWidgetLinkQuery } from "Common/Utils/Dashboard/DashboardWidgetLink";

/*
 * A LINK TO ONE WIDGET OF A DASHBOARD (#10084).
 *
 * The dashboard's page, opened at the widget: ?widget=<its id>
 * (DashboardWidgetLink). The board opens as it always does, then scrolls
 * to the widget once it is drawn and outlines it for a moment, so a
 * warning that names a widget - what Drop This Metric empties, what a
 * cloud metric's Remove leaves without data - or a chart just added from
 * the metrics explorer is one click from the widget itself, not a search of
 * the board for its title. A widget the board no longer has opens the board
 * at its top, and says so (DASHBOARD_LINKED_WIDGET_MISSING).
 */

// The dashboard's page, at one of its widgets when one is named.
export function getDashboardWidgetRoute(data: {
  dashboardId: ObjectID | string;
  widgetId?: string | null | undefined;
}): Route {
  const route: Route = new Route(
    RouteUtil.populateRouteParams(RouteMap[PageMap.DASHBOARD_VIEW] as Route, {
      modelId: new ObjectID(data.dashboardId.toString()),
    }).toString(),
  );
  const query: Record<string, string> = getDashboardWidgetLinkQuery(
    data.widgetId,
  );

  return Object.keys(query).length > 0 ? route.addQueryParams(query) : route;
}
