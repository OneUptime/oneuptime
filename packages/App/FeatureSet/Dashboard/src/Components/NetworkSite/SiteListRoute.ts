import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

/*
 * A LINK TO THE SITES LIST ON THE SITES A COUNT SAYS ARE UNHEALTHY (#9596).
 *
 * The Network Overview's "Sites ... 2 unhealthy" opened the whole list. The
 * Sites page has an "Unhealthy Sites" tile whose chip selects exactly the
 * statuses behind its count, and those statuses are only known once its
 * counts are read: so the link names the tile (?show=unhealthy), and the
 * page presses it as soon as its counts arrive - the chip set, visible and
 * clearable, as if the reader had pressed it - and takes the word off the
 * address, so going back or reloading does not press it again over a chip
 * the reader cleared.
 *
 * Kept out of SiteSummaryTiles.ts on purpose, as DeviceListFacetRoute is out
 * of DeviceFacets.ts: RouteMap reads the app's config when it is imported.
 */

export const SITE_LIST_SHOW_PARAM: string = "show";

export const SITE_LIST_SHOW_UNHEALTHY: string = "unhealthy";

export function getUnhealthySitesRoute(): Route {
  // A copy: addQueryParams writes into the route it is called on.
  return new Route(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_SITES] as Route,
    ).toString(),
  ).addQueryParams({ [SITE_LIST_SHOW_PARAM]: SITE_LIST_SHOW_UNHEALTHY });
}
