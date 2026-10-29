import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

/*
 * A network device as a link to its page - the chip the Incident and Alert
 * tables and the affected-resources views render for the `networkDevices`
 * relation (CloudResourceElement's twin, issue #5341). Without an id (a
 * relation row that could not be read) it degrades to the plain name.
 */

export interface ComponentProps {
  networkDevice: NetworkDevice;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const NetworkDeviceElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.networkDevice?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
          {
            modelId: new ObjectID(props.networkDevice._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.Signal} className="w-5 h-5 me-1" />
          ) : (
            <></>
          )}{" "}
          {props.networkDevice.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.networkDevice?.name || ""}</span>;
};

export default NetworkDeviceElement;
