import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import LogsHistogram from "./components/LogsHistogram";
import LogsFacetSidebar from "./components/LogsFacetSidebar";
import ActiveFilterChips from "./components/ActiveFilterChips";
import {
  LiveLogsOptions,
  HistogramBucket,
  FacetData,
  ActiveFilter,
  CORE_LOGS_TABLE_COLUMN_OPTIONS,
  DEFAULT_LOGS_TABLE_COLUMNS,
  getLogsAttributeColumnId,
  LogsSavedViewOption,
  LogsTableColumnOption,
  LogsViewMode,
  normalizeLogsTableColumns,
} from "./types";
import LogsAnalyticsView from "./components/LogsAnalyticsView";
import { LogSearchBarRef } from "./components/LogSearchBar";
import { queryStringToFilter } from "../../../Types/Log/LogQueryToFilter";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { exportLogs, LogExportFormat } from "../../Utils/LogExport";
import ObjectID from "../../../Types/ObjectID";

export interface ComponentProps {
  logs: Array<Log>;
  onFilterChanged: (filterOptions: Query<Log>) => void;
  filterData: Query<Log>;
  isLoading: boolean;
  showFilters?: boolean | undefined;
  noLogsMessage?: string | undefined;
  getTraceRoute?: (traceId: string, log: Log) => Route | URL | undefined;
  getSpanRoute?: (spanId: string, log: Log) => Route | URL | undefined;
  projectId?: ObjectID | undefined;
  totalCount?: number | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  sortField?: LogsTableSortField | undefined;
  sortOrder?: SortOrder | undefined;
  onSortChange?: (field: LogsTableSortField, order: SortOrder) => void;
  liveOptions?: LiveLogsOptions | undefined;
  histogramBuckets?: Array<HistogramBucket>;
  histogramLoading?: boolean;
  onHistogramTimeRangeSelect?: (startTime: Date, endTime: Date) => void;
  facetData?: FacetData;
  facetLoading?: boolean;
  onFacetInclude?: (facetKey: string, value: string) => void;
  onFacetExclude?: (facetKey: string, value: string) => void;
  showFacetSidebar?: boolean;
  activeFilters?: Array<ActiveFilter> | undefined;
  onRemoveFilter?: ((facetKey: string, value: string) => void) | undefined;
  onClearAllFilters?: (() => void) | undefined;
  valueSuggestions?: Record<string, Array<string>> | undefined;
  onFieldValueSelect?: ((fieldKey: string, value: string) => void) | undefined;
  timeRange?: RangeStartAndEndDateTime | undefined;
  onTimeRangeChange?: ((value: RangeStartAndEndDateTime) => void) | undefined;
  selectedColumns?: Array<string> | undefined;
  onSelectedColumnsChange?: ((columns: Array<string>) => void) | undefined;
  savedViews?: Array<LogsSavedViewOption> | undefined;
  selectedSavedViewId?: string | null;
  onSavedViewSelect?: ((viewId: string) => void) | undefined;
  onCreateSavedView?: (() => void) | undefined;
  onEditSavedView?: ((viewId: string) => void) | undefined;
  onDeleteSavedView?: ((viewId: string) => void) | undefined;
  onUpdateCurrentSavedView?: (() => void) | undefined;
  viewMode?: LogsViewMode | undefined;
  onViewModeChange?: ((mode: LogsViewMode) => void) | undefined;
  analyticsServiceIds?: Array<string> | undefined;
  analyticsAppliedFacetFilters?: Map<string, Set<string>> | undefined;
}

export type LogsSortField = LogsTableSortField;
export type { LiveLogsOptions } from "./types";
export type {
  HistogramBucket,
  FacetData,
  ActiveFilter,
  LogsViewMode,
} from "./types";

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

function getEmptyMessageWithTimeRange(
  timeRange: RangeStartAndEndDateTime | undefined,
): string {
  if (!timeRange) {
    return "Adjust filters or check again later.";
  }

  if (timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate) {
    const startDate: Date = timeRange.startAndEndDate.startValue;
    const endDate: Date = timeRange.startAndEndDate.endValue;
    const fmt: (d: Date) => string = (d: Date): string => {
      return d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    };

    return `Time range: ${fmt(startDate)} – ${fmt(endDate)}. Try adjusting filters or expanding the time range.`;
  }

  const rangeLabel: string = timeRange.range.toLowerCase();
  return `Time range: ${rangeLabel}. Try adjusting filters or expanding the time range.`;
}

const getSeverityWeight: (severity: string | undefined) => number = (
  severity: string | undefined,
): number => {
  if (!severity) {
    return 0;
  }

  const normalized: string = severity.toString().toLowerCase();
  return severityWeight[normalized] || 0;
};

