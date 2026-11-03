import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import Navigation from "Common/UI/Utils/Navigation";
import OneUptimeDate from "Common/Types/Date";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import {
  fetchDockerSwarmInventoryResources,
  routeParamFromExternalId,
} from "../Utils/DockerSwarmResourceUtils";
import { withDockerSwarmStatus } from "../Utils/DockerSwarmPartFacts";
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
 * The swarm's services, each with its replicas by the swarm's rules
 * (DockerSwarmHealth: "2 of 3 running" in amber, none running in red, a
 * paused or rolled-back update, tasks that keep failing) and why, its mode,
 * its stack and its image. Swarm reports no CPU or memory per service (the
 * agent reads each task's container): its tasks have them.
 */

const MODE_WORDS: Record<string, string> = {
  replicated: translationKey("Replicated"),
  global: translationKey("Global"),
  "replicated-job": translationKey("Replicated job"),
  "global-job": translationKey("Global job"),
};

const DockerSwarmClusterServices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const translator: Translator = useTranslator();

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const now: Date = OneUptimeDate.getCurrentDate();
      const serviceList: Array<InfrastructureResource> =
        await fetchDockerSwarmInventoryResources({
          dockerSwarmClusterId: modelId,
          kind: "Service",
          transform: (
            resource: InfrastructureResource,
            row: DockerSwarmResource,
          ): void => {
            Object.assign(resource, withDockerSwarmStatus(resource, row, now));
          },
        });

      setResources(serviceList);
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
      title="Services"
      description="Replicated and global services in this swarm, with their replicas and what needs a look."
      resources={resources}
      isLoading={isLoading}
      error={error}
      showGroupColumn={true}
      groupColumnTitle="Stack"
      groupFallbackLabel="(no stack)"
      showResourceMetrics={false}
      showAge={false}
      tableIdPrefix="docker-swarm"
      builtInColumnDescriptions={{
        status: DOCKER_SWARM_METRIC_DESCRIPTIONS.serviceStatusColumn,
      }}
      emptyMessage="No services reported yet. Make sure the Docker Swarm agent is sending metrics."
      columns={[
        {
          title: "Mode",
          key: "serviceMode",
          getValue: (resource: InfrastructureResource): string => {
            const mode: string = (
              resource.additionalAttributes["serviceMode"] || ""
            ).toLowerCase();
            const word: string | undefined = MODE_WORDS[mode];
            return word ? translator.translateText(word) || word : mode || "—";
          },
        },
        {
          title: "Replicas",
          key: "replicas",
          description: DOCKER_SWARM_METRIC_DESCRIPTIONS.replicas,
          getValue: (resource: InfrastructureResource): string => {
            return resource.additionalAttributes["replicas"] || "—";
          },
        },
        {
          title: "Image",
          key: "image",
          // Whole, tag included: it breaks after its dots and slashes.
          isName: true,
          getValue: (resource: InfrastructureResource): string => {
            return resource.additionalAttributes["image"] || "—";
          },
        },
      ]}
      getViewRoute={(resource: InfrastructureResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICE_DETAIL] as Route,
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

export default DockerSwarmClusterServices;
