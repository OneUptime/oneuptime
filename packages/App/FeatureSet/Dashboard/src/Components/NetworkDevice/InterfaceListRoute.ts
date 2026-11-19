import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";

/*
 * A DEVICE'S INTERFACES THAT ARE DOWN, ONE STEP AWAY (#9596).
 *
 * A device's hero said "Interfaces 48 · 46 up · 2 down", and its Interfaces
 * page "Down: 2" over a table of all 48: neither said which two. Now the
 * hero's "2 down" opens the Interfaces page on the two (?show=down), and the
 * page's Down card filters its table to them, and back.
 *
 * Down is what the table's Status column draws as Down: an interface that
 * is administratively up and operationally not (a port someone disabled
 * reads Disabled, and is not down).
 */

export const INTERFACES_SHOW_PARAM: string = "show";

export const INTERFACES_SHOW_DOWN: string = "down";

// The interfaces the Down count counts, as the table queries them.
export const DOWN_INTERFACES_QUERY: Query<NetworkInterface> = {
  isAdministrativelyUp: true,
  isOperationallyUp: false,
};

export function getDownInterfacesRoute(deviceId: ObjectID): Route {
  // A copy: addQueryParams writes into the route it is called on.
  return new Route(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_DEVICE_VIEW_INTERFACES] as Route,
      { modelId: deviceId },
    ).toString(),
  ).addQueryParams({ [INTERFACES_SHOW_PARAM]: INTERFACES_SHOW_DOWN });
}
