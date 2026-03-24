import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
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
import { getKvValue, getKvStringValue } from "../Utils/KubernetesObjectParser";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Table from "Common/UI/Components/Table/Table";
import FieldType from "Common/UI/Components/Types/FieldType";
import Column from "Common/UI/Components/Table/Types/Column";
import Filter from "Common/UI/Components/Filters/Types/Filter";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";
import Search from "Common/Types/BaseDatabase/Search";
import Includes from "Common/Types/BaseDatabase/Includes";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

interface KubernetesEventRow {
  timestamp: string;
  type: string;
  reason: string;
  objectKind: string;
  objectName: string;
  object: string;
  namespace: string;
  message: string;
}

const PAGE_SIZE: number = 25;

const KubernetesClusterEvents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [events, setEvents] = useState<Array<KubernetesEventRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Descending);
  const [showFilterModal, setShowFilterModal] = useState<boolean>(false);
  const [filterData, setFilterData] = useState<FilterData<KubernetesEventRow>>(
    {},
  );

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
        },
      });

      if (!item?.clusterIdentifier) {
        setError("Cluster not found.");
        setIsLoading(false);
        return;
      }

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -24);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eventsQueryOptions: any = {
        modelType: Log,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!.toString(),
          time: new InBetween<Date>(startDate, endDate),
          attributes: {
            "logAttributes.event.domain": "k8s",
            "logAttributes.k8s.resource.name": "events",
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
        await AnalyticsModelAPI.getList<Log>(eventsQueryOptions);

      const k8sEvents: Array<KubernetesEventRow> = [];

      for (const log of listResult.data) {
        const attrs: JSONObject = log.attributes || {};

        if (
          attrs["resource.k8s.cluster.name"] !== item.clusterIdentifier &&
          attrs["k8s.cluster.name"] !== item.clusterIdentifier
        ) {
          continue;
        }

        let bodyObj: JSONObject | null = null;
        try {
          if (typeof log.body === "string") {
            bodyObj = JSON.parse(log.body) as JSONObject;
          }
        } catch {
          continue;
        }

        if (!bodyObj) {
          continue;
        }

        const topKvList: JSONObject | undefined = (bodyObj["kvlistValue"] ||
          bodyObj["kvlist_value"]) as JSONObject | undefined;
        if (!topKvList) {
          continue;
        }

        const objectVal: string | JSONObject | null = getKvValue(
          topKvList,
          "object",
        );
        if (!objectVal || typeof objectVal === "string") {
          continue;
        }
        const objectKvList: JSONObject = objectVal;

        const eventType: string = getKvStringValue(objectKvList, "type") || "";
        const reason: string = getKvStringValue(objectKvList, "reason") || "";
        const note: string = getKvStringValue(objectKvList, "note") || "";

        const regardingKv: string | JSONObject | null = getKvValue(
          objectKvList,
          "regarding",
        );
        const regardingObj: JSONObject | undefined =
          regardingKv && typeof regardingKv !== "string"
            ? regardingKv
            : undefined;

        const objectKind: string = regardingObj
          ? getKvStringValue(regardingObj, "kind")
          : "";
        const objectName: string = regardingObj
          ? getKvStringValue(regardingObj, "name")
          : "";

        const metadataKv: string | JSONObject | null = getKvValue(
          objectKvList,
          "metadata",
        );
        const metadataObj: JSONObject | undefined =
          metadataKv && typeof metadataKv !== "string" ? metadataKv : undefined;

        const namespace: string =
          (regardingObj ? getKvStringValue(regardingObj, "namespace") : "") ||
          (metadataObj ? getKvStringValue(metadataObj, "namespace") : "") ||
          "";

        if (eventType || reason) {
          k8sEvents.push({
            timestamp: log.time
              ? OneUptimeDate.getDateAsLocalFormattedString(log.time)
              : "",
            type: eventType || "Unknown",
            reason: reason || "Unknown",
            objectKind: objectKind || "Unknown",
            objectName: objectName || "Unknown",
            object: `${objectKind || "Unknown"}/${objectName || "Unknown"}`,
            namespace: namespace || "default",
            message: note || "",
          });
        }
      }

      setEvents(k8sEvents);
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

  // Build filters from data
  const filters: Array<Filter<KubernetesEventRow>> = useMemo(() => {
    const types: Array<string> = Array.from(
      new Set(
        events.map((e: KubernetesEventRow) => {
          return e.type;
        }),
      ),
    ).sort();

    const namespaces: Array<string> = Array.from(
      new Set(
        events
          .map((e: KubernetesEventRow) => {
            return e.namespace;
          })
          .filter(Boolean),
      ),
    ).sort();

    const reasons: Array<string> = Array.from(
      new Set(
        events
          .map((e: KubernetesEventRow) => {
            return e.reason;
          })
          .filter(Boolean),
      ),
    ).sort();

    const objectKinds: Array<string> = Array.from(
      new Set(
        events
          .map((e: KubernetesEventRow) => {
            return e.objectKind;
          })
          .filter(Boolean),
      ),
    ).sort();

    return [
      {
        title: "Type",
        key: "type",
        type: FieldType.Dropdown,
        filterDropdownOptions: types.map((t: string) => {
          return { label: t, value: t };
        }),
      },
      {
        title: "Reason",
        key: "reason",
        type: FieldType.Dropdown,
        filterDropdownOptions: reasons.map((r: string) => {
          return { label: r, value: r };
        }),
      },
      {
        title: "Object Kind",
        key: "objectKind",
        type: FieldType.Dropdown,
        filterDropdownOptions: objectKinds.map((k: string) => {
          return { label: k, value: k };
        }),
      },
      {
        title: "Namespace",
        key: "namespace",
        type: FieldType.Dropdown,
        filterDropdownOptions: namespaces.map((ns: string) => {
          return { label: ns, value: ns };
        }),
      },
      {
        title: "Message",
        key: "message",
        type: FieldType.Text,
      },
    ];
  }, [events]);

  // Filter and sort data client-side
  const processedData: Array<KubernetesEventRow> = useMemo(() => {
    let data: Array<KubernetesEventRow> = [...events];

    for (const key of Object.keys(filterData) as Array<
      keyof KubernetesEventRow
    >) {
      const value: unknown = filterData[key];
      if (!value) {
        continue;
      }

      if (value instanceof Search) {
        const searchText: string = value.toString().toLowerCase();
        data = data.filter((r: KubernetesEventRow) => {
          const fieldValue: string = (r[key] as string) || "";
          return fieldValue.toLowerCase().includes(searchText);
        });
      } else if (value instanceof Includes) {
        const includeValues: Array<string> = value.values as Array<string>;
        data = data.filter((r: KubernetesEventRow) => {
          const fieldValue: string = (r[key] as string) || "";
          return includeValues.includes(fieldValue);
        });
      } else if (typeof value === "string") {
        data = data.filter((r: KubernetesEventRow) => {
          const fieldValue: string = (r[key] as string) || "";
          return fieldValue === value;
        });
      } else if (Array.isArray(value)) {
        const includeValues: Array<string> = value.map((v: unknown) => {
          return String(v);
        });
        data = data.filter((r: KubernetesEventRow) => {
          const fieldValue: string = (r[key] as string) || "";
          return includeValues.includes(fieldValue);
        });
      }
    }

    if (sortBy) {
      data.sort((a: KubernetesEventRow, b: KubernetesEventRow) => {
        const aVal: string = (a[sortBy as keyof KubernetesEventRow] as string) || "";
        const bVal: string = (b[sortBy as keyof KubernetesEventRow] as string) || "";
        const cmp: number = aVal.localeCompare(bVal);
        return sortOrder === SortOrder.Descending ? -cmp : cmp;
      });
    }

    return data;
  }, [events, filterData, sortBy, sortOrder]);

  // Paginate
  const paginatedData: Array<KubernetesEventRow> = useMemo(() => {
    const start: number = (currentPage - 1) * PAGE_SIZE;
    return processedData.slice(start, start + PAGE_SIZE);
  }, [processedData, currentPage]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const tableColumns: Array<Column<KubernetesEventRow>> = [
    {
      title: "Time",
      type: FieldType.Element,
      key: "timestamp",
      getElement: (event: KubernetesEventRow): ReactElement => {
        return (
          <span className="text-sm text-gray-500 whitespace-nowrap">
            {event.timestamp}
          </span>
        );
      },
    },
    {
      title: "Type",
      type: FieldType.Element,
      key: "type",
      getElement: (event: KubernetesEventRow): ReactElement => {
        const isWarning: boolean = event.type.toLowerCase() === "warning";
        return (
          <span
            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
              isWarning
                ? "bg-yellow-50 text-yellow-700"
                : "bg-green-50 text-green-700"
            }`}
          >
            {event.type}
          </span>
        );
      },
    },
    {
      title: "Reason",
      type: FieldType.Element,
      key: "reason",
      getElement: (event: KubernetesEventRow): ReactElement => {
        return (
          <span className="font-medium text-gray-900">{event.reason}</span>
        );
      },
    },
    {
      title: "Object",
      type: FieldType.Element,
      key: "object",
      disableSort: true,
      getElement: (event: KubernetesEventRow): ReactElement => {
        return <span className="text-gray-900">{event.object}</span>;
      },
    },
    {
      title: "Namespace",
      type: FieldType.Element,
      key: "namespace",
      getElement: (event: KubernetesEventRow): ReactElement => {
        return (
          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
            {event.namespace}
          </span>
        );
      },
    },
    {
      title: "Message",
      type: FieldType.Element,
      key: "message",
      disableSort: true,
      getElement: (event: KubernetesEventRow): ReactElement => {
        return (
          <span className="text-sm text-gray-500">{event.message}</span>
        );
      },
    },
  ];

  const hasActiveFilters: boolean = Object.keys(filterData).length > 0;

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
    {
      title: "",
      buttonStyle: ButtonStyleType.ICON,
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: () => {
        setShowFilterModal(true);
      },
      icon: IconProp.Filter,
    },
  ];

  return (
    <Card
      title="Kubernetes Events"
      description="Events from the last 24 hours in this cluster."
      buttons={cardButtons}
    >
      <Table<KubernetesEventRow>
        id="kubernetes-events-table"
        columns={tableColumns}
        data={paginatedData}
        singularLabel="Kubernetes Event"
        pluralLabel="Kubernetes Events"
        isLoading={false}
        error=""
        currentPageNumber={currentPage}
        totalItemsCount={processedData.length}
        itemsOnPage={paginatedData.length}
        onNavigateToPage={(page: number) => {
          setCurrentPage(page);
        }}
        sortBy={sortBy as keyof KubernetesEventRow | null}
        sortOrder={sortOrder}
        onSortChanged={(
          newSortBy: keyof KubernetesEventRow | null,
          newSortOrder: SortOrder,
        ) => {
          setSortBy(newSortBy as string | null);
          setSortOrder(newSortOrder);
        }}
        filters={filters}
        showFilterModal={showFilterModal}
        filterData={filterData}
        onFilterChanged={(newFilterData: FilterData<KubernetesEventRow>) => {
          setFilterData(newFilterData);
          setCurrentPage(1);
        }}
        onFilterModalOpen={() => {
          setShowFilterModal(true);
        }}
        onFilterModalClose={() => {
          setShowFilterModal(false);
        }}
        noItemsMessage={
          hasActiveFilters
            ? "No events match the current filters."
            : "No Kubernetes events found in the last 24 hours. Events will appear here once the kubernetes-agent is sending data."
        }
      />
    </Card>
  );
};

export default KubernetesClusterEvents;
