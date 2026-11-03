import React, { FunctionComponent, ReactElement } from "react";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import Route from "Common/Types/API/Route";
import ResourceTable, {
  InfrastructureResource,
} from "../../Infrastructure/ResourceTable";
import { DOCKER_SWARM_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/DockerSwarmMetricDescriptions";
import { isCurrentDockerSwarmTask } from "../../../Pages/DockerSwarm/Utils/DockerSwarmHealth";
import {
  DOCKER_SWARM_TASK_METRIC_THRESHOLDS,
  withDockerSwarmStatus,
} from "../../../Pages/DockerSwarm/Utils/DockerSwarmPartFacts";
import { toInfrastructureResource } from "../../../Pages/DockerSwarm/Utils/DockerSwarmResourceUtils";

/*
 * The current tasks of a Docker Swarm node or service, each with its state
 * by the swarm's rules (DockerSwarmHealth) and why, its CPU and memory
 * coloured at its alerts' lines, and one step to its page. A node's page
 * names each task's service; a service's page each task's node.
 */

export interface ComponentProps {
  title: string;
  description: string;
  rows: Array<DockerSwarmResource>;
  // The column beside the name: a node's tasks say their service, a service's their node.
  groupBy: "service" | "node";
  getTaskRoute: (externalId: string) => Route;
  now: Date;
  emptyMessage: string;
}

const DockerSwarmTasksTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const resources: Array<InfrastructureResource> = props.rows
    .filter((row: DockerSwarmResource): boolean => {
      return isCurrentDockerSwarmTask(row);
    })
    .map((row: DockerSwarmResource): InfrastructureResource => {
      const resource: InfrastructureResource = withDockerSwarmStatus(
        toInfrastructureResource(row),
        row,
        props.now,
      );
      return {
        ...resource,
        namespace:
          props.groupBy === "service"
            ? row.serviceName || ""
            : row.nodeHostname || "",
      };
    });

  return (
    <div className="mb-6">
      <ResourceTable
        title={props.title}
        description={props.description}
        resources={resources}
        showGroupColumn={true}
        groupColumnTitle={props.groupBy === "service" ? "Service" : "Node"}
        groupFallbackLabel="—"
        showAge={false}
        tableIdPrefix="docker-swarm-part"
        metricThresholds={DOCKER_SWARM_TASK_METRIC_THRESHOLDS}
        builtInColumnDescriptions={{
          status: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskStatus,
          cpu: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskCpuColumn,
          memory: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskMemoryColumn,
        }}
        emptyMessage={props.emptyMessage}
        getViewRoute={(resource: InfrastructureResource): Route => {
          return props.getTaskRoute(
            resource.additionalAttributes["externalId"] || "",
          );
        }}
      />
    </div>
  );
};

export default DockerSwarmTasksTable;
