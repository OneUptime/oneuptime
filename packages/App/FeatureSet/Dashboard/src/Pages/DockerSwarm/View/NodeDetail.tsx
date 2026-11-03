import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ResourcePartReadError from "../../../Components/ResourcePart/ResourcePartReadError";
import DockerSwarmPartHero from "../../../Components/DockerSwarm/Part/DockerSwarmPartHero";
import DockerSwarmNodeOverview from "../../../Components/DockerSwarm/Part/DockerSwarmNodeOverview";
import {
  DockerSwarmPartRoutes,
  getDockerSwarmPartRoutes,
} from "../../../Components/DockerSwarm/Part/DockerSwarmPartRoutes";
import useDockerSwarmPart, {
  DockerSwarmPart,
} from "../../../Components/DockerSwarm/Part/UseDockerSwarmPart";
import { getDockerSwarmNodeRows } from "../Utils/DockerSwarmHealth";
import { countDockerSwarmTasks } from "../Utils/DockerSwarmPartFacts";
import { externalIdFromRouteParam } from "../Utils/DockerSwarmResourceUtils";

/*
 * A Docker Swarm node's page: its hero (its state by the swarm's rules, its
 * role, its tasks running, CPUs and memory), then its Overview - what needs
 * attention on it and the tasks it runs, those tasks, what is open on it,
 * the node alerts and its details.
 */
const DockerSwarmClusterNodeDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../docker-swarm/:modelId/nodes/:subModelId — subModelId
   * is the percent-encoded externalId ("node/<id>"), not a DB id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const part: DockerSwarmPart = useDockerSwarmPart({
    clusterId: modelId,
    kind: "Node",
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
          testId="docker-swarm-node-read-error"
          title="Couldn't load this node"
          message={part.rowError}
          onRetry={part.refresh}
        />
      ) : (
        <DockerSwarmNodeOverview
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
    <div data-testid="docker-swarm-node-page">
      <DockerSwarmPartHero
        kind="Node"
        row={part.row}
        externalId={externalId}
        clusterName={clusterName}
        clusterRoute={routes.clusterRoute}
        getPartRoute={routes.getPartRoute}
        taskCount={
          part.row
            ? countDockerSwarmTasks(
                getDockerSwarmNodeRows({ rows: part.rows, node: part.row }),
              )
            : undefined
        }
        now={part.readAt}
      />
      <Tabs tabs={tabs} wrap={true} onTabChange={() => {}} />
    </div>
  );
};

export default DockerSwarmClusterNodeDetail;
