import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Card from "Common/UI/Components/Card/Card";
import Table from "Common/UI/Components/Table/Table";
import FieldType from "Common/UI/Components/Types/FieldType";
import Column from "Common/UI/Components/Table/Types/Column";

interface DockerContainerRow {
  containerName: string;
  containerImage: string;
  cpuPercent: string;
  memoryUsage: string;
  networkRx: string;
  networkTx: string;
}

const DockerHostContainers: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [containers, setContainers] = useState<Array<DockerContainerRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const host: DockerHost | null = await ModelAPI.getItem({
        modelType: DockerHost,
        id: modelId,
        select: {
          hostIdentifier: true,
        },
      });

      if (!host?.hostIdentifier) {
        setError("Host not found.");
        setIsLoading(false);
        return;
      }

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(endDate, -5);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queryOptions: any = {
        modelType: Metric,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!.toString(),
          name: "container.cpu.usage.total",
          time: new InBetween<Date>(startDate, endDate),
          attributes: {
            "resource.host.name": host.hostIdentifier,
            "resource.container.runtime": "docker",
          },
        },
        limit: 500,
        skip: 0,
        select: {
          time: true,
          value: true,
          attributes: true,
        },
        sort: {
          time: SortOrder.Descending,
        },
        requestOptions: {},
      };

      const listResult: ListResult<Metric> =
        await AnalyticsModelAPI.getList<Metric>(queryOptions);

      // Deduplicate by container name (take latest value)
      const containerMap: Map<string, DockerContainerRow> = new Map();

      for (const metric of listResult.data) {
        const attrs: Record<string, unknown> =
          (metric.attributes as Record<string, unknown>) || {};
        const name: string =
          (attrs["resource.container.name"] as string) || "unknown";

        if (!containerMap.has(name)) {
          containerMap.set(name, {
            containerName: name,
            containerImage:
              (attrs["resource.container.image.name"] as string) || "unknown",
            cpuPercent: metric.value
              ? `${(Number(metric.value) * 100).toFixed(2)}%`
              : "N/A",
            memoryUsage: "N/A",
            networkRx: "N/A",
            networkTx: "N/A",
          });
        }
      }

      setContainers(Array.from(containerMap.values()));
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

  const tableColumns: Array<Column<DockerContainerRow>> = useMemo(() => {
    return [
      {
        title: "Container Name",
        type: FieldType.Text,
        key: "containerName",
      },
      {
        title: "Image",
        type: FieldType.Text,
        key: "containerImage",
      },
      {
        title: "CPU Usage",
        type: FieldType.Text,
        key: "cpuPercent",
      },
      {
        title: "Memory Usage",
        type: FieldType.Text,
        key: "memoryUsage",
      },
      {
        title: "Network RX",
        type: FieldType.Text,
        key: "networkRx",
      },
      {
        title: "Network TX",
        type: FieldType.Text,
        key: "networkTx",
      },
    ];
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Card
      title="Docker Containers"
      description="Containers running on this Docker host."
    >
      <Table<DockerContainerRow>
        id="docker-containers-table"
        columns={tableColumns}
        data={containers}
        singularLabel="Container"
        pluralLabel="Containers"
        isLoading={false}
        error=""
        currentPageNumber={1}
        totalItemsCount={containers.length}
        itemsOnPage={containers.length}
        onNavigateToPage={() => {}}
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        noItemsMessage="No containers found. Make sure the Docker agent is sending metrics."
      />
    </Card>
  );
};

export default DockerHostContainers;
