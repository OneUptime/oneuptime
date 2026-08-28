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
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
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
import Host from "Common/Models/DatabaseModels/Host";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
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

import Includes from "Common/Types/BaseDatabase/Includes";
import {
  ResourceEntityFacetSelections,
  collectResourceEntityFacetSelections,
  collectServiceFacetSelections,
  isResourceFacetKey,
} from "Common/Types/Telemetry/ResourceEntityFacet";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { APP_API_URL } from "Common/UI/Config";
import { JSONObject } from "Common/Types/JSON";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import TraceRow from "./TraceRow";
import SpanDetailsPanel from "./SpanDetailsPanel";
import TelemetrySavedViewsControl from "../Telemetry/TelemetrySavedViewsControl";
import {
  serializeSavedViewTimeRange,
  deserializeSavedViewTimeRange,
} from "Common/Utils/Telemetry/SavedViewTimeRange";
import {
  readSavedViewFilters,
  SavedViewFilterTuple,
} from "Common/Utils/Telemetry/SavedViewFilters";
import TraceSavedView from "Common/Models/DatabaseModels/TraceSavedView";
import TelemetrySavedViewState from "Common/Types/Telemetry/TelemetrySavedViewState";
import Search from "Common/Types/BaseDatabase/Search";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import TracesAnalyticsView, {
  formatDurationMs,
  TraceAnalyticsState,
} from "./TracesAnalyticsView";
import Navigation from "Common/UI/Utils/Navigation";
import TraceAggregationType from "Common/Types/Trace/TraceAggregationType";
import TraceRecordingRuleDefinition, {
  TraceRecordingRuleAttributeFilter,
} from "Common/Types/Trace/TraceRecordingRuleDefinition";
import { writeTelemetryViewerUrlState } from "../../Utils/TelemetryViewerUrlState";
import { buildUrlScopeOverrides } from "../../Utils/InitialSavedView";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import Dictionary from "Common/Types/Dictionary";
import {
  CrossSignalQueryParams,
  toLogsExplorerQueryParams,
  toMetricsExplorerQueryParams,
} from "Common/Utils/Telemetry/CrossSignalScope";
import {
  TracesPivotScopeResult,
  buildTracesPivotScope,
  describeDroppedScopeFields,
} from "../../Utils/TraceCorrelatedSignals";
import {
  SearchValueOperator,
  SearchValuePredicate,
  buildSearchTokenValue,
  describeSearchValue,
  parseSearchValue,
} from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  ATTRIBUTE_CHIP_PREFIX,
  ATTRIBUTE_SEARCH_CHIP_PREFIX,
  ParsedTraceSearch,
  TRACE_FIELD_ALIAS_MAP,
  TRACE_KNOWN_FIELD_KEYS,
  TraceAttributeFilters,
  TraceDurationFilter,
  TraceSearchChip,
  compileTraceAttributeFilters,
  parseTraceSearch,
  resolveTraceSearchChip,
  toNumericQueryValue,
  toSpanKind,
  toSpanStatusCode,
  toTraceDurationFilter,
} from "./TracesSearchCompile";
import { shouldAdoptTimeRangeOverride } from "../../Utils/SharedTelemetryTimeCursor";

const DEFAULT_PAGE_SIZE: number = 50;
const LIVE_POLL_INTERVAL_MS: number = 10000;

// One toolbar-button idiom for the signal pivots (mirrors MetricExplorer).
const TOOLBAR_BUTTON_CLASS_NAME: string =
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";
const TOOLBAR_BUTTON_IDLE_CLASS_NAME: string =
  "text-gray-600 hover:bg-gray-100 hover:text-gray-900";

/*
 * Synthetic "Span Type" facet. It is not a real Span column — selecting its
 * single "Root spans" value drives the `rootOnly` state (restricting the view
 * to root spans), rather than adding a normal filter chip. This facet is the
 * sole control for root-only mode. Kept distinct from the backend `isRootSpan`
 * key so it never collides with generic column-chip query building.
 */
const SPAN_TYPE_FACET_KEY: string = "spanType";
const SPAN_TYPE_ROOT_VALUE: string = "root";

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

const POSITIVE_INT_REGEX: RegExp = /^\d+$/;

function computeBucketSizeInMinutes(startTime: Date, endTime: Date): number {
  const totalMs: number = endTime.getTime() - startTime.getTime();
  const targetBuckets: number = 40;
  const raw: number = Math.max(60000, Math.floor(totalMs / targetBuckets));
  return Math.max(1, Math.ceil(raw / 60000));
}

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

/*
 * The syntax table. Every row is honoured by the shared search grammar in
 * Common/Types/Telemetry/TelemetrySearchQuery, so a row only appears here once
 * its behaviour is pinned by a test — the previous table advertised an
 * attribute "exact match" that silently read `a*` as the literal two
 * characters, and no way at all to exclude, compare or list values.
 */
const SEARCH_HELP_ROWS: Array<SearchHelpRow> = [
  {
    syntax: "free text",
    description: "Search span names",
    example: "checkout",
  },
  {
    syntax: '"quoted phrase"',
    description: "Keep spaces together",
    example: '"SELECT wp_options"',
  },
  {
    syntax: "service:<name>",
    description: "Filter by service",
    example: "service:api",
  },
  {
    syntax: "status:ok|error|unset",
    description: "Filter by span status",
    example: "status:error",
  },
  {
    syntax: "name:<span name>",
    description: "Filter by span name (contains)",
    example: 'name:"SELECT wp_options"',
  },
  {
    syntax: "kind:<span kind>",
    description: "Filter by span kind",
    example: "kind:server",
  },
  {
    syntax: "duration:>N",
    description: "Duration in milliseconds (also <)",
    example: "duration:>500",
  },
  {
    syntax: "hasException:true|false",
    description: "Spans with / without exceptions",
    example: "hasException:true",
  },
  {
    syntax: "statusMessage:<text>",
    description: "Filter by status message (contains)",
    example: "statusMessage:timeout",
  },
  {
    syntax: "trace:<id>",
    description: "Filter by trace id",
    example: "trace:abc123",
  },
  {
    syntax: "span:<id>",
    description: "Filter by span id",
    example: "span:def456",
  },
  {
    syntax: "@<attr>:<value>",
    description: "Filter by span attribute",
    example: "@http.method:GET",
  },
  {
    syntax: "@<attr>:<value>*",
    description: "Wildcard — * is any text, ? is one character",
    example: "@http.route:/api/*",
  },
  {
    syntax: "@<attr>:*",
    description: "Attribute is present",
    example: "@user.id:*",
  },
  {
    syntax: "@<attr>:~<text>",
    description: "Attribute contains",
    example: "@url.host:~starship.online",
  },
  {
    syntax: "-<filter>",
    description: "Exclude — works with every filter above",
    example: "-@http.method:GET",
  },
  {
    syntax: "@<attr>:(a OR b)",
    description: "Any of these values",
    example: "@http.method:(GET OR POST)",
  },
  {
    syntax: "@<attr>:>N",
    description: "Numeric comparison (also >=, <, <=)",
    example: "@http.status_code:>499",
  },
];

/*
 * Facet sidebar entries backed by raw span attributes rather than top-level
 * columns. Clicking a value adds an `attributes.<key>` chip — the same path
 * as typed `@key:value` filters. resource.* attributes are flattened onto
 * every span at ingest, so these give a first-class service-instance / host
 * dimension without requiring a registered infra Host entity.
 */
const ATTRIBUTE_FACET_KEYS: Set<string> = new Set([
  "resource.service.instance.id",
  "resource.host.name",
]);

// Chart-metric options for the explorer's over-time chart.
const CHART_METRIC_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "count", label: "Count" },
  { value: "avgDuration", label: "Avg Response Time" },
  { value: "p50Duration", label: "Median (P50)" },
  { value: "p95Duration", label: "P95" },
];

interface InitialUrlState {
  search: string;
  filters: Array<ActiveFilter>;
  timeRange: RangeStartAndEndDateTime;
  page: number;
  pageSize: number;
  viewMode: "spans" | "analytics";
  rootOnly: boolean;
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

/*
 * Parse the filter state encoded in `window.location.search`. Called once on
 * mount; refresh + back-from-trace-detail rely on this to restore the view.
 * Defensive: malformed JSON, unknown enum values, or non-numeric page values
 * all fall back to defaults rather than throwing.
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

  const viewMode: "spans" | "analytics" =
    params.get("view") === "analytics" ? "analytics" : "spans";

  /*
   * Show all spans by default; only `rootOnly=true` restricts to root spans.
   * Downstream services (e.g. a callee behind a gateway/queue) never own the
   * trace root, so a root-only default would hide all their spans.
   */
  const rootOnly: boolean = params.get("rootOnly") === "true";

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
    viewMode,
    rootOnly,
    savedViewId,
    hasRange,
  };
}

