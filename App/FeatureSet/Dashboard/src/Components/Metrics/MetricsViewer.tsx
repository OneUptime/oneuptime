import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import TelemetryViewer from "Common/UI/Components/TelemetryViewer/TelemetryViewer";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
  FacetValue,
  SearchHelpRow,
} from "Common/UI/Components/TelemetryViewer/types";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Service from "Common/Models/DatabaseModels/Service";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ModelAPI, {
  ListResult as ModelListResult,
} from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import MetricRow from "./MetricRow";
import { SparklinePoint } from "./MetricSparkline";
import MetricUtil from "./Utils/Metrics";
import Search from "Common/Types/BaseDatabase/Search";

const DEFAULT_PAGE_SIZE: number = 50;

const SEARCH_HELP_ROWS: Array<SearchHelpRow> = [
  {
    syntax: "@name:<fragment>",
    description: "Filter by metric name",
    example: "@name:http.server",
  },
  {
    syntax: "@service:<name>",
    description: "Filter by service",
    example: "@service:api",
  },
  {
    syntax: "@<attribute>:<value>",
    description: "Filter by attribute",
    example: "@container.name:postgres",
  },
];

const FIELD_ALIAS_MAP: Record<string, string> = {
  name: "name",
  service: "services.name",
};

const KNOWN_FIELD_KEYS: Set<string> = new Set(["name", "service"]);

interface Props {
  serviceIds?: Array<ObjectID> | undefined;
}

