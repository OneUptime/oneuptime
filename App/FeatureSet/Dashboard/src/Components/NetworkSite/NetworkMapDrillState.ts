import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { MapRegion } from "./SiteMapViewModel";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * Where the Network Map is drilled to, as the URL states it. The page seeds
 * itself from this at mount and re-reads it whenever a navigation lands on the
 * route, so the URL — not a component that has been alive since the user's
 * first click — is what decides which level is on screen.
 */
export interface NetworkMapDrillState {
  siteId: string | null;
  mapRegion: MapRegion;
}

export const NETWORK_MAP_SITE_PARAM: string = "site";
export const NETWORK_MAP_REGION_PARAM: string = "mapRegion";

export function readDrillStateFromUrl(): NetworkMapDrillState {
  const siteId: string | null = Navigation.getQueryStringByName(
    NETWORK_MAP_SITE_PARAM,
  );
  const region: string | null = Navigation.getQueryStringByName(
    NETWORK_MAP_REGION_PARAM,
  );

  return {
    siteId: siteId,
    mapRegion: region === "world" ? "world" : "us",
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
