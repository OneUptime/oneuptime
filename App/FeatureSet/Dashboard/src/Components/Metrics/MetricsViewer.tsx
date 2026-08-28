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
import GroupBy from "Common/Types/BaseDatabase/GroupBy";
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
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import MetricRow from "./MetricRow";
import { SparklinePoint } from "./MetricSparkline";
import MetricUtil from "./Utils/Metrics";
import TelemetrySavedViewsControl from "../Telemetry/TelemetrySavedViewsControl";
import {
  serializeSavedViewTimeRange,
  deserializeSavedViewTimeRange,
} from "Common/Utils/Telemetry/SavedViewTimeRange";
import {
  readSavedViewFilters,
  SavedViewFilterTuple,
} from "Common/Utils/Telemetry/SavedViewFilters";
import useServiceNames from "../Telemetry/useServiceNames";
import MetricSavedView from "Common/Models/DatabaseModels/MetricSavedView";
import TelemetrySavedViewState from "Common/Types/Telemetry/TelemetrySavedViewState";
import TelemetrySavedViewType from "Common/Types/Telemetry/TelemetrySavedViewType";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
import Dictionary from "Common/Types/Dictionary";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import { describeSearchValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  ATTRIBUTE_FACET_PREFIX,
  METRICS_FIELD_ALIAS_MAP,
  METRICS_KNOWN_FIELD_KEYS,
  MetricNameFilter,
  MetricsAttributeFilters,
  MetricsTextMatcher,
  ParsedMetricsSearch,
  mergeMetricsAttributeFilters,
  parseMetricsSearch,
  valueCarriesSearchSyntax,
} from "./MetricsSearchQuery";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import { writeTelemetryViewerUrlState } from "../../Utils/TelemetryViewerUrlState";
import { buildUrlScopeOverrides } from "../../Utils/InitialSavedView";
import { shouldAdoptTimeRangeOverride } from "../../Utils/SharedTelemetryTimeCursor";

async function postApi(
  path: string,
  data: JSONObject,
): Promise<HTTPResponse<JSONObject>> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(path),
      data,
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response;
}

/*
 * Entity-scoped sparkline aggregates. MetricUtil.fetchSparklineAggregates has
 * no entityKeys passthrough, so the per-metric aggregate is issued directly
 * with the same `hasAny(entityKeys, [...])` constraint as the list query —
 * otherwise the sparkline numbers would span the whole project.
 */
async function fetchEntityScopedSparklineAggregates(data: {
  metricNames: Array<string>;
  attributes: MetricsAttributeFilters;
  startAndEndDate: InBetween<Date>;
  entityKeys: Array<string>;
  entityScope?: EntityScopeFilter | undefined;
}): Promise<Map<string, AggregatedResult>> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  if (!projectId || data.metricNames.length === 0) {
    return new Map();
  }

  const results: Array<[string, AggregatedResult]> = await Promise.all(
    data.metricNames.map(
      async (name: string): Promise<[string, AggregatedResult]> => {
        try {
          const query: Query<Metric> = {
            projectId,
            time: data.startAndEndDate,
            name,
          } as Query<Metric>;
          if (Object.keys(data.attributes).length > 0) {
            (query as Record<string, unknown>)["attributes"] = data.attributes;
          }
          if (data.entityKeys.length > 0) {
            (query as Record<string, unknown>)["entityKeys"] = new Includes(
              data.entityKeys,
            );
          }
          if (data.entityScope) {
            (query as Record<string, unknown>)["entityScope"] =
              data.entityScope;
          }
          const result: AggregatedResult =
            await AnalyticsModelAPI.aggregate<Metric>({
              modelType: Metric,
              aggregateBy: {
                query,
                aggregationType: MetricsAggregationType.Avg,
                aggregateColumnName: "value",
                aggregationTimestampColumnName: "time",
                startTimestamp: data.startAndEndDate.startValue,
                endTimestamp: data.startAndEndDate.endValue,
                limit: LIMIT_PER_PROJECT,
                skip: 0,
              } as AggregateBy<Metric>,
            });
          return [name, result];
        } catch {
          return [name, { data: [] }];
        }
      },
    ),
  );

  return new Map(results);
}

const DEFAULT_PAGE_SIZE: number = 50;

