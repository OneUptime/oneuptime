import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, NavigateFunction } from "react-router-dom";
import TelemetryViewer from "Common/UI/Components/TelemetryViewer/TelemetryViewer";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
  FacetValue,
  HistogramBucket,
  HistogramSeriesOption,
  SearchHelpRow,
} from "Common/UI/Components/TelemetryViewer/types";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, {
  ListResult as ModelListResult,
} from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import ObjectID from "Common/Types/ObjectID";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import Includes from "Common/Types/BaseDatabase/Includes";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import TraceRow from "./TraceRow";

const DEFAULT_PAGE_SIZE: number = 50;
const HISTOGRAM_MAX_SAMPLE: number = 5000;
const LIVE_POLL_INTERVAL_MS: number = 10000;

const SPAN_STATUS_COLOR: Record<number, string> = {
  [SpanStatus.Unset]: "#9ca3af",
  [SpanStatus.Ok]: "#10b981",
  [SpanStatus.Error]: "#ef4444",
};

const SPAN_KIND_LABEL: Record<string, string> = {
  SPAN_KIND_SERVER: "Server",
  SPAN_KIND_CLIENT: "Client",
  SPAN_KIND_PRODUCER: "Producer",
  SPAN_KIND_CONSUMER: "Consumer",
  SPAN_KIND_INTERNAL: "Internal",
};

const SEARCH_HELP_ROWS: Array<SearchHelpRow> = [
  {
    syntax: "@service:<name>",
    description: "Filter by service name",
    example: "@service:api",
  },
  {
    syntax: "@status:ok|error|unset",
    description: "Filter by span status",
    example: "@status:error",
  },
  {
    syntax: "@name:<span name>",
    description: "Filter by span name",
    example: "@name:GET /users",
  },
  {
    syntax: "@trace:<trace id>",
    description: "Filter by trace id",
    example: "@trace:abc123",
  },
];

const FIELD_ALIAS_MAP: Record<string, string> = {
  service: "serviceId",
  status: "statusCode",
  name: "name",
  trace: "traceId",
};

interface Props {
  serviceId?: ObjectID | undefined;
}

function computeBucketSizeMs(startTime: Date, endTime: Date): number {
  const totalMs: number = endTime.getTime() - startTime.getTime();
  const targetBuckets: number = 40;
  const raw: number = Math.max(60000, Math.floor(totalMs / targetBuckets));
  // Round to nearest minute
  return Math.ceil(raw / 60000) * 60000;
}

function bucketKey(date: Date, bucketMs: number): string {
  const t: number = Math.floor(date.getTime() / bucketMs) * bucketMs;
  return new Date(t).toISOString();
}

function statusKey(status: SpanStatus | number | undefined | null): string {
  if (status === SpanStatus.Error) {
    return "error";
  }
  if (status === SpanStatus.Ok) {
    return "ok";
  }
  return "unset";
}

