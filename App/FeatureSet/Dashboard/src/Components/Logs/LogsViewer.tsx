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
  LogsViewMode,
} from "Common/UI/Components/LogsViewer/LogsViewer";
import {
  DEFAULT_LOGS_TABLE_COLUMNS,
  LogsSavedViewOption,
  normalizeLogsTableColumns,
} from "Common/UI/Components/LogsViewer/types";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import LogSeverity from "Common/Types/Log/LogSeverity";
import LogSavedView from "Common/Models/DatabaseModels/LogSavedView";
import API from "Common/UI/Utils/API/API";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import ModelAPI, {
  ListResult as ModelListResult,
} from "Common/UI/Utils/ModelAPI/ModelAPI";
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
import JSONFunctions from "Common/Types/JSONFunctions";
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
  onCountChange?: ((count: number) => void) | undefined;
}

const DEFAULT_PAGE_SIZE: number = 100;
const LIVE_POLL_INTERVAL_MS: number = 10000;
const SAVED_VIEWS_LIMIT: number = 100;
const FACET_FILTER_KEYS: Array<string> = [
  "severityText",
  "serviceId",
  "traceId",
  "spanId",
];

function getColumnsStorageKey(viewerId: string): string {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  return `logs-columns:${projectId?.toString() || "global"}:${viewerId}`;
}

function loadSelectedColumns(viewerId: string): Array<string> {
  const savedValue: unknown = LocalStorage.getItem(
    getColumnsStorageKey(viewerId),
  );

  if (Array.isArray(savedValue)) {
    return normalizeLogsTableColumns(
      savedValue.filter((value: unknown): value is string => {
        return typeof value === "string";
      }),
    );
  }

  return [...DEFAULT_LOGS_TABLE_COLUMNS];
}

function getQueryValues(value: unknown): Array<string> {
  if (value instanceof Includes) {
    return value.values.map((item: string | number | ObjectID) => {
      return item.toString();
    });
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    value instanceof ObjectID
  ) {
    return [value.toString()];
  }

  return [];
}

function buildFacetFiltersFromQuery(
  query: Query<Log>,
  baseQuery: Query<Log>,
): Map<string, Set<string>> {
  const nextFilters: Map<string, Set<string>> = new Map();

  for (const facetKey of FACET_FILTER_KEYS) {
    if ((baseQuery as any)[facetKey] !== undefined) {
      continue;
    }

    const values: Array<string> = getQueryValues((query as any)[facetKey]);

    if (values.length > 0) {
      nextFilters.set(facetKey, new Set(values));
    }
  }

  return nextFilters;
}