/*
 * The syntax table. Every row here is honoured by the shared search grammar
 * in Common/Types/Telemetry/TelemetrySearchQuery — the table used to list
 * three rows for a parser that supported exact match and nothing else, so a
 * user who typed the wildcard every other search box teaches got an empty
 * list with no way to tell that the syntax, not the data, was missing.
 */
const SEARCH_HELP_ROWS: Array<SearchHelpRow> = [
  {
    syntax: "free text",
    description: "Search metric names",
    example: "http.server",
  },
  {
    syntax: "name:<fragment>",
    description: "Metric name contains",
    example: "name:http.server",
  },
  {
    syntax: "name:<glob>",
    description: "Metric name matches — * is any text, ? is one character",
    example: "name:http.server.*",
  },
  {
    syntax: "service:<name>",
    description: "Filter by service",
    example: "service:api",
  },
  {
    syntax: "@<attr>:<value>",
    description: "Filter by attribute",
    example: "@container.name:postgres",
  },
  {
    syntax: "@<attr>:<value>*",
    description: "Wildcard — * is any text, ? is one character",
    example: "@k8s.pod.name:api-*",
  },
  {
    syntax: "@<attr>:*",
    description: "Attribute is present",
    example: "@host.name:*",
  },
  {
    syntax: "@<attr>:~<text>",
    description: "Attribute contains",
    example: "@container.name:~postgres",
  },
  {
    syntax: "-<filter>",
    description: "Exclude — works with every filter above",
    example: "-@container.name:postgres",
  },
  {
    syntax: "@<attr>:(a OR b)",
    description: "Any of these values",
    example: "@http.method:(GET OR POST)",
  },
  {
    syntax: "@<attr>:>N",
    description: "Numeric comparison (also >=, <, <=)",
    example: "@http.status_code:>=500",
  },
];

interface InitialUrlState {
  search: string;
  filters: Array<ActiveFilter>;
  timeRange: RangeStartAndEndDateTime;
  page: number;
  pageSize: number;
  /*
   * The saved view the link named. Written by this explorer when one is
   * selected, and carried onto the Insights tab and back so a round trip
   * through Insights returns to the same named view rather than to its
   * filters with the view deselected.
   */
  savedViewId: string | null;
  /*
   * Whether the link actually named a window. `timeRange` above has already
   * fallen back to this explorer's default when it did not, so it cannot be
   * used to tell the two apart — and a saved view named in the same link
   * should keep its own window rather than be moved to a default nobody
   * asked for.
   */
  hasRange: boolean;
}

const POSITIVE_INT_REGEX: RegExp = /^\d+$/;

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
    pageRaw && POSITIVE_INT_REGEX.test(pageRaw)
      ? Math.max(1, parseInt(pageRaw, 10))
      : 1;
  const pageSizeRaw: string | null = params.get("pageSize");
  const pageSize: number =
    pageSizeRaw && POSITIVE_INT_REGEX.test(pageSizeRaw)
      ? Math.max(1, parseInt(pageSizeRaw, 10))
      : DEFAULT_PAGE_SIZE;

  const hasRange: boolean = Boolean(params.get("range"));

  const savedViewIdRaw: string | null = params.get("savedView");
  const savedViewId: string | null =
    savedViewIdRaw && savedViewIdRaw.trim().length > 0
      ? savedViewIdRaw.trim()
      : null;

  return {
    search,
    filters,
    timeRange,
    page,
    pageSize,
    savedViewId,
    hasRange,
  };
}

/*
 * Entity scope with attribute fallback (contract C4): compiles server-side
 * to `hasAny(entityKeys, [...]) OR attributes[attributeKey] = attributeValue`
 * so pre-entityKeys rows (no backfill) still match. Placed on analytics query
 * records verbatim under the key "entityScope".
 */
interface EntityScopeFilter {
  entityKeys: Array<string>;
  attributeKey: string;
  attributeValue: string;
}

