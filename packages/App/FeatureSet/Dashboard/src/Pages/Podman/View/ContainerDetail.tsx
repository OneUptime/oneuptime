import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import Card from "Common/UI/Components/Card/Card";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
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
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import EmbeddedMetricCard from "../../../Components/Metrics/EmbeddedMetricCard";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";

const CONTAINER_ID_ATTR: string = "resource.container.id";
const CONTAINER_IMAGE_ATTR: string = "resource.container.image.name";

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
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const containerName: string = Navigation.getLastParamAsString();

  const [host, setHost] = useState<PodmanHost | null>(null);
  const [containerId, setContainerId] = useState<string>("");
  const [containerImage, setContainerImage] = useState<string>("");
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

      /*
       * Look up the container's id + image from recent docker_stats metrics.
       * filelog-ingested logs only carry resource.container.id (not name), so
       * we resolve the name -> id mapping here so the Logs tab can filter
       * precisely to THIS container.
       */
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(endDate, -10);
      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      /*
       * Same pattern as Containers.tsx — using an `any`-typed query object
       * avoids a TS2589 "excessively deep type instantiation" error on the
       * AnalyticsModelAPI generic select inference when combined with the
       * attributes map filter.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metricQuery: any = {
        modelType: Metric,
        query: {
          projectId: projectId,
          name: "container.cpu.utilization",
          time: new InBetween<Date>(startDate, endDate),
          attributes: {
            "resource.host.name": item.hostIdentifier,
            "resource.container.runtime": "podman",
            "resource.container.name": containerName,
          },
        },
        limit: 1,
        skip: 0,
        select: {
          attributes: true,
        },
        sort: {
          time: SortOrder.Descending,
        },
        requestOptions: {},
      };

      const result: ListResult<Metric> =
        await AnalyticsModelAPI.getList<Metric>(metricQuery);

      if (result.data.length > 0) {
        const attrs: Record<string, unknown> =
          (result.data[0]!.attributes as Record<string, unknown>) || {};
        setContainerId((attrs[CONTAINER_ID_ATTR] as string) || "");
        setContainerImage((attrs[CONTAINER_IMAGE_ATTR] as string) || "");
      }
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
        description: `CPU utilization for ${containerName}`,
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
        description: `Memory usage percentage for ${containerName}`,
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
   * Compose service discovery groups a database image under — read from the
   * container's inventory row (its labels, and its image when no recent
   * metric carried one).
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

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <div className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoCard title="Container Name" value={containerName || "—"} />
            <InfoCard title="Image" value={containerImage || "unknown"} />
            <InfoCard
              title="Container ID"
              value={containerId ? containerId.substring(0, 12) : "unavailable"}
            />
            <InfoCard
              title="Host"
              value={host.name || host.hostIdentifier || "—"}
            />
          </div>
        </div>
      ),
    },
    {
      name: "Metrics",
      children: (
        <EmbeddedMetricCard
          title={`Container Metrics: ${containerName}`}
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
            logQuery={logQuery}
            attributeFilterDisplayKeys={LOG_ATTRIBUTE_DISPLAY_KEYS}
            attributeFilterDisplayValues={logAttributeDisplayValues}
            showFilters={true}
            enableRealtime={true}
            noLogsMessage="No logs found for this container. Make sure the Podman agent's filelog receiver is collecting logs from /var/lib/containers."
          />
        </Card>
      ),
    },
  ];

  return (
    <Fragment>
      <DatabaseServerWorkloadBadge
        resourceLabel="container"
        target={databaseTarget}
      />
      <Tabs tabs={tabs} onTabChange={() => {}} />
    </Fragment>
  );
};

export default PodmanHostContainerDetail;
