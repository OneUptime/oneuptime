import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";
import RecordLinkName from "../RecordLink/RecordLinkName";

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
        <RecordLinkName
          name={props.networkSite.name}
          icon={props.showIcon ? IconProp.BuildingOffice : undefined}
        />
      </AppLink>
    );
  }

  return <span>{props.networkSite?.name || ""}</span>;
};

export default NetworkSiteElement;