interface Props {
  primaryEntityId?: ObjectID | undefined;
  /*
   * Scope traces to a resource by OTel resource attribute (e.g.
   * { "resource.k8s.cluster.name": "<clusterIdentifier>" }). Used by the
   * Host / Docker / Kubernetes views, which key telemetry off resource
   * attributes rather than a primaryEntityId. Applied as a read-only scope chip.
   */
  attributeFilters?: Record<string, string> | undefined;
  attributeFilterDisplayKeys?: Record<string, string> | undefined;
  /*
   * Scope to a OneUptime entity by its stable entityKeys (membership).
   * Compiles to `hasAny(entityKeys, [...])` server-side — the entity
   * model's cross-cutting read (e.g. all spans touching a k8s pod), even
   * for service-owned spans.
   */
  entityKeysFilter?: Array<string> | undefined;
  /*
   * Entity scope with attribute fallback: compiles server-side to
   * `hasAny(entityKeys, [...]) OR attributes[attributeKey] = attributeValue`
   * so pre-entityKeys rows (no backfill) still match. Placed on the query
   * record verbatim under the key "entityScope"; the Host / Docker / K8s
   * pages compute it via keyFor* helpers from Common/Utils/Telemetry/EntityKey.
   */
  entityScope?:
    | {
        entityKeys: Array<string>;
        attributeKey: string;
        attributeValue: string;
      }
    | undefined;
  /*
   * Controlled shared window (the entity telemetry hub). When set, the
   * viewer seeds from it and adopts every value change; the host is expected
   * to hand back whatever `onTimeRangeChange` lifted, so an echo of the
   * viewer's own change compares equal and is a no-op.
   */
  timeRangeOverride?: RangeStartAndEndDateTime | undefined;
  /*
   * Fired only for user-initiated window changes inside this viewer (the
   * toolbar picker and histogram drag-zoom) — never when adopting
   * `timeRangeOverride` — so a controlling host can follow without loops.
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

const TracesViewer: FunctionComponent<Props> = (props: Props): ReactElement => {
  /*
   * Parse all filter state from the URL once on first mount. SpanViewer's
   * "filter by" action lands here with `?search=...` so users arrive with
   * the filter applied; refresh and back-from-trace-detail also rely on
   * this so the view restores rather than resetting to defaults.
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
        viewMode: "spans",
        rootOnly: false,
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

  const [spans, setSpans] = useState<Array<Span>>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(initialUrlState.page);
  const [pageSize, setPageSize] = useState<number>(initialUrlState.pageSize);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const [services, setServices] = useState<Array<Service>>([]);
  const [hosts, setHosts] = useState<Array<Host>>([]);
  const [dockerHosts, setDockerHosts] = useState<Array<DockerHost>>([]);
  const [podmanHosts, setPodmanHosts] = useState<Array<PodmanHost>>([]);
  const [kubernetesClusters, setKubernetesClusters] = useState<
    Array<KubernetesCluster>
  >([]);

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    props.timeRangeOverride || initialUrlState.timeRange,
  );

  /*
   * Render-time mirror of `timeRange` for the adopt effect below. The effect
   * must compare an override against the *current* window without listing
   * `timeRange` in its deps — otherwise the user's own zoom would re-run it
   * against a stale override and get yanked straight back.
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
    setPage(1);
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

  // "spans" = list + histogram + facets; "analytics" = split-by-dimension view.
  const [viewMode, setViewMode] = useState<"spans" | "analytics">(
    initialUrlState.viewMode,
  );

  /*
   * Root-spans-only (default). Switching it off includes non-root spans —
   * needed when the endpoint span carrying http.route / url.host is not the
   * trace root (e.g. behind a queue consumer or an upstream gateway).
   */
  const [rootOnly, setRootOnly] = useState<boolean>(initialUrlState.rootOnly);

  /*
   * Metric for the explorer's over-time chart: span counts (stacked by
   * status, projection-backed) or a latency aggregate over the same filters.
   */
  const [chartMetric, setChartMetric] = useState<string>("count");

  // Bumped by the toolbar Refresh button so the analytics view refetches.
  const [analyticsRefreshTick, setAnalyticsRefreshTick] = useState<number>(0);

  /*
   * The search bar's X button (and full backspace) only updates `searchValue`
   * — it doesn't call `onSubmit`. Without this effect, `submittedSearch`
   * stays at the old value, results stay filtered, and the URL keeps the
   * stale `?search=...`. Treat an emptied input as an implicit submit so the
   * displayed input and the applied filter never disagree.
   */
  useEffect(() => {
    if (searchValue === "" && submittedSearch !== "") {
      setSubmittedSearch("");
      setPage(1);
    }
  }, [searchValue, submittedSearch]);

  const [histogramBuckets, setHistogramBuckets] = useState<
    Array<HistogramBucket>
  >([]);
  const [histogramLoading, setHistogramLoading] = useState<boolean>(false);
  const [facetData, setFacetData] = useState<FacetData>({});
  const [facetLoading, setFacetLoading] = useState<boolean>(false);
  /*
   * Per-facet search text for resource facets (primaryEntityId / hostId / etc.).
   * When the user types into a facet's search box, this updates and triggers
   * the facets fetch, which forwards the text to /telemetry/traces/facets so
   * the backend can scan the full Postgres source-of-truth, not just the
   * loaded subset.
   */
  const [facetSearchText, setFacetSearchText] = useState<
    Record<string, string>
  >({});

  const [isLive, setIsLive] = useState<boolean>(false);
  const livePollRef: React.MutableRefObject<ReturnType<
    typeof setInterval
  > | null> = useRef(null);

  // spanId of the row whose inline detail panel is open (null = all collapsed).
  const [expandedSpanId, setExpandedSpanId] = useState<string | null>(null);

  // Telemetry attribute state for attribute-based search
  const [telemetryAttributes, setTelemetryAttributes] = useState<Array<string>>(
    [],
  );
  const [attributesLoading, setAttributesLoading] = useState<boolean>(false);
  const [attributeValueSuggestions, setAttributeValueSuggestions] = useState<
    Record<string, Array<string>>
  >({});
  const [attributeValuesLoading, setAttributeValuesLoading] =
    useState<boolean>(false);
  const lastValueSuggestionKeyRef: React.MutableRefObject<string> =
    useRef<string>("");

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

