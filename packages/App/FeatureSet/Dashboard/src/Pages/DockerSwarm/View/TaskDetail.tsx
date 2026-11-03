import PageComponentProps from "../../PageComponentProps";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import Log from "Common/Models/AnalyticsModels/Log";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import ResourcePartReadError from "../../../Components/ResourcePart/ResourcePartReadError";
import DockerSwarmPartHero from "../../../Components/DockerSwarm/Part/DockerSwarmPartHero";
import DockerSwarmTaskOverview from "../../../Components/DockerSwarm/Part/DockerSwarmTaskOverview";
import {
  DockerSwarmPartRoutes,
  getDockerSwarmPartRoutes,
} from "../../../Components/DockerSwarm/Part/DockerSwarmPartRoutes";
import useDockerSwarmPart, {
  DockerSwarmPart,
} from "../../../Components/DockerSwarm/Part/UseDockerSwarmPart";
import { getDockerSwarmAttribute } from "../Utils/DockerSwarmHealth";
import {
  externalIdFromRouteParam,
  keyForDockerSwarmCluster,
} from "../Utils/DockerSwarmResourceUtils";

/*
 * A Docker Swarm task's page: its hero (its state by the swarm's rules,
 * its service and node - each a link -, its slot and container), its
 * Overview - what needs attention on it with Docker's own error, what it
 * uses, what is open on it, the task alerts and its details - and its
 * container's logs.
 */

// The part of the inventory a task sits in, by name: its service, its node.
function findExternalId(
  rows: Array<DockerSwarmResource>,
  kind: "Service" | "Node",
  name: string | undefined,
): string | undefined {
  if (!name) {
    return undefined;
  }
  const wanted: string = name.toLowerCase();
  return (
    rows.find((row: DockerSwarmResource): boolean => {
      return row.kind === kind && (row.name || "").toLowerCase() === wanted;
    })?.externalId || undefined
  );
}

const DockerSwarmClusterTaskDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Route shape: .../docker-swarm/:modelId/tasks/:subModelId — subModelId
   * is the percent-encoded externalId ("task/<id>"), not a DB id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const part: DockerSwarmPart = useDockerSwarmPart({
    clusterId: modelId,
    kind: "Task",
    externalId: externalId,
  });

  const containerId: string = part.row
    ? getDockerSwarmAttribute(part.row, "containerId")
    : "";
  const clusterName: string = part.cluster?.name || "";

  /*
   * The container's own logs: the agent files each container's lines under
   * its id (container.id), which the poller now reports for each task.
   */
  const logQuery: Query<Log> = useMemo(() => {
    // `any` sidesteps a TS2589 deep instantiation, as the cluster's Logs page.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = {
      attributes: {
        "resource.docker.swarm.cluster.name": clusterName,
        "resource.container.id": containerId,
      },
    };
    return query as Query<Log>;
  }, [clusterName, containerId]);

  if (part.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (part.error) {
    return <ErrorMessage message={part.error} />;
  }

  if (!part.cluster?.name) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const routes: DockerSwarmPartRoutes = getDockerSwarmPartRoutes(modelId);
  const serviceExternalId: string | undefined = findExternalId(
    part.rows,
    "Service",
    part.row?.serviceName,
  );
  const nodeExternalId: string | undefined = findExternalId(
    part.rows,
    "Node",
    part.row?.nodeHostname,
  );

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: part.isLoadingRows ? (
        <PageLoader isVisible={true} />
      ) : part.rowError ? (
        <ResourcePartReadError
          testId="docker-swarm-task-read-error"
          title="Couldn't load this task"
          message={part.rowError}
          onRetry={part.refresh}
        />
      ) : (
        <DockerSwarmTaskOverview
          clusterId={modelId}
          clusterName={clusterName}
          externalId={externalId}
          row={part.row}
          routes={routes}
          serviceExternalId={serviceExternalId}
          nodeExternalId={nodeExternalId}
          now={part.readAt}
        />
      ),
    },
  ];

  if (containerId) {
    tabs.push({
      name: "Logs",
      children: (
        <DashboardLogsViewer
          id={`docker-swarm-task-logs-${externalId}`}
          logQuery={logQuery}
          attributeFilterDisplayKeys={{
            "resource.docker.swarm.cluster.name": "Cluster",
            "resource.container.id": "Container",
          }}
          entityScope={{
            entityKeys: [
              keyForDockerSwarmCluster(
                ProjectUtil.getCurrentProjectId()!.toString(),
                clusterName,
              ),
            ],
            attributeKey: "resource.docker.swarm.cluster.name",
            attributeValue: clusterName,
          }}
          showFilters={true}
          enableRealtime={true}
          noLogsMessage="No logs from this task's container in this range. The agent sends the logs of containers that use Docker's json-file log driver, on each node it runs on."
        />
      ),
    });
  }

  return (
    <div data-testid="docker-swarm-task-page">
      <DockerSwarmPartHero
        kind="Task"
        row={part.row}
        externalId={externalId}
        clusterName={clusterName}
        clusterRoute={routes.clusterRoute}
        getPartRoute={routes.getPartRoute}
        serviceExternalId={serviceExternalId}
        nodeExternalId={nodeExternalId}
        now={part.readAt}
      />
      <Tabs tabs={tabs} wrap={true} onTabChange={() => {}} />
    </div>
  );
};

export default DockerSwarmClusterTaskDetail;
