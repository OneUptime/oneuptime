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
import TelemetrySavedViewsControl, {
  serializeTimeRange,
  deserializeTimeRange,
} from "../Telemetry/TelemetrySavedViewsControl";
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

const DEFAULT_PAGE_SIZE: number = 50;
const LIVE_POLL_INTERVAL_MS: number = 10000;

/*
 * Synthetic "Span Type" facet. It is not a real Span column — selecting its
 * single "Root spans" value drives the same `rootOnly` state as the toolbar
 * toggle (so the two stay in sync), rather than adding a normal filter chip.
 * Kept distinct from the backend `isRootSpan` key so it never collides with
 * generic column-chip query building.
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

const SEARCH_HELP_ROWS: Array<SearchHelpRow> = [
  {
    syntax: "service:<name>",
    description: "Filter by service name",
    example: "service:api",
  },
  {
    syntax: "status:ok|error|unset",
    description: "Filter by span status",
    example: "status:error",
  },
  {
    syntax: "name:<span name>",
    description:
      'Filter by span name (substring match). Quote values with spaces: name:"SELECT wp_options".',
    example: 'name:"SELECT wp_options"',
  },
  {
    syntax: "trace:<trace id>",
    description: "Filter by trace id",
    example: "trace:abc123",
  },
  {
    syntax: "span:<span id>",
    description: "Filter by span id",
    example: "span:def456",
  },
  {
    syntax: "kind:<span kind>",
    description: "Filter by span kind",
    example: "kind:server",
  },
  {
    syntax: "hasException:true|false",
    description: "Filter spans with/without exceptions",
    example: "hasException:true",
  },
  {
    syntax: "statusMessage:<text>",
    description: "Filter by status message (substring match)",
    example: "statusMessage:timeout",
  },
  {
    syntax: "duration:>N or duration:<N",
    description: "Filter by duration in milliseconds",
    example: "duration:>500",
  },
  {
    syntax: "@<attribute>:<value>",
    description: "Filter by span attribute (exact match)",
    example: "@http.method:GET",
  },
  {
    syntax: "@<attribute>:~<value>",
    description: "Filter by span attribute (contains match)",
    example: "@url.host:~starship.online",
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

const FIELD_ALIAS_MAP: Record<string, string> = {
  service: "primaryEntityId",
  status: "statusCode",
  name: "name",
  trace: "traceId",
  span: "spanId",
  kind: "kind",
  hasexception: "hasException",
  statusmessage: "statusMessage",
  duration: "durationUnixNano",
};

/** Map user-friendly kind values to the backend enum strings */
const SPAN_KIND_VALUE_MAP: Record<string, string> = {
  server: "SPAN_KIND_SERVER",
  client: "SPAN_KIND_CLIENT",
  producer: "SPAN_KIND_PRODUCER",
  consumer: "SPAN_KIND_CONSUMER",
  internal: "SPAN_KIND_INTERNAL",
};

const KNOWN_FIELD_KEYS: Set<string> = new Set([
  "service",
  "status",
  "name",
  "trace",
  "span",
  "kind",
  "hasexception",
  "statusmessage",
  "duration",
]);

interface InitialUrlState {
  search: string;
  filters: Array<ActiveFilter>;
  timeRange: RangeStartAndEndDateTime;
  page: number;
  pageSize: number;
  viewMode: "spans" | "analytics";
  rootOnly: boolean;
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

  return { search, filters, timeRange, page, pageSize, viewMode, rootOnly };
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
}