  const baseQuery: Query<Span> = useMemo(() => {
    const query: Query<Span> = {};

    if (rootOnly) {
      query.isRootSpan = true;
    }

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (projectId) {
      query.projectId = projectId;
    }

    if (props.primaryEntityId) {
      query.primaryEntityId = props.primaryEntityId;
    }

    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    (query as Record<string, unknown>)["startTime"] = new InBetween<Date>(
      dateRange.startValue,
      dateRange.endValue,
    );

    // Apply active facet filters
    const facetGroups: Record<string, Array<string>> = {};
    const attributeChipValues: Record<string, Array<string>> = {};
    const attributeSearchChips: Record<string, string> = {};
    for (const filter of activeFilters) {
      /*
       * Chips with the `attributes.` prefix are telemetry attribute filters
       * (a facet click, a span-panel "filter by", or a typed `@key:value`).
       * Their values are search-grammar tokens, so they are grouped per key
       * and compiled by the grammar — two chips on one key used to overwrite
       * each other, silently dropping a filter the user could see applied.
       * `attributeSearches.` chips are the pre-grammar contains variant that
       * only a saved view still produces.
       */
      if (filter.facetKey.startsWith(ATTRIBUTE_SEARCH_CHIP_PREFIX)) {
        const attrKey: string = filter.facetKey.substring(
          ATTRIBUTE_SEARCH_CHIP_PREFIX.length,
        );
        attributeSearchChips[attrKey] = filter.value;
        continue;
      }
      if (filter.facetKey.startsWith(ATTRIBUTE_CHIP_PREFIX)) {
        const attrKey: string = filter.facetKey.substring(
          ATTRIBUTE_CHIP_PREFIX.length,
        );
        if (!attributeChipValues[attrKey]) {
          attributeChipValues[attrKey] = [];
        }
        attributeChipValues[attrKey]!.push(filter.value);
        continue;
      }
      if (!facetGroups[filter.facetKey]) {
        facetGroups[filter.facetKey] = [];
      }
      facetGroups[filter.facetKey]!.push(filter.value);
    }

    /*
     * The Services facet reads out of `primaryEntityId` — that column holds
     * the Service id for OTLP telemetry.
     */
    const resourceIds: Set<string> = new Set<string>(
      collectServiceFacetSelections(Object.entries(facetGroups)),
    );
    if (resourceIds.size > 0) {
      (query as Record<string, unknown>)["primaryEntityId"] =
        resourceIds.size === 1
          ? Array.from(resourceIds)[0]!
          : new Includes(Array.from(resourceIds));
    }

    /*
     * Host / docker host / podman host / Kubernetes cluster selections do
     * NOT read out of `primaryEntityId`: a span that carries a
     * `service.name` is primary-keyed on its Service and only records the
     * host / cluster in `entityKeys`. They ride `resourceFilters` so the
     * server can resolve each id to the resource's entity key, one AND
     * group per facet. See ResourceEntityFilter.
     */
    const resourceFilters: ResourceEntityFacetSelections =
      collectResourceEntityFacetSelections(Object.entries(facetGroups));
    if (Object.keys(resourceFilters).length > 0) {
      (query as Record<string, unknown>)["resourceFilters"] = resourceFilters;
    }

    const parsed: ParsedTraceSearch = parseTraceSearch(submittedSearch);
    const fieldFilters: Record<string, Array<string>> = parsed.fieldFilters;
    const freeText: string = parsed.freeText;

    /*
     * Text columns need substring matching, not exact equality. The search
     * bar turns typed `name:GET` into a chip via `onFieldValueSelect`, and
     * span names are full strings like "GET api/..." — exact-match would
     * silently return zero rows.
     *
     * Search-bar tokens for these fields merge into the chip groups so chips
     * and `name:` / `statusMessage:` tokens share one rule: a single value
     * matches as a substring (Search → ILIKE), multiple values match exactly
     * (Includes). The aggregation payload applies the same single/multi
     * routing, keeping the histogram consistent with the list.
     */
    const TEXT_CHIP_FIELDS: Set<string> = new Set(["name", "statusMessage"]);
    /*
     * Merge typed search tokens for these fields into the chip groups so a
     * clicked facet value and a typed token for the same field resolve through
     * one path. Deduped so a chip plus an identical token stays single-valued
     * (preserving substring / boolean semantics) instead of flipping to a
     * multi-value exact match. hasException is included so its chip and any
     * `hasException:` token resolve together (both buckets → no filter), and
     * statusCode / kind so a sidebar click goes through the SAME value mapping
     * a typed `status:error` does — the facet's values arrive as the numeric
     * strings ClickHouse returns, and used to land on the column unmapped.
     */
    const MERGED_CHIP_FIELDS: Set<string> = new Set([
      ...TEXT_CHIP_FIELDS,
      "hasException",
      "statusCode",
      "kind",
    ]);
    for (const mergeKey of MERGED_CHIP_FIELDS) {
      const tokenValues: Array<string> | undefined = fieldFilters[mergeKey];
      if (tokenValues && tokenValues.length > 0) {
        facetGroups[mergeKey] = Array.from(
          new Set([...(facetGroups[mergeKey] || []), ...tokenValues]),
        );
      }
    }
    for (const key of Object.keys(facetGroups)) {
      // Already compiled above, into primaryEntityId or resourceFilters.
      if (isResourceFacetKey(key)) {
        continue;
      }
      const values: Array<string> = facetGroups[key]!;
      if (key === "hasException") {
        /*
         * Boolean column — a chip value "true"/"false" must compile to a
         * boolean, not a string, or ClickHouse can't compare it. Selecting
         * both buckets is equivalent to no filter.
         */
        const bools: Array<boolean> = Array.from(
          new Set(
            values.map((v: string): boolean => {
              return v.toLowerCase() === "true";
            }),
          ),
        );
        if (bools.length === 1) {
          (query as Record<string, unknown>)[key] = bools[0]!;
        }
        continue;
      }
      if (key === "statusCode") {
        const statusCode: number | Includes | undefined = toNumericQueryValue(
          values.map((value: string): number => {
            return toSpanStatusCode(value);
          }),
        );
        if (statusCode !== undefined) {
          (query as Record<string, unknown>)[key] = statusCode;
        }
        continue;
      }
      if (key === "kind") {
        const kinds: Array<string> = Array.from(
          new Set(
            values.map((value: string): string => {
              return toSpanKind(value);
            }),
          ),
        );
        (query as Record<string, unknown>)[key] =
          kinds.length === 1 ? kinds[0]! : new Includes(kinds);
        continue;
      }
      if (TEXT_CHIP_FIELDS.has(key) && values.length === 1) {
        (query as Record<string, unknown>)[key] = new Search(values[0]!);
        continue;
      }
      if (values.length === 1) {
        (query as Record<string, unknown>)[key] = values[0]!;
      } else {
        (query as Record<string, unknown>)[key] = new Includes(values);
      }
    }

    // Apply remaining search field filters
    for (const key of Object.keys(fieldFilters)) {
      // Already compiled above, through the chip groups.
      if (MERGED_CHIP_FIELDS.has(key)) {
        continue;
      }

      const values: Array<string> = fieldFilters[key]!;

      if (key === "durationUnixNano") {
        /*
         * The bounds are read by the shared parser the aggregation payload
         * uses, so `duration:>500` cannot mean one thing in the list and
         * another in the chart above it.
         */
        const duration: TraceDurationFilter = toTraceDurationFilter(values[0]!);
        if (duration.minDurationNano !== undefined) {
          (query as Record<string, unknown>)[key] = new GreaterThan(
            duration.minDurationNano,
          );
        } else if (duration.maxDurationNano !== undefined) {
          (query as Record<string, unknown>)[key] = new LessThan(
            duration.maxDurationNano,
          );
        } else if (duration.exactDurationNano !== undefined) {
          (query as Record<string, unknown>)[key] = duration.exactDurationNano;
        }
        continue;
      }

      if (values.length === 1) {
        (query as Record<string, unknown>)[key] = values[0]!;
        continue;
      }

      (query as Record<string, unknown>)[key] = new Includes(values);
    }

    /*
     * Bare free text matches span names as a substring — the aggregation
     * payload already sends it as nameSearchText, so the list must apply it
     * too or the chart filters tighter than the list. Query<Span> holds one
     * predicate per column, so an explicit name filter wins when both are
     * present (the chart then ANDs both and may be slightly narrower).
     */
    if (
      freeText &&
      freeText.length > 0 &&
      !(query as Record<string, unknown>)["name"]
    ) {
      (query as Record<string, unknown>)["name"] = new Search(freeText);
    }

    /*
     * Attribute filters from every source — chips, the submitted search
     * string, the pre-grammar contains chips and the host page's read-only
     * resource scope — compiled ONCE for both transports. The histogram and
     * facet payload below reads the other half of the same result, which is
     * what stops the chart and the list disagreeing about a filter the user
     * can see applied.
     */
    const attributeFilters: TraceAttributeFilters =
      compileTraceAttributeFilters({
        chipValues: attributeChipValues,
        parsed: parsed.attributeFilters,
        legacyContainsChips: attributeSearchChips,
        scope: props.attributeFilters || {},
      });
    if (Object.keys(attributeFilters.queryAttributes).length > 0) {
      (query as Record<string, unknown>)["attributes"] =
        attributeFilters.queryAttributes;
    }

    if (props.entityKeysFilter && props.entityKeysFilter.length > 0) {
      (query as Record<string, unknown>)["entityKeys"] = new Includes(
        props.entityKeysFilter,
      );
    }

    // Contract C4: pass through verbatim; compiled by StatementGenerator.
    if (props.entityScope) {
      (query as Record<string, unknown>)["entityScope"] = props.entityScope;
    }

    return query;
  }, [
    props.primaryEntityId,
    props.attributeFilters,
    props.entityKeysFilter,
    props.entityScope,
    timeRange,
    activeFilters,
    submittedSearch,
    rootOnly,
  ]);

  const listSelect: Select<Span> = useMemo(() => {
    return {
      traceId: true,
      spanId: true,
      parentSpanId: true,
      name: true,
      primaryEntityId: true,
      startTime: true,
      endTime: true,
      durationUnixNano: true,
      statusCode: true,
      statusMessage: true,
      kind: true,
    } as Select<Span>;
  }, []);

