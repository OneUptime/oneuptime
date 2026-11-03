import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Card from "Common/UI/Components/Card/Card";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import DatabaseServerWorkloadBadge from "../../../Components/DatabaseServer/DatabaseServerWorkloadBadge";
import { DatabaseWorkloadTarget } from "../../../Components/DatabaseServer/DatabaseWorkloadLookup";
import useContainerDatabaseWorkloadTarget from "../../../Components/DatabaseServer/useContainerDatabaseWorkloadTarget";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import {
  buildSavedViewScope,
  SavedViewScopeKind,
} from "Common/Utils/Telemetry/SavedViewScope";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import EmbeddedMetricCard from "../../../Components/Metrics/EmbeddedMetricCard";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ResourcePartReadError from "../../../Components/ResourcePart/ResourcePartReadError";
import ContainerHostContainerHero from "../../../Components/ContainerHost/ContainerHostContainerHero";
import ContainerHostContainerOverview from "../../../Components/ContainerHost/ContainerHostContainerOverview";
import { ContainerHostContainer } from "../../../Components/ContainerHost/ContainerHostHealth";
import {
  ContainerHostRoutes,
  PODMAN_CONTAINER_HOST_RUNTIME,
  getContainerHostRoutes,
} from "../../../Components/ContainerHost/ContainerHostRuntime";
import useContainerHostReadings, {
  ContainerHostReadingsState,
} from "../../../Components/ContainerHost/UseContainerHostReadings";

/*
 * A Podman container's page: its hero (its state by the host's rules, the
 * host it runs on, its image and Compose project), its Overview - what needs
 * attention on it, what it uses, how often it restarted, what is open on it,
 * the container alerts and its details (ContainerHostContainerOverview) -
 * its metrics and its logs.
 */

/*
 * Labels for the locked chips the Logs tab builds from logQuery.attributes.
 * Without them the chips read as raw OTel resource keys
 * ("resource.container.id: 3f2a9c…"). Display only — the query keeps
 * filtering on the attribute keys and values.
 */
const LOG_ATTRIBUTE_DISPLAY_KEYS: Record<string, string> = {
  "resource.host.name": "Podman Host",
  "resource.container.runtime": "Runtime",
  "resource.container.id": "Container",
};

const PodmanHostContainerDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const containerName: string = Navigation.getLastParamAsString();

  const [host, setHost] = useState<PodmanHost | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: PodmanHost | null = await ModelAPI.getItem({
        modelType: PodmanHost,
        id: modelId,
        select: {
          hostIdentifier: true,
          name: true,
        },
      });

      if (!item?.hostIdentifier) {
        setError("Host not found.");
        setIsLoading(false);
        return;
      }

      setHost(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [containerName]);

  /*
   * Every container of the host with its latest readings (the host's
   * newest reading is what this one is measured against), its restarts and
   * its inventory row - its id, image, labels and when its run started.
   */
  const readingsState: ContainerHostReadingsState = useContainerHostReadings({
    runtime: PODMAN_CONTAINER_HOST_RUNTIME,
    hostId: modelId,
    hostIdentifier: host?.hostIdentifier as string | undefined,
  });

  const container: ContainerHostContainer | null = useMemo(() => {
    return (
      readingsState.readings?.containers.find(
        (candidate: ContainerHostContainer): boolean => {
          return candidate.name === containerName;
        },
      ) || null
    );
  }, [readingsState.readings, containerName]);

  /*
   * filelog-ingested logs only carry resource.container.id (not name), so
   * the name -> id mapping comes from the container's readings and its
   * inventory row, and the Logs tab filters precisely to THIS container.
   */
  const containerId: string = container?.containerId || "";
  const containerImage: string = container?.image || "";

  const logQuery: Query<Log> = useMemo(() => {
    const attributeFilters: Record<string, string> = {
      "resource.host.name": host?.hostIdentifier || "",
      "resource.container.runtime": "podman",
    };

    /*
     * filelog records the container id (not name) from the file path.
     * If we resolved it from docker_stats metrics, filter exactly.
     */
    if (containerId) {
      attributeFilters["resource.container.id"] = containerId;
    }

    // Cast via `any` to sidestep a TS2589 depth error on Query<Log>.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = { attributes: attributeFilters };
    return q as Query<Log>;
  }, [host?.hostIdentifier, containerId]);

  /*
   * What the Logs tab's locked chips read. The filter matches the host's
   * machine identifier and the container's id (filelog only records the
   * id), but a person knows the host by its name and the container by the
   * name they clicked through from — show those instead.
   */
  const logAttributeDisplayValues: Record<string, string> = useMemo(() => {
    const displayValues: Record<string, string> = {
      "resource.host.name": host?.name || host?.hostIdentifier || "",
    };

    if (containerId) {
      displayValues["resource.container.id"] = containerName || containerId;
    }

    return displayValues;
  }, [host?.name, host?.hostIdentifier, containerId, containerName]);

  const metricQueryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    const hostIdentifier: string = host?.hostIdentifier || "";

    const commonAttributes: Record<string, string> = {
      "resource.host.name": hostIdentifier,
      "resource.container.runtime": "podman",
      "resource.container.name": containerName,
    };

    const cpuQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "container_cpu",
        title: "CPU Utilization",
        description: translator.translateTemplate(
          "CPU utilization for {{containerName}}",
          { containerName: containerName },
        ),
        legend: "CPU %",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "container.cpu.utilization",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    const memPctQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "container_memory_percent",
        title: "Memory Usage",
        description: translator.translateTemplate(
          "Memory usage percentage for {{containerName}}",
          { containerName: containerName },
        ),
        legend: "Memory %",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "container.memory.percent",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    return [cpuQuery, memPctQuery];
  }, [host?.hostIdentifier, containerName]);

  /*
   * The Database discovered in this container, if any: by its name, or the
   * Swarm / Compose service discovery groups a database image under — read
   * from the container's inventory row (its labels, and its image when no
   * recent metric carried one).
   */
  const databaseTarget: DatabaseWorkloadTarget | null =
    useContainerDatabaseWorkloadTarget({
      platform: "podman",
      hostId: modelId,
      containerName: containerName,
      imageName: containerImage,
    });

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host) {
    return <ErrorMessage message="Host not found." />;
  }

  const routes: ContainerHostRoutes = getContainerHostRoutes(
    PODMAN_CONTAINER_HOST_RUNTIME,
    modelId,
  );
  const hostName: string = host.name || host.hostIdentifier || "—";

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children:
        readingsState.isLoading && !readingsState.readings ? (
          <PageLoader isVisible={true} />
        ) : readingsState.error && !readingsState.readings ? (
          <ResourcePartReadError
            testId="container-host-container-read-error"
            title="Couldn't load this container"
            message={readingsState.error}
            onRetry={readingsState.refresh}
          />
        ) : (
          <ContainerHostContainerOverview
            runtime={PODMAN_CONTAINER_HOST_RUNTIME}
            hostId={modelId}
            hostName={hostName}
            hostIdentifier={host.hostIdentifier || ""}
            container={container}
            hostLatestReadingAt={
              readingsState.readings?.hostLatestReadingAt || null
            }
            hasRestartCounts={Boolean(readingsState.readings?.hasRestartCounts)}
            routes={routes}
            readAt={readingsState.readings?.readAt || new Date()}
          />
        ),
    },
    {
      name: "Metrics",
      children: (
        <EmbeddedMetricCard
          title={translator.translateTemplate(
            "Container Metrics: {{containerName}}",
            { containerName: containerName },
          )}
          description="CPU and memory usage for this container."
          queryConfigs={metricQueryConfigs}
        />
      ),
    },
    {
      name: "Logs",
      children: (
        <Card
          title="Container Logs"
          description={
            containerId
              ? "Live OpenTelemetry logs for this container."
              : "Showing logs for this Podman host. Specific container filtering is unavailable until the agent reports container metadata."
          }
        >
          <DashboardLogsViewer
            id={`podman-container-logs-${containerName}`}
            savedViewScope={buildSavedViewScope(
              SavedViewScopeKind.PodmanContainer,
              modelId,
              containerName,
            )}
            logQuery={logQuery}
            attributeFilterDisplayKeys={LOG_ATTRIBUTE_DISPLAY_KEYS}
            attributeFilterDisplayValues={logAttributeDisplayValues}
            showFilters={true}
            enableRealtime={true}
            noLogsMessage="Make sure the Podman agent's filelog receiver is collecting logs from /var/lib/containers."
          />
        </Card>
      ),
    },
  ];

  return (
    <Fragment>
      <ContainerHostContainerHero
        containerName={containerName}
        container={container}
        hostLatestReadingAt={
          readingsState.readings?.hostLatestReadingAt || null
        }
        hostName={hostName}
        hostRoute={routes.hostRoute}
      />
      <DatabaseServerWorkloadBadge
        resourceLabel="container"
        target={databaseTarget}
      />
      <Tabs tabs={tabs} onTabChange={() => {}} />
    </Fragment>
  );
};

export default PodmanHostContainerDetail;