const MetricsViewer: FunctionComponent<Props> = (
  props: Props,
): ReactElement => {
  const [metrics, setMetrics] = useState<Array<MetricType>>([]);
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

  // Telemetry attributes for autocomplete
  const [telemetryAttributes, setTelemetryAttributes] = useState<
    Array<string>
  >([]);

  // Attribute value suggestions: attributeKey -> Array<value>
  const [attributeValueSuggestions, setAttributeValueSuggestions] = useState<
    Record<string, Array<string>>
  >({});
  const lastValueSuggestionKeyRef: React.MutableRefObject<string> =
    useRef<string>("");

  // Metric names that match attribute filters (null = no attribute filter active)
  const [attributeMatchedNames, setAttributeMatchedNames] = useState<
    Array<string> | null
  >(null);
  const [attributeFilterLoading, setAttributeFilterLoading] =
    useState<boolean>(false);

  // Track the last submitted attribute filters to avoid redundant queries
  const lastAttributeFilterRef: React.MutableRefObject<string> =
    useRef<string>("");

  // name -> sparkline data
  const [sparklineData, setSparklineData] = useState<
    Record<string, Array<SparklinePoint>>
  >({});
  const [sparklineLastValue, setSparklineLastValue] = useState<
    Record<string, number>
  >({});
  const [sparklineLoading, setSparklineLoading] = useState<boolean>(false);

  // Load services and telemetry attributes once
  useEffect(() => {
    const loadServices: () => Promise<void> = async () => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          return;
        }
        const result: ModelListResult<Service> = await ModelAPI.getList({
          modelType: Service,
          query: { projectId },
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

  // Load telemetry attributes for autocomplete
  useEffect(() => {
    const loadAttributes: () => Promise<void> = async () => {
      try {
        const attrs: Array<string> =
          await MetricUtil.getTelemetryAttributes();
        setTelemetryAttributes(attrs);
      } catch {
        // non-critical
      }
    };
    void loadAttributes();
  }, []);

  // Load attribute values when the user types @attribute: in the search bar
  useEffect(() => {
    const currentWord: string = (searchValue.split(/\s+/).pop() || "").trim();
    if (!currentWord.startsWith("@") || !currentWord.includes(":")) {
      return;
    }
    const colonIdx: number = currentWord.indexOf(":");
    const attrKey: string = currentWord.substring(1, colonIdx);

    if (
      !attrKey ||
      KNOWN_FIELD_KEYS.has(attrKey) ||
      attrKey === lastValueSuggestionKeyRef.current
    ) {
      return;
    }
    lastValueSuggestionKeyRef.current = attrKey;

    const loadValues: () => Promise<void> = async () => {
      try {
        const values: Array<string> =
          await MetricUtil.getTelemetryAttributeValues({
            attributeKey: attrKey,
          });
        setAttributeValueSuggestions(
          (prev: Record<string, Array<string>>): Record<
            string,
            Array<string>
          > => {
            return { ...prev, [attrKey]: values };
          },
        );
      } catch {
        // non-critical
      }
    };
    void loadValues();
  }, [searchValue]);

  // Parse search string
  const parseSearch: (raw: string) => {
    freeText: string;
    nameFragment: string | null;
    serviceFragment: string | null;
    attributes: Record<string, string>;
  } = useCallback((raw: string) => {
    let nameFragment: string | null = null;
    let serviceFragment: string | null = null;
    const attributes: Record<string, string> = {};
    const freeTextParts: Array<string> = [];
    const tokens: Array<string> = raw.match(/@\S+:[^\s]+|\S+/g) || [];
    for (const token of tokens) {
      const match: RegExpMatchArray | null = token.match(/^@([^:]+):(.*)$/);
      if (match) {
        const alias: string = match[1]!;
        const value: string = match[2]!;
        if (alias === "name") {
          nameFragment = value;
        } else if (alias === "service") {
          serviceFragment = value;
        } else if (!KNOWN_FIELD_KEYS.has(alias)) {
          attributes[alias] = value;
        }
      } else {
        freeTextParts.push(token);
      }
    }
    return {
      freeText: freeTextParts.join(" ").trim(),
      nameFragment,
      serviceFragment,
      attributes,
    };
  }, []);

  // Parsed search (memoized from submitted search)
  const parsedSearch: ReturnType<typeof parseSearch> = useMemo(() => {
    return parseSearch(submittedSearch);
  }, [submittedSearch, parseSearch]);

  // When attribute filters change, query the Metric analytics model for matching metric names
  useEffect(() => {
    const attributeKeys: Array<string> = Object.keys(parsedSearch.attributes);
    const filterKey: string = JSON.stringify(parsedSearch.attributes);

    if (attributeKeys.length === 0) {
      setAttributeMatchedNames(null);
      lastAttributeFilterRef.current = "";
      return;
    }

    // Skip if same filter as last time
    if (filterKey === lastAttributeFilterRef.current) {
      return;
    }
    lastAttributeFilterRef.current = filterKey;

    const fetchMatchingNames: () => Promise<void> = async () => {
      setAttributeFilterLoading(true);
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          setAttributeMatchedNames([]);
          return;
        }

        const dateRange: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

        const analyticsQuery: Query<Metric> = {
          projectId,
          time: new InBetween<Date>(dateRange.startValue, dateRange.endValue),
          attributes: parsedSearch.attributes,
        } as Query<Metric>;

        const result: AnalyticsListResult<Metric> =
          await AnalyticsModelAPI.getList<Metric>({
            modelType: Metric,
            query: analyticsQuery,
            limit: 5000,
            skip: 0,
            select: {
              name: true,
            } as Select<Metric>,
            sort: { time: SortOrder.Descending } as Record<string, SortOrder>,
            requestOptions: {},
          });

        const uniqueNames: Set<string> = new Set<string>();
        for (const m of result.data) {
          const name: string = m.name as unknown as string;
          if (name) {
            uniqueNames.add(name);
          }
        }
        setAttributeMatchedNames(Array.from(uniqueNames));
      } catch {
        setAttributeMatchedNames([]);
      } finally {
        setAttributeFilterLoading(false);
      }
    };
    void fetchMatchingNames();
  }, [parsedSearch.attributes, timeRange]);

  // Build metric query
  const metricQuery: Query<MetricType> = useMemo(() => {
    const query: Query<MetricType> = {};
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (projectId) {
      query.projectId = projectId;
    }

    // Prop-level service filter
    const propServiceIds: Array<ObjectID> = props.serviceIds || [];

    // Active facet filters for service
    const facetServiceIds: Array<ObjectID> = [];
    for (const filter of activeFilters) {
      if (filter.facetKey === "serviceId") {
        facetServiceIds.push(new ObjectID(filter.value));
      }
    }

    const mergedServiceIds: Array<ObjectID> = [
      ...propServiceIds,
      ...facetServiceIds,
    ];

    if (mergedServiceIds.length > 0) {
      (query as Record<string, unknown>)["services"] = new Includes(
        mergedServiceIds,
      );
    }

    // Name search (freeText + @name:)
    const nameQuery: string | null =
      parsedSearch.nameFragment || parsedSearch.freeText;

    // When attribute filters are active, restrict to matched metric names
    if (attributeMatchedNames !== null) {
      if (attributeMatchedNames.length === 0) {
        // No metrics match the attribute filter — force empty results
        (query as Record<string, unknown>)["name"] = "__no_match__";
      } else if (nameQuery) {
        // Intersect: only show attribute-matched names that also contain the name fragment
        const lowerNameQuery: string = nameQuery.toLowerCase();
        const filtered: Array<string> = attributeMatchedNames.filter(
          (n: string): boolean => {
            return n.toLowerCase().includes(lowerNameQuery);
          },
        );
        if (filtered.length === 0) {
          (query as Record<string, unknown>)["name"] = "__no_match__";
        } else {
          (query as Record<string, unknown>)["name"] = new Includes(filtered);
        }
      } else {
        (query as Record<string, unknown>)["name"] = new Includes(
          attributeMatchedNames,
        );
      }
    } else if (nameQuery) {
      // Use substring matching so @name:container.blockio matches
      // container.blockio.io_service_bytes_recursive
      (query as Record<string, unknown>)["name"] = new Search(nameQuery);
    }

    return query;
  }, [
    props.serviceIds,
    activeFilters,
    parsedSearch,
    attributeMatchedNames,
  ]);

  // Fetch metric list
  const fetchMetrics: () => Promise<void> = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const result: ModelListResult<MetricType> = await ModelAPI.getList({
        modelType: MetricType,
        query: metricQuery,
        limit: pageSize,
        skip: (page - 1) * pageSize,
        select: {
          name: true,
          description: true,
          unit: true,
          services: {
            _id: true,
            name: true,
            serviceColor: true,
          },
        },
        sort: { name: SortOrder.Ascending },
      });
      setMetrics(result.data || []);
      setTotalCount(result.count);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [metricQuery, page, pageSize]);

  useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  // Batch-fetch sparklines for visible metric names
  const visibleNames: Array<string> = useMemo(() => {
    return metrics
      .map((m: MetricType): string | undefined => {
        return m.name || undefined;
      })
      .filter((n: string | undefined): n is string => {
        return typeof n === "string" && n.length > 0;
      });
  }, [metrics]);

  useEffect(() => {
    if (visibleNames.length === 0) {
      setSparklineData({});
      setSparklineLastValue({});
      return;
    }
    const fetchSparklines: () => Promise<void> = async () => {
      setSparklineLoading(true);
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          return;
        }
        const dateRange: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

        const query: Query<Metric> = {
          projectId,
          name: new Includes(visibleNames),
          time: new InBetween<Date>(dateRange.startValue, dateRange.endValue),
          ...(Object.keys(parsedSearch.attributes).length > 0
            ? { attributes: parsedSearch.attributes }
            : {}),
        } as Query<Metric>;

        const result: AnalyticsListResult<Metric> =
          await AnalyticsModelAPI.getList<Metric>({
            modelType: Metric,
            query,
            limit: 5000,
            skip: 0,
            select: {
              name: true,
              time: true,
              value: true,
            } as Select<Metric>,
            sort: { time: SortOrder.Ascending } as Record<string, SortOrder>,
            requestOptions: {},
          });

        // Bucket into N equal-width buckets per metric name
        const buckets: number = 24;
        const startMs: number = dateRange.startValue.getTime();
        const endMs: number = dateRange.endValue.getTime();
        const bucketMs: number = Math.max(
          1,
          Math.floor((endMs - startMs) / buckets),
        );

        // name -> bucketIdx -> sum + count
        const acc: Map<
          string,
          Array<{ sum: number; count: number }>
        > = new Map();
        for (const name of visibleNames) {
          const arr: Array<{ sum: number; count: number }> = [];
          for (let i: number = 0; i < buckets; i++) {
            arr.push({ sum: 0, count: 0 });
          }
          acc.set(name, arr);
        }

        const last: Record<string, number> = {};

        for (const m of result.data) {
          const name: string = m.name as unknown as string;
          if (!name || !acc.has(name)) {
            continue;
          }
          const t: Date = OneUptimeDate.fromString(m.time as unknown as string);
          const idx: number = Math.min(
            buckets - 1,
            Math.max(0, Math.floor((t.getTime() - startMs) / bucketMs)),
          );
          const v: number = Number(m.value || 0);
          const arr: Array<{ sum: number; count: number }> = acc.get(name)!;
          arr[idx]!.sum += v;
          arr[idx]!.count += 1;
          last[name] = v;
        }

        const out: Record<string, Array<SparklinePoint>> = {};
        for (const [name, arr] of acc.entries()) {
          const points: Array<SparklinePoint> = arr.map(
            (
              bucket: { sum: number; count: number },
              i: number,
            ): SparklinePoint => {
              const t: Date = new Date(startMs + i * bucketMs);
              const v: number =
                bucket.count > 0 ? bucket.sum / bucket.count : 0;
              return { time: t.toISOString(), value: v };
            },
          );
          out[name] = points;
        }
        setSparklineData(out);
        setSparklineLastValue(last);
      } catch {
        setSparklineData({});
        setSparklineLastValue({});
      } finally {
        setSparklineLoading(false);
      }
    };
    void fetchSparklines();
  }, [visibleNames, timeRange, parsedSearch.attributes]);

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
    return [
      {
        key: "serviceId",
        title: "Service",
        valueDisplayMap: serviceNameMap,
        valueColorMap: serviceColorMap,
        priority: 1,
      },
    ];
  }, [services]);

  /*
   * Compute facets from loaded services (and distribution isn't known without
   * a backend aggregation, so show equal weights for v1)
   */
  const facetData: FacetData = useMemo(() => {
    const values: Array<FacetValue> = services
      .filter((s: Service): boolean => {
        return Boolean(s.id);
      })
      .map((s: Service): FacetValue => {
        return { value: s.id!.toString(), count: 0 };
      });
    return { serviceId: values };
  }, [services]);

  // Facet interaction
  const handleFacetInclude: (facetKey: string, value: string) => void =
    useCallback(
      (facetKey: string, value: string) => {
        setActiveFilters((prev: Array<ActiveFilter>): Array<ActiveFilter> => {
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
          return [...prev, { facetKey, value, displayKey, displayValue }];
        });
        setPage(1);
      },
      [facetConfigs],
    );

  const handleRemoveFilter: (facetKey: string, value: string) => void =
    useCallback((facetKey: string, value: string) => {
      setActiveFilters((prev: Array<ActiveFilter>): Array<ActiveFilter> => {
        return prev.filter((f: ActiveFilter): boolean => {
          return !(f.facetKey === facetKey && f.value === value);
        });
      });
      setPage(1);
    }, []);

  const handleClearAllFilters: () => void = useCallback(() => {
    setActiveFilters([]);
    setPage(1);
  }, []);

  // Row click → navigate to metric viewer
  const handleRowClick: (metric: MetricType) => void = useCallback(
    (metric: MetricType) => {
      const route: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.METRIC_VIEW]!,
      );
      const currentUrl: URL = Navigation.getCurrentURL();
      const metricUrl: URL = new URL(
        currentUrl.protocol,
        currentUrl.hostname,
        route,
      );
      const metricQueriesPayload: Array<Record<string, unknown>> = [
        {
          metricName: metric.name || "",
          aggregationType: MetricsAggregationType.Avg,
        },
      ];
      metricUrl.addQueryParam(
        "metricQueries",
        JSON.stringify(metricQueriesPayload),
        true,
      );
      Navigation.navigate(metricUrl);
    },
    [],
  );

  return (
    <TelemetryViewer<MetricType>
      items={metrics}
      isLoading={isLoading || attributeFilterLoading}
      error={error || undefined}
      onRefresh={() => {
        void fetchMetrics();
      }}
      emptyMessage="No metrics found"
      itemLabel="metrics"
      renderRow={(metric: MetricType): ReactElement => {
        const name: string = metric.name || "";
        return (
          <MetricRow
            metric={metric}
            sparklinePoints={sparklineData[name]}
            sparklineLoading={sparklineLoading}
            lastValue={sparklineLastValue[name]}
            onClick={() => {
              handleRowClick(metric);
            }}
          />
        );
      }}
      getRowKey={(metric: MetricType, index: number): string => {
        return `${metric._id?.toString() || metric.name || "row"}-${index}`;
      }}
      // Search
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      onSearchSubmit={() => {
        setSubmittedSearch(searchValue);
        setPage(1);
      }}
      searchPlaceholder="Search metrics — e.g. @name:http @service:api @container.name:postgres"
      searchSuggestions={telemetryAttributes.map((attr: string): string => {
        return `@${attr}`;
      })}
      searchValueSuggestions={attributeValueSuggestions}
      onSearchFieldValueSelect={(fieldKey: string, value: string) => {
        // When user selects a value suggestion, add @field:value to search and submit
        const newSearch: string = `@${fieldKey}:${value}`;
        setSearchValue(newSearch);
        setSubmittedSearch(newSearch);
        setPage(1);
      }}
      searchFieldAliasMap={FIELD_ALIAS_MAP}
      searchHelpRows={SEARCH_HELP_ROWS}
      searchHelpCombinedExample="@service:api @container.name:postgres http.server.duration"
      // Time (drives sparkline range)
      timeRange={timeRange}
      onTimeRangeChange={(value: RangeStartAndEndDateTime) => {
        setTimeRange(value);
      }}
      // Facets
      showFacetSidebar={true}
      facetData={facetData}
      facetConfigs={facetConfigs}
      facetLoading={false}
      onFacetInclude={handleFacetInclude}
      // Active filters
      activeFilters={activeFilters}
      onRemoveFilter={handleRemoveFilter}
      onClearAllFilters={handleClearAllFilters}
      // No top histogram for metrics
      showHistogram={false}
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

export default MetricsViewer;
