import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";
import RecordLinkName from "../RecordLink/RecordLinkName";

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
        <RecordLinkName
          name={props.dockerSwarmCluster.name}
          icon={props.showIcon ? IconProp.DockerSwarm : undefined}
        />
      </AppLink>
    );
  }

  return <span>{props.dockerSwarmCluster?.name || ""}</span>;
};

export default DockerSwarmClusterElement;
