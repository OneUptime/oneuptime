import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Query from "../../../Types/BaseDatabase/Query";
import { PromiseVoidFunction } from "../../../Types/FunctionTypes";
import Log from "../../../Models/AnalyticsModels/Log";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import API from "../../Utils/API/API";
import { APP_API_URL } from "../../Config";
import PageLoader from "../Loader/PageLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Service from "../../../Models/DatabaseModels/Service";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Dictionary from "../../../Types/Dictionary";
import LogsFilterCard from "./components/LogsFilterCard";
import LogsViewerToolbar, {
  LogsViewerToolbarProps,
} from "./components/LogsViewerToolbar";
import LogsTable, {
  LogsTableSortField,
  resolveLogIdentifier,
} from "./components/LogsTable";
import LogsPagination from "./components/LogsPagination";
import LogDetailsPanel from "./components/LogDetailsPanel";
import { LiveLogsOptions } from "./types";

export interface ComponentProps {
  logs: Array<Log>;
  onFilterChanged: (filterOptions: Query<Log>) => void;
  filterData: Query<Log>;
  isLoading: boolean;
  showFilters?: boolean | undefined;
  noLogsMessage?: string | undefined;
  getTraceRoute?: (traceId: string, log: Log) => Route | URL | undefined;
  getSpanRoute?: (spanId: string, log: Log) => Route | URL | undefined;
  totalCount?: number | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  sortField?: LogsTableSortField | undefined;
  sortOrder?: SortOrder | undefined;
  onSortChange?: (field: LogsTableSortField, order: SortOrder) => void;
  liveOptions?: LiveLogsOptions | undefined;
}

export type LogsSortField = LogsTableSortField;
export type { LiveLogsOptions } from "./types";

const DEFAULT_PAGE_SIZE: number = 100;
const PAGE_SIZE_OPTIONS: Array<number> = [100, 250, 500, 1000];

const severityWeight: Record<string, number> = {
  fatal: 6,
  error: 5,
  warn: 4,
  warning: 4,
  info: 3,
  notice: 3,
  debug: 2,
  trace: 1,
};

const getSeverityWeight: (severity: string | undefined) => number = (
  severity: string | undefined,
): number => {
  if (!severity) {
    return 0;
  }

  const normalized: string = severity.toString().toLowerCase();
  return severityWeight[normalized] || 0;
};

const LogsViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [filterData, setFilterData] = useState<Query<Log>>(props.filterData);

  const [logAttributes, setLogAttributes] = useState<Array<string>>([]);
  const [attributesLoaded, setAttributesLoaded] = useState<boolean>(false);
  const [attributesLoading, setAttributesLoading] = useState<boolean>(false);
  const [attributesError, setAttributesError] = useState<string>("");
  const [areAdvancedFiltersVisible, setAreAdvancedFiltersVisible] =
    useState<boolean>(false);

  const [isPageLoading, setIsPageLoading] = useState<boolean>(true);
  const [pageError, setPageError] = useState<string>("");

  const [serviceMap, setServiceMap] = useState<Dictionary<Service>>(
    {},
  );

  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  const [internalPage, setInternalPage] = useState<number>(1);
  const [internalPageSize, setInternalPageSize] =
    useState<number>(DEFAULT_PAGE_SIZE);
  const [localSortField, setLocalSortField] =
    useState<LogsTableSortField>("time");
  const [localSortOrder, setLocalSortOrder] = useState<SortOrder>(
    SortOrder.Descending,
  );

  useEffect(() => {
    setFilterData(props.filterData);
  }, [props.filterData]);

  useEffect(() => {
    if (props.sortField) {
      setLocalSortField(props.sortField);
    }
  }, [props.sortField]);

  useEffect(() => {
    if (props.sortOrder) {
      setLocalSortOrder(props.sortOrder);
    }
  }, [props.sortOrder]);

  useEffect(() => {
    if (props.pageSize) {
      setInternalPageSize(props.pageSize);
    }
  }, [props.pageSize]);

  const currentPage: number = props.page ?? internalPage;
  const pageSize: number = props.pageSize ?? internalPageSize;

  const totalItems: number = props.totalCount ?? props.logs.length;

  const totalPages: number = Math.max(
    1,
    Math.ceil(totalItems / Math.max(pageSize, 1)),
  );

  const sortField: LogsTableSortField = props.sortField ?? localSortField;
  const sortOrder: SortOrder = props.sortOrder ?? localSortOrder;

  const shouldClientSort: boolean = !props.onSortChange;

  const sortedLogs: Array<Log> = useMemo(() => {
    if (!shouldClientSort) {
      return props.logs;
    }

    const cloned: Array<Log> = [...props.logs];

    cloned.sort((a: Log, b: Log) => {
      if (sortField === "time") {
        const aTime: number =
          Number(a.timeUnixNano) || (a.time ? new Date(a.time).getTime() : 0);
        const bTime: number =
          Number(b.timeUnixNano) || (b.time ? new Date(b.time).getTime() : 0);

        if (aTime === bTime) {
          return 0;
        }

        return sortOrder === SortOrder.Descending
          ? bTime - aTime
          : aTime - bTime;
      }

      const aSeverity: number = getSeverityWeight(a.severityText?.toString());
      const bSeverity: number = getSeverityWeight(b.severityText?.toString());

      if (aSeverity === bSeverity) {
        return 0;
      }

      return sortOrder === SortOrder.Descending
        ? bSeverity - aSeverity
        : aSeverity - bSeverity;
    });

    return cloned;
  }, [props.logs, shouldClientSort, sortField, sortOrder]);

  const shouldClientPaginate: boolean = props.totalCount === undefined;

  const paginatedLogs: Array<Log> = useMemo(() => {
    if (!shouldClientPaginate) {
      return sortedLogs;
    }

    if (sortedLogs.length === 0) {
      return [];
    }

    const safePage: number = Math.min(Math.max(currentPage, 1), totalPages);
    const startIndex: number = (safePage - 1) * pageSize;
    return sortedLogs.slice(startIndex, startIndex + pageSize);
  }, [sortedLogs, shouldClientPaginate, currentPage, totalPages, pageSize]);

  const displayedLogs: Array<Log> = shouldClientPaginate
    ? paginatedLogs
    : sortedLogs;

  useEffect(() => {
    if (!shouldClientPaginate || props.page !== undefined) {
      return;
    }

    const safePage: number = Math.min(Math.max(internalPage, 1), totalPages);

    if (safePage !== internalPage) {
      setInternalPage(safePage);
    }
  }, [shouldClientPaginate, props.page, internalPage, totalPages]);

  useEffect(() => {
    if (!selectedLogId) {
      return;
    }

    const stillExists: boolean = displayedLogs.some(
      (log: Log, index: number) => {
        return resolveLogIdentifier(log, index) === selectedLogId;
      },
    );

    if (!stillExists) {
      setSelectedLogId(null);
    }
  }, [displayedLogs, selectedLogId]);

  const loadServices: PromiseVoidFunction =
    useCallback(async (): Promise<void> => {
      try {
        setIsPageLoading(true);
        setPageError("");

        const telemetryServices: ListResult<Service> =
          await ModelAPI.getList({
            modelType: Service,
            query: {},
            select: {
              name: true,
              serviceColor: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {
              name: SortOrder.Ascending,
            },
          });
        const services: Dictionary<Service> = {};

        telemetryServices.data.forEach((service: Service) => {
          if (!service.id) {
            return;
          }

          services[service.id.toString()] = service;
        });

        setServiceMap(services);
      } catch (err) {
        setPageError(
          `We couldn't load telemetry service metadata. ${API.getFriendlyErrorMessage(err as Error)}`,
        );
      } finally {
        setIsPageLoading(false);
      }
    }, []);

  const loadAttributes: PromiseVoidFunction =
    useCallback(async (): Promise<void> => {
      try {
        setAttributesLoading(true);
        setAttributesError("");

        const attributeResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/logs/get-attributes",
            ),
            data: {},
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (attributeResponse instanceof HTTPErrorResponse) {
          throw attributeResponse;
        }

        const attributes: Array<string> = (attributeResponse.data[
          "attributes"
        ] || []) as Array<string>;
        setLogAttributes(attributes);
        setAttributesLoaded(true);
      } catch (err) {
        setLogAttributes([]);
        setAttributesLoaded(false);
        setAttributesError(
          `We couldn't load log attributes. Filters may be limited. ${API.getFriendlyErrorMessage(err as Error)}`,
        );
      } finally {
        setAttributesLoading(false);
      }
    }, []);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const resetPage: () => void = (): void => {
    if (props.onPageChange) {
      props.onPageChange(1);
    }

    if (props.page === undefined) {
      setInternalPage(1);
    }
  };

  const handleApplyFilters: () => void = (): void => {
    resetPage();
    setSelectedLogId(null);
    props.onFilterChanged(filterData);
  };

  const handlePageChange: (page: number) => void = (page: number): void => {
    if (props.onPageChange) {
      props.onPageChange(page);
    }

    if (props.page === undefined) {
      setInternalPage(page);
    }

    setSelectedLogId(null);

    setSelectedLogId(null);
  };

  const handlePageSizeChange: (size: number) => void = (size: number): void => {
    if (props.onPageSizeChange) {
      props.onPageSizeChange(size);
    }

    if (props.pageSize === undefined) {
      setInternalPageSize(size);
    }

    resetPage();
    setSelectedLogId(null);
  };

  const handleSortChange: (field: LogsTableSortField) => void = (
    field: LogsTableSortField,
  ): void => {
    const isSameField: boolean = sortField === field;
    const nextOrder: SortOrder = isSameField
      ? sortOrder === SortOrder.Descending
        ? SortOrder.Ascending
        : SortOrder.Descending
      : SortOrder.Descending;

    setLocalSortField(field);
    setLocalSortOrder(nextOrder);

    props.onSortChange?.(field, nextOrder);

    resetPage();
    setSelectedLogId(null);
  };

  if (isPageLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (pageError) {
    return <ErrorMessage message={pageError} />;
  }

  const toolbarProps: LogsViewerToolbarProps = {
    resultCount: totalItems,
    currentPage,
    totalPages,
    ...(props.liveOptions ? { liveOptions: props.liveOptions } : {}),
  };

  return (
    <div className="space-y-6">
      {props.showFilters && (
        <div className="mb-6">
          <LogsFilterCard
            filterData={filterData}
            onFilterChanged={(updated: Query<Log>) => {
              setFilterData(updated);
            }}
            onAdvancedFiltersToggle={(show: boolean) => {
              setAreAdvancedFiltersVisible(show);

              if (show && !attributesLoaded && !attributesLoading) {
                void loadAttributes();
              }
            }}
            isFilterLoading={areAdvancedFiltersVisible && attributesLoading}
            filterError={
              areAdvancedFiltersVisible && attributesError
                ? attributesError
                : undefined
            }
            onFilterRefreshClick={
              areAdvancedFiltersVisible && attributesError
                ? () => {
                    void loadAttributes();
                  }
                : undefined
            }
            logAttributes={logAttributes}
            toolbar={
              <LogsViewerToolbar
                {...toolbarProps}
                showApplyButton={true}
                onApplyFilters={handleApplyFilters}
              />
            }
          />
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-950/60 shadow-xl">
        {!props.showFilters && (
          <div className="border-b border-slate-800/70 bg-slate-950/70 px-4 py-3">
            <LogsViewerToolbar {...toolbarProps} />
          </div>
        )}

        <LogsTable
          logs={displayedLogs}
          serviceMap={serviceMap}
          isLoading={props.isLoading}
          emptyMessage={props.noLogsMessage}
          onRowClick={(_log: Log, rowId: string) => {
            setSelectedLogId((currentSelected: string | null) => {
              if (currentSelected === rowId) {
                return null;
              }

              return rowId;
            });
          }}
          selectedLogId={selectedLogId}
          sortField={sortField}
          sortOrder={sortOrder}
          onSortChange={handleSortChange}
          renderExpandedContent={(log: Log) => {
            return (
              <LogDetailsPanel
                log={log}
                serviceMap={serviceMap}
                onClose={() => {
                  setSelectedLogId(null);
                }}
                getTraceRoute={props.getTraceRoute}
                getSpanRoute={props.getSpanRoute}
                variant="embedded"
              />
            );
          }}
        />

        <LogsPagination
          currentPage={currentPage}
          totalItems={totalItems}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          isDisabled={props.isLoading || totalItems === 0}
        />
      </div>
    </div>
  );
};

export default LogsViewer;
