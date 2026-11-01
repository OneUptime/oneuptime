import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { UserFlowScope } from "./UserFlowScope";
import { buildUserFlowScopeSearch } from "./UserFlowUrlState";

/*
 * Where "View journey" goes, from the Users page or the session list: the
 * User Flows page on this person or session, over the window they were found
 * in. Null when the application id cannot be read, and the action is not
 * offered, as a row's link to the player is not.
 */
export function buildUserFlowScopeRoute(data: {
  rumApplicationId: string;
  scope: UserFlowScope | null;
  timeRange: RangeStartAndEndDateTime;
}): Route | null {
  if (!data.scope) {
    return null;
  }

  try {
    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.RUM_APPLICATION_VIEW_USER_FLOWS] as Route,
      { modelId: new ObjectID(data.rumApplicationId) },
    );

    return new Route(
      `${route.toString()}${buildUserFlowScopeSearch(data.scope, data.timeRange)}`,
    );
  } catch {
    return null;
  }
}
