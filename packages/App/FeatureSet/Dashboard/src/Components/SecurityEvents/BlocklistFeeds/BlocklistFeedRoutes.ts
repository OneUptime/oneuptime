import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";

// The project's blocklist feeds (#10345).
export function getBlocklistFeedsRoute(): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_BLOCKLIST_FEEDS] as Route,
  );
}

// One feed's own page.
export function getBlocklistFeedViewRoute(feedId: ObjectID | string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_BLOCKLIST_FEED_VIEW] as Route,
    { modelId: feedId.toString() },
  );
}