interface Props {
  serviceIds?: Array<ObjectID> | undefined;
  /*
   * Restrict the service badges rendered in each row. This is separate from
   * serviceIds because some legacy entity pages use serviceIds with an ID
   * that does not belong to a Service.
   */
  serviceIdsToDisplay?: Array<ObjectID> | undefined;
  attributeFilters?: Record<string, string> | undefined;
  attributeFilterDisplayKeys?: Record<string, string> | undefined;
  /*
   * Scope to a OneUptime entity by its stable entityKeys (membership) —
   * compiles to `hasAny(entityKeys, [...])` server-side.
   */
  entityKeysFilter?: Array<string> | undefined;
  entityScope?: EntityScopeFilter | undefined;
  /*
   * Controlled shared window (the entity telemetry hub). When set, the
   * viewer seeds from it and adopts every value change; the host is expected
   * to hand back whatever `onTimeRangeChange` lifted, so an echo of the
   * viewer's own change compares equal and is a no-op.
   */
  timeRangeOverride?: RangeStartAndEndDateTime | undefined;
  /*
   * Fired only for user-initiated window changes inside this viewer (the
   * toolbar picker) — never when adopting `timeRangeOverride` — so a
   * controlling host can follow without loops.
   */
  onTimeRangeChange?:
    | ((timeRange: RangeStartAndEndDateTime) => void)
    | undefined;
  /*
   * Embedded contexts (the entity telemetry hub) own the page URL: when
   * true, the viewer neither seeds from nor mirrors state to the query
   * string — the same reason the logs viewer's syncUrlState defaults off
   * for incident embeds. Standalone explorer pages leave this unset.
   */
  disableUrlSync?: boolean | undefined;
}

