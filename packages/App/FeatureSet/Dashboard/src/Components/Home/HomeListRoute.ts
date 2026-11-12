import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";

/*
 * Where something Home counts opens: the list in the product it belongs to,
 * in the current project (#6857) - Home keeps no lists of its own. When that
 * list holds more than Home counted, as the SLOs list does for SLOs at risk,
 * `query` carries the list's own filters, already encoded for the address
 * (TableFilterUrlState.getLinkQueryParams), so it opens showing exactly what
 * the number counted.
 */
export type GetHomeListRouteFunction = (
  pageMap: PageMap,
  query?: Dictionary<string> | undefined,
) => Route;

export const getHomeListRoute: GetHomeListRouteFunction = (
  pageMap: PageMap,
  query?: Dictionary<string> | undefined,
): Route => {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[pageMap] as Route,
  );

  if (!query || Object.keys(query).length === 0) {
    return route;
  }

  return route.addQueryParams(query);
};
