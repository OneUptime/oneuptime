import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import LogsViewer, {
  LogsSortField,
  LiveLogsOptions,
  HistogramBucket,
  FacetData,
  ActiveFilter,
} from "Common/UI/Components/LogsViewer/LogsViewer";
import LogSeverity from "Common/Types/Log/LogSeverity";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Query from "Common/Types/BaseDatabase/Query";
import Realtime from "Common/UI/Utils/Realtime";
import Log from "Common/Models/AnalyticsModels/Log";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import Select from "Common/Types/BaseDatabase/Select";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import ProjectUtil from "Common/UI/Utils/Project";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";

export interface ComponentProps {
  id: string;
  serviceIds?: Array<ObjectID> | undefined;
  enableRealtime?: boolean;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  showFilters?: boolean | undefined;
  noLogsMessage?: string | undefined;
  logQuery?: Query<Log> | undefined;
  limit?: number | undefined;
}

const DEFAULT_PAGE_SIZE: number = 100;
const LIVE_POLL_INTERVAL_MS: number = 10000;

function buildBaseQuery(props: ComponentProps): Query<Log> {
  const query: Query<Log> = {};

  if (props.serviceIds && props.serviceIds.length > 0) {
    query.serviceId = new Includes(props.serviceIds);
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
}

function getApiUrl(path: string): URL {
  return URL.fromString(APP_API_URL.toString()).addRoute(path);
}

function getHeaders(): Record<string, string> {
  return ModelAPI.getCommonHeaders();
}

async function postApi(
  path: string,
  data: JSONObject,
): Promise<HTTPResponse<JSONObject>> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post({
      url: getApiUrl(path),
      data,
      headers: getHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response;
}

const DashboardLogsViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [logs, setLogs] = useState<Array<Log>>([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [filterOptions, setFilterOptions] = useState<Query<Log>>(() => {
    const base: Query<Log> = buildBaseQuery(props);
    const defaultRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate({
        range: TimeRange.PAST_ONE_HOUR,
      });
    (base as any).time = new InBetween<Date>(
      defaultRange.startValue,
      defaultRange.endValue,
    );
    return base;
  });
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(
    props.limit || DEFAULT_PAGE_SIZE,
  );
  const [totalCount, setTotalCount] = useState<number>(0);
  const [sortField, setSortField] = useState<LogsSortField>("time");
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Descending);
  const [isLiveEnabled, setIsLiveEnabled] = useState<boolean>(false);
  const [isLiveUpdating, setIsLiveUpdating] = useState<boolean>(false);
  const liveRequestInFlight = useRef<boolean>(false);

  // Histogram state
  const [histogramBuckets, setHistogramBuckets] = useState<
    Array<HistogramBucket>
  >([]);
  const [histogramLoading, setHistogramLoading] = useState<boolean>(false);

  // Facet state
  const [facetData, setFacetData] = useState<FacetData>({});
  const [facetLoading, setFacetLoading] = useState<boolean>(false);

  // Track user-applied facet filters: Map<facetKey, Set<value>>
  const [appliedFacetFilters, setAppliedFacetFilters] = useState<
    Map<string, Set<string>>
  >(new Map());

  // Time range state — single source of truth for histogram, facets, and log query
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  useEffect(() => {
    const base: Query<Log> = buildBaseQuery(props);
    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    (base as any).time = new InBetween<Date>(
      dateRange.startValue,
      dateRange.endValue,
    );
    setFilterOptions(base);
    setPage(1);
  }, [props.serviceIds, props.traceIds, props.spanIds, props.logQuery]);

  const select: Select<Log> = useMemo(() => {
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

  // Extract service IDs for API calls
  const serviceIdStrings: Array<string> | undefined = useMemo(() => {
    if (!props.serviceIds || props.serviceIds.length === 0) {
      return undefined;
    }

    return props.serviceIds.map((id: ObjectID) => id.toString());
  }, [props.serviceIds]);

  // --- Fetch logs ---

  type FetchOptions = {
    skipLoadingState?: boolean;
  };

  const fetchItems = useCallback(
    async (options: FetchOptions = {}): Promise<void> => {
      const { skipLoadingState = false } = options;

      setError("");

      if (skipLoadingState) {
        if (liveRequestInFlight.current) {
          return;
        }

        liveRequestInFlight.current = true;
        setIsLiveUpdating(true);
      } else {
        setIsLoading(true);
      }

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
      } finally {
        if (skipLoadingState) {
          liveRequestInFlight.current = false;
          setIsLiveUpdating(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [filterOptions, page, pageSize, select, sortField, sortOrder],
  );

  // --- Fetch histogram ---

  const fetchHistogram = useCallback(async (): Promise<void> => {
    try {
      setHistogramLoading(true);

      // Compute fresh dates from time range (preset ranges are relative to "now")
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

      const requestData: JSONObject = {
        startTime: dateRange.startValue.toISOString(),
        endTime: dateRange.endValue.toISOString(),
      } as JSONObject;

      if (serviceIdStrings) {
        (requestData as any)["serviceIds"] = serviceIdStrings;
      }

      // Pass active facet filters to the histogram so it reflects the current view
      const severityValues: Set<string> | undefined =
        appliedFacetFilters.get("severityText");

      if (severityValues && severityValues.size > 0) {
        (requestData as any)["severityTexts"] = Array.from(severityValues);
      }

      const serviceFilterValues: Set<string> | undefined =
        appliedFacetFilters.get("serviceId");

      if (serviceFilterValues && serviceFilterValues.size > 0) {
        // Merge with prop-level serviceIds (facet filter overrides/narrows)
        (requestData as any)["serviceIds"] = Array.from(serviceFilterValues);
      }

      const response: HTTPResponse<JSONObject> = await postApi(
        "/telemetry/logs/histogram",
        requestData,
      );

      const buckets: Array<HistogramBucket> = ((response.data["buckets"] ||
        []) as unknown) as Array<HistogramBucket>;

      setHistogramBuckets(buckets);
    } catch {
      // Histogram is non-critical; silently degrade
      setHistogramBuckets([]);
    } finally {
      setHistogramLoading(false);
    }
  }, [serviceIdStrings, appliedFacetFilters, timeRange]);

  // --- Fetch facets ---

  const fetchFacets = useCallback(async (): Promise<void> => {
    try {
      setFacetLoading(true);

      // Compute fresh dates from time range (preset ranges are relative to "now")
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

      const requestData: JSONObject = {
        startTime: dateRange.startValue.toISOString(),
        endTime: dateRange.endValue.toISOString(),
        facetKeys: ["severityText", "serviceId"],
      } as JSONObject;

      if (serviceIdStrings) {
        (requestData as any)["serviceIds"] = serviceIdStrings;
      }

      const response: HTTPResponse<JSONObject> = await postApi(
        "/telemetry/logs/facets",
        requestData,
      );

      const facets: FacetData = ((response.data["facets"] ||
        {}) as unknown) as FacetData;

      setFacetData(facets);
    } catch {
      // Facets are non-critical; silently degrade
      setFacetData({});
    } finally {
      setFacetLoading(false);
    }
  }, [serviceIdStrings, timeRange]);

  // --- Effects ---

  useEffect(() => {
    fetchItems().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [fetchItems]);

  useEffect(() => {
    void fetchHistogram();
  }, [fetchHistogram]);

  useEffect(() => {
    void fetchFacets();
  }, [fetchFacets]);

  // Live polling
  useEffect(() => {
    if (
      !isLiveEnabled ||
      page !== 1 ||
      sortField !== "time" ||
      sortOrder !== SortOrder.Descending
    ) {
      return;
    }

    void fetchItems({ skipLoadingState: true });

    const intervalId: number = window.setInterval(() => {
      void fetchItems({ skipLoadingState: true });
    }, LIVE_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [fetchItems, isLiveEnabled, page, sortField, sortOrder]);

  // Realtime
  useEffect(() => {
    if (!props.enableRealtime) {
      return;
    }

    const projectId = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const disconnectFunction: () => void =
      Realtime.listenToAnalyticsModelEvent(
        {
          modelType: Log,
          eventType: ModelEventType.Create,
          tenantId: projectId,
        },
        (_model: Log) => {
          if (
            page === 1 &&
            sortField === "time" &&
            sortOrder === SortOrder.Descending
          ) {
            fetchItems({ skipLoadingState: isLiveEnabled }).catch(
              (err: unknown) => {
                setError(API.getFriendlyMessage(err));
              },
            );
          }
        },
      );

    return () => {
      disconnectFunction();
    };
  }, [fetchItems, isLiveEnabled, page, sortField, sortOrder]);

  // --- Handlers ---

  const handleLiveToggle: LiveLogsOptions["onToggle"] = useCallback(
    (shouldEnable: boolean) => {
      if (shouldEnable) {
        if (page !== 1) {
          setPage(1);
        }

        if (sortField !== "time") {
          setSortField("time");
        }

        if (sortOrder !== SortOrder.Descending) {
          setSortOrder(SortOrder.Descending);
        }
      } else {
        liveRequestInFlight.current = false;
        setIsLiveUpdating(false);
      }

      setIsLiveEnabled(shouldEnable);
    },
    [page, sortField, sortOrder],
  );

  const disableLiveMode = useCallback((): void => {
    if (isLiveEnabled) {
      setIsLiveEnabled(false);
      liveRequestInFlight.current = false;
      setIsLiveUpdating(false);
    }
  }, [isLiveEnabled]);

  const handleFilterChanged = useCallback(
    (newFilter: Query<Log>): void => {
      setFilterOptions(newFilter);
      setPage(1);
      disableLiveMode();
    },
    [disableLiveMode],
  );

  const handlePageChange = useCallback(
    (nextPage: number): void => {
      setPage(nextPage);

      if (nextPage !== 1) {
        disableLiveMode();
      }
    },
    [disableLiveMode],
  );

  const handlePageSizeChange = useCallback((nextSize: number): void => {
    setPageSize(nextSize);
    setPage(1);
  }, []);

  const handleSortChange = useCallback(
    (field: LogsSortField, order: SortOrder): void => {
      setSortField(field);
      setSortOrder(order);
      setPage(1);

      if (field !== "time" || order !== SortOrder.Descending) {
        disableLiveMode();
      }
    },
    [disableLiveMode],
  );

  const handleHistogramTimeRangeSelect = useCallback(
    (startTime: Date, endTime: Date): void => {
      // Sync the time range picker to show "Custom" with selected dates
      const customRange: RangeStartAndEndDateTime = {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(startTime, endTime),
      };
      setTimeRange(customRange);

      const updatedFilter: Query<Log> = {
        ...filterOptions,
        time: new InBetween<Date>(startTime, endTime),
      };

      setFilterOptions(updatedFilter);
      setPage(1);
      disableLiveMode();
    },
    [filterOptions, disableLiveMode],
  );

  const handleTimeRangeChange = useCallback(
    (newTimeRange: RangeStartAndEndDateTime): void => {
      setTimeRange(newTimeRange);

      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange);

      const updatedFilter: Query<Log> = {
        ...filterOptions,
        time: new InBetween<Date>(dateRange.startValue, dateRange.endValue),
      };

      setFilterOptions(updatedFilter);
      setPage(1);
      disableLiveMode();
    },
    [filterOptions, disableLiveMode],
  );

  const rebuildFilterOptionsFromFacets = useCallback(
    (facets: Map<string, Set<string>>): Query<Log> => {
      const updatedFilter: Query<Log> = buildBaseQuery(props);

      // Preserve the current time filter
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
      (updatedFilter as any).time = new InBetween<Date>(
        dateRange.startValue,
        dateRange.endValue,
      );

      for (const [key, values] of facets.entries()) {
        if (values.size === 0) {
          continue;
        }

        if (values.size === 1) {
          // Single value: use direct equality
          const singleValue: string = Array.from(values)[0]!;
          (updatedFilter as any)[key] = singleValue;
        } else {
          // Multiple values: use Includes
          (updatedFilter as any)[key] = new Includes(Array.from(values));
        }
      }

      return updatedFilter;
    },
    [props, timeRange],
  );

  const handleFacetInclude = useCallback(
    (facetKey: string, value: string): void => {
      const nextFilters: Map<string, Set<string>> = new Map(
        Array.from(appliedFacetFilters.entries()).map(
          ([k, v]: [string, Set<string>]) => [k, new Set(v)] as [string, Set<string>],
        ),
      );

      const currentValues: Set<string> | undefined = nextFilters.get(facetKey);

      if (currentValues && currentValues.has(value)) {
        // Toggle off: remove this value
        currentValues.delete(value);

        if (currentValues.size === 0) {
          nextFilters.delete(facetKey);
        }
      } else {
        // Add value to the set
        if (currentValues) {
          currentValues.add(value);
        } else {
          nextFilters.set(facetKey, new Set([value]));
        }
      }

      setAppliedFacetFilters(nextFilters);
      setFilterOptions(rebuildFilterOptionsFromFacets(nextFilters));
      setPage(1);
      disableLiveMode();
    },
    [appliedFacetFilters, disableLiveMode, rebuildFilterOptionsFromFacets],
  );

  const handleFacetExclude = useCallback(
    (_facetKey: string, _value: string): void => {
      // Exclusion filters are not yet supported in the Query type.
      // This is a placeholder for future NOT-filter support.
    },
    [],
  );

  const handleRemoveFilter = useCallback(
    (facetKey: string, value: string): void => {
      const nextFilters: Map<string, Set<string>> = new Map(
        Array.from(appliedFacetFilters.entries()).map(
          ([k, v]: [string, Set<string>]) => [k, new Set(v)] as [string, Set<string>],
        ),
      );

      const currentValues: Set<string> | undefined = nextFilters.get(facetKey);

      if (currentValues) {
        currentValues.delete(value);

        if (currentValues.size === 0) {
          nextFilters.delete(facetKey);
        }
      } else {
        nextFilters.delete(facetKey);
      }

      setAppliedFacetFilters(nextFilters);
      setFilterOptions(rebuildFilterOptionsFromFacets(nextFilters));
      setPage(1);
      disableLiveMode();
    },
    [appliedFacetFilters, disableLiveMode, rebuildFilterOptionsFromFacets],
  );

  const handleClearAllFilters = useCallback((): void => {
    setAppliedFacetFilters(new Map());
    const base: Query<Log> = buildBaseQuery(props);
    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    (base as any).time = new InBetween<Date>(
      dateRange.startValue,
      dateRange.endValue,
    );
    setFilterOptions(base);
    setPage(1);
    disableLiveMode();
  }, [props, timeRange, disableLiveMode]);

  const getTraceRoute = useCallback(
    (traceId: string): Route | URL | undefined => {
      if (!traceId) {
        return undefined;
      }

      return RouteUtil.populateRouteParams(RouteMap[PageMap.TRACE_VIEW]!, {
        modelId: traceId,
      });
    },
    [],
  );

  const getSpanRoute = useCallback(
    (spanId: string, log: Log): Route | URL | undefined => {
      const traceId: string | undefined = log.traceId?.toString();

      if (!spanId || !traceId) {
        return undefined;
      }

      const route: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.TRACE_VIEW]!,
        {
          modelId: traceId,
        },
      );

      const routeWithQuery: Route = new Route(route.toString());
      routeWithQuery.addQueryParams({ spanId });

      return routeWithQuery;
    },
    [],
  );

  // Build value suggestions for the search bar autocomplete
  const valueSuggestions: Record<string, Array<string>> = useMemo(() => {
    const suggestions: Record<string, Array<string>> = {
      severityText: [
        LogSeverity.Fatal,
        LogSeverity.Error,
        LogSeverity.Warning,
        LogSeverity.Information,
        LogSeverity.Debug,
        LogSeverity.Trace,
        LogSeverity.Unspecified,
      ],
    };

    // Add service IDs from facet data
    if (facetData["serviceId"]) {
      suggestions["serviceId"] = facetData["serviceId"].map(
        (fv: { value: string; count: number }) => fv.value,
      );
    }

    return suggestions;
  }, [facetData]);

  // Handle field:value selection from search bar (adds as chip)
  const handleFieldValueSelect = useCallback(
    (fieldKey: string, value: string): void => {
      // Map user-facing field names to internal keys
      const fieldAliases: Record<string, string> = {
        severity: "severityText",
        level: "severityText",
        service: "serviceId",
      };
      const resolvedKey: string = fieldAliases[fieldKey] || fieldKey;

      handleFacetInclude(resolvedKey, value);
    },
    [handleFacetInclude],
  );

  // Build activeFilters array for UI display
  const activeFilters: Array<ActiveFilter> = useMemo(() => {
    const filters: Array<ActiveFilter> = [];

    const facetKeyDisplayNames: Record<string, string> = {
      severityText: "Severity",
      serviceId: "Service",
      traceId: "Trace",
      spanId: "Span",
    };

    for (const [facetKey, values] of appliedFacetFilters.entries()) {
      const displayKey: string = facetKeyDisplayNames[facetKey] || facetKey;

      for (const value of values) {
        filters.push({
          facetKey,
          value,
          displayKey,
          displayValue: value,
        });
      }
    }

    return filters;
  }, [appliedFacetFilters]);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <div id={props.id}>
      <LogsViewer
        isLoading={isLoading}
        onFilterChanged={handleFilterChanged}
        filterData={filterOptions}
        logs={logs}
        showFilters={props.showFilters}
        noLogsMessage={props.noLogsMessage}
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        sortField={sortField}
        sortOrder={sortOrder}
        onSortChange={handleSortChange}
        liveOptions={{
          isLive: isLiveEnabled,
          onToggle: handleLiveToggle,
          isDisabled: isLiveUpdating,
        }}
        getTraceRoute={getTraceRoute}
        getSpanRoute={getSpanRoute}
        histogramBuckets={histogramBuckets}
        histogramLoading={histogramLoading}
        onHistogramTimeRangeSelect={handleHistogramTimeRangeSelect}
        facetData={facetData}
        facetLoading={facetLoading}
        onFacetInclude={handleFacetInclude}
        onFacetExclude={handleFacetExclude}
        showFacetSidebar={true}
        activeFilters={activeFilters}
        onRemoveFilter={handleRemoveFilter}
        onClearAllFilters={handleClearAllFilters}
        valueSuggestions={valueSuggestions}
        onFieldValueSelect={handleFieldValueSelect}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />
    </div>
  );
};

export default DashboardLogsViewer;