const TracesViewer: FunctionComponent<Props> = (props: Props): ReactElement => {
  const navigate: NavigateFunction = useNavigate();

  const [spans, setSpans] = useState<Array<Span>>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const [services, setServices] = useState<Array<Service>>([]);

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const [searchValue, setSearchValue] = useState<string>("");
  const [submittedSearch, setSubmittedSearch] = useState<string>("");

  const [activeFilters, setActiveFilters] = useState<Array<ActiveFilter>>([]);

  const [histogramBuckets, setHistogramBuckets] = useState<
    Array<HistogramBucket>
  >([]);
  const [histogramLoading, setHistogramLoading] = useState<boolean>(false);
  const [facetData, setFacetData] = useState<FacetData>({});
  const [facetLoading, setFacetLoading] = useState<boolean>(false);

  const [isLive, setIsLive] = useState<boolean>(false);
  const livePollRef: React.MutableRefObject<ReturnType<
    typeof setInterval
  > | null> = useRef(null);

  // Service lookup map
  const serviceById: Record<string, Service> = useMemo(() => {
    const map: Record<string, Service> = {};
    for (const service of services) {
      if (service.id) {
        map[service.id.toString()] = service;
      }
    }
    return map;
  }, [services]);

  // Parse search string (simple @field:value + free text)
  const parseSearch: (raw: string) => {
    freeText: string;
    fieldFilters: Record<string, Array<string>>;
  } = useCallback((raw: string) => {
    const fieldFilters: Record<string, Array<string>> = {};
    const freeTextParts: Array<string> = [];
    const tokens: Array<string> = raw.match(/@\S+:[^\s]+|\S+/g) || [];
    for (const token of tokens) {
      const match: RegExpMatchArray | null = token.match(/^@([^:]+):(.*)$/);
      if (match) {
        const alias: string = match[1]!;
        const value: string = match[2]!;
        const backendField: string = FIELD_ALIAS_MAP[alias] || alias;
        if (!fieldFilters[backendField]) {
          fieldFilters[backendField] = [];
        }
        fieldFilters[backendField]!.push(value);
      } else {
        freeTextParts.push(token);
      }
    }
    return { freeText: freeTextParts.join(" ").trim(), fieldFilters };
  }, []);

  const baseQuery: Query<Span> = useMemo(() => {
    const query: Query<Span> = {
      parentSpanId: new IsNull(),
    };

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (projectId) {
      query.projectId = projectId;
    }

    if (props.serviceId) {
      query.serviceId = props.serviceId;
    }

    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    (query as Record<string, unknown>)["startTime"] = new InBetween<Date>(
      dateRange.startValue,
      dateRange.endValue,
    );

    // Apply active facet filters
    const facetGroups: Record<string, Array<string>> = {};
    for (const filter of activeFilters) {
      if (!facetGroups[filter.facetKey]) {
        facetGroups[filter.facetKey] = [];
      }
      facetGroups[filter.facetKey]!.push(filter.value);
    }

    for (const key of Object.keys(facetGroups)) {
      const values: Array<string> = facetGroups[key]!;
      if (values.length === 1) {
        (query as Record<string, unknown>)[key] = values[0]!;
      } else {
        (query as Record<string, unknown>)[key] = new Includes(values);
      }
    }

    // Apply search field filters
    const { fieldFilters } = parseSearch(submittedSearch);
    for (const key of Object.keys(fieldFilters)) {
      const values: Array<string> = fieldFilters[key]!;
      if (key === "statusCode") {
        const mapped: Array<number> = values.map((v: string): number => {
          if (v.toLowerCase() === "error") {
            return SpanStatus.Error;
          }
          if (v.toLowerCase() === "ok") {
            return SpanStatus.Ok;
          }
          return SpanStatus.Unset;
        });
        (query as Record<string, unknown>)[key] =
          mapped.length === 1 ? mapped[0] : new Includes(mapped);
      } else if (values.length === 1) {
        (query as Record<string, unknown>)[key] = values[0]!;
      } else {
        (query as Record<string, unknown>)[key] = new Includes(values);
      }
    }

    return query;
  }, [props.serviceId, timeRange, activeFilters, submittedSearch, parseSearch]);

  const listSelect: Select<Span> = useMemo(() => {
    return {
      traceId: true,
      spanId: true,
      parentSpanId: true,
      name: true,
      serviceId: true,
      startTime: true,
      endTime: true,
      durationUnixNano: true,
      statusCode: true,
      statusMessage: true,
      kind: true,
    } as Select<Span>;
  }, []);

  // Load services once
  useEffect(() => {
    const loadServices: () => Promise<void> = async () => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          return;
        }
        const result: ModelListResult<Service> = await ModelAPI.getList({
          modelType: Service,
          query: { projectId: projectId },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: { name: true, serviceColor: true },
          sort: { name: SortOrder.Ascending },
        });
        setServices(result.data || []);
      } catch {
        // non-critical
      }
    };
    void loadServices();
  }, []);

  // Fetch spans list
  const fetchSpans: (options?: {
    skipLoadingState?: boolean;
  }) => Promise<void> = useCallback(
    async (options: { skipLoadingState?: boolean } = {}) => {
      if (!options.skipLoadingState) {
        setIsLoading(true);
      }
      setError("");
      try {
        const result: ListResult<Span> = await AnalyticsModelAPI.getList<Span>({
          modelType: Span,
          query: baseQuery,
          limit: pageSize,
          skip: (page - 1) * pageSize,
          select: listSelect,
          sort: { startTime: SortOrder.Descending } as Record<
            string,
            SortOrder
          >,
          requestOptions: {},
        });
        setSpans(result.data);
        setTotalCount(result.count);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        if (!options.skipLoadingState) {
          setIsLoading(false);
        }
      }
    },
    [baseQuery, page, pageSize, listSelect],
  );

  // Fetch histogram + facets from an auxiliary unpaged sample
  const fetchHistogramAndFacets: () => Promise<void> = useCallback(async () => {
    setHistogramLoading(true);
    setFacetLoading(true);
    try {
      const sample: ListResult<Span> = await AnalyticsModelAPI.getList<Span>({
        modelType: Span,
        query: baseQuery,
        limit: HISTOGRAM_MAX_SAMPLE,
        skip: 0,
        select: {
          startTime: true,
          statusCode: true,
          serviceId: true,
          name: true,
          kind: true,
        } as Select<Span>,
        sort: { startTime: SortOrder.Descending } as Record<string, SortOrder>,
        requestOptions: {},
      });

      // Histogram
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
      const bucketMs: number = computeBucketSizeMs(
        dateRange.startValue,
        dateRange.endValue,
      );

      const countMap: Map<string, Map<string, number>> = new Map();
      for (const span of sample.data) {
        if (!span.startTime) {
          continue;
        }
        const d: Date = OneUptimeDate.fromString(
          span.startTime as unknown as string,
        );
        const key: string = bucketKey(d, bucketMs);
        const series: string = statusKey(span.statusCode);
        if (!countMap.has(key)) {
          countMap.set(key, new Map());
        }
        const inner: Map<string, number> = countMap.get(key)!;
        inner.set(series, (inner.get(series) || 0) + 1);
      }

      const buckets: Array<HistogramBucket> = [];
      for (const [time, inner] of countMap.entries()) {
        for (const [series, count] of inner.entries()) {
          buckets.push({ time, series, count });
        }
      }
      buckets.sort((a: HistogramBucket, b: HistogramBucket): number => {
        return a.time.localeCompare(b.time);
      });
      setHistogramBuckets(buckets);

      // Facets (computed client-side from sample)
      const facetKeys: Array<string> = [
        "serviceId",
        "statusCode",
        "kind",
        "name",
      ];
      const facets: FacetData = {};
      for (const key of facetKeys) {
        const counts: Map<string, number> = new Map();
        for (const span of sample.data) {
          const raw: unknown = (span as unknown as Record<string, unknown>)[
            key
          ];
          if (raw === null || raw === undefined) {
            continue;
          }
          const value: string =
            raw instanceof ObjectID ? raw.toString() : String(raw);
          counts.set(value, (counts.get(value) || 0) + 1);
        }
        const sorted: Array<FacetValue> = Array.from(counts.entries())
          .map(([value, count]: [string, number]): FacetValue => {
            return { value, count };
          })
          .sort((a: FacetValue, b: FacetValue): number => {
            return b.count - a.count;
          })
          .slice(0, 20);
        facets[key] = sorted;
      }
      setFacetData(facets);
    } catch {
      // non-critical
      setHistogramBuckets([]);
      setFacetData({});
    } finally {
      setHistogramLoading(false);
      setFacetLoading(false);
    }
  }, [baseQuery, timeRange]);

  useEffect(() => {
    void fetchSpans();
  }, [fetchSpans]);

  useEffect(() => {
    void fetchHistogramAndFacets();
  }, [fetchHistogramAndFacets]);

  // Live polling
  useEffect(() => {
    if (livePollRef.current) {
      clearInterval(livePollRef.current);
      livePollRef.current = null;
    }
    if (isLive) {
      livePollRef.current = setInterval(() => {
        void fetchSpans({ skipLoadingState: true });
      }, LIVE_POLL_INTERVAL_MS);
    }
    return () => {
      if (livePollRef.current) {
        clearInterval(livePollRef.current);
        livePollRef.current = null;
      }
    };
  }, [isLive, fetchSpans]);

  // Max duration in visible set — for duration bar scaling
  const maxDurationNano: number = useMemo(() => {
    let max: number = 0;
    for (const span of spans) {
      const d: number = Number(span.durationUnixNano || 0);
      if (d > max) {
        max = d;
      }
    }
    return max;
  }, [spans]);

  // Facet configs
  const facetConfigs: Array<FacetConfig> = useMemo(() => {
    const serviceNameMap: Record<string, string> = {};
    const serviceColorMap: Record<string, string> = {};
    for (const service of services) {
      if (service.id) {
        serviceNameMap[service.id.toString()] = service.name || "Unknown";
        if (service.serviceColor) {
          serviceColorMap[service.id.toString()] =
            service.serviceColor.toString();
        }
      }
    }

    const statusLabelMap: Record<string, string> = {
      [SpanStatus.Ok]: "Ok",
      [SpanStatus.Error]: "Error",
      [SpanStatus.Unset]: "Unset",
    };
    const statusColorMap: Record<string, string> = {
      [SpanStatus.Ok]: SPAN_STATUS_COLOR[SpanStatus.Ok]!,
      [SpanStatus.Error]: SPAN_STATUS_COLOR[SpanStatus.Error]!,
      [SpanStatus.Unset]: SPAN_STATUS_COLOR[SpanStatus.Unset]!,
    };

    return [
      {
        key: "serviceId",
        title: "Service",
        valueDisplayMap: serviceNameMap,
        valueColorMap: serviceColorMap,
        priority: 1,
      },
      {
        key: "statusCode",
        title: "Status",
        valueDisplayMap: statusLabelMap,
        valueColorMap: statusColorMap,
        priority: 2,
      },
      {
        key: "kind",
        title: "Span Kind",
        valueDisplayMap: SPAN_KIND_LABEL,
        priority: 3,
      },
      {
        key: "name",
        title: "Span Name",
        priority: 4,
      },
    ];
  }, [services]);

  // Histogram series
  const histogramSeries: Array<HistogramSeriesOption> = useMemo(() => {
    return [
      { key: "ok", label: "Ok", color: SPAN_STATUS_COLOR[SpanStatus.Ok]! },
      {
        key: "unset",
        label: "Unset",
        color: SPAN_STATUS_COLOR[SpanStatus.Unset]!,
      },
      {
        key: "error",
        label: "Error",
        color: SPAN_STATUS_COLOR[SpanStatus.Error]!,
      },
    ];
  }, []);

  // Facet interaction
  const handleFacetInclude: (facetKey: string, value: string) => void =
    useCallback(
      (facetKey: string, value: string) => {
        setActiveFilters(
          (prev: Array<ActiveFilter>): Array<ActiveFilter> => {
            if (
              prev.some((f: ActiveFilter): boolean => {
                return f.facetKey === facetKey && f.value === value;
              })
            ) {
              return prev;
            }
            const config: FacetConfig | undefined = facetConfigs.find(
              (c: FacetConfig): boolean => {
                return c.key === facetKey;
              },
            );
            const displayKey: string = config?.title || facetKey;
            const displayValue: string =
              config?.valueDisplayMap?.[value] || value;
            return [
              ...prev,
              { facetKey, value, displayKey, displayValue },
            ];
          },
        );
        setPage(1);
      },
      [facetConfigs],
    );

  const handleRemoveFilter: (facetKey: string, value: string) => void =
    useCallback((facetKey: string, value: string) => {
      setActiveFilters(
        (prev: Array<ActiveFilter>): Array<ActiveFilter> => {
          return prev.filter((f: ActiveFilter): boolean => {
            return !(f.facetKey === facetKey && f.value === value);
          });
        },
      );
      setPage(1);
    }, []);

  const handleClearAllFilters: () => void = useCallback(() => {
    setActiveFilters([]);
    setPage(1);
  }, []);

  // Histogram drag-to-zoom
  const handleHistogramTimeRangeSelect: (start: Date, end: Date) => void =
    useCallback((start: Date, end: Date) => {
      setTimeRange({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(start, end),
      });
      setPage(1);
    }, []);

  // Row click → navigate to trace view
  const handleRowClick: (span: Span) => void = useCallback(
    (span: Span) => {
      if (!span.traceId) {
        return;
      }
      const route: string = RouteUtil.populateRouteParams(
        RouteMap[PageMap.TRACE_VIEW]!,
        { modelId: span.traceId.toString() },
      ).toString();
      navigate(route);
    },
    [navigate],
  );

  return (
    <TelemetryViewer<Span>
      items={spans}
      isLoading={isLoading}
      error={error || undefined}
      onRefresh={() => {
        void fetchSpans();
        void fetchHistogramAndFacets();
      }}
      emptyMessage="No traces found"
      itemLabel="traces"
      renderRow={(span: Span): ReactElement => {
        const service: Service | undefined = span.serviceId
          ? serviceById[span.serviceId.toString()]
          : undefined;
        return (
          <TraceRow
            span={span}
            service={service}
            maxDurationNano={maxDurationNano}
            onClick={() => {
              handleRowClick(span);
            }}
          />
        );
      }}
      getRowKey={(span: Span, index: number): string => {
        return `${span.spanId?.toString() || "row"}-${index}`;
      }}
      // Search
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      onSearchSubmit={() => {
        setSubmittedSearch(searchValue);
        setPage(1);
      }}
      searchPlaceholder="Search traces — e.g. @service:api @status:error"
      searchFieldAliasMap={FIELD_ALIAS_MAP}
      searchHelpRows={SEARCH_HELP_ROWS}
      searchHelpCombinedExample="@service:api @status:error checkout"
      // Time
      timeRange={timeRange}
      onTimeRangeChange={(value: RangeStartAndEndDateTime) => {
        setTimeRange(value);
        setPage(1);
      }}
      // Live
      live={{
        isLive,
        onToggle: setIsLive,
      }}
      // Facets
      showFacetSidebar={true}
      facetData={facetData}
      facetConfigs={facetConfigs}
      facetLoading={facetLoading}
      onFacetInclude={handleFacetInclude}
      // Active filters
      activeFilters={activeFilters}
      onRemoveFilter={handleRemoveFilter}
      onClearAllFilters={handleClearAllFilters}
      // Histogram
      showHistogram={true}
      histogramBuckets={histogramBuckets}
      histogramSeries={histogramSeries}
      histogramTitle="Traces over time"
      histogramLoading={histogramLoading}
      onHistogramTimeRangeSelect={handleHistogramTimeRangeSelect}
      // Pagination
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      onPageChange={setPage}
      onPageSizeChange={(size: number) => {
        setPageSize(size);
        setPage(1);
      }}
    />
  );
};

export default TracesViewer;
