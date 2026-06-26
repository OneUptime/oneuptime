import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

export interface ComponentProps {
  podmanHost: PodmanHost;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const PodmanHostElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.podmanHost?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.PODMAN_HOST_VIEW] as Route,
          {
            modelId: new ObjectID(props.podmanHost._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.Podman} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.podmanHost.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.podmanHost?.name || ""}</span>;
};

export default PodmanHostElement;
