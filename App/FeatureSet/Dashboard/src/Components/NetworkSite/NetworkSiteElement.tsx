import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

export interface ComponentProps {
  networkSite: NetworkSite;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

/*
 * One network site as a link to its overview. Mirrors IoTFleetElement — a
 * site attached to an incident, alert or maintenance event should be as
 * clickable as any other affected resource.
 */
const NetworkSiteElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.networkSite?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.NETWORK_SITE_VIEW] as Route,
          {
            modelId: new ObjectID(props.networkSite._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.BuildingOffice} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.networkSite.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.networkSite?.name || ""}</span>;
};

export default NetworkSiteElement;
