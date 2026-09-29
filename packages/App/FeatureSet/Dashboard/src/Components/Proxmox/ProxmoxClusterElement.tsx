import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

export interface ComponentProps {
  proxmoxCluster: ProxmoxCluster;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const ProxmoxClusterElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.proxmoxCluster?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.PROXMOX_CLUSTER_VIEW] as Route,
          {
            modelId: new ObjectID(props.proxmoxCluster._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.Proxmox} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.proxmoxCluster.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.proxmoxCluster?.name || ""}</span>;
};

export default ProxmoxClusterElement;