const TracesViewer: FunctionComponent<Props> = (props: Props): ReactElement => {
  /*
   * Parse all filter state from the URL once on first mount. SpanViewer's
   * "filter by" action lands here with `?search=...` so users arrive with
   * the filter applied; refresh and back-from-trace-detail also rely on
   * this so the view restores rather than resetting to defaults.
   */
  const initialUrlState: InitialUrlState = useMemo(readInitialUrlState, []);

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

  /*
   * Parse search string — log syntax: field:value (no @) for known fields,
   * @attribute:value (with @) for span attributes
   */
  const parseSearch: (raw: string) => {
    freeText: string;
    fieldFilters: Record<string, Array<string>>;
    attributes: Record<string, string>;
    attributeSearches: Record<string, string>;
  } = useCallback((raw: string) => {
    const fieldFilters: Record<string, Array<string>> = {};
    const attributes: Record<string, string> = {};
    const attributeSearches: Record<string, string> = {};
    const freeTextParts: Array<string> = [];
    /*
     * Tokenizer:
     *  1. `@?\S+:"[^"]*"` — `field:"value"` or `@attr:"value"` with spaces
     *     inside double quotes (e.g. `name:"SELECT wp_options"`).
     *  2. `@\S+:[^\s]+`   — `@attr:value` (no spaces, no quotes).
     *  3. `\S+`           — bare token (field prefix on its own, free text,
     *                       or unquoted `field:value` that fits in one word).
     */
    const rawTokens: Array<string> =
      raw.match(/@?\S+:~?"[^"]*"|@\S+:[^\s]+|\S+/g) || [];
    /*
     * Two merges in this loop:
     *  - `name: POST` → `["name:", "POST"]` → `name:POST` (space after colon).
     *  - `name: "SELECT wp_options"` → `["name:", "\"SELECT", "wp_options\""]`
     *    → `name:"SELECT wp_options"` (keep absorbing until closing quote).
     */
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
          if (
            (merged.includes(':"') || merged.includes(':~"')) &&
            !merged.endsWith('"')
          ) {
            while (i + 1 < rawTokens.length && !merged.endsWith('"')) {
              i++;
              merged = merged + " " + rawTokens[i]!;
            }
          }
          tokens.push(merged);
          continue;
        }
      }
      // Standalone token with an unclosed quote — absorb until close.
      if (
        (token.includes(':"') || token.includes(':~"')) &&
        !token.endsWith('"')
      ) {
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
      // @attribute:value (exact) or @attribute:~value (contains)
      const attrMatch: RegExpMatchArray | null = token.match(/^@([^:]+):(.*)$/);
      if (attrMatch) {
        const attrValue: string = stripQuotes(attrMatch[2]!);
        if (attrValue.startsWith("~")) {
          const searchValue: string = stripQuotes(attrValue.substring(1));
          if (searchValue.length > 0) {
            attributeSearches[attrMatch[1]!] = searchValue;
          }
        } else if (attrValue.length > 0) {
          attributes[attrMatch[1]!] = attrValue;
        }
        continue;
      }
      // field:value (no @) → known field filter
      const fieldMatch: RegExpMatchArray | null = token.match(/^([^:]+):(.*)$/);
      if (fieldMatch) {
        const fieldName: string = fieldMatch[1]!.toLowerCase();
        const fieldValue: string = stripQuotes(fieldMatch[2]!);
        if (KNOWN_FIELD_KEYS.has(fieldName) && fieldValue.length > 0) {
          const backendField: string = FIELD_ALIAS_MAP[fieldName] || fieldName;
          if (!fieldFilters[backendField]) {
            fieldFilters[backendField] = [];
          }
          fieldFilters[backendField]!.push(fieldValue);
          continue;
        }
      }
      freeTextParts.push(token);
    }
    return {
      freeText: freeTextParts.join(" ").trim(),
      fieldFilters,
      attributes,
      attributeSearches,
    };
  }, []);

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
    const attributeChips: Record<string, string> = {};
    const attributeSearchChips: Record<string, string> = {};
    for (const filter of activeFilters) {
      /*
       * Chips with the `attributes.` prefix are telemetry attribute filters
       * (added when a user types `@key:value` in the search bar). Route them
       * into `query.attributes` rather than as top-level columns.
       * `attributeSearches.` chips are the contains-match variant
       * (`@key:~value`).
       */
      if (filter.facetKey.startsWith("attributeSearches.")) {
        const attrKey: string = filter.facetKey.substring(
          "attributeSearches.".length,
        );
        attributeSearchChips[attrKey] = filter.value;
        continue;
      }
      if (filter.facetKey.startsWith("attributes.")) {
        const attrKey: string = filter.facetKey.substring("attributes.".length);
        attributeChips[attrKey] = filter.value;
        continue;
      }
      if (!facetGroups[filter.facetKey]) {
        facetGroups[filter.facetKey] = [];
      }
      facetGroups[filter.facetKey]!.push(filter.value);
    }

    /*
     * The primaryEntityId / hostId / dockerHostId / kubernetesClusterId facets
     * all filter the same underlying `primaryEntityId` column on Span. Union
     * the selected values into a single `primaryEntityId IN (...)` predicate.
     */
    const resourceFacetKeys: Set<string> = new Set<string>([
      "primaryEntityId",
      "hostId",
      "dockerHostId",
      "podmanHostId",
      "kubernetesClusterId",
    ]);
    const resourceIds: Set<string> = new Set<string>();
    for (const key of resourceFacetKeys) {
      const values: Array<string> | undefined = facetGroups[key];
      if (values) {
        for (const v of values) {
          resourceIds.add(v);
        }
      }
    }
    if (resourceIds.size > 0) {
      (query as Record<string, unknown>)["primaryEntityId"] =
        resourceIds.size === 1
          ? Array.from(resourceIds)[0]!
          : new Includes(Array.from(resourceIds));
    }

    const { fieldFilters, freeText, attributes, attributeSearches } =
      parseSearch(submittedSearch);

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
    for (const textKey of TEXT_CHIP_FIELDS) {
      const tokenValues: Array<string> | undefined = fieldFilters[textKey];
      if (tokenValues && tokenValues.length > 0) {
        facetGroups[textKey] = [
          ...(facetGroups[textKey] || []),
          ...tokenValues,
        ];
      }
    }
    for (const key of Object.keys(facetGroups)) {
      if (resourceFacetKeys.has(key)) {
        continue;
      }
      const values: Array<string> = facetGroups[key]!;
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
      const values: Array<string> = fieldFilters[key]!;

      if (key === "statusCode") {
        // Map friendly status names to numeric codes
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
      } else if (key === "name" || key === "statusMessage") {
        // Already merged into the chip groups above.
        continue;
      } else if (key === "kind") {
        // Map friendly kind names (server, client, etc.) to backend enum
        const mapped: Array<string> = values.map((v: string): string => {
          return SPAN_KIND_VALUE_MAP[v.toLowerCase()] || v;
        });
        (query as Record<string, unknown>)[key] =
          mapped.length === 1 ? mapped[0] : new Includes(mapped);
      } else if (key === "hasException") {
        // Boolean field
        const boolVal: boolean = values[0]!.toLowerCase() === "true";
        (query as Record<string, unknown>)[key] = boolVal;
      } else if (key === "durationUnixNano") {
        // Duration filter: duration:>500 or duration:<200 (in milliseconds)
        const raw: string = values[0]!;
        const msToNano: number = 1_000_000;
        if (raw.startsWith(">")) {
          const ms: number = Number(raw.substring(1));
          if (!isNaN(ms)) {
            (query as Record<string, unknown>)[key] = new GreaterThan(
              ms * msToNano,
            );
          }
        } else if (raw.startsWith("<")) {
          const ms: number = Number(raw.substring(1));
          if (!isNaN(ms)) {
            (query as Record<string, unknown>)[key] = new LessThan(
              ms * msToNano,
            );
          }
        } else {
          // Exact match in ms
          const ms: number = Number(raw);
          if (!isNaN(ms)) {
            (query as Record<string, unknown>)[key] = ms * msToNano;
          }
        }
      } else if (values.length === 1) {
        (query as Record<string, unknown>)[key] = values[0]!;
      } else {
        (query as Record<string, unknown>)[key] = new Includes(values);
      }
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
     * Apply attribute filters — merge chip + search sources with the
     * prop-level resource scope (Host / Docker / Kubernetes views).
     * Contains-match filters become Search instances, which the analytics
     * query layer compiles to a case-insensitive value ILIKE.
     */
    const mergedAttributes: Record<string, unknown> = {
      ...attributeChips,
      ...attributes,
    };
    const mergedAttributeSearches: Record<string, string> = {
      ...attributeSearchChips,
      ...attributeSearches,
    };
    for (const [key, value] of Object.entries(mergedAttributeSearches)) {
      // A contains filter on a key supersedes an exact filter on the same key…
      mergedAttributes[key] = new Search(value);
    }
    // …but the read-only resource scope (Host / Docker / K8s pages) always wins.
    Object.assign(mergedAttributes, props.attributeFilters || {});
    if (Object.keys(mergedAttributes).length > 0) {
      (query as Record<string, unknown>)["attributes"] = mergedAttributes;
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
    parseSearch,
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
    if (viewMode === "analytics") {
      params.set("view", "analytics");
    }
    if (rootOnly) {
      params.set("rootOnly", "true");
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
  }, [
    submittedSearch,
    activeFilters,
    timeRange,
    page,
    pageSize,
    viewMode,
    rootOnly,
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
      KNOWN_FIELD_KEYS.has(attrKey) ||
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
    const attributeChips: Record<string, string> = {};
    const attributeSearchChips: Record<string, string> = {};
    for (const filter of activeFilters) {
      // `attributes.<key>` chips route into `payload.attributes`, not `groups`.
      if (filter.facetKey.startsWith("attributeSearches.")) {
        const attrKey: string = filter.facetKey.substring(
          "attributeSearches.".length,
        );
        attributeSearchChips[attrKey] = filter.value;
        continue;
      }
      if (filter.facetKey.startsWith("attributes.")) {
        const attrKey: string = filter.facetKey.substring("attributes.".length);
        attributeChips[attrKey] = filter.value;
        continue;
      }
      if (!groups[filter.facetKey]) {
        groups[filter.facetKey] = [];
      }
      groups[filter.facetKey]!.push(filter.value);
    }

    const { fieldFilters, freeText, attributes, attributeSearches } =
      parseSearch(submittedSearch);
    for (const key of Object.keys(fieldFilters)) {
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key]!.push(...fieldFilters[key]!);
    }

    /*
     * Pass attribute filters (chip + parsed + prop scope) to aggregation,
     * with the same precedence the list applies: a contains filter
     * supersedes an exact filter on the same key, and the read-only
     * resource scope supersedes both — otherwise the server would AND
     * exact + contains and the chart would disagree with the list.
     */
    const mergedAttributes: Record<string, string> = {
      ...attributeChips,
      ...attributes,
    };
    const mergedAttributeSearches: Record<string, string> = {
      ...attributeSearchChips,
      ...attributeSearches,
    };
    const scopeAttributes: Record<string, string> =
      props.attributeFilters || {};
    for (const key of Object.keys(mergedAttributeSearches)) {
      if (scopeAttributes[key] !== undefined) {
        delete mergedAttributeSearches[key];
        continue;
      }
      delete mergedAttributes[key];
    }
    Object.assign(mergedAttributes, scopeAttributes);
    if (Object.keys(mergedAttributes).length > 0) {
      payload["attributes"] = mergedAttributes;
    }
    if (Object.keys(mergedAttributeSearches).length > 0) {
      payload["attributeSearches"] = mergedAttributeSearches;
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
     * primaryEntityId / hostId / dockerHostId / kubernetesClusterId all filter
     * the underlying `primaryEntityId` column — union them into a single list.
     */
    const resourceIdSet: Set<string> = new Set<string>();
    for (const k of [
      "primaryEntityId",
      "hostId",
      "dockerHostId",
      "podmanHostId",
      "kubernetesClusterId",
    ]) {
      const values: Array<string> | undefined = groups[k];
      if (values) {
        for (const v of values) {
          resourceIdSet.add(v);
        }
      }
    }
    if (resourceIdSet.size > 0) {
      payload["serviceIds"] = Array.from(resourceIdSet);
    }

    if (groups["statusCode"] && groups["statusCode"].length > 0) {
      payload["statusCodes"] = groups["statusCode"].map((v: string): number => {
        const lower: string = v.toLowerCase();
        if (lower === "error" || v === String(SpanStatus.Error)) {
          return SpanStatus.Error;
        }
        if (lower === "ok" || v === String(SpanStatus.Ok)) {
          return SpanStatus.Ok;
        }
        return SpanStatus.Unset;
      });
    }

    if (groups["kind"] && groups["kind"].length > 0) {
      // Map friendly kind names to backend enum values
      payload["spanKinds"] = groups["kind"].map((v: string): string => {
        return SPAN_KIND_VALUE_MAP[v.toLowerCase()] || v;
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
      if (groups["name"].length === 1) {
        payload["spanNameSearches"] = groups["name"];
      } else {
        payload["spanNames"] = groups["name"];
      }
    }

    if (groups["traceId"] && groups["traceId"].length > 0) {
      payload["traceIds"] = groups["traceId"];
    }

    if (groups["spanId"] && groups["spanId"].length > 0) {
      payload["spanIds"] = groups["spanId"];
    }

    if (groups["hasException"] && groups["hasException"].length > 0) {
      payload["hasException"] =
        groups["hasException"][0]!.toLowerCase() === "true";
    }

    /*
     * Same single/multi routing as `name`: one value matches as a substring
     * (mirrors the list's Search), several match exactly (mirrors Includes).
     */
    if (groups["statusMessage"] && groups["statusMessage"].length > 0) {
      if (groups["statusMessage"].length === 1) {
        payload["statusMessageSearchText"] = groups["statusMessage"][0];
      } else {
        payload["statusMessages"] = groups["statusMessage"];
      }
    }

    if (groups["durationUnixNano"] && groups["durationUnixNano"].length > 0) {
      const raw: string = groups["durationUnixNano"][0]!;
      const msToNano: number = 1_000_000;
      if (raw.startsWith(">")) {
        const ms: number = Number(raw.substring(1));
        if (!isNaN(ms)) {
          payload["minDurationNano"] = ms * msToNano;
        }
      } else if (raw.startsWith("<")) {
        const ms: number = Number(raw.substring(1));
        if (!isNaN(ms)) {
          payload["maxDurationNano"] = ms * msToNano;
        }
      } else {
        // duration:N (no operator) filters the list as exact equality.
        const ms: number = Number(raw);
        if (!isNaN(ms)) {
          payload["exactDurationNano"] = ms * msToNano;
        }
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
    parseSearch,
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
       * Span Type: a single "Root spans" choice mirroring the toolbar toggle.
       * Selecting it scopes to root spans (trace entry points); leaving it
       * unselected shows all spans. Count is the exact number of root spans.
       */
      {
        key: SPAN_TYPE_FACET_KEY,
        title: "Span Type",
        valueDisplayMap: { [SPAN_TYPE_ROOT_VALUE]: "Root spans" },
        priority: 6.5,
      },
      {
        key: "kind",
        title: "Span Kind",
        valueDisplayMap: SPAN_KIND_LABEL,
        priority: 7,
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
         * Span Type is a synthetic facet that mirrors the toolbar toggle:
         * selecting "Root spans" sets rootOnly instead of adding a filter
         * chip, so both surfaces share one source of truth.
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
        const chipKey: string = ATTRIBUTE_FACET_KEYS.has(facetKey)
          ? `attributes.${facetKey}`
          : facetKey;
        setActiveFilters((prev: Array<ActiveFilter>): Array<ActiveFilter> => {
          if (
            prev.some((f: ActiveFilter): boolean => {
              return f.facetKey === chipKey && f.value === value;
            })
          ) {
            return prev;
          }
          // Attribute chips (`attributes.<key>`) display as just `<key>`.
          const displayKey: string =
            config?.title ||
            (chipKey.startsWith("attributes.")
              ? chipKey.substring("attributes.".length)
              : chipKey);
          const displayValue: string =
            config?.valueDisplayMap?.[value] || value;
          return [
            ...prev,
            { facetKey: chipKey, value, displayKey, displayValue },
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
      if (chip.facetKey.startsWith("attributeSearches.")) {
        displayKey = chip.facetKey.substring("attributeSearches.".length);
        displayValue = `~${chip.value}`;
      } else if (chip.facetKey.startsWith("attributes.")) {
        displayKey = chip.facetKey.substring("attributes.".length);
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
       * Exact attribute filters carry over; contains-filters have no
       * rule-side equivalent and are dropped from the prefill.
       */
      const filterAttributes: Array<TraceRecordingRuleAttributeFilter> =
        Object.entries(
          (aggregationRequest["attributes"] as Record<string, string>) || {},
        ).map(
          ([key, value]: [
            string,
            string,
          ]): TraceRecordingRuleAttributeFilter => {
            return { key, value };
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

  // Histogram drag-to-zoom
  const handleHistogramTimeRangeSelect: (start: Date, end: Date) => void =
    useCallback((start: Date, end: Date) => {
      setTimeRange({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(start, end),
      });
      setPage(1);
    }, []);

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

  // Whether the URL already carried filter state (deep link) on first mount.
  const hasInitialUrlState: boolean = useMemo((): boolean => {
    return (
      initialUrlState.search.length > 0 ||
      initialUrlState.filters.length > 0 ||
      initialUrlState.timeRange.range !== TimeRange.PAST_ONE_HOUR
    );
  }, [initialUrlState]);

  // Capture the current explorer state for Save / Update of a saved view.
  const captureCurrentState: () => TelemetrySavedViewState =
    useCallback((): TelemetrySavedViewState => {
      return {
        search: submittedSearch,
        filters: activeFilters.map((filter: ActiveFilter): [string, string] => {
          return [filter.facetKey, filter.value];
        }),
        timeRange: serializeTimeRange(timeRange),
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
        (state.filters || []).map(
          ([facetKey, value]: [string, string]): ActiveFilter => {
            return {
              facetKey: facetKey,
              value: value,
              displayKey: facetKey,
              displayValue: value,
            };
          },
        ),
      );
      setTimeRange(deserializeTimeRange(state.timeRange));
      if (state.pageSize) {
        setPageSize(state.pageSize);
      }
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
            captureCurrentState={captureCurrentState}
            applyState={applySavedViewState}
            onError={setError}
          />
        ) : undefined
      }
      toolbarTrailingActions={
        <>
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
          {/* Root-spans-only toggle */}
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
              rootOnly
                ? "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                : "border-indigo-300 bg-indigo-50 text-indigo-700"
            }`}
            onClick={() => {
              setRootOnly(!rootOnly);
              setPage(1);
            }}
            title={
              rootOnly
                ? "Showing root spans only — click to include all spans (e.g. when http.route / url.host live on a non-root span)"
                : "Showing all spans — click to show root spans only"
            }
          >
            {rootOnly ? "Root spans" : "All spans"}
          </button>
        </>
      }
      emptyMessage="No traces found"
      itemLabel="traces"
      renderRow={(span: Span): ReactElement => {
        const service: Service | undefined = span.primaryEntityId
          ? serviceById[span.primaryEntityId.toString()]
          : undefined;
        return (
          <TraceRow
            span={span}
            service={service}
            maxDurationNano={maxDurationNano}
            to={getTraceRoute(span)}
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
         * Add the typed pair as a chip via the same path as facet clicks so
         * it lives in `activeFilters` and feels consistent with the rest of
         * the UI. Known fields use their alias (e.g. "service" →
         * "primaryEntityId"); unknown keys are telemetry attributes and get an
         * `attributes.` prefix so they're routed into `query.attributes`
         * during query construction. Known-field detection is
         * case-insensitive so users can type `Service:api`; attribute keys
         * keep their original case because the data is case-sensitive (the
         * backend matches them case-insensitively at query time).
         *
         * Surrounding double quotes are stripped: typing `name:"SELECT"`
         * should store the chip as `SELECT`, otherwise the backend SQL
         * becomes `name ILIKE '%"SELECT"%'` and matches nothing.
         */
        const lowerFieldKey: string = fieldKey.toLowerCase();
        const isKnownField: boolean = KNOWN_FIELD_KEYS.has(lowerFieldKey);
        let cleanValue: string =
          value.length >= 2 && value.startsWith('"') && value.endsWith('"')
            ? value.slice(1, -1)
            : value;
        // `@key:~value` → contains-match chip (attributeSearches.<key>).
        let facetKey: string;
        if (isKnownField) {
          facetKey = FIELD_ALIAS_MAP[lowerFieldKey] || lowerFieldKey;
        } else if (cleanValue.startsWith("~")) {
          facetKey = `attributeSearches.${fieldKey}`;
          cleanValue = cleanValue.substring(1);
          if (
            cleanValue.length >= 2 &&
            cleanValue.startsWith('"') &&
            cleanValue.endsWith('"')
          ) {
            cleanValue = cleanValue.slice(1, -1);
          }
        } else {
          facetKey = `attributes.${fieldKey}`;
        }
        if (cleanValue.length === 0) {
          return;
        }
        handleFacetInclude(facetKey, cleanValue);
      }}
      searchFieldAliasMap={FIELD_ALIAS_MAP}
      searchHelpRows={SEARCH_HELP_ROWS}
      searchHelpCombinedExample="service:api status:error @http.method:GET checkout"
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