const MetricsViewer: FunctionComponent<Props> = (
  props: Props,
): ReactElement => {
  /*
   * Parse all filter state from the URL once on first mount so refresh +
   * back-from-metric-detail restore the view.
   *
   * A useState initializer (not a memo) because it is a seed: it must never
   * recompute. Embedded hosts (disableUrlSync) skip the URL entirely — the
   * host page's query params are not this viewer's state.
   */
  const [initialUrlState] = useState<InitialUrlState>((): InitialUrlState => {
    if (props.disableUrlSync) {
      return {
        search: "",
        filters: [],
        timeRange: props.timeRangeOverride || {
          range: TimeRange.PAST_ONE_HOUR,
        },
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
        savedViewId: null,
        hasRange: false,
      };
    }
    return readInitialUrlState();
  });

  /*
   * The saved view currently selected in the control below, mirrored up here
   * so it can travel in the URL alongside the filters it produced.
   */
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string | null>(
    initialUrlState.savedViewId,
  );

  /*
   * The scope this link carried, for layering over a saved view it also
   * named — the trip back from the Insights tab, which says "this view, but
   * with the window and filters I ended up on". Undefined when the link
   * named no scope, so a project default applies exactly as saved.
   */
  const initialStateOverrides: Partial<TelemetrySavedViewState> | undefined =
    useMemo(() => {
      return buildUrlScopeOverrides({
        search: initialUrlState.search,
        filters: initialUrlState.filters.map(
          (filter: ActiveFilter): [string, string] => {
            return [filter.facetKey, filter.value];
          },
        ),
        /*
         * Only when the link actually named a range. `initialUrlState
         * .timeRange` has already fallen back to the explorer default by
         * this point, and overriding a named view's own window with that
         * default would be the opposite of carrying the user's window.
         */
        timeRange: initialUrlState.hasRange
          ? serializeSavedViewTimeRange(initialUrlState.timeRange)
          : undefined,
      });
    }, [initialUrlState]);

  const [metrics, setMetrics] = useState<Array<MetricType>>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(initialUrlState.page);
  const [pageSize, setPageSize] = useState<number>(initialUrlState.pageSize);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const [services, setServices] = useState<Array<Service>>([]);

  /*
   * Resolve the scoped service id(s) to names so the read-only "Service" chip
   * shows the service name instead of a raw UUID. Scoped views don't load the
   * full service list (facets are hidden), so this targeted lookup is the only
   * name source for the chip. Filtering itself still uses the stable id.
   */
  const scopedServiceNameMap: Record<string, string> = useServiceNames(
    props.serviceIds,
  );

  const [facetData, setFacetData] = useState<FacetData>({});
  const [facetLoading, setFacetLoading] = useState<boolean>(false);
  /*
   * Per-facet search text for resource facets (primaryEntityId / etc.). Updates
   * trigger a backend refetch so the sidebar can show services beyond the
   * loaded subset.
   */
  const [facetSearchText, setFacetSearchText] = useState<
    Record<string, string>
  >({});

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    props.timeRangeOverride || initialUrlState.timeRange,
  );

  /*
   * Render-time mirror of `timeRange` for the adopt effect below. The effect
   * must compare an override against the *current* window without listing
   * `timeRange` in its deps — otherwise the user's own picker change would
   * re-run it against a stale override and get yanked straight back.
   */
  const timeRangeRef: React.MutableRefObject<RangeStartAndEndDateTime> =
    useRef<RangeStartAndEndDateTime>(timeRange);
  timeRangeRef.current = timeRange;

  /*
   * Adopt a controlled window change from the host. Value-gated: the echo of
   * a window this viewer just lifted through onTimeRangeChange compares
   * equal and is skipped, which is what breaks the feedback loop.
   */
  useEffect(() => {
    if (
      !shouldAdoptTimeRangeOverride(
        props.timeRangeOverride,
        timeRangeRef.current,
      )
    ) {
      return;
    }
    setTimeRange(props.timeRangeOverride!);
  }, [props.timeRangeOverride]);

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
    return hasServiceIds || hasAttributeFilters || Boolean(props.entityScope);
  }, [props.serviceIds, props.attributeFilters, props.entityScope]);

  /*
   * Mirror filter state to the URL so refresh and back-from-metric-detail
   * restore the view. Uses `replaceState` so individual filter tweaks don't
   * push history entries.
   */
  useEffect(() => {
    if (props.disableUrlSync) {
      return;
    }
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
    /*
     * Written even when it equals this explorer's default: the Viewer and
     * Insights tabs now hand their scope to each other through these params,
     * and a window that is not written down cannot be carried — "absent
     * means my default" quietly changes the window whenever the two tabs
     * start from different ones.
     */
    params.set("range", timeRange.range);
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
    if (selectedSavedViewId) {
      params.set("savedView", selectedSavedViewId);
    }

    writeTelemetryViewerUrlState(Object.fromEntries(params.entries()));
  }, [
    props.disableUrlSync,
    submittedSearch,
    activeFilters,
    timeRange,
    page,
    pageSize,
    selectedSavedViewId,
  ]);

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
      METRICS_KNOWN_FIELD_KEYS.has(attrKey.toLowerCase()) ||
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
   * The typed search string, compiled. The grammar is the one every explorer
   * shares (see MetricsSearchQuery), which is what makes `@platform.team:a*`
   * a prefix match here as well: this used to be a hand-rolled tokenizer that
   * understood exact match and nothing else, so a glob was matched against
   * the literal characters `a` and `*` and found nothing.
   */
  const parsedSearch: ParsedMetricsSearch = useMemo(() => {
    return parseMetricsSearch(submittedSearch);
  }, [submittedSearch]);

  /*
   * Merge attribute filters from three sources:
   *   1. Tokens parsed from the typed search string (`@key:value`).
   *   2. Chips in `activeFilters` whose key starts with `attributes.`
   *      (added when the user picks a value from the dropdown / hits Enter).
   *   3. The scope pinned by the host page (`props.attributeFilters`).
   */
  const effectiveAttributes: MetricsAttributeFilters = useMemo(() => {
    return mergeMetricsAttributeFilters({
      parsed: parsedSearch.attributes,
      chips: activeFilters,
      ...(props.attributeFilters ? { pinned: props.attributeFilters } : {}),
    });
  }, [parsedSearch.attributes, activeFilters, props.attributeFilters]);

  /*
   * When attribute filters (or the entityKeys / entityScope scopes) change,
   * query the Metric analytics model for matching metric names. The entity
   * scopes must run this fetch even with zero attribute filters — they are
   * the only thing that restricts the metric-name list to the entity.
   */
  useEffect(() => {
    const attributeKeys: Array<string> = Object.keys(effectiveAttributes);
    const entityKeys: Array<string> = props.entityKeysFilter || [];
    const entityScope: EntityScopeFilter | undefined = props.entityScope;
    const filterKey: string = JSON.stringify({
      attributes: effectiveAttributes,
      entityKeys,
      entityScope: entityScope || null,
    });

    if (attributeKeys.length === 0 && entityKeys.length === 0 && !entityScope) {
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
        } as Query<Metric>;

        if (attributeKeys.length > 0) {
          (analyticsQuery as Record<string, unknown>)["attributes"] =
            effectiveAttributes;
        }

        if (entityKeys.length > 0) {
          (analyticsQuery as Record<string, unknown>)["entityKeys"] =
            new Includes(entityKeys);
        }

        if (entityScope) {
          (analyticsQuery as Record<string, unknown>)["entityScope"] =
            entityScope;
        }

        /*
         * GROUP BY name server-side so ClickHouse returns one row per
         * metric name. The previous getList with `limit: 5000` + client
         * dedup truncated by recency when a busy entity emitted many rows
         * per minute, silently dropping less-frequent metric names.
         */
        const result: AnalyticsListResult<Metric> =
          await AnalyticsModelAPI.getList<Metric>({
            modelType: Metric,
            query: analyticsQuery,
            groupBy: { name: true } as GroupBy<Metric>,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              name: true,
            } as Select<Metric>,
            sort: { name: SortOrder.Ascending } as Record<string, SortOrder>,
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
  }, [
    effectiveAttributes,
    props.entityKeysFilter,
    props.entityScope,
    timeRange,
  ]);

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
      if (filter.facetKey === "primaryEntityId") {
        facetServiceIds.push(new ObjectID(filter.value));
      }
    }

    const mergedServiceIds: Array<ObjectID> = [
      ...propServiceIds,
      ...facetServiceIds,
    ];

    /*
     * `service:<fragment>` search token — resolved to service ids against the
     * loaded service names, because the metric list filters by id. When the
     * token matches nothing, force empty results instead of silently ignoring
     * the filter. Skipped when the service list hasn't loaded (scoped views
     * don't load it and scope services via props).
     */
    let serviceFragmentMatchedNothing: boolean = false;
    const serviceMatcher: MetricsTextMatcher | null =
      parsedSearch.serviceMatcher;
    if (serviceMatcher && services.length > 0) {
      const fragmentServiceIds: Array<ObjectID> = [];
      for (const service of services) {
        if (
          service.id &&
          service.name &&
          serviceMatcher(service.name.toString())
        ) {
          fragmentServiceIds.push(service.id);
        }
      }
      if (fragmentServiceIds.length === 0) {
        serviceFragmentMatchedNothing = true;
      } else {
        mergedServiceIds.push(...fragmentServiceIds);
      }
    }

    if (mergedServiceIds.length > 0) {
      (query as Record<string, unknown>)["services"] = new Includes(
        mergedServiceIds,
      );
    }

    // Name search (free text, or an explicit `name:`)
    const nameFilter: MetricNameFilter | null = parsedSearch.nameFilter;

    if (serviceFragmentMatchedNothing) {
      // No service matched `service:<fragment>` — force empty results
      (query as Record<string, unknown>)["name"] = "__no_match__";
    } else if (attributeMatchedNames !== null) {
      if (attributeMatchedNames.length === 0) {
        // No metrics match the attribute filter — force empty results
        (query as Record<string, unknown>)["name"] = "__no_match__";
      } else if (nameFilter) {
        /*
         * Intersect. The names came back from ClickHouse already, so the name
         * restriction is applied to that list rather than to the column — by
         * the SAME predicate the column would have used, so the two paths
         * cannot disagree about what `name:http.server.*` means.
         */
        const filtered: Array<string> = attributeMatchedNames.filter(
          (metricName: string): boolean => {
            return nameFilter.matches(metricName);
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
    } else if (nameFilter) {
      /*
       * A plain `name:container.blockio` is a FRAGMENT — it has to match
       * container.blockio.io_service_bytes_recursive. A glob says exactly
       * where it may match instead, so `name:http.server.*` anchors at the
       * start rather than matching anywhere in the name.
       */
      (query as Record<string, unknown>)["name"] = nameFilter.queryValue;
    }

    return query;
  }, [
    props.serviceIds,
    activeFilters,
    parsedSearch,
    attributeMatchedNames,
    services,
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
    /*
     * When attribute filters or the entityKeys / entityScope scopes are
     * active, defer the metric list fetch until the name match has resolved.
     * Otherwise the first pass would query with no name restriction and
     * briefly render the unfiltered (project-wide) list before snapping to
     * the filtered one.
     */
    const hasEffectiveAttributes: boolean =
      Object.keys(effectiveAttributes).length > 0;
    const isEntityScoped: boolean = Boolean(
      (props.entityKeysFilter && props.entityKeysFilter.length > 0) ||
        props.entityScope,
    );
    if (
      (hasEffectiveAttributes || isEntityScoped) &&
      attributeMatchedNames === null
    ) {
      setIsLoading(true);
      return;
    }
    void fetchMetrics();
  }, [
    fetchMetrics,
    effectiveAttributes,
    attributeMatchedNames,
    props.entityKeysFilter,
    props.entityScope,
  ]);

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
        const entityKeys: Array<string> = props.entityKeysFilter || [];
        const isEntityScoped: boolean =
          entityKeys.length > 0 || Boolean(props.entityScope);
        const aggregates: Map<string, AggregatedResult> = isEntityScoped
          ? await fetchEntityScopedSparklineAggregates({
              metricNames: visibleNames,
              attributes: effectiveAttributes,
              startAndEndDate: new InBetween<Date>(
                dateRange.startValue,
                dateRange.endValue,
              ),
              entityKeys,
              entityScope: props.entityScope,
            })
          : await MetricUtil.fetchSparklineAggregates({
              metricNames: visibleNames,
              attributes:
                effectiveAttributes as Dictionary<DictionaryEntryValue>,
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
  }, [
    visibleNames,
    timeRange,
    effectiveAttributes,
    props.entityKeysFilter,
    props.entityScope,
  ]);

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
        key: "primaryEntityId",
        title: "Service",
        valueDisplayMap: serviceNameMap,
        valueColorMap: serviceColorMap,
        priority: 1,
        serverSearchable: true,
      },
    ];
  }, [services, isScoped]);

  /*
   * Fetch facets from the backend. Counts come from a ClickHouse GROUP BY
   * over the current time window; values are resolved from the Postgres
   * source-of-truth so every service in the project appears in the sidebar
   * regardless of recent metric activity.
   */
  const fetchFacets: () => Promise<void> = useCallback(async () => {
    if (isScoped) {
      setFacetData({});
      return;
    }

    setFacetLoading(true);

    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

    const payload: JSONObject = {
      startTime: dateRange.startValue.toISOString(),
      endTime: dateRange.endValue.toISOString(),
      facetKeys: ["primaryEntityId"],
    };

    const facetSearchTextActive: Record<string, string> = {};
    for (const [key, val] of Object.entries(facetSearchText)) {
      if (val && val.trim().length > 0) {
        facetSearchTextActive[key] = val.trim();
      }
    }
    if (Object.keys(facetSearchTextActive).length > 0) {
      payload["facetSearchText"] = facetSearchTextActive;
    }

    try {
      const response: HTTPResponse<JSONObject> = await postApi(
        "/telemetry/metrics/facets",
        payload,
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
  }, [isScoped, timeRange, facetSearchText]);

  useEffect(() => {
    void fetchFacets();
  }, [fetchFacets]);

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
          const displayKey: string = facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)
            ? facetKey.substring(ATTRIBUTE_FACET_PREFIX.length)
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
      const isAttributeChip: boolean = chip.facetKey.startsWith(
        ATTRIBUTE_FACET_PREFIX,
      );
      const displayKey: string = isAttributeChip
        ? chip.facetKey.substring(ATTRIBUTE_FACET_PREFIX.length)
        : config?.title || chip.displayKey || chip.facetKey;
      /*
       * An attribute chip stores its value in the search grammar, so a
       * literal asterisk arrives escaped (`a\*b`) and an any-of list arrives
       * bracketed. The chip has to show the value the user typed, not its
       * escaping.
       */
      const displayValue: string = isAttributeChip
        ? describeSearchValue(chip.value)
        : config?.valueDisplayMap?.[chip.value] ||
          (chip.facetKey === "primaryEntityId"
            ? scopedServiceNameMap[chip.value]
            : undefined) ||
          chip.displayValue ||
          chip.value;
      return { ...chip, displayKey, displayValue };
    };

    const base: Array<ActiveFilter> = [];
    if (props.serviceIds && props.serviceIds.length > 0) {
      for (const primaryEntityId of props.serviceIds) {
        base.push(
          resolveDisplay({
            facetKey: "primaryEntityId",
            value: primaryEntityId.toString(),
            displayKey: "Service",
            displayValue: primaryEntityId.toString(),
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
    scopedServiceNameMap,
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

      /*
       * Propagate the list's attribute filters — the prop-injected scope
       * (e.g. the service view's `resource.service.name`, or a host page's
       * `resource.host.name`) plus any search/facet attribute chips the user
       * added, all merged in effectiveAttributes — so the detail chart is
       * scoped to the same entity the list was, instead of aggregating the
       * metric across every service in the project.
       */
      const presetAttributes: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(effectiveAttributes)) {
        if (value) {
          presetAttributes[key] = value;
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

      /*
       * Carry the current time window so the detail page opens on the same
       * range the user was viewing (it otherwise resets to the last hour).
       * A preset range also carries its relative token so the explorer
       * opens rolling (re-anchored to now) instead of pinned.
       */
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
      metricUrl.addQueryParam(
        "startTime",
        OneUptimeDate.toString(dateRange.startValue),
        true,
      );
      metricUrl.addQueryParam(
        "endTime",
        OneUptimeDate.toString(dateRange.endValue),
        true,
      );
      if (timeRange.range !== TimeRange.CUSTOM) {
        metricUrl.addQueryParam("range", timeRange.range, true);
      }

      Navigation.navigate(metricUrl);
    },
    [effectiveAttributes, timeRange],
  );

  /*
   * Whether the URL already carried filter state (deep link) on first mount.
   * A controlled window counts too: the host owns the view then, so the
   * default saved view must not auto-apply over it — the same skip the logs
   * viewer performs for a pinned incident window.
   */
  const hasInitialUrlState: boolean = useMemo((): boolean => {
    return (
      Boolean(props.timeRangeOverride) ||
      initialUrlState.search.length > 0 ||
      initialUrlState.filters.length > 0 ||
      initialUrlState.timeRange.range !== TimeRange.PAST_ONE_HOUR
    );
  }, [initialUrlState, props.timeRangeOverride]);

  // Capture the current explorer state for Save / Update of a saved view.
  const captureCurrentState: () => TelemetrySavedViewState =
    useCallback((): TelemetrySavedViewState => {
      return {
        search: submittedSearch,
        filters: activeFilters.map((filter: ActiveFilter): [string, string] => {
          return [filter.facetKey, filter.value];
        }),
        timeRange: serializeSavedViewTimeRange(timeRange),
        pageSize: pageSize,
      };
    }, [submittedSearch, activeFilters, timeRange, pageSize]);

  // Apply a saved view's state back into the explorer.
  const applySavedViewState: (state: TelemetrySavedViewState) => void =
    useCallback((state: TelemetrySavedViewState): void => {
      const nextSearch: string = state.search || "";
      setSearchValue(nextSearch);
      setSubmittedSearch(nextSearch);
      setActiveFilters(
        readSavedViewFilters(state.filters).map(
          ([facetKey, value]: SavedViewFilterTuple): ActiveFilter => {
            return {
              facetKey: facetKey,
              value: value,
              displayKey: facetKey,
              displayValue: value,
            };
          },
        ),
      );
      setTimeRange(deserializeSavedViewTimeRange(state.timeRange));
      /*
       * Unconditional, like every other field here: a view saved before page
       * size was captured falls back to the default, and so does the empty
       * state the saved-views control applies when a view is cleared. Guarding
       * this one left the cleared explorer on the view's page size — and, via
       * the URL mirror, still advertising it in the query string.
       */
      setPageSize(state.pageSize || DEFAULT_PAGE_SIZE);
      setPage(1);
    }, []);

  return (
    <TelemetryViewer<MetricType>
      items={metrics}
      isLoading={isLoading || attributeFilterLoading}
      error={error || undefined}
      onRefresh={() => {
        void fetchMetrics();
      }}
      toolbarLeadingActions={
        !isScoped ? (
          <TelemetrySavedViewsControl<MetricSavedView>
            modelType={MetricSavedView}
            savedViewNoun="Metric"
            explorerLabel="metrics"
            hasInitialUrlState={hasInitialUrlState}
            initialSavedViewId={initialUrlState.savedViewId}
            initialStateOverrides={initialStateOverrides}
            onSelectionChange={setSelectedSavedViewId}
            captureCurrentState={captureCurrentState}
            applyState={applySavedViewState}
            onError={setError}
            /*
             * List-page views only. viewType is NULL on rows created
             * before the explorer got its own saved views — those are
             * list views by definition, hence EqualToOrNull.
             */
            additionalQuery={
              {
                viewType: new EqualToOrNull<string>(
                  TelemetrySavedViewType.List,
                ),
              } as Query<MetricSavedView>
            }
            additionalSaveFields={
              {
                viewType: TelemetrySavedViewType.List,
              } as Partial<MetricSavedView>
            }
          />
        ) : undefined
      }
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
            serviceIds={props.serviceIdsToDisplay}
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
      searchPlaceholder="Search metrics — e.g. name:http.server.* service:api @container.name:postgres"
      searchSuggestions={["name", "service"]}
      searchAttributeSuggestions={telemetryAttributes}
      searchValueSuggestions={attributeValueSuggestions}
      searchAttributesLoading={attributesLoading}
      searchValuesLoading={attributeValuesLoading}
      onSearchFieldValueSelect={(
        fieldKey: string,
        value: string,
      ): boolean | void => {
        /*
         * `name` and `service` are handled via the typed search path
         * (fragment match + service resolution), so they stay in the search
         * string — return false so the search bar keeps the token in the
         * input and submits the search as-is. (Setting the search state
         * here instead doesn't work: the bar clears the token right after
         * this callback, which empties the input and resets the submitted
         * search, silently dropping the filter.)
         *
         * Anything carrying grammar — a glob, `~contains`, an any-of list,
         * a comparison — stays in the input too. The bar resolves a typed
         * value against the suggestion list before calling this, so a glob
         * with exactly one matching suggestion would arrive here already
         * replaced by that one literal value: `@k:a*` silently chipped as
         * `@k:abc`.
         *
         * Everything else is a telemetry attribute — turn it into a chip
         * with the `attributes.` prefix so it lives in `activeFilters` and
         * is routed through the analytics query. Known-field detection is
         * case-insensitive; the attribute key keeps its original case,
         * because ClickHouse resolves a plain equality with a direct map
         * subscript (`attributes['k']`) and that lookup IS case-sensitive.
         * Only the substring and glob operators reach the backend's
         * case-insensitive key match.
         *
         * For the chip branch, strip surrounding quotes so a value like
         * `"my-value"` doesn't get stored with them. The known-field branch
         * preserves them because the search string is re-parsed, and the
         * parser strips them itself.
         */
        const lowerFieldKey: string = fieldKey.toLowerCase();
        if (METRICS_KNOWN_FIELD_KEYS.has(lowerFieldKey)) {
          return false;
        }
        if (valueCarriesSearchSyntax(value)) {
          return false;
        }
        const cleanValue: string =
          value.length >= 2 && value.startsWith('"') && value.endsWith('"')
            ? value.slice(1, -1)
            : value;
        handleFacetInclude(`${ATTRIBUTE_FACET_PREFIX}${fieldKey}`, cleanValue);
      }}
      searchFieldAliasMap={METRICS_FIELD_ALIAS_MAP}
      searchHelpRows={SEARCH_HELP_ROWS}
      searchHelpCombinedExample="service:api @container.name:postgres http.server.duration"
      // Time (drives sparkline range)
      timeRange={timeRange}
      onTimeRangeChange={(value: RangeStartAndEndDateTime) => {
        setTimeRange(value);
        // User-initiated (the toolbar picker) — lift to a controlling host.
        props.onTimeRangeChange?.(value);
      }}
      // Facets
      showFacetSidebar={!isScoped}
      facetData={facetData}
      facetConfigs={facetConfigs}
      facetLoading={facetLoading}
      onFacetInclude={handleFacetInclude}
      onFacetSearchChange={(facetKey: string, text: string) => {
        setFacetSearchText(
          (prev: Record<string, string>): Record<string, string> => {
            if ((prev[facetKey] || "") === text) {
              return prev;
            }
            const next: Record<string, string> = { ...prev };
            if (text.length === 0) {
              delete next[facetKey];
            } else {
              next[facetKey] = text;
            }
            return next;
          },
        );
      }}
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
