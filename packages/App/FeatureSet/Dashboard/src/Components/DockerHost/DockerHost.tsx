import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

export interface ComponentProps {
  dockerHost: DockerHost;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const DockerHostElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.dockerHost?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_HOST_VIEW] as Route,
          {
            modelId: new ObjectID(props.dockerHost._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.Docker} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.dockerHost.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.dockerHost?.name || ""}</span>;
};

export default DockerHostElement;
