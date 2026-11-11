import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";
import RecordLinkName from "../RecordLink/RecordLinkName";

export interface ComponentProps {
  openStackCloud: OpenStackCloud;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const OpenStackCloudElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.openStackCloud?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.OPENSTACK_CLOUD_VIEW] as Route,
          {
            modelId: new ObjectID(props.openStackCloud._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <RecordLinkName
          name={props.openStackCloud.name}
          icon={props.showIcon ? IconProp.Cloud : undefined}
        />
      </AppLink>
    );
  }

  return <span>{props.openStackCloud?.name || ""}</span>;
};

export default OpenStackCloudElement;
