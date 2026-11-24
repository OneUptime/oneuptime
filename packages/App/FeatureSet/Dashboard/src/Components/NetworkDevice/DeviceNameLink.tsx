import AppLink from "../AppLink/AppLink";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";

// A network device's own page.
export function getNetworkDeviceRoute(deviceId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
    { modelId: new ObjectID(deviceId) },
  );
}

export interface DeviceNameLinkProps {
  deviceId: string;
  name: string;
  dataTestId: string;
}

/*
 * A device's name in a line about it, linking to its page: the device a
 * scan's host is (Review Results), or another device at a monitor's address
 * (a device's Monitors card). The name is as its owner wrote it.
 */
const DeviceNameLink: FunctionComponent<DeviceNameLinkProps> = (
  props: DeviceNameLinkProps,
): ReactElement => {
  return (
    <AppLink
      to={getNetworkDeviceRoute(props.deviceId)}
      className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
      dataTestId={props.dataTestId}
    >
      <span dir="auto">{props.name}</span>
    </AppLink>
  );
};

export default DeviceNameLink;
