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
import TelemetryService from "../../../Models/DatabaseModels/TelemetryService";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Dictionary from "../../../Types/Dictionary";
import LogsFilterCard from "./components/LogsFilterCard";
import LogsViewerToolbar, {
  LogsViewerToolbarProps,
} from "./components/LogsViewerToolbar";
import LogsTable, { resolveLogIdentifier } from "./components/LogsTable";
import LogsPagination from "./components/LogsPagination";
import LogDetailsPanel from "./components/LogDetailsPanel";

export interface ComponentProps {
  logs: Array<Log>;
  onFilterChanged: (filterOptions: Query<Log>) => void;
  filterData: Query<Log>;
  isLoading: boolean;
  showFilters?: boolean | undefined;
  noLogsMessage?: string | undefined;
  getTraceRoute?: (traceId: string, log: Log) => Route | URL | undefined;
  getSpanRoute?: (spanId: string, log: Log) => Route | URL | undefined;
}

const DEFAULT_PAGE_SIZE: number = 25;
const PAGE_SIZE_OPTIONS: Array<number> = [10, 25, 50, 100];

const LogsViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [filterData, setFilterData] = useState<Query<Log>>(props.filterData);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [isDescending, setIsDescending] = useState<boolean>(false);

  const [logAttributes, setLogAttributes] = useState<Array<string>>([]);
  const [attributesLoaded, setAttributesLoaded] = useState<boolean>(false);
  const [attributesLoading, setAttributesLoading] = useState<boolean>(false);
  const [attributesError, setAttributesError] = useState<string>("");
  const [areAdvancedFiltersVisible, setAreAdvancedFiltersVisible] =
    useState<boolean>(false);

  const [isPageLoading, setIsPageLoading] = useState<boolean>(true);
  const [pageError, setPageError] = useState<string>("");

  const [serviceMap, setServiceMap] = useState<Dictionary<TelemetryService>>(
    {},
  );

  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  const sortedLogs: Array<Log> = useMemo(() => {
    if (isDescending) {
      return [...props.logs].reverse();
    }

    return [...props.logs];
  }, [props.logs, isDescending]);

  const totalItems: number = sortedLogs.length;
  const totalPages: number = Math.max(
    1,
    Math.ceil(totalItems / Math.max(pageSize, 1)),
  );
  const safeCurrentPage: number = Math.min(
    Math.max(currentPage, 1),
    totalPages,
  );

  const paginatedLogs: Array<Log> = useMemo(() => {
    if (totalItems === 0) {
      return [];
    }

    const startIndex: number = (safeCurrentPage - 1) * pageSize;
    return sortedLogs.slice(startIndex, startIndex + pageSize);
  }, [sortedLogs, safeCurrentPage, pageSize, totalItems]);

  useEffect(() => {
    if (currentPage === safeCurrentPage) {
      return;
    }

    setCurrentPage(safeCurrentPage);
  }, [safeCurrentPage, currentPage]);

  useEffect(() => {
    if (!autoScroll || totalItems === 0) {
      return;
    }

    const desiredPage: number = isDescending ? 1 : totalPages;

    setCurrentPage((previousPage: number) => {
      if (previousPage === desiredPage) {
        return previousPage;
      }

      return desiredPage;
    });
  }, [props.logs, autoScroll, isDescending, totalItems, totalPages]);

  useEffect(() => {
    if (!selectedLogId) {
      return;
    }

    const stillExists: boolean = props.logs.some((log: Log, index: number) => {
      return resolveLogIdentifier(log, index) === selectedLogId;
    });

    if (!stillExists) {
      setSelectedLogId(null);
    }
  }, [props.logs, selectedLogId]);

  const loadTelemetryServices: PromiseVoidFunction =
    useCallback(async (): Promise<void> => {
      try {
        setIsPageLoading(true);
        setPageError("");

        const telemetryServices: ListResult<TelemetryService> =
          await ModelAPI.getList({
            modelType: TelemetryService,
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
        const services: Dictionary<TelemetryService> = {};

        telemetryServices.data.forEach((service: TelemetryService) => {
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
    void loadTelemetryServices();
  }, [loadTelemetryServices]);

  const handleAutoScrollChange: (checked: boolean) => void = (
    checked: boolean,
  ): void => {
    setAutoScroll(checked);

    if (checked && totalItems > 0) {
      setCurrentPage(isDescending ? 1 : totalPages);
    }
  };

  const handleSortDirectionChange: (nextDescending: boolean) => void = (
    nextDescending: boolean,
  ): void => {
    if (nextDescending === isDescending) {
      return;
    }

    setIsDescending(nextDescending);

    if (autoScroll && totalItems > 0) {
      setCurrentPage(nextDescending ? 1 : totalPages);
    }
  };

  const handleApplyFilters: () => void = (): void => {
    setCurrentPage(1);
    setSelectedLogId(null);
    props.onFilterChanged(filterData);
  };

  const handlePageChange: (page: number) => void = (page: number): void => {
    setAutoScroll(false);
    setCurrentPage(page);
  };

  const handlePageSizeChange: (size: number) => void = (size: number): void => {
    setAutoScroll(false);
    setPageSize(size);
    setCurrentPage(1);
  };

  const selectedLog: Log | null = useMemo(() => {
    if (!selectedLogId) {
      return null;
    }

    const match: Log | undefined = props.logs.find(
      (log: Log, index: number) => {
        return resolveLogIdentifier(log, index) === selectedLogId;
      },
    );

    return match || null;
  }, [props.logs, selectedLogId]);

  if (isPageLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (pageError) {
    return <ErrorMessage message={pageError} />;
  }

  const toolbarProps: LogsViewerToolbarProps = {
    autoScroll,
    onAutoScrollChange: handleAutoScrollChange,
    isDescending,
    onSortDirectionChange: handleSortDirectionChange,
    resultCount: totalItems,
    currentPage: safeCurrentPage,
    totalPages,
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

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 shadow-sm">
        {!props.showFilters && (
          <div className="border-b border-slate-800 px-4 py-3">
            <LogsViewerToolbar {...toolbarProps} />
          </div>
        )}

        <LogsTable
          logs={paginatedLogs}
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
        />

        <LogsPagination
          currentPage={safeCurrentPage}
          totalItems={totalItems}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          isDisabled={props.isLoading || totalItems === 0}
        />
      </div>

      {selectedLog ? (
        <LogDetailsPanel
          log={selectedLog}
          serviceMap={serviceMap}
          onClose={() => {
            setSelectedLogId(null);
          }}
          getTraceRoute={props.getTraceRoute}
          getSpanRoute={props.getSpanRoute}
        />
      ) : totalItems > 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-6 text-center text-sm text-slate-400">
          Select a log row to preview its details.
        </div>
      ) : null}
    </div>
  );
};

export default LogsViewer;
