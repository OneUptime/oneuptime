import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import Navigation from "Common/UI/Utils/Navigation";
import OneUptimeDate from "Common/Types/Date";
import ResourceTable, {
  InfrastructureResource,
  ResourceColumn,
} from "../../../Components/Infrastructure/ResourceTable";
import {
  fetchDockerSwarmInventoryResources,
  formatBytes,
  routeParamFromExternalId,
} from "../Utils/DockerSwarmResourceUtils";
import {
  DOCKER_SWARM_TASK_METRIC_THRESHOLDS,
  withDockerSwarmStatus,
} from "../Utils/DockerSwarmPartFacts";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { DOCKER_SWARM_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/DockerSwarmMetricDescriptions";

/*
 * The tasks Swarm wants running, each with its state by the swarm's rules
 * (DockerSwarmHealth: Running, Starting, Pending with Docker's error, Failed,
 * Rejected, a task close to its memory limit) and why, its node, and its CPU
 * and memory coloured at its alerts' lines.
 */

/*
 * The list's own column beside ResourceTable's: each task's image. No
 * Service column: a task's name is its service's and its slot ("shop_web.2"),
 * as docker service ps names it, and a column that said it again pushed each
 * task's CPU and memory out of view at 1280.
 */
const TASK_COLUMNS: Array<ResourceColumn> = [
  {
    title: "Image",
    key: "image",
    /*
     * Under the task's name when the table is short of room: a registry
     * path as wide as a column of its own pushed each task's CPU and memory
     * - what its state is judged by - out of view.
     */
    foldInto: "name",
    // Whole, tag included: it breaks after its dots and slashes.
    isName: true,
    getValue: (resource: InfrastructureResource): string => {
      return resource.additionalAttributes["image"] || "—";
    },
  },
];

const DockerSwarmClusterTasks: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      /*
       * Postgres inventory read (DockerSwarmResource, kind=Task). Parent
       * service and image ride the inventory row; per-task CPU/memory
       * come off the docker_stats mirror. The scheduled node groups the
       * table.
       */
      const now: Date = OneUptimeDate.getCurrentDate();
      const taskList: Array<InfrastructureResource> =
        await fetchDockerSwarmInventoryResources({
          dockerSwarmClusterId: modelId,
          kind: "Task",
          transform: (
            resource: InfrastructureResource,
            row: DockerSwarmResource,
          ): void => {
            Object.assign(resource, withDockerSwarmStatus(resource, row, now));
          },
        });

      setResources(taskList);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  return (
    <ResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Tasks"
      description="The tasks (containers) of this swarm's services, with their state and what each one uses."
      resources={resources}
      isLoading={isLoading}
      error={error}
      showGroupColumn={true}
      groupColumnTitle="Node"
      groupFallbackLabel="—"
      showAge={false}
      tableIdPrefix="docker-swarm"
      metricThresholds={DOCKER_SWARM_TASK_METRIC_THRESHOLDS}
      // "471 MiB", as Docker and the task's own page write it.
      formatMemory={formatBytes}
      builtInColumnDescriptions={{
        status: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskStatus,
        cpu: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskCpuColumn,
        memory: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskMemoryColumn,
      }}
      emptyMessage="No tasks reported yet. Make sure the Docker Swarm agent is sending metrics."
      columns={TASK_COLUMNS}
      getViewRoute={(resource: InfrastructureResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASK_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: routeParamFromExternalId(
              resource.additionalAttributes["externalId"] || "",
            ),
          },
        );
      }}
    />
  );
};

export default DockerSwarmClusterTasks;
