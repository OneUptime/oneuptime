import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import { isSecurityWatchlistName } from "Common/Types/SecurityEvent/SecurityWatchlist";

/*
 * Where Security Events > Detections > Watchlists lives, and how a rule's
 * form sends its reader there to create a list the rule names but the
 * project lacks: with the name in the address (?create=board_members),
 * Create Watchlist opens at once with that name in it - the one step the
 * reader came for, the name spelled as the rule spells it.
 */

// The address's key for a list to create on arrival.
export const WATCHLIST_CREATE_PARAM: string = "create";

// The Watchlists page, or with a name, the page opening Create Watchlist with it.
export function getWatchlistsRoute(nameToCreate?: string | undefined): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_WATCHLISTS] as Route,
  ) as Route;

  if (!nameToCreate || !isSecurityWatchlistName(nameToCreate)) {
    return route;
  }

  return route.addQueryParams({ [WATCHLIST_CREATE_PARAM]: nameToCreate });
}

/*
 * The name to create, read from the address: one rules can write, or none -
 * anything else is not a list a rule can name, and is left for the reader
 * to type.
 */
export function readWatchlistNameToCreate(
  value: string | null | undefined,
): string | null {
  const name: string = (value || "").trim();

  return name && isSecurityWatchlistName(name) ? name : null;
}
