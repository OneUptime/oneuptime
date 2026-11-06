import {
  MultiDeviceSnmpWalkQuery,
  buildMultiDeviceSnmpWalkQuery,
} from "./MultiDeviceSnmpWalkViewModel";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

/*
 * The address of the Network's SNMP Walk page (issue #5548) with devices
 * picked and, when there is one, the OID to start at - as the Devices
 * list's Bulk Actions and an OID's menu on a device's own SNMP Walk page
 * open it. The page walks nothing until the reader presses Walk.
 */
export function getMultiDeviceSnmpWalkRoute(
  query: MultiDeviceSnmpWalkQuery,
): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_SNMP_WALK] as Route,
  );
  const queryString: string = buildMultiDeviceSnmpWalkQuery(query);

  return new Route(
    queryString ? `${route.toString()}?${queryString}` : route.toString(),
  );
}
