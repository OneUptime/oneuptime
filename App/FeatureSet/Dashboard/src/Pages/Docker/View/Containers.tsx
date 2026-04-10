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
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Table from "Common/UI/Components/Table/Table";
import FieldType from "Common/UI/Components/Types/FieldType";
import Column from "Common/UI/Components/Table/Types/Column";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

interface DockerContainerRow {
  containerName: string;
  containerImage: string;
  cpuPercent: string;
  memoryUsage: string;
  memoryPercent: string;
  networkRx: string;
  networkTx: string;
}

const CONTAINER_NAME_ATTR: string = "resource.container.name";
const CONTAINER_IMAGE_ATTR: string = "resource.container.image.name";

const formatBytes: (bytes: number) => string = (bytes: number): string => {
  if (!isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units: Array<string> = ["B", "KB", "MB", "GB", "TB"];
  let value: number = bytes;
  let idx: number = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const DockerHostContainers: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [containers, setContainers] = useState<Array<DockerContainerRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
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

      const metricNames: Array<string> = [
        "container.cpu.utilization",
        "container.memory.usage.total",
        "container.memory.percent",
        "container.network.io.usage.rx_bytes",
        "container.network.io.usage.tx_bytes",
      ];

      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buildQuery: (metricName: string) => any = (metricName: string) => {
        return {
          modelType: Metric,
          query: {
            projectId: projectId,
            name: metricName,
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
      };

      const results: Array<ListResult<Metric>> = await Promise.all(
        metricNames.map((n: string) => {
          return AnalyticsModelAPI.getList<Metric>(buildQuery(n));
        }),
      );

      // For each metric, take the latest value per container name.
      const latestByMetric: Map<string, Map<string, Metric>> = new Map();
      metricNames.forEach((name: string, idx: number) => {
        const perContainer: Map<string, Metric> = new Map();
        const listResult: ListResult<Metric> = results[idx]!;
        for (const metric of listResult.data) {
          const attrs: Record<string, unknown> =
            (metric.attributes as Record<string, unknown>) || {};
          const containerName: string =
            (attrs[CONTAINER_NAME_ATTR] as string) || "";
          if (!containerName) {
            continue;
          }
          if (!perContainer.has(containerName)) {
            perContainer.set(containerName, metric);
          }
        }
        latestByMetric.set(name, perContainer);
      });

      // Collect union of container names.
      const containerNames: Set<string> = new Set();
      for (const perContainer of latestByMetric.values()) {
        for (const name of perContainer.keys()) {
          containerNames.add(name);
        }
      }

      const rows: Array<DockerContainerRow> = [];
      for (const containerName of containerNames) {
        // Pick image from whichever metric has it.
        let image: string = "unknown";
        for (const perContainer of latestByMetric.values()) {
          const m: Metric | undefined = perContainer.get(containerName);
          if (m) {
            const attrs: Record<string, unknown> =
              (m.attributes as Record<string, unknown>) || {};
            const img: string = (attrs[CONTAINER_IMAGE_ATTR] as string) || "";
            if (img) {
              image = img;
              break;
            }
          }
        }

        const cpuMetric: Metric | undefined = latestByMetric
          .get("container.cpu.utilization")
          ?.get(containerName);
        const memBytesMetric: Metric | undefined = latestByMetric
          .get("container.memory.usage.total")
          ?.get(containerName);
        const memPctMetric: Metric | undefined = latestByMetric
          .get("container.memory.percent")
          ?.get(containerName);
        const rxMetric: Metric | undefined = latestByMetric
          .get("container.network.io.usage.rx_bytes")
          ?.get(containerName);
        const txMetric: Metric | undefined = latestByMetric
          .get("container.network.io.usage.tx_bytes")
          ?.get(containerName);

        rows.push({
          containerName: containerName,
          containerImage: image,
          cpuPercent:
            cpuMetric && cpuMetric.value !== undefined
              ? `${Number(cpuMetric.value).toFixed(2)}%`
              : "—",
          memoryUsage:
            memBytesMetric && memBytesMetric.value !== undefined
              ? formatBytes(Number(memBytesMetric.value))
              : "—",
          memoryPercent:
            memPctMetric && memPctMetric.value !== undefined
              ? `${Number(memPctMetric.value).toFixed(2)}%`
              : "—",
          networkRx:
            rxMetric && rxMetric.value !== undefined
              ? formatBytes(Number(rxMetric.value))
              : "—",
          networkTx:
            txMetric && txMetric.value !== undefined
              ? formatBytes(Number(txMetric.value))
              : "—",
        });
      }

      rows.sort((a: DockerContainerRow, b: DockerContainerRow) => {
        return a.containerName.localeCompare(b.containerName);
      });

      setContainers(rows);
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
        title: "CPU",
        type: FieldType.Text,
        key: "cpuPercent",
      },
      {
        title: "Memory",
        type: FieldType.Text,
        key: "memoryUsage",
      },
      {
        title: "Memory %",
        type: FieldType.Text,
        key: "memoryPercent",
      },
      {
        title: "Network RX (total)",
        type: FieldType.Text,
        key: "networkRx",
      },
      {
        title: "Network TX (total)",
        type: FieldType.Text,
        key: "networkTx",
      },
    ];
  }, []);

  const cardButtons: Array<CardButtonSchema> = [
    {
      title: "",
      buttonStyle: ButtonStyleType.ICON,
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: () => {
        fetchData().catch(() => {});
      },
      icon: IconProp.Refresh,
    },
  ];

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Card
      title="Docker Containers"
      description="Containers running on this Docker host (last 5 minutes)."
      buttons={cardButtons}
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
        noItemsMessage="No containers found in the last 5 minutes. Make sure the Docker agent is sending metrics."
      />
    </Card>
  );
};

export default DockerHostContainers;
