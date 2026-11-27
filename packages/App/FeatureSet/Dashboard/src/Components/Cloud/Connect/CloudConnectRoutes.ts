import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

/*
 * Where Cloud > Connect opens, from a link elsewhere in the Dashboard:
 *
 *   ?cloud=aws (azure, gcp)    that cloud's form, to connect an account
 *   ?connection=<id>           that connection's form, to edit it - what a
 *                              security case's step links to, to turn
 *                              Security case checks on (#11039)
 */

export const CLOUD_CONNECT_CLOUD_QUERY_PARAM: string = "cloud";
export const CLOUD_CONNECT_CONNECTION_QUERY_PARAM: string = "connection";

// A connection's id, as a link carries one: a UUID, and nothing else.
const CONNECTION_ID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCloudConnectionIdInLink(
  value: string | null | undefined,
): value is string {
  return Boolean(value && CONNECTION_ID.test(value));
}

// Cloud > Connect, on a connection's form when its id is given.
export function getCloudConnectRoute(connectionId?: string | undefined): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CLOUD_CONNECT] as Route,
  );

  return isCloudConnectionIdInLink(connectionId)
    ? route.addQueryParams({
        [CLOUD_CONNECT_CONNECTION_QUERY_PARAM]: connectionId,
      })
    : route;
}
