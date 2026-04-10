import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Log from "Common/Models/AnalyticsModels/Log";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
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
import { JSONObject } from "Common/Types/JSON";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Table from "Common/UI/Components/Table/Table";
import FieldType from "Common/UI/Components/Types/FieldType";
import Column from "Common/UI/Components/Table/Types/Column";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

interface DockerLogRow {
  timestamp: string;
  containerName: string;
  severity: string;
  message: string;
}

const PAGE_SIZE: number = 50;

const DockerHostLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [logs, setLogs] = useState<Array<DockerLogRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Descending);

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
      const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -1);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queryOptions: any = {
        modelType: Log,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!.toString(),
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
          body: true,
          severityText: true,
          attributes: true,
        },
        sort: {
          time: SortOrder.Descending,
        },
        requestOptions: {},
      };

      const listResult: ListResult<Log> =
        await AnalyticsModelAPI.getList<Log>(queryOptions);

      const dockerLogs: Array<DockerLogRow> = [];

      for (const log of listResult.data) {
        const attrs: JSONObject = (log.attributes as JSONObject) || {};

        const containerId: string =
          (attrs["resource.container.id"] as string) || "";
        const containerName: string =
          (attrs["resource.container.name"] as string) ||
          (containerId ? containerId.substring(0, 12) : "unknown");

        dockerLogs.push({
          timestamp: log.time
            ? OneUptimeDate.getDateAsLocalFormattedString(log.time)
            : "",
          containerName: containerName,
          severity: log.severityText || "info",
          message:
            typeof log.body === "string" ? log.body : JSON.stringify(log.body),
        });
      }

      setLogs(dockerLogs);
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

  const paginatedData: Array<DockerLogRow> = useMemo(() => {
    const start: number = (currentPage - 1) * PAGE_SIZE;
    return logs.slice(start, start + PAGE_SIZE);
  }, [logs, currentPage]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const tableColumns: Array<Column<DockerLogRow>> = [
    {
      title: "Time",
      type: FieldType.Text,
      key: "timestamp",
    },
    {
      title: "Container",
      type: FieldType.Text,
      key: "containerName",
    },
    {
      title: "Severity",
      type: FieldType.Text,
      key: "severity",
    },
    {
      title: "Message",
      type: FieldType.Text,
      key: "message",
    },
  ];

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

  return (
    <Card
      title="Container Logs"
      description="Logs from containers on this Docker host (last 1 hour)."
      buttons={cardButtons}
    >
      <Table<DockerLogRow>
        id="docker-logs-table"
        columns={tableColumns}
        data={paginatedData}
        singularLabel="Log Entry"
        pluralLabel="Log Entries"
        isLoading={false}
        error=""
        currentPageNumber={currentPage}
        totalItemsCount={logs.length}
        itemsOnPage={paginatedData.length}
        onNavigateToPage={(page: number) => {
          setCurrentPage(page);
        }}
        sortBy={sortBy as keyof DockerLogRow | null}
        sortOrder={sortOrder}
        onSortChanged={(
          newSortBy: keyof DockerLogRow | null,
          newSortOrder: SortOrder,
        ) => {
          setSortBy(newSortBy as string | null);
          setSortOrder(newSortOrder);
        }}
        noItemsMessage="No container logs found. Make sure the Docker agent is configured to collect container logs."
      />
    </Card>
  );
};

export default DockerHostLogs;