// Resolve a human-readable service name to its UUID using the serviceMap.
function resolveServiceNameToId(
  name: string,
  serviceMap: Dictionary<Service>,
): string | undefined {
  const lowerName: string = name.toLowerCase();

  for (const [id, service] of Object.entries(serviceMap)) {
    if (service?.name && service.name.toLowerCase() === lowerName) {
      return id;
    }
  }

  return undefined;
}

const LogsViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [filterData, setFilterData] = useState<Query<Log>>(props.filterData);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [logAttributes, setLogAttributes] = useState<Array<string>>([]);
  const [attributesLoaded, setAttributesLoaded] = useState<boolean>(false);
  const [attributesLoading, setAttributesLoading] = useState<boolean>(false);

  const [isPageLoading, setIsPageLoading] = useState<boolean>(true);
  const [pageError, setPageError] = useState<string>("");

  const [serviceMap, setServiceMap] = useState<Dictionary<Service>>({});

  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1);
  const searchBarRef: React.RefObject<LogSearchBarRef> =
    useRef<LogSearchBarRef>(null!);

  const [internalPage, setInternalPage] = useState<number>(1);
  const [internalPageSize, setInternalPageSize] =
    useState<number>(DEFAULT_PAGE_SIZE);
  const [localSortField, setLocalSortField] =
    useState<LogsTableSortField>("time");
  const [localSortOrder, setLocalSortOrder] = useState<SortOrder>(
    SortOrder.Descending,
  );
  const [internalSelectedColumns, setInternalSelectedColumns] = useState<
    Array<string>
  >(DEFAULT_LOGS_TABLE_COLUMNS);

  const [internalViewMode, setInternalViewMode] =
    useState<LogsViewMode>("list");

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

  useEffect(() => {
    if (props.selectedColumns) {
      setInternalSelectedColumns(
        normalizeLogsTableColumns(props.selectedColumns),
      );
    }
  }, [props.selectedColumns]);

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

        const telemetryServices: ListResult<Service> = await ModelAPI.getList({
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
      } catch {
        setLogAttributes([]);
        setAttributesLoaded(false);
      } finally {
        setAttributesLoading(false);
      }
    }, []);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  // Load attributes eagerly for search bar suggestions
  useEffect(() => {
    if (!attributesLoaded && !attributesLoading) {
      void loadAttributes();
    }
  }, [attributesLoaded, attributesLoading, loadAttributes]);

  // Reset focused row when displayed logs change
  useEffect(() => {
    setFocusedRowIndex(-1);
  }, [displayedLogs]);

  const resetPage: () => void = useCallback((): void => {
    if (props.onPageChange) {
      props.onPageChange(1);
    }

    if (props.page === undefined) {
      setInternalPage(1);
    }
  }, [props.onPageChange, props.page]);

  const handleSearchSubmit: () => void = useCallback((): void => {
    const queryFilter: Record<string, unknown> = queryStringToFilter(
      searchQuery,
    ) as Record<string, unknown>;

    // Resolve human-readable service name to UUID if needed
    if (
      queryFilter["serviceId"] &&
      typeof queryFilter["serviceId"] === "string"
    ) {
      const serviceName: string = queryFilter["serviceId"] as string;
      const resolvedId: string | undefined = resolveServiceNameToId(
        serviceName,
        serviceMap,
      );

      if (resolvedId) {
        queryFilter["serviceId"] = resolvedId;
      }
    }

    const mergedFilter: Query<Log> = {
      ...filterData,
      ...queryFilter,
    } as Query<Log>;

    resetPage();
    setSelectedLogId(null);
    props.onFilterChanged(mergedFilter);
  }, [searchQuery, serviceMap, filterData, resetPage, props]);

  // Scroll focused row into view
  useEffect(() => {
    if (focusedRowIndex < 0) {
      return;
    }

    // Use requestAnimationFrame to ensure the DOM has updated with data-focused
    requestAnimationFrame(() => {
      const focusedRow: Element | null = document.querySelector(
        `tr[data-focused="true"]`,
      );
      if (focusedRow) {
        focusedRow.scrollIntoView({ block: "nearest" });
      }
    });
  }, [focusedRowIndex]);

  // Keyboard shortcuts: j/k navigate, Enter expand/collapse, Escape close, / focus search, Ctrl+Enter apply
  useEffect(() => {
    const handleKeyDown: (e: KeyboardEvent) => void = (
      e: KeyboardEvent,
    ): void => {
      const target: EventTarget | null = e.target;
      const isInputFocused: boolean =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      // Ctrl+Enter applies filters even when search bar is focused
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSearchSubmit();
        return;
      }

      // Skip other shortcuts when an input is focused
      if (isInputFocused) {
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        searchBarRef.current?.focus();
        return;
      }

      if (e.key === "Escape") {
        if (selectedLogId) {
          setSelectedLogId(null);
        }
        return;
      }

      const logCount: number = displayedLogs.length;

      if (logCount === 0) {
        return;
      }

      if (e.key === "j") {
        e.preventDefault();
        setFocusedRowIndex((prev: number): number => {
          return Math.min(prev + 1, logCount - 1);
        });
        return;
      }

      if (e.key === "k") {
        e.preventDefault();
        setFocusedRowIndex((prev: number): number => {
          return Math.max(prev - 1, 0);
        });
        return;
      }

      if (e.key === "Enter") {
        if (focusedRowIndex >= 0 && focusedRowIndex < logCount) {
          const log: Log = displayedLogs[focusedRowIndex]!;
          const rowId: string = resolveLogIdentifier(log, focusedRowIndex);
          setSelectedLogId((currentSelected: string | null) => {
            if (currentSelected === rowId) {
              return null;
            }
            return rowId;
          });
        }
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [displayedLogs, focusedRowIndex, selectedLogId, handleSearchSubmit]);

  const handlePageChange: (page: number) => void = (page: number): void => {
    if (props.onPageChange) {
      props.onPageChange(page);
    }

    if (props.page === undefined) {
      setInternalPage(page);
    }

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

  /*
   * Enrich active filters with resolved display values (e.g. service names)
   * Must be before early returns to maintain consistent hook call order.
   */
  const enrichedActiveFilters: Array<ActiveFilter> = useMemo(() => {
    if (!props.activeFilters) {
      return [];
    }

    return props.activeFilters.map((filter: ActiveFilter): ActiveFilter => {
      if (filter.facetKey === "serviceId" && serviceMap[filter.value]) {
        const service: Service | undefined = serviceMap[filter.value];
        return {
          ...filter,
          displayValue: service?.name || filter.value,
        };
      }

      return filter;
    });
  }, [props.activeFilters, serviceMap]);

  /*
   * Replace serviceId UUIDs with human-readable names in value suggestions
   * Must be before early returns to maintain consistent hook call order.
   */
  const resolvedValueSuggestions: Record<string, Array<string>> | undefined =
    useMemo(() => {
      if (!props.valueSuggestions) {
        return undefined;
      }

      const suggestions: Record<string, Array<string>> = {
        ...props.valueSuggestions,
      };

      if (suggestions["serviceId"] && Object.keys(serviceMap).length > 0) {
        suggestions["serviceId"] = suggestions["serviceId"].map(
          (id: string) => {
            const service: Service | undefined = serviceMap[id];
            return service?.name || id;
          },
        );
      }

      return suggestions;
    }, [props.valueSuggestions, serviceMap]);

  /*
   * Wrap onFieldValueSelect to resolve service names back to UUIDs
   * Must be before early returns to maintain consistent hook call order.
   */
  const handleFieldValueSelectWithServiceResolve:
    | ((fieldKey: string, value: string) => void)
    | undefined = useMemo(() => {
    if (!props.onFieldValueSelect) {
      return undefined;
    }

    return (fieldKey: string, value: string): void => {
      if (fieldKey === "service") {
        const resolvedId: string | undefined = resolveServiceNameToId(
          value,
          serviceMap,
        );

        if (resolvedId) {
          props.onFieldValueSelect!(fieldKey, resolvedId);
          return;
        }
      }

      props.onFieldValueSelect!(fieldKey, value);
    };
  }, [props.onFieldValueSelect, serviceMap]);

  const selectedColumns: Array<string> = props.selectedColumns
    ? normalizeLogsTableColumns(props.selectedColumns)
    : internalSelectedColumns;

  const availableColumns: Array<LogsTableColumnOption> = useMemo(() => {
    const attributeColumns: Array<LogsTableColumnOption> = [...logAttributes]
      .sort((left: string, right: string) => {
        return left.localeCompare(right);
      })
      .map((attributeKey: string): LogsTableColumnOption => {
        return {
          id: getLogsAttributeColumnId(attributeKey),
          label: attributeKey,
          attributeKey,
        };
      });

    return [...CORE_LOGS_TABLE_COLUMN_OPTIONS, ...attributeColumns];
  }, [logAttributes]);

  if (isPageLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (pageError) {
    return <ErrorMessage message={pageError} />;
  }

  const currentViewMode: LogsViewMode = props.viewMode ?? internalViewMode;

  const handleViewModeChange: (mode: LogsViewMode) => void = (
    mode: LogsViewMode,
  ): void => {
    if (!props.viewMode) {
      setInternalViewMode(mode);
    }

    props.onViewModeChange?.(mode);
  };

  const toolbarProps: LogsViewerToolbarProps = {
    resultCount: totalItems,
    currentPage,
    totalPages,
    viewMode: currentViewMode,
    onViewModeChange: handleViewModeChange,
    savedViews: props.savedViews,
    selectedSavedViewId: props.selectedSavedViewId,
    onSavedViewSelect: props.onSavedViewSelect,
    onCreateSavedView: props.onCreateSavedView,
    onEditSavedView: props.onEditSavedView,
    onDeleteSavedView: props.onDeleteSavedView,
    onUpdateCurrentSavedView: props.onUpdateCurrentSavedView,
    ...(props.onSelectedColumnsChange || props.selectedColumns
      ? {
          availableColumns,
          selectedColumns,
          onSelectedColumnsChange: (columns: Array<string>) => {
            const nextColumns: Array<string> =
              normalizeLogsTableColumns(columns);

            if (!props.selectedColumns) {
              setInternalSelectedColumns(nextColumns);
            }

            props.onSelectedColumnsChange?.(nextColumns);
          },
        }
      : {}),
    onExportCSV: () => {
      exportLogs(displayedLogs, LogExportFormat.CSV, selectedColumns);
    },
    onExportJSON: () => {
      exportLogs(displayedLogs, LogExportFormat.JSON, selectedColumns);
    },
    ...(props.liveOptions ? { liveOptions: props.liveOptions } : {}),
    ...(props.timeRange && props.onTimeRangeChange
      ? {
          timeRange: props.timeRange,
          onTimeRangeChange: props.onTimeRangeChange,
        }
      : {}),
  };

  const showSidebar: boolean =
    props.showFacetSidebar !== false && Boolean(props.facetData);

  return (
    <div className="space-y-2">
      {props.showFilters && (
        <div>
          <LogsFilterCard
            ref={searchBarRef}
            logAttributes={logAttributes}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            onSearchSubmit={handleSearchSubmit}
            valueSuggestions={resolvedValueSuggestions}
            onFieldValueSelect={handleFieldValueSelectWithServiceResolve}
            toolbar={<LogsViewerToolbar {...toolbarProps} />}
          />
        </div>
      )}

      {/* Active filter chips */}
      {enrichedActiveFilters.length > 0 && props.onRemoveFilter && (
        <ActiveFilterChips
          filters={enrichedActiveFilters}
          onRemove={props.onRemoveFilter}
          onClearAll={props.onClearAllFilters || (() => {})}
        />
      )}

      {/* Histogram */}
      {props.histogramBuckets && (
        <LogsHistogram
          buckets={props.histogramBuckets}
          isLoading={props.histogramLoading || false}
          onTimeRangeSelect={props.onHistogramTimeRangeSelect}
        />
      )}

      {/* Main content: analytics view or sidebar + table */}
      {currentViewMode === "analytics" ? (
        <LogsAnalyticsView
          timeRange={props.timeRange || { range: TimeRange.PAST_ONE_HOUR }}
          serviceIds={props.analyticsServiceIds}
          appliedFacetFilters={props.analyticsAppliedFacetFilters || new Map()}
          logAttributes={logAttributes}
        />
      ) : (
        <div className="flex gap-3">
          {showSidebar && props.facetData && (
            <LogsFacetSidebar
              facetData={props.facetData}
              isLoading={props.facetLoading || false}
              serviceMap={serviceMap}
              onIncludeFilter={props.onFacetInclude || (() => {})}
              onExcludeFilter={props.onFacetExclude || (() => {})}
              activeFilters={props.activeFilters}
              savedViews={props.savedViews}
              selectedSavedViewId={props.selectedSavedViewId}
              onSavedViewSelect={props.onSavedViewSelect}
            />
          )}

          <div className="min-w-0 flex-1">
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              {!props.showFilters && (
                <div className="border-b border-gray-100 bg-gray-50/50 px-4 py-3">
                  <LogsViewerToolbar {...toolbarProps} />
                </div>
              )}

              <LogsTable
                logs={displayedLogs}
                serviceMap={serviceMap}
                isLoading={props.isLoading}
                focusedRowIndex={focusedRowIndex >= 0 ? focusedRowIndex : undefined}
                emptyMessage={
                  props.noLogsMessage ||
                  getEmptyMessageWithTimeRange(props.timeRange)
                }
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
                selectedColumns={selectedColumns}
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
                      projectId={props.projectId}
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
        </div>
      )}
    </div>
  );
};

export default LogsViewer;