  /*
   * Mirror filter state to the URL so refresh and back-from-trace-detail
   * restore the view. Uses `replaceState` so individual filter tweaks don't
   * push history entries (you'd otherwise have to back-button through every
   * keystroke). Page/pageSize/range defaults are omitted to keep the URL
   * minimal — and `?search=` already handles the SpanViewer "filter by" deep
   * link from before this change.
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
    if (viewMode === "analytics") {
      params.set("view", "analytics");
    }
    if (rootOnly) {
      params.set("rootOnly", "true");
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
    viewMode,
    rootOnly,
    selectedSavedViewId,
  ]);

  // Load services / hosts / docker hosts / k8s clusters once
  useEffect(() => {
    const loadResources: () => Promise<void> = async () => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          return;
        }
        const [
          serviceResult,
          hostResult,
          dockerHostResult,
          podmanHostResult,
          clusterResult,
        ]: [
          ModelListResult<Service>,
          ModelListResult<Host>,
          ModelListResult<DockerHost>,
          ModelListResult<PodmanHost>,
          ModelListResult<KubernetesCluster>,
        ] = await Promise.all([
          ModelAPI.getList({
            modelType: Service,
            query: { projectId: projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { name: true, serviceColor: true },
            sort: { name: SortOrder.Ascending },
          }),
          ModelAPI.getList({
            modelType: Host,
            query: { projectId: projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { name: true, hostIdentifier: true },
            sort: { name: SortOrder.Ascending },
          }),
          ModelAPI.getList({
            modelType: DockerHost,
            query: { projectId: projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { name: true, hostIdentifier: true },
            sort: { name: SortOrder.Ascending },
          }),
          ModelAPI.getList({
            modelType: PodmanHost,
            query: { projectId: projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { name: true, hostIdentifier: true },
            sort: { name: SortOrder.Ascending },
          }),
          ModelAPI.getList({
            modelType: KubernetesCluster,
            query: { projectId: projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { name: true, clusterIdentifier: true },
            sort: { name: SortOrder.Ascending },
          }),
        ]);
        setServices(serviceResult.data || []);
        setHosts(hostResult.data || []);
        setDockerHosts(dockerHostResult.data || []);
        setPodmanHosts(podmanHostResult.data || []);
        setKubernetesClusters(clusterResult.data || []);
      } catch {
        // non-critical
      }
    };
    void loadResources();
  }, []);

  // Load telemetry attributes for search suggestions
  useEffect(() => {
    const loadAttributes: () => Promise<void> = async () => {
      try {
        setAttributesLoading(true);
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/traces/get-attributes",
            ),
            data: {},
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });
        if (response instanceof HTTPErrorResponse) {
          throw response;
        }
        setTelemetryAttributes(
          (response.data["attributes"] || []) as Array<string>,
        );
      } catch {
        // non-critical
      } finally {
        setAttributesLoading(false);
      }
    };
    void loadAttributes();
  }, []);

  // Load attribute values when user types @attribute: in search bar
  useEffect(() => {
    const currentWord: string = (searchValue.split(/\s+/).pop() || "").trim();
    if (!currentWord.startsWith("@") || !currentWord.includes(":")) {
      return;
    }
    const colonIdx: number = currentWord.indexOf(":");
    const attrKey: string = currentWord.substring(1, colonIdx);

    if (
      !attrKey ||
      TRACE_KNOWN_FIELD_KEYS.has(attrKey) ||
      attrKey === lastValueSuggestionKeyRef.current
    ) {
      return;
    }
    lastValueSuggestionKeyRef.current = attrKey;

    const loadValues: () => Promise<void> = async () => {
      try {
        setAttributeValuesLoading(true);
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/traces/get-attribute-values",
            ),
            data: { attributeKey: attrKey },
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });
        if (response instanceof HTTPErrorResponse) {
          throw response;
        }
        const values: Array<string> = (response.data["values"] ||
          []) as Array<string>;
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

  // Fetch spans list
  const fetchSpans: (options?: {
    skipLoadingState?: boolean;
  }) => Promise<void> = useCallback(
    async (options: { skipLoadingState?: boolean } = {}) => {
      // Analytics mode hides the list — skip the fetch until switched back.
      if (viewMode === "analytics") {
        return;
      }
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
    [baseQuery, page, pageSize, listSelect, viewMode],
  );

  // Build the aggregation request payload — shared by histogram and facets
  const aggregationRequest: JSONObject = useMemo(() => {
    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

    const payload: JSONObject = {
      startTime: dateRange.startValue.toISOString(),
      endTime: dateRange.endValue.toISOString(),
      rootOnly: rootOnly,
    };

    // Collect filter values from both active facet filters and parsed search
    const groups: Record<string, Array<string>> = {};
    const attributeChipValues: Record<string, Array<string>> = {};
    const attributeSearchChips: Record<string, string> = {};
    for (const filter of activeFilters) {
      // `attributes.<key>` chips route into `payload.attributes`, not `groups`.
      if (filter.facetKey.startsWith(ATTRIBUTE_SEARCH_CHIP_PREFIX)) {
        const attrKey: string = filter.facetKey.substring(
          ATTRIBUTE_SEARCH_CHIP_PREFIX.length,
        );
        attributeSearchChips[attrKey] = filter.value;
        continue;
      }
      if (filter.facetKey.startsWith(ATTRIBUTE_CHIP_PREFIX)) {
        const attrKey: string = filter.facetKey.substring(
          ATTRIBUTE_CHIP_PREFIX.length,
        );
        if (!attributeChipValues[attrKey]) {
          attributeChipValues[attrKey] = [];
        }
        attributeChipValues[attrKey]!.push(filter.value);
        continue;
      }
      if (!groups[filter.facetKey]) {
        groups[filter.facetKey] = [];
      }
      groups[filter.facetKey]!.push(filter.value);
    }

    const parsed: ParsedTraceSearch = parseTraceSearch(submittedSearch);
    const fieldFilters: Record<string, Array<string>> = parsed.fieldFilters;
    const freeText: string = parsed.freeText;
    for (const key of Object.keys(fieldFilters)) {
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key]!.push(...fieldFilters[key]!);
    }

    /*
     * The attribute half of the very same compilation the span list runs on
     * (see baseQuery): every operator the grammar can express reaches the
     * server in its `{_type, value}` wire shape, so the chart cannot read
     * `@k:a*` as an exact match on two characters while the list reads it as
     * a prefix. `attributeSearches` now carries only the pre-grammar chips a
     * saved view can still hold.
     */
    const attributeFilters: TraceAttributeFilters =
      compileTraceAttributeFilters({
        chipValues: attributeChipValues,
        parsed: parsed.attributeFilters,
        legacyContainsChips: attributeSearchChips,
        scope: props.attributeFilters || {},
      });
    if (Object.keys(attributeFilters.payloadAttributes).length > 0) {
      payload["attributes"] = attributeFilters.payloadAttributes;
    }
    if (Object.keys(attributeFilters.payloadAttributeSearches).length > 0) {
      payload["attributeSearches"] = attributeFilters.payloadAttributeSearches;
    }

    /*
     * Entity scope must constrain the histogram/facets too, not just the
     * span list — otherwise the counts above the list are project-wide.
     */
    if (props.entityKeysFilter && props.entityKeysFilter.length > 0) {
      payload["entityKeys"] = [...props.entityKeysFilter];
    }

    // Scope by primaryEntityId prop if present
    if (props.primaryEntityId) {
      if (!groups["primaryEntityId"]) {
        groups["primaryEntityId"] = [];
      }
      groups["primaryEntityId"]!.push(props.primaryEntityId.toString());
    }

    /*
     * Mirror the list query: the Services facet narrows `serviceIds`, while
     * host / docker / podman / Kubernetes selections travel under
     * `resourceFilters` so the server matches them through the resource's
     * entity key instead of against a column that only holds Service ids.
     */
    const resourceIdSet: Set<string> = new Set<string>(
      collectServiceFacetSelections(Object.entries(groups)),
    );
    if (resourceIdSet.size > 0) {
      payload["serviceIds"] = Array.from(resourceIdSet);
    }

    const payloadResourceFilters: ResourceEntityFacetSelections =
      collectResourceEntityFacetSelections(Object.entries(groups));
    if (Object.keys(payloadResourceFilters).length > 0) {
      payload["resourceFilters"] = payloadResourceFilters;
    }

    if (groups["statusCode"] && groups["statusCode"].length > 0) {
      payload["statusCodes"] = groups["statusCode"].map(
        (value: string): number => {
          return toSpanStatusCode(value);
        },
      );
    }

    if (groups["kind"] && groups["kind"].length > 0) {
      // Map friendly kind names to backend enum values
      payload["spanKinds"] = groups["kind"].map((value: string): string => {
        return toSpanKind(value);
      });
    }

    /*
     * Mirror the list's name semantics: a single name value filters the list
     * as a substring (Search → ILIKE, see TEXT_CHIP_FIELDS in baseQuery), so
     * route it to spanNameSearches — exact-match spanNames would make the
     * chart disagree with the list for partial names like "ShipShipment".
     * Multiple name values filter the list exactly (Includes), which
     * spanNames preserves.
     */
    if (groups["name"] && groups["name"].length > 0) {
      /*
       * Dedupe so a chip plus an identical token stays a single substring
       * match (mirrors baseQuery) instead of flipping to a multi-value exact.
       */
      const names: Array<string> = Array.from(new Set(groups["name"]));
      if (names.length === 1) {
        payload["spanNameSearches"] = names;
      } else {
        payload["spanNames"] = names;
      }
    }

    if (groups["traceId"] && groups["traceId"].length > 0) {
      payload["traceIds"] = groups["traceId"];
    }

    if (groups["spanId"] && groups["spanId"].length > 0) {
      payload["spanIds"] = groups["spanId"];
    }

    if (groups["hasException"] && groups["hasException"].length > 0) {
      /*
       * Mirror baseQuery: a single distinct boolean filters; both buckets
       * selected means no filter, so the chart never disagrees with the list.
       */
      const bools: Array<boolean> = Array.from(
        new Set(
          groups["hasException"].map((v: string): boolean => {
            return v.toLowerCase() === "true";
          }),
        ),
      );
      if (bools.length === 1) {
        payload["hasException"] = bools[0];
      }
    }

    /*
     * Same single/multi routing as `name`: one value matches as a substring
     * (mirrors the list's Search), several match exactly (mirrors Includes).
     */
    if (groups["statusMessage"] && groups["statusMessage"].length > 0) {
      const statusMessages: Array<string> = Array.from(
        new Set(groups["statusMessage"]),
      );
      if (statusMessages.length === 1) {
        payload["statusMessageSearchText"] = statusMessages[0];
      } else {
        payload["statusMessages"] = statusMessages;
      }
    }

