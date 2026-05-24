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
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import MetricRow from "./MetricRow";
import { SparklinePoint } from "./MetricSparkline";
import MetricUtil from "./Utils/Metrics";
import Search from "Common/Types/BaseDatabase/Search";

const DEFAULT_PAGE_SIZE: number = 50;

const SEARCH_HELP_ROWS: Array<SearchHelpRow> = [
  {
    syntax: "name:<fragment>",
    description: "Filter by metric name",
    example: "name:http.server",
  },
  {
    syntax: "service:<name>",
    description: "Filter by service",
    example: "service:api",
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

interface InitialUrlState {
  search: string;
  filters: Array<ActiveFilter>;
  timeRange: RangeStartAndEndDateTime;
  page: number;
  pageSize: number;
}

/*
 * Parse filter state from `window.location.search` on first mount so refresh
 * + back-from-metric-detail restore the view rather than resetting it.
 * Defensive: malformed JSON / unknown enum / non-numeric values fall back to
 * defaults instead of throwing.
 */
function readInitialUrlState(): InitialUrlState {
  const params: URLSearchParams = new URLSearchParams(window.location.search);

  const rawSearch: string | null = params.get("search");
  let search: string = "";
  if (rawSearch) {
    try {
      search = decodeURIComponent(rawSearch);
    } catch {
      search = rawSearch;
    }
  }

  let filters: Array<ActiveFilter> = [];
  const filtersRaw: string | null = params.get("filters");
  if (filtersRaw) {
    try {
      const parsed: unknown = JSON.parse(filtersRaw);
      if (Array.isArray(parsed)) {
        filters = (parsed as Array<unknown>)
          .filter((pair: unknown): pair is [string, string] => {
            return (
              Array.isArray(pair) &&
              pair.length === 2 &&
              typeof pair[0] === "string" &&
              typeof pair[1] === "string"
            );
          })
          .map(([facetKey, value]: [string, string]): ActiveFilter => {
            return {
              facetKey,
              value,
              displayKey: facetKey,
              displayValue: value,
            };
          });
      }
    } catch {
      // malformed JSON → ignore
    }
  }

  let timeRange: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };
  const rangeRaw: string | null = params.get("range");
  if (rangeRaw) {
    const knownRanges: Array<string> = Object.values(TimeRange);
    if (knownRanges.includes(rangeRaw)) {
      const matched: TimeRange = rangeRaw as TimeRange;
      if (matched === TimeRange.CUSTOM) {
        const startStr: string | null = params.get("start");
        const endStr: string | null = params.get("end");
        if (startStr && endStr) {
          const startDate: Date = new Date(startStr);
          const endDate: Date = new Date(endStr);
          if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
            timeRange = {
              range: matched,
              startAndEndDate: new InBetween<Date>(startDate, endDate),
            };
          }
        }
      } else {
        timeRange = { range: matched };
      }
    }
  }

  const pageRaw: string | null = params.get("page");
  const page: number =
    pageRaw && (/^\d+$/).test(pageRaw) ? Math.max(1, parseInt(pageRaw, 10)) : 1;
  const pageSizeRaw: string | null = params.get("pageSize");
  const pageSize: number =
    pageSizeRaw && (/^\d+$/).test(pageSizeRaw)
      ? Math.max(1, parseInt(pageSizeRaw, 10))
      : DEFAULT_PAGE_SIZE;

  return { search, filters, timeRange, page, pageSize };
}

interface Props {
  serviceIds?: Array<ObjectID> | undefined;
  attributeFilters?: Record<string, string> | undefined;
  attributeFilterDisplayKeys?: Record<string, string> | undefined;
}

