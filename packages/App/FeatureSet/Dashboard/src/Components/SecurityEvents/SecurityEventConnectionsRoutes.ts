import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

/*
 * Where Security Events > Connections opens, from a link elsewhere in the
 * Dashboard:
 *
 *   ?connection=<id>   that connection's form, to edit it - what a security
 *                      case's step links to, to give a Google Workspace
 *                      connection's delegation the scope it lacks (#11376),
 *                      as Cloud > Connect opens an AWS connection's (#11039)
 */

export const SECURITY_EVENT_CONNECTION_QUERY_PARAM: string = "connection";

// A connection's id, as a link carries one: a UUID, and nothing else.
const CONNECTION_ID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSecurityEventConnectionIdInLink(
  value: string | null | undefined,
): value is string {
  return Boolean(value && CONNECTION_ID.test(value));
}

// Security Events > Connections, on a connection's form when its id is given.
export function getSecurityEventConnectionsRoute(
  connectionId?: string | undefined,
): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route,
  );

  return isSecurityEventConnectionIdInLink(connectionId)
    ? route.addQueryParams({
        [SECURITY_EVENT_CONNECTION_QUERY_PARAM]: connectionId,
      })
    : route;
}
