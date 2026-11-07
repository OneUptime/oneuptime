import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { CLOUD_RESOURCES_TABLE_ID } from "../AppPlatforms/AppPlatformsAccountFacet";
import { getRouteWithCloudAccountChip } from "../AppPlatforms/AppPlatformsListRoutes";
import Route from "Common/Types/API/Route";

/*
 * Cloud > All Resources, in these accounts: the list arrives with its
 * Cloud Account chip set to them - visibly, editable and clearable - as
 * App Platforms' lists do when Cloud's Overview links to them. A
 * connection's resource count on Cloud > Connect links here with the
 * accounts it reads, so the count opens the resources it counted. No
 * account, no chip: the whole list.
 */
export function getCloudResourcesRoute(
  accountIds: ReadonlyArray<string> = [],
): Route {
  return getRouteWithCloudAccountChip({
    route: RouteUtil.populateRouteParams(
      RouteMap[PageMap.CLOUD_MONITORED_RESOURCES] as Route,
    ),
    tableId: CLOUD_RESOURCES_TABLE_ID,
    accountIds,
  });
}