const MetricsViewer: FunctionComponent<Props> = (
  props: Props,
): ReactElement => {
  /*
   * Parse all filter state from the URL once on first mount so refresh +
   * back-from-metric-detail restore the view.
   */
  const initialUrlState: InitialUrlState = useMemo(readInitialUrlState, []);

  const [metrics, setMetrics] = useState<Array<MetricType>>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(initialUrlState.page);
  const [pageSize, setPageSize] = useState<number>(initialUrlState.pageSize);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const [services, setServices] = useState<Array<Service>>([]);

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    initialUrlState.timeRange,
  );

  const [searchValue, setSearchValue] = useState<string>(
    initialUrlState.search,
  );
  const [submittedSearch, setSubmittedSearch] = useState<string>(
    initialUrlState.search,
  );

  const [activeFilters, setActiveFilters] = useState<Array<ActiveFilter>>(
    initialUrlState.filters,
  );

  /*
   * The search bar's X button (and full backspace) only updates `searchValue`
   * — it doesn't call `onSubmit`. Without this effect, `submittedSearch`
   * stays at the old value, results stay filtered, and the URL keeps the
   * stale `?search=...`. Treat an emptied input as an implicit submit.
   */
  useEffect(() => {
    if (searchValue === "" && submittedSearch !== "") {
      setSubmittedSearch("");
      setPage(1);
    }
  }, [searchValue, submittedSearch]);

  // Telemetry attributes for autocomplete
  const [telemetryAttributes, setTelemetryAttributes] = useState<Array<string>>(
    [],
  );
  const [attributesLoading, setAttributesLoading] = useState<boolean>(false);

  // Attribute value suggestions: attributeKey -> Array<value>
  const [attributeValueSuggestions, setAttributeValueSuggestions] = useState<
    Record<string, Array<string>>
  >({});
  const [attributeValuesLoading, setAttributeValuesLoading] =
    useState<boolean>(false);
  const lastValueSuggestionKeyRef: React.MutableRefObject<string> =
    useRef<string>("");

  // Metric names that match attribute filters (null = no attribute filter active)
  const [attributeMatchedNames, setAttributeMatchedNames] =
    useState<Array<string> | null>(null);
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

  const isScoped: boolean = useMemo(() => {
    const hasServiceIds: boolean = Boolean(
      props.serviceIds && props.serviceIds.length > 0,
    );
    const hasAttributeFilters: boolean = Boolean(
      props.attributeFilters && Object.keys(props.attributeFilters).length > 0,
    );
    return hasServiceIds || hasAttributeFilters;
  }, [props.serviceIds, props.attributeFilters]);

  /*
   * Mirror filter state to the URL so refresh and back-from-metric-detail
   * restore the view. Uses `replaceState` so individual filter tweaks don't
   * push history entries.
   */
  useEffect(() => {
    const params: URLSearchParams = new URLSearchParams();
    if (submittedSearch) {
      params.set("search", submittedSearch);
    }
    if (activeFilters.length > 0) {
      const tuples: Array<[string, string]> = activeFilters.map(
        (f: ActiveFilter): [string, string] => {
          return [f.facetKey, f.value];
        },
      );
      params.set("filters", JSON.stringify(tuples));
    }
    if (timeRange.range !== TimeRange.PAST_ONE_HOUR) {
      params.set("range", timeRange.range);
    }
    if (timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate) {
      params.set("start", timeRange.startAndEndDate.startValue.toISOString());
      params.set("end", timeRange.startAndEndDate.endValue.toISOString());
    }
    if (page > 1) {
      params.set("page", String(page));
    }
    if (pageSize !== DEFAULT_PAGE_SIZE) {
      params.set("pageSize", String(pageSize));
    }

    const query: string = params.toString();
    const nextSearch: string = query ? `?${query}` : "";
    if (nextSearch !== window.location.search) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${nextSearch}${window.location.hash}`,
      );
    }
  }, [submittedSearch, activeFilters, timeRange, page, pageSize]);

  // Load services and telemetry attributes once
  useEffect(() => {
    if (isScoped) {
      // No service facet in scoped views, so skip the fetch.
      return;
    }
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
        const named: Array<Service> = (result.data || []).filter(
          (s: Service): boolean => {
            return Boolean(s.name && s.name.toString().trim());
          },
        );
        setServices(named);
      } catch {
        // non-critical
      }
    };
    void loadServices();
  }, [isScoped]);

  // Load telemetry attributes for autocomplete
  useEffect(() => {
    const loadAttributes: () => Promise<void> = async () => {
      try {
        setAttributesLoading(true);
        const attrs: Array<string> = await MetricUtil.getTelemetryAttributes();
        setTelemetryAttributes(attrs);
      } catch {
        // non-critical
      } finally {
        setAttributesLoading(false);
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
        setAttributeValuesLoading(true);
        const values: Array<string> =
          await MetricUtil.getTelemetryAttributeValues({
            attributeKey: attrKey,
          });
        setAttributeValueSuggestions(
          (
            prev: Record<string, Array<string>>,
          ): Record<string, Array<string>> => {
            return { ...prev, [attrKey]: values };
          },
        );
      } catch {
        // non-critical
      } finally {
        setAttributeValuesLoading(false);
      }
    };
    void loadValues();
  }, [searchValue]);

  /*
   * Parse search string
   * Follows log syntax: name:value, service:value (no @) for fields;
   * @attribute:value (with @) for attributes
   */
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
    /*
     * Tokenizer also matches `field:"value with spaces"` so users can search
     * metric names that include spaces. See the matching block in
     * TracesViewer for details.
     */
    const rawTokens: Array<string> =
      raw.match(/@?\S+:"[^"]*"|@\S+:[^\s]+|\S+/g) || [];
    const tokens: Array<string> = [];
    for (let i: number = 0; i < rawTokens.length; i++) {
      const token: string = rawTokens[i]!;
      if (token.endsWith(":") && i + 1 < rawTokens.length) {
        const prefix: string = token.slice(0, -1);
        const isAttr: boolean = prefix.startsWith("@");
        const fieldName: string = isAttr
          ? prefix.slice(1).toLowerCase()
          : prefix.toLowerCase();
        if (isAttr || KNOWN_FIELD_KEYS.has(fieldName)) {
          let merged: string = token + rawTokens[i + 1]!;
          i++;
          if (merged.includes(':"') && !merged.endsWith('"')) {
            while (i + 1 < rawTokens.length && !merged.endsWith('"')) {
              i++;
              merged = merged + " " + rawTokens[i]!;
            }
          }
          tokens.push(merged);
          continue;
        }
      }
      if (token.includes(':"') && !token.endsWith('"')) {
        let merged: string = token;
        while (i + 1 < rawTokens.length && !merged.endsWith('"')) {
          i++;
          merged = merged + " " + rawTokens[i]!;
        }
        tokens.push(merged);
        continue;
      }
      tokens.push(token);
    }
    const stripQuotes: (s: string) => string = (s: string): string => {
      if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        return s.slice(1, -1);
      }
      return s;
    };
    for (const token of tokens) {
      // @attribute:value → attribute filter
      const attrMatch: RegExpMatchArray | null = token.match(/^@([^:]+):(.*)$/);
      if (attrMatch) {
        const attrKey: string = attrMatch[1]!;
        const attrValue: string = stripQuotes(attrMatch[2]!);
        if (attrValue.length > 0) {
          attributes[attrKey] = attrValue;
        }
        continue;
      }
      // field:value (no @) → known field filter
      const fieldMatch: RegExpMatchArray | null = token.match(/^([^:]+):(.*)$/);
      if (fieldMatch) {
        const fieldName: string = fieldMatch[1]!.toLowerCase();
        const fieldValue: string = stripQuotes(fieldMatch[2]!);
        if (fieldName === "name" && fieldValue.length > 0) {
          nameFragment = fieldValue;
        } else if (fieldName === "service" && fieldValue.length > 0) {
          serviceFragment = fieldValue;
        } else {
          freeTextParts.push(token);
        }
        continue;
      }
      freeTextParts.push(token);
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

  /*
   * Merge attribute filters from two sources:
   *   1. Tokens parsed from the typed search string (`@key:value`).
   *   2. Chips in `activeFilters` whose key starts with `attributes.`
   *      (added when the user picks a value from the dropdown / hits Enter).
   */
  const effectiveAttributes: Record<string, string> = useMemo(() => {
    const attrs: Record<string, string> = { ...parsedSearch.attributes };
    for (const filter of activeFilters) {
      if (filter.facetKey.startsWith("attributes.")) {
        const attrKey: string = filter.facetKey.substring("attributes.".length);
        attrs[attrKey] = filter.value;
      }
    }
    if (props.attributeFilters) {
      for (const [key, value] of Object.entries(props.attributeFilters)) {
        if (value) {
          attrs[key] = value;
        }
      }
    }
    return attrs;
  }, [parsedSearch.attributes, activeFilters, props.attributeFilters]);

  // When attribute filters change, query the Metric analytics model for matching metric names
  useEffect(() => {
    const attributeKeys: Array<string> = Object.keys(effectiveAttributes);
    const filterKey: string = JSON.stringify(effectiveAttributes);

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
          attributes: effectiveAttributes,
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
  }, [effectiveAttributes, timeRange]);

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
      /*
       * Use substring matching so @name:container.blockio matches
       * container.blockio.io_service_bytes_recursive
       */
      (query as Record<string, unknown>)["name"] = new Search(nameQuery);
    }

    return query;
  }, [props.serviceIds, activeFilters, parsedSearch, attributeMatchedNames]);

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
    /*
     * When attribute filters are active, defer the metric list fetch until the
     * attribute → name match has resolved. Otherwise the first pass would query
     * with no name restriction and briefly render the unfiltered list before
     * snapping to the filtered one.
     */
    const hasEffectiveAttributes: boolean =
      Object.keys(effectiveAttributes).length > 0;
    if (hasEffectiveAttributes && attributeMatchedNames === null) {
      setIsLoading(true);
      return;
    }
    void fetchMetrics();
  }, [fetchMetrics, effectiveAttributes, attributeMatchedNames]);

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
        const dateRange: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

        /*
         * Backend-aggregated fetch (one parallel call per metric name).
         * The previous getList path with `limit: 5000` truncated by
         * time when a host emitted many per-attribute-combo rows
         * (e.g. process.* metrics: ~700 rows/min each), so the right
         * side of every sparkline flatlined at 0. The aggregate API
         * returns one bucketed point per minute (~60 rows/metric for a
         * 1h window) and reuses the explorer's dedup/result cache.
         */
        const aggregates: Map<string, AggregatedResult> =
          await MetricUtil.fetchSparklineAggregates({
            metricNames: visibleNames,
            attributes: effectiveAttributes as Record<string, string>,
            startAndEndDate: new InBetween<Date>(
              dateRange.startValue,
              dateRange.endValue,
            ),
          });

        const last: Record<string, number> = {};
        const out: Record<string, Array<SparklinePoint>> = {};
        for (const name of visibleNames) {
          const aggregated: AggregatedResult = aggregates.get(name) || {
            data: [],
          };
          const points: Array<SparklinePoint> = [];
          for (const row of aggregated.data) {
            const ts: Date | undefined =
              row.timestamp instanceof Date
                ? row.timestamp
                : row.timestamp
                  ? OneUptimeDate.fromString(row.timestamp as unknown as string)
                  : undefined;
            const value: number = Number(row.value);
            if (!ts || !Number.isFinite(value)) {
              continue;
            }
            points.push({ time: ts.toISOString(), value });
          }
          // Sort ascending so the chart renders left-to-right.
          points.sort((a: SparklinePoint, b: SparklinePoint): number => {
            return new Date(a.time).getTime() - new Date(b.time).getTime();
          });
          out[name] = points;
          if (points.length > 0) {
            // Most recent point — the rightmost bucket on the chart.
            last[name] = points[points.length - 1]!.value;
          }
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
  }, [visibleNames, timeRange, effectiveAttributes]);

  // Facet configs
  const facetConfigs: Array<FacetConfig> = useMemo(() => {
    if (isScoped) {
      return [];
    }
    const serviceNameMap: Record<string, string> = {};
    const serviceColorMap: Record<string, string> = {};
    for (const service of services) {
      if (service.id && service.name) {
        serviceNameMap[service.id.toString()] = service.name.toString();
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
  }, [services, isScoped]);

  /*
   * Compute facets from loaded services (and distribution isn't known without
   * a backend aggregation, so show equal weights for v1)
   */
  const facetData: FacetData = useMemo(() => {
    if (isScoped) {
      return {};
    }
    const values: Array<FacetValue> = services
      .filter((s: Service): boolean => {
        return Boolean(s.id && s.name);
      })
      .map((s: Service): FacetValue => {
        return { value: s.id!.toString(), count: 0 };
      });
    return { serviceId: values };
  }, [services, isScoped]);

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
          // Attribute chips (`attributes.<key>`) display as just `<key>`.
          const displayKey: string = facetKey.startsWith("attributes.")
            ? facetKey.substring("attributes.".length)
            : config?.title || facetKey;
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

  // Read-only chips for prop-level scoping (e.g. service view page)
  const mergedActiveFilters: Array<ActiveFilter> = useMemo(() => {
    const resolveDisplay: (chip: ActiveFilter) => ActiveFilter = (
      chip: ActiveFilter,
    ) => {
      const config: FacetConfig | undefined = facetConfigs.find(
        (c: FacetConfig): boolean => {
          return c.key === chip.facetKey;
        },
      );
      const displayKey: string = chip.facetKey.startsWith("attributes.")
        ? chip.facetKey.substring("attributes.".length)
        : config?.title || chip.displayKey || chip.facetKey;
      const displayValue: string =
        config?.valueDisplayMap?.[chip.value] ||
        chip.displayValue ||
        chip.value;
      return { ...chip, displayKey, displayValue };
    };

    const base: Array<ActiveFilter> = [];
    if (props.serviceIds && props.serviceIds.length > 0) {
      for (const serviceId of props.serviceIds) {
        base.push(
          resolveDisplay({
            facetKey: "serviceId",
            value: serviceId.toString(),
            displayKey: "Service",
            displayValue: serviceId.toString(),
            readOnly: true,
          }),
        );
      }
    }
    if (props.attributeFilters) {
      for (const [key, value] of Object.entries(props.attributeFilters)) {
        if (!value) {
          continue;
        }
        const displayKey: string =
          props.attributeFilterDisplayKeys?.[key] || key;
        base.push({
          facetKey: `attributes.${key}`,
          value,
          displayKey,
          displayValue: value,
          readOnly: true,
        });
      }
    }
    return [...base, ...activeFilters.map(resolveDisplay)];
  }, [
    props.serviceIds,
    props.attributeFilters,
    props.attributeFilterDisplayKeys,
    activeFilters,
    facetConfigs,
  ]);

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
      const presetAttributes: Record<string, string> = {};
      if (props.attributeFilters) {
        for (const [key, value] of Object.entries(props.attributeFilters)) {
          if (value) {
            presetAttributes[key] = value;
          }
        }
      }
      const queryPayload: Record<string, unknown> = {
        metricName: metric.name || "",
        aggregationType: MetricsAggregationType.Avg,
      };
      if (Object.keys(presetAttributes).length > 0) {
        queryPayload["attributes"] = presetAttributes;
      }
      const metricQueriesPayload: Array<Record<string, unknown>> = [
        queryPayload,
      ];
      metricUrl.addQueryParam(
        "metricQueries",
        JSON.stringify(metricQueriesPayload),
        true,
      );
      Navigation.navigate(metricUrl);
    },
    [props.attributeFilters],
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
      searchPlaceholder="Search metrics — e.g. name:http service:api @container.name:postgres"
      searchSuggestions={["name", "service"]}
      searchAttributeSuggestions={telemetryAttributes}
      searchValueSuggestions={attributeValueSuggestions}
      searchAttributesLoading={attributesLoading}
      searchValuesLoading={attributeValuesLoading}
      onSearchFieldValueSelect={(fieldKey: string, value: string) => {
        /*
         * `name` and `service` are handled via the typed search path
         * (substring + service facet), so promote those to the search
         * string. Unknown keys are telemetry attributes — turn them into
         * chips with the `attributes.` prefix so they live in
         * `activeFilters` and are routed through the analytics query.
         * Known-field detection is case-insensitive; attribute keys keep
         * their original case (the backend matches map keys case-
         * insensitively at query time).
         *
         * For the attribute (chip) branch, strip surrounding quotes so a
         * value like `"my-value"` doesn't get stored literally as a chip.
         * The known-field branch preserves quotes because the resulting
         * search string is re-parsed by `parseSearch`, which strips them.
         */
        const lowerFieldKey: string = fieldKey.toLowerCase();
        if (KNOWN_FIELD_KEYS.has(lowerFieldKey)) {
          const newSearch: string = `${lowerFieldKey}:${value}`;
          setSearchValue(newSearch);
          setSubmittedSearch(newSearch);
          setPage(1);
          return;
        }
        const cleanValue: string =
          value.length >= 2 && value.startsWith('"') && value.endsWith('"')
            ? value.slice(1, -1)
            : value;
        handleFacetInclude(`attributes.${fieldKey}`, cleanValue);
      }}
      searchFieldAliasMap={FIELD_ALIAS_MAP}
      searchHelpRows={SEARCH_HELP_ROWS}
      searchHelpCombinedExample="service:api @container.name:postgres http.server.duration"
      // Time (drives sparkline range)
      timeRange={timeRange}
      onTimeRangeChange={(value: RangeStartAndEndDateTime) => {
        setTimeRange(value);
      }}
      // Facets
      showFacetSidebar={!isScoped}
      facetData={facetData}
      facetConfigs={facetConfigs}
      facetLoading={false}
      onFacetInclude={handleFacetInclude}
      // Active filters
      activeFilters={mergedActiveFilters}
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