    if (groups["durationUnixNano"] && groups["durationUnixNano"].length > 0) {
      // Read by the same parser baseQuery uses — one reading, two renderings.
      const duration: TraceDurationFilter = toTraceDurationFilter(
        groups["durationUnixNano"][0]!,
      );
      if (duration.minDurationNano !== undefined) {
        payload["minDurationNano"] = duration.minDurationNano;
      }
      if (duration.maxDurationNano !== undefined) {
        payload["maxDurationNano"] = duration.maxDurationNano;
      }
      if (duration.exactDurationNano !== undefined) {
        payload["exactDurationNano"] = duration.exactDurationNano;
      }
    }

    if (freeText && freeText.length > 0) {
      payload["nameSearchText"] = freeText;
    }

    return payload;
  }, [
    timeRange,
    activeFilters,
    submittedSearch,
    props.primaryEntityId,
    props.attributeFilters,
    props.entityKeysFilter,
    rootOnly,
  ]);

  // Fetch histogram + facets from dedicated backend endpoints
  const fetchHistogramAndFacets: () => Promise<void> = useCallback(async () => {
    // Analytics mode renders its own chart/table — skip the spans fetches.
    if (viewMode === "analytics") {
      return;
    }

    setHistogramLoading(true);
    setFacetLoading(true);

    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

    const bucketSizeInMinutes: number = computeBucketSizeInMinutes(
      dateRange.startValue,
      dateRange.endValue,
    );

    /*
     * Histogram and facets use the same window as the list so users see
     * filter values that actually match what they can see. Aggregation
     * queries are protected server-side by max_execution_time and the
     * ClickHouse client request_timeout cap (see TraceAggregationService
     * and ClickhouseConfig).
     *
     * Latency chart metrics (avg/p50/p95) ride the analytics endpoint with
     * the same filters; counts keep the projection-backed histogram.
     */
    const isLatencyChart: boolean = chartMetric !== "count";

    const histogramPayload: JSONObject = isLatencyChart
      ? {
          ...aggregationRequest,
          bucketSizeInMinutes,
          chartType: "timeseries",
          metric: chartMetric,
        }
      : {
          ...aggregationRequest,
          bucketSizeInMinutes,
        };

    /*
     * Forward only non-empty per-facet search entries — saves bandwidth and
     * matches backend semantics where a missing key is the same as an empty
     * value (no filter).
     */
    const facetSearchTextActive: Record<string, string> = {};
    for (const [key, val] of Object.entries(facetSearchText)) {
      if (val && val.trim().length > 0) {
        facetSearchTextActive[key] = val.trim();
      }
    }

    const facetsPayload: JSONObject = {
      ...aggregationRequest,
      facetKeys: [
        "primaryEntityId",
        "hostId",
        "dockerHostId",
        "podmanHostId",
        "kubernetesClusterId",
        "statusCode",
        "kind",
        // Backs the "Span Type" facet (root vs non-root counts).
        "isRootSpan",
        // Backs the "Has Exception" facet (exact exception-span counts).
        "hasException",
        // Backs the "Span Name" facet (top operation names, sampled).
        "name",
        ...Array.from(ATTRIBUTE_FACET_KEYS),
      ],
    };

    if (Object.keys(facetSearchTextActive).length > 0) {
      facetsPayload["facetSearchText"] = facetSearchTextActive;
    }

    const [histogramResult, facetsResult] = await Promise.allSettled([
      postApi(
        isLatencyChart
          ? "/telemetry/traces/analytics"
          : "/telemetry/traces/histogram",
        histogramPayload,
      ),
      postApi("/telemetry/traces/facets", facetsPayload),
    ]);

    if (histogramResult.status === "fulfilled") {
      if (isLatencyChart) {
        // Analytics timeseries rows → single-series histogram buckets.
        const rows: Array<{ time: string; value: number }> = (histogramResult
          .value.data["data"] || []) as unknown as Array<{
          time: string;
          value: number;
        }>;
        setHistogramBuckets(
          rows.map((row: { time: string; value: number }): HistogramBucket => {
            return { time: row.time, series: "latency", count: row.value };
          }),
        );
      } else {
        const buckets: Array<HistogramBucket> = (histogramResult.value.data[
          "buckets"
        ] || []) as unknown as Array<HistogramBucket>;
        setHistogramBuckets(buckets);
      }
    } else {
      setHistogramBuckets([]);
    }

    if (facetsResult.status === "fulfilled") {
      const facetsRaw: Record<string, Array<FacetValue>> = (facetsResult.value
        .data["facets"] || {}) as unknown as Record<string, Array<FacetValue>>;

      /*
       * statusCode values come back as numeric strings from ClickHouse — map
       * them to lowercase labels so TraceRow/facet config can render them.
       */
      const mappedFacets: FacetData = { ...facetsRaw };
      if (facetsRaw["statusCode"]) {
        mappedFacets["statusCode"] = facetsRaw["statusCode"].map(
          (f: FacetValue): FacetValue => {
            const n: number = Number(f.value);
            return { value: String(n), count: f.count };
          },
        );
      }

      /*
       * Span Type facet: collapse the backend's root/non-root buckets into a
       * single "Root spans" choice whose count is the exact number of root
       * spans in the window. Selecting it drives the same `rootOnly` state as
       * the toolbar toggle (see SPAN_TYPE_FACET_KEY handling); leaving it
       * unselected shows all spans (the default).
       */
      const rootSpanBucket: FacetValue | undefined = facetsRaw[
        "isRootSpan"
      ]?.find((f: FacetValue): boolean => {
        return f.value === "true" || f.value === "1";
      });
      mappedFacets[SPAN_TYPE_FACET_KEY] = [
        { value: SPAN_TYPE_ROOT_VALUE, count: rootSpanBucket?.count ?? 0 },
      ];
      delete mappedFacets["isRootSpan"];

      /*
       * Has Exception facet: keep just the "with exceptions" bucket as a single
       * "Has exception" choice. It is a normal filter chip (value "true"),
       * which baseQuery/aggregationRequest already compile to hasException.
       */
      const hasExceptionBucket: FacetValue | undefined = facetsRaw[
        "hasException"
      ]?.find((f: FacetValue): boolean => {
        return f.value === "true" || f.value === "1";
      });
      mappedFacets["hasException"] = [
        { value: "true", count: hasExceptionBucket?.count ?? 0 },
      ];
      setFacetData(mappedFacets);
    } else {
      setFacetData({});
    }

    setHistogramLoading(false);
    setFacetLoading(false);
  }, [aggregationRequest, timeRange, facetSearchText, chartMetric, viewMode]);

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

    const hostNameMap: Record<string, string> = {};
    for (const host of hosts) {
      if (host.id) {
        hostNameMap[host.id.toString()] =
          host.name || host.hostIdentifier || "Unknown";
      }
    }

    const dockerHostNameMap: Record<string, string> = {};
    for (const dockerHost of dockerHosts) {
      if (dockerHost.id) {
        dockerHostNameMap[dockerHost.id.toString()] =
          dockerHost.name || dockerHost.hostIdentifier || "Unknown";
      }
    }

    const podmanHostNameMap: Record<string, string> = {};
    for (const podmanHost of podmanHosts) {
      if (podmanHost.id) {
        podmanHostNameMap[podmanHost.id.toString()] =
          podmanHost.name || podmanHost.hostIdentifier || "Unknown";
      }
    }

    const clusterNameMap: Record<string, string> = {};
    for (const cluster of kubernetesClusters) {
      if (cluster.id) {
        clusterNameMap[cluster.id.toString()] =
          cluster.name || cluster.clusterIdentifier || "Unknown";
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
        key: "primaryEntityId",
        title: "Service",
        valueDisplayMap: serviceNameMap,
        valueColorMap: serviceColorMap,
        priority: 1,
        serverSearchable: true,
      },
      {
        key: "hostId",
        title: "Host",
        valueDisplayMap: hostNameMap,
        priority: 2,
        serverSearchable: true,
      },
      {
        key: "dockerHostId",
        title: "Docker Host",
        valueDisplayMap: dockerHostNameMap,
        priority: 3,
        serverSearchable: true,
      },
      {
        key: "podmanHostId",
        title: "Podman Host",
        valueDisplayMap: podmanHostNameMap,
        priority: 4,
        serverSearchable: true,
      },
      {
        key: "kubernetesClusterId",
        title: "Kubernetes Cluster",
        valueDisplayMap: clusterNameMap,
        priority: 5,
        serverSearchable: true,
      },
      {
        key: "statusCode",
        title: "Status",
        valueDisplayMap: statusLabelMap,
        valueColorMap: statusColorMap,
        priority: 6,
      },
      /*
       * Span Type: a single "Root spans" choice that toggles root-only mode.
       * Selecting it scopes to root spans (trace entry points); leaving it
       * unselected shows all spans. Count is the exact number of root spans.
       */
      {
        key: SPAN_TYPE_FACET_KEY,
        title: "Span Type",
        valueDisplayMap: { [SPAN_TYPE_ROOT_VALUE]: "Root spans" },
        priority: 6.5,
      },
      /*
       * Has Exception: a single "Has exception" choice. Count is the exact
       * number of spans that recorded an exception (computed server-side, not
       * sampled, so rare exceptions are never under-reported).
       */
      {
        key: "hasException",
        title: "Has Exception",
        valueDisplayMap: { true: "Has exception" },
        valueColorMap: { true: SPAN_STATUS_COLOR[SpanStatus.Error]! },
        priority: 6.7,
      },
      {
        key: "kind",
        title: "Span Kind",
        valueDisplayMap: SPAN_KIND_LABEL,
        priority: 7,
      },
      /*
       * Span Name: top operation names in the window (sampled, like other
       * non-projection facets). Selecting one filters the list to a substring
       * match on the span name, mirroring a typed `name:` search.
       */
      {
        key: "name",
        title: "Span Name",
        priority: 7.5,
      },
      /*
       * Attribute-backed instance facets (see ATTRIBUTE_FACET_KEYS) — a
       * first-class service-instance / host-name dimension even when no
       * infra Host entity is registered. Counts come from the recent-spans
       * sample, like other attribute facets.
       */
      {
        key: "resource.service.instance.id",
        title: "Service Instance",
        priority: 8,
      },
      {
        key: "resource.host.name",
        title: "Host Name",
        priority: 9,
      },
    ];
  }, [services, hosts, dockerHosts, podmanHosts, kubernetesClusters]);

  // Histogram series — status-stacked counts, or a single latency series.
  const histogramSeries: Array<HistogramSeriesOption> = useMemo(() => {
    if (chartMetric !== "count") {
      const label: string =
        CHART_METRIC_OPTIONS.find((opt: { value: string }) => {
          return opt.value === chartMetric;
        })?.label || chartMetric;
      return [{ key: "latency", label, color: "#6366f1" }];
    }
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
  }, [chartMetric]);

  // Service id → name map for the analytics view's dimension display.
  const serviceNameMap: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = {};
    for (const service of services) {
      if (service.id) {
        map[service.id.toString()] = service.name || "Unknown";
      }
    }
    return map;
  }, [services]);

  // Facet interaction
  const handleFacetInclude: (facetKey: string, value: string) => void =
    useCallback(
      (facetKey: string, value: string) => {
        /*
         * Span Type is a synthetic facet: selecting "Root spans" sets
         * rootOnly instead of adding a filter chip.
         */
        if (facetKey === SPAN_TYPE_FACET_KEY) {
          setRootOnly(value === SPAN_TYPE_ROOT_VALUE);
          setPage(1);
          return;
        }
        /*
         * Attribute-backed facets (Service Instance / Host Name) filter via
         * the attributes map — store their chips under the same
         * `attributes.<key>` scheme as typed `@key:value` filters so query
         * building has one path.
         */
        const config: FacetConfig | undefined = facetConfigs.find(
          (c: FacetConfig): boolean => {
            return c.key === facetKey;
          },
        );
        const isAttributeFacet: boolean = ATTRIBUTE_FACET_KEYS.has(facetKey);
        const chipKey: string = isAttributeFacet
          ? `${ATTRIBUTE_CHIP_PREFIX}${facetKey}`
          : facetKey;
        /*
         * A sidebar value comes from the DATA and may legitimately contain
         * `*`, `?` or a space — a URL route like `/api/*`, a container arg.
         * An attribute chip is re-parsed by the search grammar when the query
         * is built, so it has to be written back as a token that means exactly
         * this value; unescaped, clicking `/api/*` filtered for far more than
         * the row it came from. Callers that already hold a grammar token
         * (the span panel, the search bar) escape at their own call site.
         */
        const chipValue: string = isAttributeFacet
          ? buildSearchTokenValue(value)
          : value;
        setActiveFilters((prev: Array<ActiveFilter>): Array<ActiveFilter> => {
          if (
            prev.some((f: ActiveFilter): boolean => {
              return f.facetKey === chipKey && f.value === chipValue;
            })
          ) {
            return prev;
          }
          // Attribute chips (`attributes.<key>`) display as just `<key>`.
          const displayKey: string =
            config?.title ||
            (chipKey.startsWith(ATTRIBUTE_CHIP_PREFIX)
              ? chipKey.substring(ATTRIBUTE_CHIP_PREFIX.length)
              : chipKey);
          const displayValue: string =
            config?.valueDisplayMap?.[value] ||
            (chipKey.startsWith(ATTRIBUTE_CHIP_PREFIX)
              ? describeSearchValue(chipValue)
              : value);
          return [
            ...prev,
            { facetKey: chipKey, value: chipValue, displayKey, displayValue },
          ];
        });
        setPage(1);
      },
      [facetConfigs],
    );

  const handleRemoveFilter: (facetKey: string, value: string) => void =
    useCallback((facetKey: string, value: string) => {
      /*
       * Removing the synthetic Span Type chip clears the root-only scope back
       * to the default (all spans) — it lives in rootOnly, not activeFilters.
       */
      if (facetKey === SPAN_TYPE_FACET_KEY) {
        setRootOnly(false);
        setPage(1);
        return;
      }
      setActiveFilters((prev: Array<ActiveFilter>): Array<ActiveFilter> => {
        return prev.filter((f: ActiveFilter): boolean => {
          return !(f.facetKey === facetKey && f.value === value);
        });
      });
      setPage(1);
    }, []);

  const handleClearAllFilters: () => void = useCallback(() => {
    setActiveFilters([]);
    /*
     * Span Type lives in rootOnly, not activeFilters — clear it too so "Clear
     * all" truly resets every chip (incl. the synthetic "Root spans" one).
     */
    setRootOnly(false);
    setPage(1);
  }, []);

  /*
   * Read-only chips for prop-level scoping (e.g. service view page), merged
   * with the user-added chips. Display labels are re-derived from
   * facetConfigs here so URL-restored chips (which only carry facetKey/value)
   * still show the human-readable label once services/hosts/etc. load.
   */
  const mergedActiveFilters: Array<ActiveFilter> = useMemo(() => {
    const resolveDisplay: (chip: ActiveFilter) => ActiveFilter = (
      chip: ActiveFilter,
    ) => {
      const config: FacetConfig | undefined = facetConfigs.find(
        (c: FacetConfig): boolean => {
          return c.key === chip.facetKey;
        },
      );
      let displayKey: string = config?.title || chip.facetKey;
      let displayValue: string =
        config?.valueDisplayMap?.[chip.value] || chip.value;
      if (chip.facetKey.startsWith(ATTRIBUTE_SEARCH_CHIP_PREFIX)) {
        displayKey = chip.facetKey.substring(
          ATTRIBUTE_SEARCH_CHIP_PREFIX.length,
        );
        displayValue = `~${chip.value}`;
      } else if (chip.facetKey.startsWith(ATTRIBUTE_CHIP_PREFIX)) {
        displayKey = chip.facetKey.substring(ATTRIBUTE_CHIP_PREFIX.length);
        /*
         * The chip stores a grammar token; show what it means — escapes
         * resolved, so a clicked `/api/*` reads as `/api/*` and not as the
         * `\*` the query needs.
         */
        displayValue = describeSearchValue(chip.value);
      }
      return { ...chip, displayKey, displayValue };
    };

    const base: Array<ActiveFilter> = [];
    if (props.primaryEntityId) {
      base.push(
        resolveDisplay({
          facetKey: "primaryEntityId",
          value: props.primaryEntityId.toString(),
          displayKey: "Service",
          displayValue: props.primaryEntityId.toString(),
          readOnly: true,
        }),
      );
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
    /*
     * Surface the root-only scope as a (removable) chip so the Span Type facet
     * row shows selected and the active-filter bar reflects it. It lives in
     * `rootOnly`, not `activeFilters`, so it's injected here for display only —
     * removing it routes to handleRemoveFilter, which clears rootOnly. Shown
     * only when active; the default (all spans) is the no-chip state, matching
     * every other facet.
     */
    const spanTypeChip: Array<ActiveFilter> = rootOnly
      ? [
          {
            facetKey: SPAN_TYPE_FACET_KEY,
            value: SPAN_TYPE_ROOT_VALUE,
            displayKey: "Span Type",
            displayValue: "Root spans",
          },
        ]
      : [];
    return [...base, ...activeFilters.map(resolveDisplay), ...spanTypeChip];
  }, [
    props.primaryEntityId,
    props.attributeFilters,
    props.attributeFilterDisplayKeys,
    activeFilters,
    facetConfigs,
    rootOnly,
  ]);

  /*
   * "Create metric…" from the analytics view — prefill a Trace Recording
   * Rule with the current analysis (filters + measure + split) and land on
   * the recording-rules settings page with the create form open. This is
   * how an ad-hoc analysis becomes a persistent, alertable metric.
   */
  const handleCreateMetric: (state: TraceAnalyticsState) => void = useCallback(
    (state: TraceAnalyticsState): void => {
      const metricToAggregation: Record<string, TraceAggregationType> = {
        count: TraceAggregationType.Count,
        errorCount: TraceAggregationType.ErrorCount,
        avgDuration: TraceAggregationType.AvgDurationSeconds,
        p50Duration: TraceAggregationType.P50DurationSeconds,
        p90Duration: TraceAggregationType.P90DurationSeconds,
        p95Duration: TraceAggregationType.P95DurationSeconds,
        p99Duration: TraceAggregationType.P99DurationSeconds,
        minDuration: TraceAggregationType.MinDurationSeconds,
        maxDuration: TraceAggregationType.MaxDurationSeconds,
      };

      const escapeRegex: (value: string) => string = (
        value: string,
      ): string => {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      };

      // Span-name filters → one regex the rule engine can evaluate.
      let spanNameRegex: string | undefined = undefined;
      const exactNames: Array<string> =
        (aggregationRequest["spanNames"] as Array<string>) || [];
      const nameSearches: Array<string> =
        (aggregationRequest["spanNameSearches"] as Array<string>) || [];
      if (exactNames.length > 0) {
        spanNameRegex = `^(${exactNames.map(escapeRegex).join("|")})$`;
      } else if (nameSearches.length > 0) {
        spanNameRegex = escapeRegex(nameSearches[0]!);
      } else if (aggregationRequest["nameSearchText"]) {
        spanNameRegex = escapeRegex(
          aggregationRequest["nameSearchText"] as string,
        );
      }

      /*
       * Exact attribute filters carry over. A rule filter is a key/value
       * pair, so an operator-shaped attribute filter (a glob, a range, an
       * any-of list, a contains) has no rule-side equivalent and is dropped
       * from the prefill rather than stringified into a value that would
       * record nothing.
       */
      const filterAttributes: Array<TraceRecordingRuleAttributeFilter> =
        Object.entries(
          (aggregationRequest["attributes"] as Record<string, unknown>) || {},
        )
          .filter(([, value]: [string, unknown]): boolean => {
            return typeof value === "string" && value.length > 0;
          })
          .map(
            ([key, value]: [
              string,
              unknown,
            ]): TraceRecordingRuleAttributeFilter => {
              return { key, value: value as string };
            },
          );

      /*
       * Rules group by attribute keys only — top-level dimensions (span
       * name, service, status, kind) have no rule-side equivalent.
       */
      const TOP_LEVEL_DIMENSIONS: Set<string> = new Set([
        "name",
        "primaryEntityId",
        "statusCode",
        "kind",
      ]);
      const groupByAttribute: string =
        state.groupBy.find((key: string): boolean => {
          return !TOP_LEVEL_DIMENSIONS.has(key);
        }) || "";

      /*
       * Filters with direct rule-side equivalents carry over. Rules cannot
       * express service/duration/contains filters — those are dropped, so a
       * heavily-filtered analysis may record a broader span set.
       */
      const statusCodes: Array<number> =
        (aggregationRequest["statusCodes"] as Array<number>) || [];
      const onlyErrors: boolean =
        statusCodes.length === 1 && statusCodes[0] === 2;

      const spanKinds: Array<string> =
        (aggregationRequest["spanKinds"] as Array<string>) || [];
      const spanKind: string | undefined =
        spanKinds.length === 1 ? spanKinds[0] : undefined;

      const definition: TraceRecordingRuleDefinition = {
        sources: [
          {
            alias: "A",
            aggregationType:
              metricToAggregation[state.metric] || TraceAggregationType.Count,
            ...(spanNameRegex ? { spanNameRegex } : {}),
            ...(spanKind ? { spanKind } : {}),
            ...(onlyErrors ? { onlyErrors } : {}),
            ...(filterAttributes.length > 0 ? { filterAttributes } : {}),
          },
        ],
        expression: "A",
        groupByAttribute,
      };

      const route: Route = new Route(
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.TRACES_SETTINGS_RECORDING_RULES]!,
        ).toString(),
      );
      route.addQueryParams({
        prefill: encodeURIComponent(JSON.stringify(definition)),
      });
      Navigation.navigate(route);
    },
    [aggregationRequest],
  );

  // Histogram drag-to-zoom — user-initiated, so it also lifts to the host.
  const handleHistogramTimeRangeSelect: (start: Date, end: Date) => void =
    useCallback(
      (start: Date, end: Date) => {
        const customRange: RangeStartAndEndDateTime = {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(start, end),
        };
        setTimeRange(customRange);
        setPage(1);
        props.onTimeRangeChange?.(customRange);
      },
      [props.onTimeRangeChange],
    );

  /*
   * Cross-signal pivots: distill the current view (facet chips, parsed
   * search, prop-level scope, window) into a TelemetryCrossSignalScope and
   * open the target explorer equivalently scoped. Built at click time so a
   * relative range resolves to the freshest window; the tooltip hints are
   * memoised because they do not depend on the resolved timestamps.
   */
  const buildPivot: () => TracesPivotScopeResult =
    useCallback((): TracesPivotScopeResult => {
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
      const parsed: ParsedTraceSearch = parseTraceSearch(submittedSearch);

      /*
       * A cross-signal scope carries exact attribute values and nothing else,
       * so an attribute filter with any other operator is routed to the bucket
       * the pivot already reports as "not carried" rather than being flattened
       * into an equality on the glob text — `@k:a*` would otherwise arrive on
       * the logs explorer as a filter for the two characters "a*".
       */
      const searchAttributes: Dictionary<string> = {};
      const searchAttributeSearches: Dictionary<string> = {};
      for (const filter of parsed.attributeFilters) {
        if (filter.predicate.operator === SearchValueOperator.Equals) {
          searchAttributes[filter.key] = filter.predicate.value;
          continue;
        }
        searchAttributeSearches[filter.key] = filter.predicate.value;
      }

      return buildTracesPivotScope({
        primaryEntityId: props.primaryEntityId?.toString(),
        scopeAttributeFilters: props.attributeFilters,
        activeFilters: activeFilters.map(
          (filter: ActiveFilter): { facetKey: string; value: string } => {
            if (!filter.facetKey.startsWith(ATTRIBUTE_CHIP_PREFIX)) {
              return { facetKey: filter.facetKey, value: filter.value };
            }

            /*
             * An attribute chip stores a grammar token, not a literal: hand
             * the scope the value it means, and let a non-equality chip fall
             * into the same not-carried bucket a typed one does.
             */
            const predicate: SearchValuePredicate = parseSearchValue(
              filter.value,
            );
            const key: string = filter.facetKey.substring(
              ATTRIBUTE_CHIP_PREFIX.length,
            );

            if (predicate.operator === SearchValueOperator.Equals) {
              return { facetKey: filter.facetKey, value: predicate.value };
            }

            return {
              facetKey: `${ATTRIBUTE_SEARCH_CHIP_PREFIX}${key}`,
              value: predicate.value,
            };
          },
        ),
        fieldFilters: parsed.fieldFilters,
        searchAttributes,
        searchAttributeSearches,
        freeText: parsed.freeText,
        rootOnly,
        hasEntityScope: Boolean(
          props.entityScope ||
            (props.entityKeysFilter && props.entityKeysFilter.length > 0),
        ),
        startTime: dateRange.startValue,
        endTime: dateRange.endValue,
      });
    }, [
      timeRange,
      submittedSearch,
      activeFilters,
      rootOnly,
      props.primaryEntityId,
      props.attributeFilters,
      props.entityScope,
      props.entityKeysFilter,
    ]);

  // Scope fields each pivot target cannot express — shown in the tooltip.
  const pivotHints: { logs: Array<string>; metrics: Array<string> } =
    useMemo(() => {
      const pivot: TracesPivotScopeResult = buildPivot();
      const logsResult: CrossSignalQueryParams = toLogsExplorerQueryParams(
        pivot.scope,
      );
      const metricsResult: CrossSignalQueryParams =
        toMetricsExplorerQueryParams(pivot.scope);

      return {
        logs: Array.from(
          new Set([
            ...pivot.notCarried,
            ...describeDroppedScopeFields(logsResult.dropped),
          ]),
        ),
        metrics: Array.from(
          new Set([
            ...pivot.notCarried,
            ...describeDroppedScopeFields(metricsResult.dropped),
          ]),
        ),
      };
    }, [buildPivot]);

  const navigateToPivot: (target: "logs" | "metrics") => void = useCallback(
    (target: "logs" | "metrics"): void => {
      const pivot: TracesPivotScopeResult = buildPivot();
      const serialized: CrossSignalQueryParams =
        target === "logs"
          ? toLogsExplorerQueryParams(pivot.scope)
          : toMetricsExplorerQueryParams(pivot.scope);

      const route: Route = RouteUtil.populateRouteParams(
        RouteMap[target === "logs" ? PageMap.LOGS : PageMap.METRIC_VIEW]!,
      );
      const currentUrl: URL = Navigation.getCurrentURL();
      const targetUrl: URL = new URL(
        currentUrl.protocol,
        currentUrl.hostname,
        route,
      );

      const params: Dictionary<string> = serialized.params;

      for (const paramName of Object.keys(params)) {
        targetUrl.addQueryParam(paramName, params[paramName] as string, true);
      }

      Navigation.navigate(targetUrl);
    },
    [buildPivot],
  );

  /*
   * Build the route to a trace's detail page so rows can render as real
   * anchors (cmd/ctrl/middle-click → open in new tab).
   */
  const getTraceRoute: (span: Span) => Route | undefined = useCallback(
    (span: Span) => {
      if (!span.traceId) {
        return undefined;
      }
      return RouteUtil.populateRouteParams(RouteMap[PageMap.TRACE_VIEW]!, {
        modelId: span.traceId.toString(),
      });
    },
    [],
  );

  /*
   * Saved views are only offered on the top-level traces explorer — not when
   * the viewer is scoped to a resource (service / host / docker / k8s detail).
   */
  const enableSavedViews: boolean =
    !props.primaryEntityId &&
    !props.entityScope &&
    (!props.attributeFilters ||
      Object.keys(props.attributeFilters).length === 0);

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
        rootOnly: rootOnly,
      };
    }, [submittedSearch, activeFilters, timeRange, pageSize, rootOnly]);

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
      // Views saved before the toggle existed default to showing all spans.
      setRootOnly(state.rootOnly ?? false);
      setPage(1);
    }, []);

  return (
    <TelemetryViewer<Span>
      items={spans}
      isLoading={isLoading}
      error={error || undefined}
      onRefresh={() => {
        void fetchSpans();
        void fetchHistogramAndFacets();
        setAnalyticsRefreshTick((tick: number) => {
          return tick + 1;
        });
      }}
      toolbarLeadingActions={
        enableSavedViews ? (
          <TelemetrySavedViewsControl<TraceSavedView>
            modelType={TraceSavedView}
            savedViewNoun="Trace"
            explorerLabel="traces"
            hasInitialUrlState={hasInitialUrlState}
            initialSavedViewId={initialUrlState.savedViewId}
            initialStateOverrides={initialStateOverrides}
            onSelectionChange={setSelectedSavedViewId}
            captureCurrentState={captureCurrentState}
            applyState={applySavedViewState}
            onError={setError}
          />
        ) : undefined
      }
      toolbarTrailingActions={
        <>
          {/*
           * Signal pivots: jump to the logs / metrics explorer carrying the
           * current scope (service facets, attribute filters, window). The
           * tooltip lists any filters the target grammar cannot express so
           * the narrowing is never silent.
           */}
          <div
            className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm"
            aria-label="Related telemetry signals"
          >
            <Tooltip
              text={`Open the logs explorer scoped like this view${
                pivotHints.logs.length > 0
                  ? ` — not carried over: ${pivotHints.logs.join(", ")}`
                  : ""
              }`}
            >
              <button
                type="button"
                aria-label="View logs for this scope"
                className={`${TOOLBAR_BUTTON_CLASS_NAME} ${TOOLBAR_BUTTON_IDLE_CLASS_NAME}`}
                onClick={() => {
                  navigateToPivot("logs");
                }}
              >
                <Icon icon={IconProp.Logs} className="h-3.5 w-3.5" />
                <span>Logs</span>
              </button>
            </Tooltip>
            <Tooltip
              text={`Open the metric explorer scoped like this view${
                pivotHints.metrics.length > 0
                  ? ` — not carried over: ${pivotHints.metrics.join(", ")}`
                  : ""
              }`}
            >
              <button
                type="button"
                aria-label="View metrics for this scope"
                className={`${TOOLBAR_BUTTON_CLASS_NAME} ${TOOLBAR_BUTTON_IDLE_CLASS_NAME}`}
                onClick={() => {
                  navigateToPivot("metrics");
                }}
              >
                <Icon icon={IconProp.ChartBar} className="h-3.5 w-3.5" />
                <span>Metrics</span>
              </button>
            </Tooltip>
          </div>
          {/* Spans / Analytics view toggle */}
          <div className="inline-flex overflow-hidden rounded-md border border-gray-200 shadow-sm">
            {(["spans", "analytics"] as Array<"spans" | "analytics">).map(
              (mode: "spans" | "analytics") => {
                return (
                  <button
                    key={mode}
                    type="button"
                    className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      viewMode === mode
                        ? "bg-indigo-50 text-indigo-700"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      setViewMode(mode);
                    }}
                  >
                    {mode === "spans" ? "Spans" : "Analytics"}
                  </button>
                );
              },
            )}
          </div>
          {/*
           * The root-spans-only toggle lives in the "Span Type" facet
           * (sidebar), which drives the same `rootOnly` state — so no separate
           * toolbar button is needed here.
           */}
        </>
      }
      emptyMessage="No traces found"
      itemLabel="traces"
      renderRow={(span: Span): ReactElement => {
        const service: Service | undefined = span.primaryEntityId
          ? serviceById[span.primaryEntityId.toString()]
          : undefined;
        const spanKey: string = span.spanId?.toString() || "";
        const isExpanded: boolean =
          spanKey !== "" && expandedSpanId === spanKey;
        return (
          <>
            <TraceRow
              span={span}
              service={service}
              maxDurationNano={maxDurationNano}
              isExpanded={isExpanded}
              onToggle={() => {
                setExpandedSpanId(isExpanded ? null : spanKey || null);
              }}
            />
            {isExpanded && (
              <SpanDetailsPanel
                span={span}
                service={service}
                traceRoute={getTraceRoute(span)}
                onFilterByAttribute={(key: string, value: string) => {
                  /*
                   * The value is copied straight off the span, so it is
                   * escaped into a grammar token here — the chip is re-parsed
                   * when the query is built.
                   */
                  handleFacetInclude(
                    `${ATTRIBUTE_CHIP_PREFIX}${key}`,
                    buildSearchTokenValue(value),
                  );
                  setExpandedSpanId(null);
                }}
              />
            )}
          </>
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
      searchPlaceholder="Search traces — e.g. service:api status:error @http.method:GET"
      searchSuggestions={[
        "service",
        "status",
        "name",
        "trace",
        "span",
        "kind",
        "hasException",
        "statusMessage",
        "duration",
      ]}
      searchAttributeSuggestions={telemetryAttributes}
      searchValueSuggestions={attributeValueSuggestions}
      searchAttributesLoading={attributesLoading}
      searchValuesLoading={attributeValuesLoading}
      onSearchFieldValueSelect={(fieldKey: string, value: string) => {
        /*
         * Turn a typed `key:value` into a chip via the same path as a facet
         * click, so both live in `activeFilters` — but only when a chip can
         * carry the filter losslessly. Returning `false` tells the search bar
         * to leave the token in the input and submit the search string
         * instead, which routes it through the shared grammar; that is the
         * branch that makes `status:error`, `kind:server`, `duration:>500`
         * and every wildcard / negation / range mean the same thing whether
         * they are typed and submitted or typed and Enter-ed. They used to
         * chip their raw text: "error" landed on the numeric statusCode
         * column, "server" never became SPAN_KIND_SERVER, and ">500" was
         * compared as a string against an Int128.
         */
        const chip: TraceSearchChip | null = resolveTraceSearchChip(
          fieldKey,
          value,
        );

        if (!chip) {
          return false;
        }

        if (chip.value.length === 0) {
          return;
        }

        handleFacetInclude(chip.facetKey, chip.value);
        return;
      }}
      searchFieldAliasMap={TRACE_FIELD_ALIAS_MAP}
      searchHelpRows={SEARCH_HELP_ROWS}
      searchHelpCombinedExample="status:error @http.status_code:>499 -@http.method:GET"
      // Time
      timeRange={timeRange}
      onTimeRangeChange={(value: RangeStartAndEndDateTime) => {
        setTimeRange(value);
        setPage(1);
        // User-initiated (the toolbar picker) — lift to a controlling host.
        props.onTimeRangeChange?.(value);
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
      // Histogram
      showHistogram={true}
      histogramBuckets={histogramBuckets}
      histogramSeries={histogramSeries}
      histogramTitle={
        chartMetric === "count" ? "Traces over time" : "Response time"
      }
      histogramLoading={histogramLoading}
      onHistogramTimeRangeSelect={handleHistogramTimeRangeSelect}
      histogramValueFormatter={
        chartMetric === "count" ? undefined : formatDurationMs
      }
      histogramHeaderActions={
        <select
          className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-600 focus:border-indigo-400 focus:outline-none"
          value={chartMetric}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            setChartMetric(e.target.value);
          }}
          title="Chart metric"
        >
          {CHART_METRIC_OPTIONS.map((opt: { value: string; label: string }) => {
            return (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            );
          })}
        </select>
      }
      mainContentOverride={
        viewMode === "analytics" ? (
          <TracesAnalyticsView
            baseFilters={aggregationRequest}
            attributeKeys={telemetryAttributes}
            serviceNameMap={serviceNameMap}
            onCreateMetric={handleCreateMetric}
            refreshTick={analyticsRefreshTick}
          />
        ) : undefined
      }
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
