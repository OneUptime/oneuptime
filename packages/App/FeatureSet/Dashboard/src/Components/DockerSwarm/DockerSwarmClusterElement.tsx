import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

export interface ComponentProps {
  dockerSwarmCluster: DockerSwarmCluster;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const DockerSwarmClusterElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.dockerSwarmCluster?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW] as Route,
          {
            modelId: new ObjectID(props.dockerSwarmCluster._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.DockerSwarm} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.dockerSwarmCluster.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.dockerSwarmCluster?.name || ""}</span>;
};

export default DockerSwarmClusterElement;