function resolveSavedTimeRange(
  query: Query<Log>,
): RangeStartAndEndDateTime | undefined {
  const timeFilter: unknown = (query as any).time;

  if (!timeFilter || !(timeFilter instanceof InBetween)) {
    return undefined;
  }

  const startTime: Date = new Date(timeFilter.startValue as string | Date);
  const endTime: Date = new Date(timeFilter.endValue as string | Date);

  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return undefined;
  }

  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(startTime, endTime),
  };
}

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
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: getApiUrl(path),
      data,
      headers: getHeaders(),
    },
  );

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
  const [savedViews, setSavedViews] = useState<Array<LogSavedView>>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string | null>(
    null,
  );
  const [selectedColumns, setSelectedColumns] = useState<Array<string>>(() => {
    return loadSelectedColumns(props.id);
  });
  const [showCreateSavedViewModal, setShowCreateSavedViewModal] =
    useState<boolean>(false);
  const [savedViewToEdit, setSavedViewToEdit] = useState<
    LogSavedView | undefined
  >(undefined);
  const [savedViewToDelete, setSavedViewToDelete] = useState<
    LogSavedView | undefined
  >(undefined);
  const [isSavedViewLoading, setIsSavedViewLoading] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<LogsViewMode>("list");

  const liveRequestInFlight: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const hasAppliedInitialSavedView: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

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

    return props.serviceIds.map((id: ObjectID) => {
      return id.toString();
    });
  }, [props.serviceIds]);

  const savedViewOptions: Array<LogsSavedViewOption> = useMemo(() => {
    return [...savedViews]
      .sort((left: LogSavedView, right: LogSavedView) => {
        if (Boolean(left.isDefault) !== Boolean(right.isDefault)) {
          return left.isDefault ? -1 : 1;
        }

        return (left.name || "").localeCompare(right.name || "");
      })
      .map((savedView: LogSavedView): LogsSavedViewOption => {
        return {
          id: savedView.id?.toString() || "",
          name: savedView.name || "Untitled View",
          isDefault: Boolean(savedView.isDefault),
        };
      });
  }, [savedViews]);

  const selectedSavedView: LogSavedView | undefined = useMemo(() => {
    return savedViews.find((savedView: LogSavedView) => {
      return savedView.id?.toString() === selectedSavedViewId;
    });
  }, [savedViews, selectedSavedViewId]);

  // --- Fetch logs ---

  const fetchSavedViews: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        setIsSavedViewLoading(true);

        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

        if (!projectId) {
          setSavedViews([]);
          return;
        }

        const result: ModelListResult<LogSavedView> = await ModelAPI.getList({
          modelType: LogSavedView,
          query: {
            projectId: projectId,
          },
          limit: SAVED_VIEWS_LIMIT,
          skip: 0,
          select: {
            name: true,
            query: true,
            columns: true,
            sortField: true,
            sortOrder: true,
            pageSize: true,
            isDefault: true,
            createdByUserId: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
        });

        setSavedViews(result.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsSavedViewLoading(false);
      }
    }, []);

  type FetchOptions = {
    skipLoadingState?: boolean;
  };

  const fetchItems: (options?: FetchOptions) => Promise<void> = useCallback(
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

        if (props.onCountChange) {
          props.onCountChange(listResult.count);
        }

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

  const fetchHistogram: () => Promise<void> =
    useCallback(async (): Promise<void> => {
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

        const traceFilterValues: Set<string> | undefined =
          appliedFacetFilters.get("traceId");

        if (traceFilterValues && traceFilterValues.size > 0) {
          (requestData as any)["traceIds"] = Array.from(traceFilterValues);
        }

        const spanFilterValues: Set<string> | undefined =
          appliedFacetFilters.get("spanId");

        if (spanFilterValues && spanFilterValues.size > 0) {
          (requestData as any)["spanIds"] = Array.from(spanFilterValues);
        }

        const response: HTTPResponse<JSONObject> = await postApi(
          "/telemetry/logs/histogram",
          requestData,
        );

        const buckets: Array<HistogramBucket> = (response.data["buckets"] ||
          []) as unknown as Array<HistogramBucket>;

        setHistogramBuckets(buckets);
      } catch {
        // Histogram is non-critical; silently degrade
        setHistogramBuckets([]);
      } finally {
        setHistogramLoading(false);
      }
    }, [serviceIdStrings, appliedFacetFilters, timeRange]);

  // --- Fetch facets ---

  const fetchFacets: () => Promise<void> =
    useCallback(async (): Promise<void> => {
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

        const facets: FacetData = (response.data["facets"] ||
          {}) as unknown as FacetData;

        setFacetData(facets);
      } catch {
        // Facets are non-critical; silently degrade
        setFacetData({});
      } finally {
        setFacetLoading(false);
      }
    }, [serviceIdStrings, timeRange]);

  // --- Handlers (defined before effects that reference them) ---

  const disableLiveMode: () => void = useCallback((): void => {
    if (isLiveEnabled) {
      setIsLiveEnabled(false);
      liveRequestInFlight.current = false;
      setIsLiveUpdating(false);
    }
  }, [isLiveEnabled]);

  const applySavedView: (savedView: LogSavedView) => void = useCallback(
    (savedView: LogSavedView): void => {
      const baseQuery: Query<Log> = buildBaseQuery(props);
      const rawQuery: JSONObject =
        (savedView.query as unknown as JSONObject) || {};
      const savedQuery: Query<Log> = (JSONFunctions.deserialize(
        JSONFunctions.serialize(rawQuery),
      ) || {}) as Query<Log>;
      const mergedQuery: Query<Log> = {
        ...(savedQuery as unknown as JSONObject),
        ...(baseQuery as unknown as JSONObject),
      } as unknown as Query<Log>;
      const nextTimeRange: RangeStartAndEndDateTime | undefined =
        resolveSavedTimeRange(savedQuery);

      if (nextTimeRange) {
        setTimeRange(nextTimeRange);
      }

      setAppliedFacetFilters(
        buildFacetFiltersFromQuery(mergedQuery, baseQuery),
      );
      setFilterOptions(mergedQuery);
      setPage(1);
      setPageSize(savedView.pageSize || DEFAULT_PAGE_SIZE);
      setSortField((savedView.sortField as LogsSortField) || "time");
      setSortOrder(savedView.sortOrder || SortOrder.Descending);
      setSelectedColumns(normalizeLogsTableColumns(savedView.columns || []));
      setSelectedSavedViewId(savedView.id?.toString() || null);
      disableLiveMode();
    },
    [disableLiveMode, props],
  );

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

  useEffect(() => {
    void fetchSavedViews();
  }, [fetchSavedViews]);

  useEffect(() => {
    LocalStorage.setItem(getColumnsStorageKey(props.id), selectedColumns);
  }, [props.id, selectedColumns]);

  useEffect(() => {
    if (hasAppliedInitialSavedView.current || isSavedViewLoading) {
      return;
    }

    hasAppliedInitialSavedView.current = true;

    const defaultSavedView: LogSavedView | undefined = savedViews.find(
      (savedView: LogSavedView) => {
        return Boolean(savedView.isDefault);
      },
    );

    if (defaultSavedView) {
      applySavedView(defaultSavedView);
    }
  }, [applySavedView, isSavedViewLoading, savedViews]);

  useEffect(() => {
    if (!selectedSavedViewId) {
      return;
    }

    const exists: boolean = savedViews.some((savedView: LogSavedView) => {
      return savedView.id?.toString() === selectedSavedViewId;
    });

    if (!exists) {
      setSelectedSavedViewId(null);
    }
  }, [savedViews, selectedSavedViewId]);

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

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const disconnectFunction: () => void = Realtime.listenToAnalyticsModelEvent(
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

  const handleFilterChanged: (newFilter: Query<Log>) => void = useCallback(
    (newFilter: Query<Log>): void => {
      setFilterOptions(newFilter);
      setPage(1);
      disableLiveMode();
    },
    [disableLiveMode],
  );

  const handlePageChange: (nextPage: number) => void = useCallback(
    (nextPage: number): void => {
      setPage(nextPage);

      if (nextPage !== 1) {
        disableLiveMode();
      }
    },
    [disableLiveMode],
  );

  const handlePageSizeChange: (nextSize: number) => void = useCallback(
    (nextSize: number): void => {
      setPageSize(nextSize);
      setPage(1);
    },
    [],
  );

  const handleSortChange: (field: LogsSortField, order: SortOrder) => void =
    useCallback(
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

  const handleHistogramTimeRangeSelect: (
    startTime: Date,
    endTime: Date,
  ) => void = useCallback(
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

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback(
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

  const rebuildFilterOptionsFromFacets: (
    facets: Map<string, Set<string>>,
  ) => Query<Log> = useCallback(
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

  const handleFacetInclude: (facetKey: string, value: string) => void =
    useCallback(
      (facetKey: string, value: string): void => {
        const nextFilters: Map<string, Set<string>> = new Map(
          Array.from(appliedFacetFilters.entries()).map(
            ([k, v]: [string, Set<string>]) => {
              return [k, new Set(v)] as [string, Set<string>];
            },
          ),
        );

        const currentValues: Set<string> | undefined =
          nextFilters.get(facetKey);

        if (currentValues && currentValues.has(value)) {
          // Toggle off: remove this value
          currentValues.delete(value);

          if (currentValues.size === 0) {
            nextFilters.delete(facetKey);
          }
        } else if (currentValues) {
          // Add value to the existing set
          currentValues.add(value);
        } else {
          nextFilters.set(facetKey, new Set([value]));
        }

        setAppliedFacetFilters(nextFilters);
        setFilterOptions(rebuildFilterOptionsFromFacets(nextFilters));
        setPage(1);
        disableLiveMode();
      },
      [appliedFacetFilters, disableLiveMode, rebuildFilterOptionsFromFacets],
    );

  const handleFacetExclude: (_facetKey: string, _value: string) => void =
    useCallback((_facetKey: string, _value: string): void => {
      /*
       * Exclusion filters are not yet supported in the Query type.
       * This is a placeholder for future NOT-filter support.
       */
    }, []);

  const handleRemoveFilter: (facetKey: string, value: string) => void =
    useCallback(
      (facetKey: string, value: string): void => {
        const nextFilters: Map<string, Set<string>> = new Map(
          Array.from(appliedFacetFilters.entries()).map(
            ([k, v]: [string, Set<string>]) => {
              return [k, new Set(v)] as [string, Set<string>];
            },
          ),
        );

        const currentValues: Set<string> | undefined =
          nextFilters.get(facetKey);

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

  const handleClearAllFilters: () => void = useCallback((): void => {
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

  const getTraceRoute: (traceId: string) => Route | URL | undefined =
    useCallback((traceId: string): Route | URL | undefined => {
      if (!traceId) {
        return undefined;
      }

      return RouteUtil.populateRouteParams(RouteMap[PageMap.TRACE_VIEW]!, {
        modelId: traceId,
      });
    }, []);

  const getSpanRoute: (spanId: string, log: Log) => Route | URL | undefined =
    useCallback((spanId: string, log: Log): Route | URL | undefined => {
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
    }, []);

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
        (fv: { value: string; count: number }) => {
          return fv.value;
        },
      );
    }

    return suggestions;
  }, [facetData]);

  // Handle field:value selection from search bar (adds as chip)
  const handleFieldValueSelect: (fieldKey: string, value: string) => void =
    useCallback(
      (fieldKey: string, value: string): void => {
        // Map user-facing field names to internal keys
        const fieldAliases: Record<string, string> = {
          severity: "severityText",
          level: "severityText",
          service: "serviceId",
          trace: "traceId",
          span: "spanId",
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
    <>
      {showCreateSavedViewModal && (
        <ModelFormModal<LogSavedView>
          modelType={LogSavedView}
          name="Save Log View"
          title="Save Log View"
          description="Save the current log explorer state as a reusable view."
          onClose={() => {
            setShowCreateSavedViewModal(false);
          }}
          submitButtonText="Save View"
          onBeforeCreate={async (savedView: LogSavedView) => {
            savedView.query = filterOptions;
            savedView.columns = selectedColumns;
            savedView.sortField = sortField;
            savedView.sortOrder = sortOrder;
            savedView.pageSize = pageSize;
            return savedView;
          }}
          onSuccess={async (savedView: LogSavedView) => {
            setShowCreateSavedViewModal(false);
            await fetchSavedViews();
            applySavedView(savedView);
          }}
          formProps={{
            name: "Save Log View",
            modelType: LogSavedView,
            id: "save-log-view",
            fields: [
              {
                field: {
                  name: true,
                },
                fieldType: FormFieldSchemaType.Text,
                title: "Name",
                description: "Choose a name for this saved log view.",
                placeholder: "Errors in checkout",
                required: true,
              },
              {
                field: {
                  isDefault: true,
                },
                fieldType: FormFieldSchemaType.Checkbox,
                title: "Set as default",
                description: "Automatically apply this view when opening logs.",
                required: false,
              },
            ],
            formType: FormType.Create,
          }}
        />
      )}

      {savedViewToEdit && (
        <ModelFormModal<LogSavedView>
          modelType={LogSavedView}
          modelIdToEdit={savedViewToEdit.id!}
          name="Edit Log View"
          title="Edit Log View"
          description="Rename this saved view or change whether it loads by default."
          onClose={() => {
            setSavedViewToEdit(undefined);
          }}
          submitButtonText="Save Changes"
          onSuccess={async () => {
            setSavedViewToEdit(undefined);
            await fetchSavedViews();
          }}
          formProps={{
            name: "Edit Log View",
            modelType: LogSavedView,
            id: "edit-log-view",
            fields: [
              {
                field: {
                  name: true,
                },
                fieldType: FormFieldSchemaType.Text,
                title: "Name",
                description: "Update the name of this saved view.",
                placeholder: "Errors in checkout",
                required: true,
              },
              {
                field: {
                  isDefault: true,
                },
                fieldType: FormFieldSchemaType.Checkbox,
                title: "Set as default",
                description: "Automatically apply this view when opening logs.",
                required: false,
              },
            ],
            formType: FormType.Update,
          }}
        />
      )}

      {savedViewToDelete && (
        <ConfirmModal
          title={`Delete ${savedViewToDelete.name || "saved view"}`}
          description={`Are you sure you want to delete ${savedViewToDelete.name || "this saved view"}?`}
          isLoading={isSavedViewLoading}
          submitButtonText="Delete"
          submitButtonType={ButtonStyleType.DANGER}
          onSubmit={async () => {
            if (!savedViewToDelete.id) {
              setSavedViewToDelete(undefined);
              return;
            }

            setIsSavedViewLoading(true);

            try {
              await ModelAPI.deleteItem({
                modelType: LogSavedView,
                id: savedViewToDelete.id,
              });

              if (savedViewToDelete.id.toString() === selectedSavedViewId) {
                setSelectedSavedViewId(null);
              }

              await fetchSavedViews();
              setSavedViewToDelete(undefined);
            } catch (err) {
              setError(API.getFriendlyMessage(err));
            } finally {
              setIsSavedViewLoading(false);
            }
          }}
          onClose={() => {
            setSavedViewToDelete(undefined);
          }}
        />
      )}

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
          selectedColumns={selectedColumns}
          onSelectedColumnsChange={(columns: Array<string>) => {
            setSelectedColumns(normalizeLogsTableColumns(columns));
          }}
          savedViews={savedViewOptions}
          selectedSavedViewId={selectedSavedViewId}
          onSavedViewSelect={(viewId: string) => {
            const savedView: LogSavedView | undefined = savedViews.find(
              (item: LogSavedView) => {
                return item.id?.toString() === viewId;
              },
            );

            if (savedView) {
              applySavedView(savedView);
            }
          }}
          onCreateSavedView={() => {
            setShowCreateSavedViewModal(true);
          }}
          onEditSavedView={(viewId: string) => {
            const savedView: LogSavedView | undefined = savedViews.find(
              (item: LogSavedView) => {
                return item.id?.toString() === viewId;
              },
            );

            setSavedViewToEdit(savedView);
          }}
          onDeleteSavedView={(viewId: string) => {
            const savedView: LogSavedView | undefined = savedViews.find(
              (item: LogSavedView) => {
                return item.id?.toString() === viewId;
              },
            );

            setSavedViewToDelete(savedView);
          }}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          analyticsServiceIds={serviceIdStrings}
          projectId={ProjectUtil.getCurrentProjectId() || undefined}
          analyticsAppliedFacetFilters={appliedFacetFilters}
          onUpdateCurrentSavedView={async () => {
            if (!selectedSavedView?.id) {
              return;
            }

            setIsSavedViewLoading(true);

            try {
              await ModelAPI.updateById({
                modelType: LogSavedView,
                id: selectedSavedView.id,
                data: JSONFunctions.serialize({
                  query: filterOptions,
                  columns: selectedColumns,
                  sortField: sortField,
                  sortOrder: sortOrder,
                  pageSize: pageSize,
                } as JSONObject) as JSONObject,
              });

              await fetchSavedViews();
            } catch (err) {
              setError(API.getFriendlyMessage(err));
            } finally {
              setIsSavedViewLoading(false);
            }
          }}
        />
      </div>
    </>
  );
};

export default DashboardLogsViewer;
