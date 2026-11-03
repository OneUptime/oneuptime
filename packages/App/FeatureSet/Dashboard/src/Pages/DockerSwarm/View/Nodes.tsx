import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import Navigation from "Common/UI/Utils/Navigation";
import OneUptimeDate from "Common/Types/Date";
import ResourceTable, {
  InfrastructureResource,
  ResourceColumnTone,
} from "../../../Components/Infrastructure/ResourceTable";
import {
  fetchDockerSwarmInventoryResources,
  routeParamFromExternalId,
} from "../Utils/DockerSwarmResourceUtils";
import { withDockerSwarmStatus } from "../Utils/DockerSwarmPartFacts";
import { isDockerSwarmManager } from "../Utils/DockerSwarmHealth";
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
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The swarm's nodes, each with its state by the swarm's rules
 * (DockerSwarmHealth: Ready, Down, Disconnected, Drained, a manager the
 * others cannot reach) and why, its role and its availability in Docker's
 * words. Swarm reports no CPU or memory per node (the agent reads each task's
 * container), so the list has no usage columns: a task's page and the
 * Tasks list have them.
 */

/*
 * A node's role as Docker gives it, manager or worker: which manager leads
 * is its Manager Status, in the column beside it ("Leader" in both read
 * as one fact said twice).
 */
const ROLE_WORDS: Record<string, string> = {
  manager: translationKey("Manager node"),
  worker: translationKey("Worker node"),
};

const AVAILABILITY_WORDS: Record<string, string> = {
  active: translationKey("Active"),
  drain: translationKey("Drained"),
  pause: translationKey("Paused"),
};

const MANAGER_STATUS_WORDS: Record<string, string> = {
  leader: translationKey("Leader"),
  reachable: translationKey("Reachable"),
  unreachable: translationKey("Unreachable"),
  unknown: translationKey("Unknown"),
};

const DockerSwarmClusterNodes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const translator: Translator = useTranslator();

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const word: (words: Record<string, string>, value: string) => string = (
    words: Record<string, string>,
    value: string,
  ): string => {
    const key: string | undefined = words[value.toLowerCase()];
    return key ? translator.translateText(key) || key : value || "—";
  };

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      /*
       * Postgres inventory read (DockerSwarmResource, kind=Node) — the
       * same rows behind the sidebar badge counts. Role, availability,
       * manager status and engine version ride attributes / columns.
       */
      const now: Date = OneUptimeDate.getCurrentDate();
      const nodeList: Array<InfrastructureResource> =
        await fetchDockerSwarmInventoryResources({
          dockerSwarmClusterId: modelId,
          kind: "Node",
          transform: (
            resource: InfrastructureResource,
            row: DockerSwarmResource,
          ): void => {
            Object.assign(resource, withDockerSwarmStatus(resource, row, now));
            resource.additionalAttributes["role"] = isDockerSwarmManager(row)
              ? "manager"
              : "worker";
          },
        });

      setResources(nodeList);
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
      title="Nodes"
      description="All manager and worker nodes in this Docker Swarm cluster."
      resources={resources}
      isLoading={isLoading}
      error={error}
      showGroupColumn={false}
      showResourceMetrics={false}
      showAge={false}
      tableIdPrefix="docker-swarm"
      builtInColumnDescriptions={{
        status: DOCKER_SWARM_METRIC_DESCRIPTIONS.nodeStatus,
      }}
      emptyMessage="No nodes reported yet. Make sure the Docker Swarm agent is sending metrics."
      columns={[
        {
          title: "Role",
          key: "role",
          description: DOCKER_SWARM_METRIC_DESCRIPTIONS.managers,
          getValue: (resource: InfrastructureResource): string => {
            return word(
              ROLE_WORDS,
              resource.additionalAttributes["role"] || "",
            );
          },
        },
        {
          title: "Availability",
          key: "availability",
          description: DOCKER_SWARM_METRIC_DESCRIPTIONS.availability,
          getValue: (resource: InfrastructureResource): string => {
            return word(
              AVAILABILITY_WORDS,
              resource.additionalAttributes["availability"] || "",
            );
          },
        },
        {
          title: "Manager Status",
          key: "managerStatus",
          description: DOCKER_SWARM_METRIC_DESCRIPTIONS.managerStatus,
          getValue: (resource: InfrastructureResource): string => {
            return word(
              MANAGER_STATUS_WORDS,
              resource.additionalAttributes["managerStatus"] || "",
            );
          },
          getTone: (
            resource: InfrastructureResource,
          ): ResourceColumnTone | undefined => {
            return (
              resource.additionalAttributes["managerStatus"] || ""
            ).toLowerCase() === "unreachable"
              ? "danger"
              : undefined;
          },
        },
        {
          title: "Engine Version",
          key: "engineVersion",
          getValue: (resource: InfrastructureResource): string => {
            return resource.additionalAttributes["engineVersion"] || "—";
          },
        },
      ]}
      getViewRoute={(resource: InfrastructureResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODE_DETAIL] as Route,
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

export default DockerSwarmClusterNodes;
