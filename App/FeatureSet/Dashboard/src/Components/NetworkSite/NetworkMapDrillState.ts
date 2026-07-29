import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * Where the Network Map is drilled to, as the URL states it. The page seeds
 * itself from this at mount and re-reads it whenever a navigation lands on the
 * route, so the URL — not a component that has been alive since the user's
 * first click — is what decides which level is on screen.
 *
 * The map's geographic frame is deliberately NOT in here. It is derived from
 * the sites themselves (see Geo/GeoViewport.ts fitViewportToPoints), so the
 * same link opens on the same view for everyone without carrying coordinates
 * around; a URL parameter would only be able to disagree with the data.
 */
export interface NetworkMapDrillState {
  siteId: string | null;
}

export const NETWORK_MAP_SITE_PARAM: string = "site";

/*
 * The map used to offer a "United States / World" toggle, mirrored into this
 * parameter. Both are gone — the map now frames itself to wherever the sites
 * are — but links from that era are still in inboxes and bookmarks, so the
 * page clears the stale parameter out of the address bar rather than leaving
 * a control name in the URL that nothing answers to.
 */
export const LEGACY_NETWORK_MAP_REGION_PARAM: string = "mapRegion";

export function readDrillStateFromUrl(): NetworkMapDrillState {
  return {
    siteId: Navigation.getQueryStringByName(NETWORK_MAP_SITE_PARAM),
  };
}

/*
 * The route the sidebar's "Network Map" entry points at — the top of the map,
 * from wherever the user currently is.
 *
 * A plain Route to the map page cannot express that. Navigation.navigate()
 * drops any navigation whose target is already the current page, and
 * isOnThisPage() decides that on the pathname alone (Navigation.ts:216-243,
 * :285). The drill position lives in the query string, so from
 * ".../network-sites/map?site=<deep>" a link to ".../network-sites/map" is the
 * same page by that test: the click is swallowed, no location change is
 * produced, and the user is stranded at whatever level they drilled to with no
 * way back up through the nav.
 *
 * Carrying the reset in the route makes the link a real navigation again. A
 * Route holding a query string never matches the (query-less) current
 * pathname, so the router runs it and the page sees a new location; an empty
 * "site" reads back as null, which is the root view. The map then tidies the
 * spent "?site=" out of the address bar through its usual replaceState mirror.
 */
export function getNetworkMapRootRoute(): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_SITE_MAP] as Route,
  ).addQueryParams({ [NETWORK_MAP_SITE_PARAM]: "" });
}
