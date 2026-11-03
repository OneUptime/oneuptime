import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ResourcePartReadError from "../../../Components/ResourcePart/ResourcePartReadError";
import ResourcePartTabs from "../../../Components/ResourcePart/ResourcePartTabs";
import DockerSwarmPartHero from "../../../Components/DockerSwarm/Part/DockerSwarmPartHero";
import DockerSwarmServiceOverview from "../../../Components/DockerSwarm/Part/DockerSwarmServiceOverview";
import {
  DockerSwarmPartRoutes,
  getDockerSwarmPartRoutes,
} from "../../../Components/DockerSwarm/Part/DockerSwarmPartRoutes";
import useDockerSwarmPart, {
  DockerSwarmPart,
} from "../../../Components/DockerSwarm/Part/UseDockerSwarmPart";
import { getDockerSwarmServiceRows } from "../Utils/DockerSwarmHealth";
import { countDockerSwarmTasks } from "../Utils/DockerSwarmPartFacts";
import { externalIdFromRouteParam } from "../Utils/DockerSwarmResourceUtils";

/*
 * A Docker Swarm service's page: its hero (its replicas by the swarm's
 * rules, its mode, its stack, its tasks running), then its Overview - what
 * needs attention on it and its tasks (with Docker's own error), its tasks,
 * what is open on it, the service alerts and its details.
 */
const DockerSwarmClusterServiceDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../docker-swarm/:modelId/services/:subModelId —
   * subModelId is the percent-encoded externalId ("service/<id>").
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const part: DockerSwarmPart = useDockerSwarmPart({
    clusterId: modelId,
    kind: "Service",
    externalId: externalId,
  });

  if (part.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (part.error) {
    return <ErrorMessage message={part.error} />;
  }

  if (!part.cluster?.name) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const clusterName: string = part.cluster.name;
  const routes: DockerSwarmPartRoutes = getDockerSwarmPartRoutes(modelId);

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: part.isLoadingRows ? (
        <PageLoader isVisible={true} />
      ) : part.rowError ? (
        <ResourcePartReadError
          testId="docker-swarm-service-read-error"
          title="Couldn't load this service"
          message={part.rowError}
          onRetry={part.refresh}
        />
      ) : (
        <DockerSwarmServiceOverview
          clusterId={modelId}
          clusterName={clusterName}
          externalId={externalId}
          row={part.row}
          rows={part.rows}
          routes={routes}
          now={part.readAt}
        />
      ),
    },
  ];

  return (
    <div data-testid="docker-swarm-service-page">
      <DockerSwarmPartHero
        kind="Service"
        row={part.row}
        externalId={externalId}
        clusterName={clusterName}
        clusterRoute={routes.clusterRoute}
        getPartRoute={routes.getPartRoute}
        taskCount={
          part.row
            ? countDockerSwarmTasks(
                getDockerSwarmServiceRows({
                  rows: part.rows,
                  service: part.row,
                }),
              )
            : undefined
        }
        now={part.readAt}
      />
      <ResourcePartTabs tabs={tabs} />
    </div>
  );
};

export default DockerSwarmClusterServiceDetail;
