import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceMoreSettings from "../../../Components/TelemetryResource/TelemetryResourceMoreSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const DockerSwarmClusterSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ResourceDetailsCard<DockerSwarmCluster>
        modelType={DockerSwarmCluster}
        modelId={modelId}
        id="docker-swarm-cluster-details"
        title="Cluster Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Name",
          description:
            "Must match the docker.swarm.cluster.name the Docker Swarm Agent reports. Rename it there too, or its next report creates a new cluster.",
          placeholder: "swarm-production",
        }}
        descriptionField={{
          placeholder: "Production Docker Swarm cluster running in US East",
        }}
      />
      <TelemetryResourceMoreSettings<DockerSwarmCluster>
        modelType={DockerSwarmCluster}
        modelId={modelId}
        resourceName="Docker Swarm cluster"
        modelDetailIdPrefix="model-detail-docker-swarm-cluster"
      />
      <ArchiveResourceCard<DockerSwarmCluster>
        modelType={DockerSwarmCluster}
        modelId={modelId}
        singularName="cluster"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_SWARM_CLUSTERS] as Route,
        )}
      />
    </Fragment>
  );
};

export default DockerSwarmClusterSettings;
