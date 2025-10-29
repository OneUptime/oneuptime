import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import LogsViewer, {
  LogsSortField,
} from "Common/UI/Components/LogsViewer/LogsViewer";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import Log from "Common/Models/AnalyticsModels/Log";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import Select from "Common/Types/BaseDatabase/Select";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";

export interface ComponentProps {
  id: string;
  telemetryServiceIds?: Array<ObjectID> | undefined;
  enableRealtime?: boolean;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  showFilters?: boolean | undefined;
  noLogsMessage?: string | undefined;
  logQuery?: Query<Log> | undefined;
  limit?: number | undefined;
}

const DashboardLogsViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type RefreshQueryFunction = () => Query<Log>;

  const refreshQuery: RefreshQueryFunction = (): Query<Log> => {
    const query: Query<Log> = {};

    if (props.telemetryServiceIds && props.telemetryServiceIds.length > 0) {
      query.serviceId = new Includes(props.telemetryServiceIds);
    }

    if (props.traceIds && props.traceIds.length > 0) {
      query.traceId = new Includes(props.traceIds);
    }

    if (props.spanIds && props.spanIds.length > 0) {
      query.spanId = new Includes(props.spanIds);
    }

    if (props.logQuery && Object.keys(props.logQuery).length > 0) {
      for (const key in props.logQuery) {
        (query as any)[key] = (props.logQuery as any)[key] as any;
      }
    }

    return query;
  };

  const DEFAULT_PAGE_SIZE: number = 100;

  const [logs, setLogs] = React.useState<Array<Log>>([]);
  const [error, setError] = React.useState<string>("");
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [filterOptions, setFilterOptions] =
    React.useState<Query<Log>>(refreshQuery());
  const [page, setPage] = React.useState<number>(1);
  const [pageSize, setPageSize] = React.useState<number>(
    props.limit || DEFAULT_PAGE_SIZE,
  );
  const [totalCount, setTotalCount] = React.useState<number>(0);
  const [sortField, setSortField] = React.useState<LogsSortField>("time");
  const [sortOrder, setSortOrder] = React.useState<SortOrder>(
    SortOrder.Descending,
  );

  useEffect(() => {
    setFilterOptions(refreshQuery());
    setPage(1);
  }, [
    props.telemetryServiceIds,
    props.traceIds,
    props.spanIds,
    props.logQuery,
  ]);

  const select: Select<Log> = React.useMemo(() => {
    return {
      body: true,
      time: true,
      projectId: true,
      serviceId: true,
      spanId: true,
      traceId: true,
      severityText: true,
      attributes: true,
    };
  }, []);

  const fetchItems: PromiseVoidFunction =
    React.useCallback(async (): Promise<void> => {
      setError("");
      setIsLoading(true);

      try {
        const listResult: ListResult<Log> =
          await AnalyticsModelAPI.getList<Log>({
            modelType: Log,
            query: filterOptions,
            limit: pageSize,
            skip: (page - 1) * pageSize,
            select: select,
            sort: {
              [sortField]: sortOrder,
            } as Record<string, SortOrder>,
            requestOptions: {},
          });

        setLogs(listResult.data);
        setTotalCount(listResult.count);

        const maximumPage: number = Math.max(
          1,
          Math.ceil(listResult.count / Math.max(pageSize, 1)),
        );

        if (page > maximumPage) {
          setPage(maximumPage);
        }
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    }, [filterOptions, page, pageSize, select, sortField, sortOrder]);

  useEffect(() => {
    fetchItems().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [fetchItems]);

  useEffect(() => {
    if (!props.enableRealtime) {
      return;
    }

    const disconnectFunction: () => void = Realtime.listenToAnalyticsModelEvent(
      {
        modelType: Log,
        eventType: ModelEventType.Create,
        tenantId: ProjectUtil.getCurrentProjectId()!,
      },
      (_model: Log) => {
        if (
          page === 1 &&
          sortField === "time" &&
          sortOrder === SortOrder.Descending
        ) {
          fetchItems().catch((err: unknown) => {
            setError(API.getFriendlyMessage(err));
          });
        }
      },
    );

    return () => {
      disconnectFunction();
    };
  }, [fetchItems, page, sortField, sortOrder]);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <div id={props.id}>
      <LogsViewer
        isLoading={isLoading}
        onFilterChanged={(filterOptions: Query<Log>) => {
          setFilterOptions(filterOptions);
          setPage(1);
        }}
        filterData={filterOptions}
        logs={logs}
        showFilters={props.showFilters}
        noLogsMessage={props.noLogsMessage}
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        onPageChange={(nextPage: number) => {
          setPage(nextPage);
        }}
        onPageSizeChange={(nextSize: number) => {
          setPageSize(nextSize);
          setPage(1);
        }}
        sortField={sortField}
        sortOrder={sortOrder}
        onSortChange={(field: LogsSortField, order: SortOrder) => {
          setSortField(field);
          setSortOrder(order);
          setPage(1);
        }}
        getTraceRoute={(traceId: string) => {
          if (!traceId) {
            return undefined;
          }

          return RouteUtil.populateRouteParams(
            RouteMap[PageMap.TELEMETRY_TRACE_VIEW]!,
            {
              modelId: traceId,
            },
          );
        }}
        getSpanRoute={(spanId: string, log: Log) => {
          const traceId: string | undefined = log.traceId?.toString();

          if (!spanId || !traceId) {
            return undefined;
          }

          const route: Route = RouteUtil.populateRouteParams(
            RouteMap[PageMap.TELEMETRY_TRACE_VIEW]!,
            {
              modelId: traceId,
            },
          );

          const routeWithQuery: Route = new Route(route.toString());
          routeWithQuery.addQueryParams({ spanId });

          return routeWithQuery;
        }}
      />
    </div>
  );
};

export default DashboardLogsViewer;
