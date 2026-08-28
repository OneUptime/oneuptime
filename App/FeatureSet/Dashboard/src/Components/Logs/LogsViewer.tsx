import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
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
  LogsSignalPivotAction,
  normalizeLogsTableColumns,
} from "Common/UI/Components/LogsViewer/types";
import useLiveLogsRefresh from "Common/UI/Components/LogsViewer/useLiveLogsRefresh";
import useLogsHistogram, {
  LogsHistogramState,
} from "Common/UI/Components/LogsViewer/useLogsHistogram";
import {
  ATTRIBUTE_FACET_PREFIX,
  buildLogsHistogramRequest,
} from "./LogsHistogramRequest";
import {
  resolveLogSavedViewTimeRange,
  withResolvedTime,
} from "./LogSavedViewTimeRange";
import {
  buildClearedLogsViewState,
  ClearedLogsViewState,
} from "./LogsViewerDefaults";
import { serializeSavedViewTimeRange } from "Common/Utils/Telemetry/SavedViewTimeRange";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import LogSeverity from "Common/Types/Log/LogSeverity";
import LogSavedView from "Common/Models/DatabaseModels/LogSavedView";
import API from "Common/UI/Utils/API/API";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import { readLegacySerializedArray } from "Common/Utils/LegacySerializedArray";
import {
  describeSearchValue,
  queryValueToChipValues,
} from "Common/Types/Telemetry/TelemetrySearchQuery";
import ModelAPI, {
  ListResult as ModelListResult,
} from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Query from "Common/Types/BaseDatabase/Query";
import Realtime from "Common/UI/Utils/Realtime";
import Log from "Common/Models/AnalyticsModels/Log";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import Span from "Common/Models/AnalyticsModels/Span";
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
import useServiceNames from "../Telemetry/useServiceNames";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import { APP_API_URL } from "Common/UI/Config";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  ResourceEntityFacetSelections,
  parseResourceEntityFacetSelections,
} from "Common/Types/Telemetry/ResourceEntityFacet";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import { shouldAdoptTimeRangeOverride } from "../../Utils/SharedTelemetryTimeCursor";
import { writeTelemetryViewerUrlState } from "../../Utils/TelemetryViewerUrlState";
import {
  InitialSavedViewResolution,
  resolveInitialSavedView,
} from "../../Utils/InitialSavedView";
import Navigation from "Common/UI/Utils/Navigation";
import Dictionary from "Common/Types/Dictionary";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import { buildAttributeFilterChips } from "./LogsAttributeFilterChips";
import IconProp from "Common/Types/Icon/IconProp";
import {
  CrossSignalQueryParams,
  toMetricsExplorerQueryParams,
  toTracesExplorerQueryParams,
} from "Common/Utils/Telemetry/CrossSignalScope";
import {
  applyLogsFacetFiltersToQuery,
  applyLogsSessionScopeToQuery,
  BODY_FACET_KEY,
  buildLogsPivotScope,
  buildSessionReplayRoute,
  buildSpanChipOpenRoute,
  buildTraceViewRoute,
  extractRumApplicationIdFromRumSessions,
  extractTraceIdFromSpans,
  formatDroppedScopeHint,
  LogsPivotScopeInput,
  LogsPivotScopeResult,
  mergeDroppedScopeFields,
} from "../../Utils/LogsCrossSignalPivot";

export interface ComponentProps {
  id: string;
  serviceIds?: Array<ObjectID> | undefined;
  enableRealtime?: boolean;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  /*
   * Base RUM session scope: compiles to `sessionId IN (...)` exactly like
   * traceIds, and is forwarded to the histogram / facets / analytics
   * endpoints so every panel covers the same rows as the list.
   */
  sessionIds?: Array<string> | undefined;
  showFilters?: boolean | undefined;
  noLogsMessage?: string | undefined;
  logQuery?: Query<Log> | undefined;
  /*
   * Entity scope with attribute fallback (contract C4): compiles server-side
   * to `hasAny(entityKeys, [...]) OR attributes[attributeKey] =
   * attributeValue` so pre-entityKeys rows (no backfill) still match. Placed
   * on the log query record verbatim under the key "entityScope".
   */
  entityScope?:
    | {
        entityKeys: Array<string>;
        attributeKey: string;
        attributeValue: string;
      }
    | undefined;
  limit?: number | undefined;
  onCountChange?: ((count: number) => void) | undefined;
  onShowDocumentation?: (() => void) | undefined;
  /*
   * When true, mirror time range / chip filters / page / pageSize to the URL
   * via `replaceState` so refresh and back-from-detail restore the view.
   * Off by default because this component is embedded inside other pages
   * (Incident, Alert, Service, etc.) where it must not clobber the URL.
   * Only the main /logs page should opt in.
   */
  syncUrlState?: boolean | undefined;
  /*
   * Controlled shared window (the entity telemetry hub). Unlike a pinned
   * `logQuery.time` window — which describes one fixed moment and resets the
   * whole filter state when it changes — adopting an override change keeps
   * the user's chip filters and can carry a rolling preset. A pinned window
   * still wins when both are present. The host is expected to hand back
   * whatever `onTimeRangeChange` lifted, so an echo of the viewer's own
   * change compares equal and is a no-op.
   */
  timeRangeOverride?: RangeStartAndEndDateTime | undefined;
  /*
   * Fired only for user-initiated window changes inside this viewer (the
   * time picker and histogram drag-zoom) — never when adopting
   * `timeRangeOverride` — so a controlling host can follow without loops.
   */
  onTimeRangeChange?:
    | ((timeRange: RangeStartAndEndDateTime) => void)
    | undefined;
}

const DEFAULT_PAGE_SIZE: number = 100;
const LIVE_POLL_INTERVAL_MS: number = 10000;
const SAVED_VIEWS_LIMIT: number = 100;
/*
 * The facet keys read BACK out of a query into chips. Must stay the mirror
 * of what applyLogsFacetFiltersToQuery compiles INTO a query, or a filter
 * that survives a saved view / URL round-trip filters the list while no
 * chip says so — and the histogram, which builds its request from the
 * chips, then counts rows the list excludes.
 */
const FACET_FILTER_KEYS: Array<string> = [
  "severityText",
  "primaryEntityId",
  "traceId",
  "spanId",
  BODY_FACET_KEY,
];

interface InitialUrlState {
  facetFilters: Map<string, Set<string>>;
  timeRange: RangeStartAndEndDateTime;
  page: number;
  pageSize: number;
  /*
   * The saved view the link named, if any — written by this viewer when one
   * is selected, and carried onto the Insights tab and back so a round trip
   * through Insights returns to the same named view rather than to its
   * filters with the view deselected.
   */
  savedViewId: string | null;
  /*
   * Whether the link described a slice of its own (chips or a window). The
   * project's default saved view must not auto-apply over one: a
   * cross-signal pivot, an AI-investigation link or a hand-off from the
   * Insights tab all arrive this way, and overwriting them a tick after
   * mount is what made those links appear to work and then not.
   */
  hasScope: boolean;
  /*
   * Which halves of that slice the link actually spelled out. A link
   * carrying chips but no window is not saying "use the default window" —
   * it is saying nothing about the window, and a saved view named in the
   * same link should keep its own.
   */
  hasFilters: boolean;
  hasRange: boolean;
}

/*
 * How a saved view is applied when the URL that named it also describes a
 * slice of its own.
 *
 * That happens on the way back from the Insights tab: the link says "the
 * DV-IMS view, but with the window and the services I ended up on". The URL
 * is the more recent statement of the two, so it wins over the view's own
 * window and chips — while the view still supplies everything the URL does
 * not carry (columns, sort, page size) and, crucially, its own identity, so
 * the user lands back inside the view they started in rather than on its
 * filters with nothing selected.
 */
interface ApplySavedViewOptions {
  overrideTimeRange?: RangeStartAndEndDateTime | undefined;
  overrideFacetFilters?: Map<string, Set<string>> | undefined;
}

const POSITIVE_INT_REGEX: RegExp = /^\d+$/;

/*
 * Parse filter state from `window.location.search` on first mount so refresh
 * + back-from-log-detail restore the view. Only invoked when the consumer
 * passes `syncUrlState`. Defensive: malformed JSON / unknown enum / non-numeric
 * values fall back to defaults rather than throwing.
 */
function readInitialUrlState(defaultPageSize: number): InitialUrlState {
  const params: URLSearchParams = new URLSearchParams(window.location.search);

  const facetFilters: Map<string, Set<string>> = new Map();
  const filtersRaw: string | null = params.get("filters");
  if (filtersRaw) {
    try {
      const parsed: unknown = JSON.parse(filtersRaw);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (
            Array.isArray(entry) &&
            entry.length === 2 &&
            typeof entry[0] === "string" &&
            Array.isArray(entry[1])
          ) {
            const values: Set<string> = new Set(
              (entry[1] as Array<unknown>).filter((v: unknown): v is string => {
                return typeof v === "string";
              }),
            );
            if (values.size > 0) {
              facetFilters.set(entry[0], values);
            }
          }
        }
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
      : defaultPageSize;

  const savedViewIdRaw: string | null = params.get("savedView");
  const savedViewId: string | null =
    savedViewIdRaw && savedViewIdRaw.trim().length > 0
      ? savedViewIdRaw.trim()
      : null;

  /*
   * Read from the raw params rather than from the parsed values above: a
   * `range` the parser rejected (an unknown enum) still means the link was
   * trying to describe a window, and `timeRange` has already fallen back to
   * the default by this point.
   */
  const hasFilters: boolean = facetFilters.size > 0;
  const hasRange: boolean = Boolean(params.get("range"));

  return {
    facetFilters,
    timeRange,
    page,
    pageSize,
    savedViewId,
    hasScope: hasFilters || hasRange,
    hasFilters,
    hasRange,
  };
}

function getColumnsStorageKey(viewerId: string): string {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  return `logs-columns:${projectId?.toString() || "global"}:${viewerId}`;
}

function loadSelectedColumns(viewerId: string): Array<string> {
  const savedValue: unknown = LocalStorage.getItem(
    getColumnsStorageKey(viewerId),
  );

  /*
   * LocalStorage.setItem serializes the value with JSONFunctions
   * .serializeValue, which used to walk a top-level array by key and store
   * { "0": "time", "1": "body" }. A plain Array.isArray check missed that, so
   * every reload quietly handed back the default columns — and the effect that
   * mirrors state to storage then overwrote the user's real selection. Read
   * both shapes so selections saved before the fix survive.
   */
  const savedColumns: Array<unknown> | null =
    readLegacySerializedArray(savedValue);

  if (savedColumns) {
    return normalizeLogsTableColumns(
      savedColumns.filter((value: unknown): value is string => {
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

  /*
   * The body chip compiles to a contains-match, so its stored form is a
   * Search rather than a bare string. Without this branch a saved view or
   * deep link carrying one round-trips into a filtered list with no chip.
   */
  if (value instanceof Search) {
    const text: string = value.toString();

    return text.trim().length > 0 ? [text] : [];
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

  /*
   * `attributes.<key>` chips, the same way. Attribute filters were the one
   * group applyLogsFacetFiltersToQuery compiled INTO a query and nothing read
   * back out, so a saved view carrying `@platform.team:a*` reopened with the
   * filter applied and no chip showing it — and the next chip edit, which
   * recompiles from the chips it can see, silently dropped it.
   */
  const savedAttributes: Record<string, unknown> =
    ((query as any)["attributes"] as Record<string, unknown>) || {};
  const baseAttributes: Record<string, unknown> =
    ((baseQuery as any)["attributes"] as Record<string, unknown>) || {};

  for (const attributeKey of Object.keys(savedAttributes)) {
    // A filter pinned by the host page is not the user's to edit or remove.
    if (baseAttributes[attributeKey] !== undefined) {
      continue;
    }

    const chipValues: Array<string> = queryValueToChipValues(
      savedAttributes[attributeKey],
    );

    if (chipValues.length > 0) {
      nextFilters.set(
        `${ATTRIBUTE_FACET_PREFIX}${attributeKey}`,
        new Set(chipValues),
      );
    }
  }

  /*
   * Host / docker / podman / Kubernetes chips live under `resourceFilters`
   * rather than in a column of their own (see applyLogsFacetFiltersToQuery).
   * Restoring them here is what makes a saved view keep its cluster chip:
   * without it the chip row would come back empty and the next chip edit
   * would recompile the query without the cluster.
   */
  const savedResourceFilters: ResourceEntityFacetSelections =
    parseResourceEntityFacetSelections((query as any)["resourceFilters"]);

  for (const facetKey of Object.keys(savedResourceFilters)) {
    if ((baseQuery as any)[facetKey] !== undefined) {
      continue;
    }

    const values: Array<string> = savedResourceFilters[facetKey] || [];

    if (values.length > 0) {
      nextFilters.set(facetKey, new Set(values));
    }
  }

  return nextFilters;
}

function buildBaseQuery(props: ComponentProps): Query<Log> {
  const query: Query<Log> = {};

  if (props.serviceIds && props.serviceIds.length > 0) {
    query.primaryEntityId = new Includes(props.serviceIds);
  }

  if (props.traceIds && props.traceIds.length > 0) {
    query.traceId = new Includes(props.traceIds);
  }

  if (props.spanIds && props.spanIds.length > 0) {
    query.spanId = new Includes(props.spanIds);
  }

  applyLogsSessionScopeToQuery(query, props.sessionIds);

  if (props.logQuery && Object.keys(props.logQuery).length > 0) {
    for (const key in props.logQuery) {
      (query as any)[key] = (props.logQuery as any)[key] as any;
    }
  }

  // Contract C4: pass through verbatim; compiled by StatementGenerator.
  if (props.entityScope) {
    (query as any)["entityScope"] = props.entityScope;
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
  const effectiveDefaultPageSize: number = props.limit || DEFAULT_PAGE_SIZE;

  /*
   * URL → state seeding. Only read the URL if the consumer asked for it; when
   * disabled (the default, for embedded usages), keep the historical defaults
   * so we don't accidentally pick up unrelated query params from the host
   * page.
   */
  const initialUrlState: InitialUrlState | null = useMemo(() => {
    if (!props.syncUrlState) {
      return null;
    }
    return readInitialUrlState(effectiveDefaultPageSize);
  }, [props.syncUrlState, effectiveDefaultPageSize]);

  /*
   * A caller that puts an explicit `time` window on logQuery is describing a
   * moment, not a filter — the incident and alert pages pass the window the
   * monitor actually evaluated over when it opened the event. Adopt it as the
   * picker's value so the whole viewer (list, histogram, facets) is anchored
   * there. Without this the viewer silently re-stamps its rolling default over
   * the window, and an incident from last Tuesday renders the past hour of
   * unrelated logs under the heading "Logs for this incident".
   *
   * Resolved as CUSTOM, so live polling and preset re-anchoring leave it alone.
   * Null for every caller that passes no window (the resource log pages), which
   * keeps the historical PAST_ONE_HOUR default for them.
   */
  const pinnedTimeRange: RangeStartAndEndDateTime | null = useMemo(() => {
    return TelemetryQueryTimeRange.getPinnedRangeForQuery(
      props.logQuery,
      TelemetryType.Log,
    );
  }, [props.logQuery]);

  /*
   * Resolved once, on mount, and shared by the two states below so the log
   * list and the picker cannot start out describing different windows. Held in
   * state rather than a memo because it is a seed: later renders must not
   * recompute it, or a caller rebuilding its query would keep yanking the user
   * back to the pin. The props-sync effect below is what follows a genuinely
   * new window.
   */
  const [initialTimeRange] = useState<RangeStartAndEndDateTime>(() => {
    return (
      pinnedTimeRange ||
      props.timeRangeOverride ||
      initialUrlState?.timeRange || { range: TimeRange.PAST_ONE_HOUR }
    );
  });

  const [logs, setLogs] = useState<Array<Log>>([]);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [filterOptions, setFilterOptions] = useState<Query<Log>>(() => {
    const base: Query<Log> = buildBaseQuery(props);
    const defaultRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(initialTimeRange);
    (base as any).time = new InBetween<Date>(
      defaultRange.startValue,
      defaultRange.endValue,
    );
    /*
     * URL-hydrated chips must reach the list query too, not just the chip
     * row and the histogram — otherwise every filter-carrying deep link
     * (cross-signal pivots, AI-insight investigation links, exception
     * occurrence links) lands on a page whose chips claim a scope the list
     * silently ignores.
     */
    return applyLogsFacetFiltersToQuery(
      base,
      initialUrlState?.facetFilters || new Map(),
    );
  });
  const [page, setPage] = useState<number>(initialUrlState?.page || 1);
  const [pageSize, setPageSize] = useState<number>(
    initialUrlState?.pageSize || effectiveDefaultPageSize,
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
  /*
   * Set once the saved-view fetch has settled, however it settled.
   *
   * The initial-view effect used to gate on `!isSavedViewLoading`, which it
   * reads out of the same commit that STARTS the fetch — the flag is still
   * false there, so the effect ran against an empty list, marked itself done,
   * and no default view was ever applied. Gating on "has the fetch finished"
   * instead of "is it not running" removes the race.
   */
  const [hasFetchedSavedViews, setHasFetchedSavedViews] =
    useState<boolean>(false);
  const [viewMode, setViewMode] = useState<LogsViewMode>("list");

  const liveRequestInFlight: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const hasAppliedInitialSavedView: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  // Facet state
  const [facetData, setFacetData] = useState<FacetData>({});
  /*
   * Per-facet search text for resource facets (primaryEntityId / hostId / etc.).
   * When the user types into a facet's search box, this updates and triggers
   * fetchFacets, which forwards the text to /telemetry/logs/facets so the
   * backend can scan the full Postgres source-of-truth, not just the loaded
   * subset.
   */
  const [facetSearchText, setFacetSearchText] = useState<
    Record<string, string>
  >({});
  const [facetLoading, setFacetLoading] = useState<boolean>(false);

  // Track user-applied facet filters: Map<facetKey, Set<value>>
  const [appliedFacetFilters, setAppliedFacetFilters] = useState<
    Map<string, Set<string>>
  >(initialUrlState?.facetFilters || new Map());

  // Time range state — single source of truth for histogram, facets, and log query
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(initialTimeRange);

  /*
   * Render-time mirror of `timeRange` for the adopt effect below. The effect
   * must compare an override against the *current* window without listing
   * `timeRange` in its deps — otherwise the user's own zoom would re-run it
   * against a stale override and get yanked straight back.
   */
  const timeRangeRef: React.MutableRefObject<RangeStartAndEndDateTime> =
    useRef<RangeStartAndEndDateTime>(timeRange);
  timeRangeRef.current = timeRange;

  useEffect(() => {
    const base: Query<Log> = buildBaseQuery(props);

    /*
     * A new pinned window means the caller is describing a different moment
     * (the incident page re-fetching), so follow it rather than re-stamping
     * the window the user is currently looking at. With no pinned window this
     * keeps the user's current picker value, as before.
     */
    const nextTimeRange: RangeStartAndEndDateTime =
      pinnedTimeRange || timeRange;

    /*
     * Compare by value, not identity. A host that rebuilds its query object on
     * every render hands us an equal-but-new window each time; setting state
     * from it unconditionally would re-render, rebuild, and loop.
     */
    if (
      pinnedTimeRange &&
      !TelemetryQueryTimeRange.isSameRange(pinnedTimeRange, timeRange)
    ) {
      setTimeRange(pinnedTimeRange);
    }

    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(nextTimeRange);
    (base as any).time = new InBetween<Date>(
      dateRange.startValue,
      dateRange.endValue,
    );
    /*
     * The applied chips survive a base-scope change (only the base + window
     * are re-stamped), so they must stay compiled into the list query —
     * this is also the pass that runs right after mount, where the chips
     * may have been hydrated from the URL. Read from the render closure
     * like `timeRange` above: chip CHANGES flow through the interaction
     * handlers, not through this effect.
     */
    setFilterOptions(applyLogsFacetFiltersToQuery(base, appliedFacetFilters));
    setPage(1);
  }, [
    props.serviceIds,
    props.traceIds,
    props.spanIds,
    props.sessionIds,
    props.logQuery,
    props.entityScope,
  ]);

  /*
   * Mirror time range / chip filters / page / pageSize to the URL so refresh
   * and back-from-log-detail restore the view. `replaceState` keeps history
   * clean. Opt-in via `syncUrlState` — embedded usages (Incident, Alert,
   * Service detail pages, etc.) leave this off so they don't clobber the
   * host page's URL.
   */
  useEffect(() => {
    if (!props.syncUrlState) {
      return;
    }
    const params: URLSearchParams = new URLSearchParams();
    if (appliedFacetFilters.size > 0) {
      const tuples: Array<[string, Array<string>]> = Array.from(
        appliedFacetFilters.entries(),
      ).map(([key, values]: [string, Set<string>]): [string, Array<string>] => {
        return [key, Array.from(values)];
      });
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
    if (pageSize !== effectiveDefaultPageSize) {
      params.set("pageSize", String(pageSize));
    }
    /*
     * The selected saved view travels with the filters it produced. Without
     * it the Insights tab could inherit the right slice but not the name of
     * the view it came from, and coming back would leave the user with a
     * view's filters and no view selected — which looks like the selection
     * was lost.
     */
    if (selectedSavedViewId) {
      params.set("savedView", selectedSavedViewId);
    }

    writeTelemetryViewerUrlState(Object.fromEntries(params.entries()));
  }, [
    props.syncUrlState,
    appliedFacetFilters,
    timeRange,
    page,
    pageSize,
    effectiveDefaultPageSize,
    selectedSavedViewId,
  ]);

  const select: Select<Log> = useMemo(() => {
    return {
      body: true,
      time: true,
      projectId: true,
      primaryEntityId: true,
      spanId: true,
      traceId: true,
      sessionId: true,
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

  /*
   * Resolve the scoped service id(s) to names so the read-only "Service" chip
   * shows the service name instead of a raw UUID. Filtering still uses the
   * stable id (primaryEntityId); this only maps that id to a friendly label.
   */
  const scopedServiceNameMap: Record<string, string> = useServiceNames(
    props.serviceIds,
  );

  /*
   * Extract trace/span IDs for API calls (histogram + facets must respect these
   * base filters so they reflect the same scope as the logs list)
   */
  const traceIdStrings: Array<string> | undefined = useMemo(() => {
    if (!props.traceIds || props.traceIds.length === 0) {
      return undefined;
    }

    return [...props.traceIds];
  }, [props.traceIds]);

  const spanIdStrings: Array<string> | undefined = useMemo(() => {
    if (!props.spanIds || props.spanIds.length === 0) {
      return undefined;
    }

    return [...props.spanIds];
  }, [props.spanIds]);

  const sessionIdStrings: Array<string> | undefined = useMemo(() => {
    if (!props.sessionIds || props.sessionIds.length === 0) {
      return undefined;
    }

    return [...props.sessionIds];
  }, [props.sessionIds]);

  /*
   * Extract attribute filters from logQuery for the chips, the
   * histogram/facets API calls and the cross-signal pivots.
   *
   * These are NOT `Record<string, string>`. Since the attribute filter rows
   * gained an operator dropdown, every operator other than `=` stores an
   * operator instance (`Includes`, `Search`, `NotEqual`, ...) as the value —
   * that is what the log monitor's criteria form writes into
   * `MonitorStepLogMonitor.attributes` and what `toQuery()` hands over here.
   * Typing them as strings is what let one reach `ActiveFilterChips` and
   * throw "Objects are not valid as a React child", taking the criteria modal
   * down with it. Each consumer below decides for itself how to narrow them.
   */
  const logQueryAttributes: Dictionary<DictionaryEntryValue> | undefined =
    useMemo(() => {
      if (!props.logQuery) {
        return undefined;
      }

      const attributes: Dictionary<DictionaryEntryValue> | undefined = (
        props.logQuery as any
      ).attributes as Dictionary<DictionaryEntryValue> | undefined;

      if (!attributes || Object.keys(attributes).length === 0) {
        return undefined;
      }

      return attributes;
    }, [props.logQuery]);

  /*
   * Extract the entityKeys membership filter from logQuery so the histogram
   * and facets reflect the same entity scope as the logs list (the backend
   * accepts a top-level `entityKeys: Array<string>` on both endpoints).
   */
  const logQueryEntityKeys: Array<string> | undefined = useMemo(() => {
    if (!props.logQuery) {
      return undefined;
    }

    const values: Array<string> = getQueryValues(
      (props.logQuery as any)["entityKeys"],
    );

    if (values.length === 0) {
      return undefined;
    }

    return values;
  }, [props.logQuery]);

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
            timeRange: true,
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
        setHasFetchedSavedViews(true);
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
        /*
         * When live polling, recompute the time range so the query window
         * slides forward to "now" and new logs become visible.
         */
        let query: Query<Log> = filterOptions;

        if (
          skipLoadingState &&
          isLiveEnabled &&
          timeRange.range !== TimeRange.CUSTOM
        ) {
          const freshRange: InBetween<Date> =
            RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
          query = {
            ...filterOptions,
            time: new InBetween<Date>(
              freshRange.startValue,
              freshRange.endValue,
            ),
          };
        }

        const listResult: ListResult<Log> =
          await AnalyticsModelAPI.getList<Log>({
            modelType: Log,
            query: query,
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
    [
      filterOptions,
      isLiveEnabled,
      page,
      pageSize,
      select,
      sortField,
      sortOrder,
      timeRange,
    ],
  );

  // --- Fetch histogram ---

  const fetchHistogramBuckets: () => Promise<Array<HistogramBucket>> =
    useCallback(async (): Promise<Array<HistogramBucket>> => {
      /*
       * The window is resolved inside the builder on every call, so a preset
       * range slides forward with the clock and live polls pick up newly
       * ingested logs.
       */
      const requestData: JSONObject = buildLogsHistogramRequest({
        timeRange: timeRange,
        serviceIds: serviceIdStrings,
        traceIds: traceIdStrings,
        spanIds: spanIdStrings,
        attributes: logQueryAttributes,
        entityKeys: logQueryEntityKeys,
        appliedFacetFilters: appliedFacetFilters,
      });

      /*
       * Base session scope — the chart must cover the same rows as the list
       * when the viewer is scoped to a RUM session.
       */
      if (sessionIdStrings) {
        requestData["sessionIds"] = sessionIdStrings;
      }

      const response: HTTPResponse<JSONObject> = await postApi(
        "/telemetry/logs/histogram",
        requestData,
      );

      return (response.data["buckets"] ||
        []) as unknown as Array<HistogramBucket>;
    }, [
      serviceIdStrings,
      traceIdStrings,
      spanIdStrings,
      sessionIdStrings,
      appliedFacetFilters,
      timeRange,
      logQueryAttributes,
      logQueryEntityKeys,
    ]);

  const histogram: LogsHistogramState = useLogsHistogram(fetchHistogramBuckets);

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
          facetKeys: [
            "severityText",
            "primaryEntityId",
            "hostId",
            "dockerHostId",
            "podmanHostId",
            "kubernetesClusterId",
          ],
        } as JSONObject;

        if (serviceIdStrings) {
          (requestData as any)["serviceIds"] = serviceIdStrings;
        }

        /*
         * Base trace/span filters from props — facet counts must match the
         * logs list scope (e.g. when viewing a single trace).
         */
        if (traceIdStrings) {
          (requestData as any)["traceIds"] = traceIdStrings;
        }

        if (spanIdStrings) {
          (requestData as any)["spanIds"] = spanIdStrings;
        }

        if (sessionIdStrings) {
          (requestData as any)["sessionIds"] = sessionIdStrings;
        }

        if (logQueryAttributes) {
          (requestData as any)["attributes"] = logQueryAttributes;
        }

        if (logQueryEntityKeys) {
          (requestData as any)["entityKeys"] = logQueryEntityKeys;
        }

        /*
         * Only forward non-empty entries — an empty string would still match
         * everything but adds noise to the request, and the backend treats
         * a missing key the same as an empty value.
         */
        const facetSearchTextActive: Record<string, string> = {};
        for (const [key, val] of Object.entries(facetSearchText)) {
          if (val && val.trim().length > 0) {
            facetSearchTextActive[key] = val.trim();
          }
        }
        if (Object.keys(facetSearchTextActive).length > 0) {
          (requestData as any)["facetSearchText"] = facetSearchTextActive;
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
    }, [
      serviceIdStrings,
      traceIdStrings,
      spanIdStrings,
      sessionIdStrings,
      timeRange,
      logQueryAttributes,
      logQueryEntityKeys,
      facetSearchText,
    ]);

  // --- Handlers (defined before effects that reference them) ---

  const disableLiveMode: () => void = useCallback((): void => {
    if (isLiveEnabled) {
      setIsLiveEnabled(false);
      liveRequestInFlight.current = false;
      setIsLiveUpdating(false);
    }
  }, [isLiveEnabled]);

  const applySavedView: (
    savedView: LogSavedView,
    options?: ApplySavedViewOptions | undefined,
  ) => void = useCallback(
    (
      savedView: LogSavedView,
      options?: ApplySavedViewOptions | undefined,
    ): void => {
      const baseQuery: Query<Log> = buildBaseQuery(props);
      const rawQuery: JSONObject =
        (savedView.query as unknown as JSONObject) || {};
      const savedQuery: Query<Log> = (JSONFunctions.deserialize(
        JSONFunctions.serialize(rawQuery),
      ) || {}) as Query<Log>;

      /*
       * The saved query's own `time` is whatever the range resolved to when the
       * view was saved, so it is discarded and re-derived from the saved
       * selection — otherwise a rolling range would come back as the frozen
       * window it produced on the day it was saved.
       */
      const nextTimeRange: RangeStartAndEndDateTime =
        options?.overrideTimeRange ||
        resolveLogSavedViewTimeRange({
          timeRange: savedView.timeRange,
          query: savedQuery,
        });

      const merged: JSONObject = {
        ...(savedQuery as unknown as JSONObject),
        ...(baseQuery as unknown as JSONObject),
      };

      if (options?.overrideFacetFilters) {
        /*
         * Chip-able keys the override does not mention are cleared off the
         * saved query first. applyLogsFacetFiltersToQuery only ever WRITES
         * the keys a selection holds — it cannot know that a service the
         * saved view carried was deselected somewhere else — so without this
         * a scope narrowed on the Insights tab would come back widened by
         * whatever the view originally had. Keys the host imposed through
         * baseQuery are left alone: those are the page's scope, not the
         * view's.
         */
        for (const facetKey of FACET_FILTER_KEYS) {
          if ((baseQuery as any)[facetKey] === undefined) {
            delete merged[facetKey];
          }
        }
        delete merged["resourceFilters"];
      }

      const mergedQuery: Query<Log> = withResolvedTime(
        merged as unknown as Query<Log>,
        nextTimeRange,
      );

      const nextFacetFilters: Map<
        string,
        Set<string>
      > = options?.overrideFacetFilters ||
      buildFacetFiltersFromQuery(mergedQuery, baseQuery);

      setTimeRange(nextTimeRange);

      setAppliedFacetFilters(nextFacetFilters);
      setFilterOptions(
        options?.overrideFacetFilters
          ? applyLogsFacetFiltersToQuery(mergedQuery, nextFacetFilters)
          : mergedQuery,
      );
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

  /*
   * Deselect the active saved view and put the explorer back where it starts.
   * Every field applying a view writes is written back to its default — see
   * buildClearedLogsViewState, which owns that answer so it can be tested
   * without a renderer.
   */
  const clearSavedView: () => void = useCallback((): void => {
    const cleared: ClearedLogsViewState = buildClearedLogsViewState({
      baseQuery: buildBaseQuery(props),
      defaultPageSize: effectiveDefaultPageSize,
      hostTimeRange: pinnedTimeRange || props.timeRangeOverride,
    });

    setTimeRange(cleared.timeRange);
    setAppliedFacetFilters(cleared.facetFilters);
    setFilterOptions(cleared.filterOptions);
    setPage(cleared.page);
    setPageSize(cleared.pageSize);
    setSortField(cleared.sortField);
    setSortOrder(cleared.sortOrder);
    setSelectedColumns(cleared.columns);
    setSelectedSavedViewId(null);
    disableLiveMode();
  }, [props, pinnedTimeRange, effectiveDefaultPageSize, disableLiveMode]);

  // --- Effects ---

  /*
   * Adopt a controlled window change from the host. Value-gated: the echo of
   * a window this viewer just lifted through onTimeRangeChange compares
   * equal and is skipped, which is what breaks the feedback loop. Unlike the
   * pinned-logQuery path above, this keeps the applied chip filters — only
   * the `time` predicate moves.
   *
   * Keyed on the override value ALONE (matching MetricsViewer/TracesViewer):
   * the live-mode teardown is inlined instead of calling disableLiveMode,
   * whose useCallback identity changes on every live toggle — listing it
   * here would replay adoption against an UNCHANGED override and yank a
   * hand-picked saved view's window back to the host cursor.
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
    const override: RangeStartAndEndDateTime = props.timeRangeOverride!;
    setTimeRange(override);
    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(override);
    setFilterOptions((previous: Query<Log>): Query<Log> => {
      const next: Query<Log> = { ...previous };
      (next as any).time = new InBetween<Date>(
        dateRange.startValue,
        dateRange.endValue,
      );
      return next;
    });
    setPage(1);
    setIsLiveEnabled(false);
    liveRequestInFlight.current = false;
    setIsLiveUpdating(false);
  }, [props.timeRangeOverride]);

  useEffect(() => {
    fetchItems().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [fetchItems]);

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
    if (hasAppliedInitialSavedView.current || !hasFetchedSavedViews) {
      return;
    }

    hasAppliedInitialSavedView.current = true;

    /*
     * Precedence lives in resolveInitialSavedView so it can be pinned in
     * tests: a view the link named wins; a link that carries its own scope
     * is left alone; a host-owned window (an incident's pinned moment, the
     * entity hub's cursor) is left alone; otherwise the project default
     * applies as it always has.
     */
    const resolution: InitialSavedViewResolution<LogSavedView> =
      resolveInitialSavedView<LogSavedView>({
        savedViews,
        getId: (savedView: LogSavedView): string | null => {
          return savedView.id?.toString() || null;
        },
        isDefault: (savedView: LogSavedView): boolean => {
          return Boolean(savedView.isDefault);
        },
        urlSavedViewId: initialUrlState?.savedViewId,
        hasUrlScope: Boolean(initialUrlState?.hasScope),
        /*
         * `!syncUrlState` is this viewer's marker for "embedded in another
         * page" — an incident, an alert, a service's Logs tab. The project
         * default view is a standalone-explorer idea (it is what the Traces
         * and Metrics explorers already mean by enableSavedViews): applying
         * one inside a service's Logs tab would silently re-window and
         * re-filter a panel the user opened to see that service's logs. A
         * view the URL NAMES still applies anywhere, because that is the
         * user asking for it.
         */
        hostOwnsView: Boolean(
          pinnedTimeRange || props.timeRangeOverride || !props.syncUrlState,
        ),
      });

    if (resolution.savedView) {
      applySavedView(
        resolution.savedView,
        /*
         * A view the URL named is applied UNDER the scope the same URL
         * carries; a project default (nobody asked for it) is applied as
         * saved.
         */
        resolution.source === "url" && initialUrlState?.hasScope
          ? {
              overrideTimeRange: initialUrlState.hasRange
                ? initialUrlState.timeRange
                : undefined,
              overrideFacetFilters: initialUrlState.hasFilters
                ? initialUrlState.facetFilters
                : undefined,
            }
          : undefined,
      );
    }
  }, [
    applySavedView,
    hasFetchedSavedViews,
    savedViews,
    pinnedTimeRange,
    props.timeRangeOverride,
    props.syncUrlState,
    initialUrlState,
  ]);

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

  /*
   * Live polling. The list and the histogram come from different endpoints,
   * so both have to be refreshed on the same beat — otherwise new rows keep
   * arriving under a chart that never moves.
   */
  useLiveLogsRefresh({
    isLive: isLiveEnabled,
    isEligible:
      page === 1 && sortField === "time" && sortOrder === SortOrder.Descending,
    intervalInMs: LIVE_POLL_INTERVAL_MS,
    refreshLogs: () => {
      void fetchItems({ skipLoadingState: true });
    },
    refreshHistogram: () => {
      void histogram.refresh({ silent: true });
    },
  });

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
      // User-initiated (drag-zoom) — lift to a controlling host.
      props.onTimeRangeChange?.(customRange);
    },
    [filterOptions, disableLiveMode, props.onTimeRangeChange],
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
      // User-initiated (the time picker) — lift to a controlling host.
      props.onTimeRangeChange?.(newTimeRange);
    },
    [filterOptions, disableLiveMode, props.onTimeRangeChange],
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

      /*
       * One shared compilation (facet chips -> query predicates) for this
       * interaction path AND the URL-hydration paths above, so a deep link
       * and a hand-applied chip always produce the same list query.
       */
      return applyLogsFacetFiltersToQuery(updatedFilter, facets);
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

      return buildTraceViewRoute(traceId);
    }, []);

  const getSpanRoute: (spanId: string, log: Log) => Route | URL | undefined =
    useCallback((spanId: string, log: Log): Route | URL | undefined => {
      const traceId: string | undefined = log.traceId?.toString();

      if (!spanId || !traceId) {
        return undefined;
      }

      return buildTraceViewRoute(traceId, spanId);
    }, []);

  /*
   * spanId-only logs can't build a trace route synchronously, so the owning
   * trace is looked up once per span id — on click/expand, cached, and cheap
   * on the server side (idx_span_id).
   */
  const spanTraceIdCacheRef: React.MutableRefObject<
    Map<string, string | null>
  > = useRef<Map<string, string | null>>(new Map());

  const resolveSpanRoute: (
    spanId: string,
    log: Log,
  ) => Promise<Route | URL | undefined> = useCallback(
    async (spanId: string, log: Log): Promise<Route | URL | undefined> => {
      const syncRoute: Route | URL | undefined = getSpanRoute(spanId, log);

      if (syncRoute) {
        return syncRoute;
      }

      if (!spanId) {
        return undefined;
      }

      let traceId: string | null | undefined =
        spanTraceIdCacheRef.current.get(spanId);

      if (traceId === undefined) {
        try {
          const listResult: ListResult<Span> =
            await AnalyticsModelAPI.getList<Span>({
              modelType: Span,
              query: { spanId: spanId } as Query<Span>,
              limit: 1,
              skip: 0,
              select: {
                traceId: true,
              },
              sort: {},
            });

          traceId = extractTraceIdFromSpans(listResult.data);
        } catch {
          // Left uncached so a transient failure can retry on the next click.
          return undefined;
        }

        spanTraceIdCacheRef.current.set(spanId, traceId);
      }

      if (!traceId) {
        return undefined;
      }

      return buildTraceViewRoute(traceId, spanId);
    },
    [getSpanRoute],
  );

  /*
   * The session replay route needs the rumApplicationId, which a bare log row
   * doesn't carry — resolved lazily (the details panel calls this on expand)
   * via one RumSession lookup by session id, and cached.
   */
  const sessionRumApplicationIdCacheRef: React.MutableRefObject<
    Map<string, string | null>
  > = useRef<Map<string, string | null>>(new Map());

  const getSessionRoute: (
    sessionId: string,
    log: Log,
  ) => Promise<Route | URL | undefined> = useCallback(
    async (sessionId: string, _log: Log): Promise<Route | URL | undefined> => {
      if (!sessionId) {
        return undefined;
      }

      let rumApplicationId: string | null | undefined =
        sessionRumApplicationIdCacheRef.current.get(sessionId);

      if (rumApplicationId === undefined) {
        try {
          const listResult: ListResult<RumSession> =
            await AnalyticsModelAPI.getList<RumSession>({
              modelType: RumSession,
              query: { sessionId: sessionId } as Query<RumSession>,
              limit: 1,
              skip: 0,
              select: {
                rumApplicationId: true,
              },
              sort: {},
            });

          rumApplicationId = extractRumApplicationIdFromRumSessions(
            listResult.data,
          );
        } catch {
          // Left uncached so a transient failure can retry on the next expand.
          return undefined;
        }

        sessionRumApplicationIdCacheRef.current.set(
          sessionId,
          rumApplicationId,
        );
      }

      if (!rumApplicationId) {
        return undefined;
      }

      return buildSessionReplayRoute(rumApplicationId, sessionId);
    },
    [],
  );

  /*
   * Cross-signal pivots: carry the CURRENT view (base scope, applied facet
   * chips, attribute filters, time window) to the traces / metrics explorer
   * through the CrossSignalScope serializers. Fields the target grammar
   * cannot express are surfaced in the button tooltip, never dropped
   * silently.
   */
  const pivotScopeInput: LogsPivotScopeInput = useMemo(() => {
    return {
      serviceIds: serviceIdStrings,
      traceIds: traceIdStrings,
      spanIds: spanIdStrings,
      sessionIds: sessionIdStrings,
      attributes: logQueryAttributes,
      appliedFacetFilters: appliedFacetFilters,
      timeRange: timeRange,
    };
  }, [
    serviceIdStrings,
    traceIdStrings,
    spanIdStrings,
    sessionIdStrings,
    logQueryAttributes,
    appliedFacetFilters,
    timeRange,
  ]);

  const navigateToExplorer: (
    pageMap: PageMap,
    params: Dictionary<string>,
  ) => void = useCallback(
    (pageMap: PageMap, params: Dictionary<string>): void => {
      const route: Route = RouteUtil.populateRouteParams(RouteMap[pageMap]!);
      const currentUrl: URL = Navigation.getCurrentURL();
      const targetUrl: URL = new URL(
        currentUrl.protocol,
        currentUrl.hostname,
        route,
      );

      for (const paramName of Object.keys(params)) {
        targetUrl.addQueryParam(paramName, params[paramName] as string, true);
      }

      Navigation.navigate(targetUrl);
    },
    [],
  );

  const buildTracesPivot: () => CrossSignalQueryParams =
    useCallback((): CrossSignalQueryParams => {
      const { scope, dropped }: LogsPivotScopeResult =
        buildLogsPivotScope(pivotScopeInput);
      const serialized: CrossSignalQueryParams =
        toTracesExplorerQueryParams(scope);

      return {
        params: serialized.params,
        dropped: mergeDroppedScopeFields(dropped, serialized.dropped),
      };
    }, [pivotScopeInput]);

  const buildMetricsPivot: () => CrossSignalQueryParams =
    useCallback((): CrossSignalQueryParams => {
      const { scope, dropped }: LogsPivotScopeResult =
        buildLogsPivotScope(pivotScopeInput);
      const serialized: CrossSignalQueryParams =
        toMetricsExplorerQueryParams(scope);

      return {
        params: serialized.params,
        dropped: mergeDroppedScopeFields(dropped, serialized.dropped),
      };
    }, [pivotScopeInput]);

  const signalPivotActions: Array<LogsSignalPivotAction> = useMemo(() => {
    const buildTooltip: (baseText: string, dropped: Array<string>) => string = (
      baseText: string,
      dropped: Array<string>,
    ): string => {
      const hint: string = formatDroppedScopeHint(dropped);
      return hint ? `${baseText} — ${hint}` : baseText;
    };

    return [
      {
        id: "logs-pivot-traces",
        label: "Traces",
        icon: IconProp.Layers,
        tooltip: buildTooltip(
          "Open the traces explorer with this scope",
          buildTracesPivot().dropped,
        ),
        onClick: () => {
          // Rebuilt at click time so a preset window resolves against "now".
          navigateToExplorer(PageMap.TRACES, buildTracesPivot().params);
        },
      },
      {
        id: "logs-pivot-metrics",
        label: "Metrics",
        icon: IconProp.ChartBar,
        tooltip: buildTooltip(
          "Open the metrics explorer with this time window",
          buildMetricsPivot().dropped,
        ),
        onClick: () => {
          /*
           * METRIC_VIEW (the metric explorer), not the METRICS list page —
           * only the explorer parses the metricQueries/startTime/endTime
           * grammar this pivot emits. A scope with no attribute filters
           * carries the window alone: the serializer omits metricQueries
           * entirely (isMeaningfulMetricQuery), and the explorer treats the
           * absolute window params as a pinned Custom range.
           */
          navigateToExplorer(PageMap.METRIC_VIEW, buildMetricsPivot().params);
        },
      },
    ];
  }, [buildTracesPivot, buildMetricsPivot, navigateToExplorer]);

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
    if (facetData["primaryEntityId"]) {
      suggestions["primaryEntityId"] = facetData["primaryEntityId"].map(
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
        // Map user-facing field names to internal keys (case-insensitive)
        const fieldAliases: Record<string, string> = {
          severity: "severityText",
          level: "severityText",
          service: "primaryEntityId",
          trace: "traceId",
          span: "spanId",
        };
        /*
         * Unknown keys are telemetry attributes (e.g. `http.method`,
         * `requestId`). Prefix them with `attributes.` so the rebuild step
         * routes them into `query.attributes[<key>]` instead of treating them
         * as top-level columns. We preserve the original case of the key
         * because attribute keys can be camelCase (`requestId`); the backend
         * matches them case-insensitively. The chip displays without the
         * `attributes.` prefix.
         */
        const aliased: string | undefined =
          fieldAliases[fieldKey.toLowerCase()];
        const resolvedKey: string = aliased
          ? aliased
          : `attributes.${fieldKey}`;

        handleFacetInclude(resolvedKey, value);
      },
      [handleFacetInclude],
    );

  // Build read-only base filter chips from props (serviceIds, traceIds, spanIds, logQuery attributes)
  const baseActiveFilters: Array<ActiveFilter> = useMemo(() => {
    const filters: Array<ActiveFilter> = [];

    if (props.serviceIds && props.serviceIds.length > 0) {
      for (const primaryEntityId of props.serviceIds) {
        const serviceIdString: string = primaryEntityId.toString();
        filters.push({
          facetKey: "primaryEntityId",
          value: serviceIdString,
          displayKey: "Service",
          displayValue:
            scopedServiceNameMap[serviceIdString] || serviceIdString,
          readOnly: true,
        });
      }
    }

    if (props.traceIds && props.traceIds.length > 0) {
      for (const traceId of props.traceIds) {
        filters.push({
          facetKey: "traceId",
          value: traceId,
          displayKey: "Trace",
          displayValue: traceId,
          readOnly: true,
          openRoute: buildTraceViewRoute(traceId),
        });
      }
    }

    if (props.spanIds && props.spanIds.length > 0) {
      for (const spanId of props.spanIds) {
        filters.push({
          facetKey: "spanId",
          value: spanId,
          displayKey: "Span",
          displayValue: spanId,
          readOnly: true,
          openRoute: buildSpanChipOpenRoute(spanId, traceIdStrings),
        });
      }
    }

    if (props.sessionIds && props.sessionIds.length > 0) {
      for (const sessionId of props.sessionIds) {
        filters.push({
          facetKey: "sessionId",
          value: sessionId,
          displayKey: "Session",
          displayValue: sessionId,
          readOnly: true,
        });
      }
    }

    filters.push(...buildAttributeFilterChips(logQueryAttributes));

    return filters;
  }, [
    props.serviceIds,
    props.traceIds,
    props.spanIds,
    props.sessionIds,
    traceIdStrings,
    logQueryAttributes,
    scopedServiceNameMap,
  ]);

  // Build activeFilters array for UI display
  const activeFilters: Array<ActiveFilter> = useMemo(() => {
    const filters: Array<ActiveFilter> = [];

    const facetKeyDisplayNames: Record<string, string> = {
      severityText: "Severity",
      primaryEntityId: "Service",
      hostId: "Host",
      dockerHostId: "Docker Host",
      podmanHostId: "Podman Host",
      kubernetesClusterId: "Kubernetes Cluster",
      traceId: "Trace",
      spanId: "Span",
      /*
       * The one chip whose value is a substring rather than an exact id —
       * "Message contains" says so, since "body: connection refused" reads
       * like an equality the filter is not.
       */
      body: "Message contains",
    };

    /*
     * A span chip only links out when the view pins down exactly one trace —
     * either the base scope or an applied trace filter.
     */
    const candidateTraceIds: Array<string> = [
      ...(traceIdStrings || []),
      ...Array.from(appliedFacetFilters.get("traceId") || []),
    ];

    for (const [facetKey, values] of appliedFacetFilters.entries()) {
      // Strip the `attributes.` prefix so the chip reads as `<key>: <value>`.
      const displayKey: string = facetKey.startsWith("attributes.")
        ? facetKey.substring("attributes.".length)
        : facetKeyDisplayNames[facetKey] || facetKey;

      const isAttributeFacet: boolean = facetKey.startsWith(
        ATTRIBUTE_FACET_PREFIX,
      );

      for (const value of values) {
        const openRoute: Route | undefined =
          facetKey === "traceId"
            ? buildTraceViewRoute(value)
            : facetKey === "spanId"
              ? buildSpanChipOpenRoute(value, candidateTraceIds)
              : undefined;

        filters.push({
          facetKey,
          value,
          displayKey,
          /*
           * An attribute chip stores the value in the search grammar, so a
           * literal asterisk arrives escaped (`a\*b`). The chip has to show
           * the value the user typed, not its escaping.
           */
          displayValue: isAttributeFacet ? describeSearchValue(value) : value,
          openRoute,
        });
      }
    }

    return filters;
  }, [appliedFacetFilters, traceIdStrings]);

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
            /*
             * The selection, not the window it currently resolves to — a
             * rolling range has to still be rolling when the view is applied.
             */
            savedView.timeRange = serializeSavedViewTimeRange(timeRange);
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
          resolveSpanRoute={resolveSpanRoute}
          getSessionRoute={getSessionRoute}
          signalPivotActions={signalPivotActions}
          histogramBuckets={histogram.buckets}
          histogramLoading={histogram.isLoading}
          onHistogramTimeRangeSelect={handleHistogramTimeRangeSelect}
          facetData={facetData}
          facetLoading={facetLoading}
          onFacetInclude={handleFacetInclude}
          onFacetExclude={handleFacetExclude}
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
          showFacetSidebar={true}
          activeFilters={activeFilters}
          baseActiveFilters={baseActiveFilters}
          onRemoveFilter={handleRemoveFilter}
          onClearAllFilters={handleClearAllFilters}
          valueSuggestions={valueSuggestions}
          onFieldValueSelect={handleFieldValueSelect}
          timeRange={timeRange}
          onTimeRangeChange={handleTimeRangeChange}
          onShowDocumentation={props.onShowDocumentation}
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
          onClearSavedView={clearSavedView}
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
          analyticsSessionIds={sessionIdStrings}
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
                /*
                 * Every value here is JSON data, but a Query and a
                 * TelemetrySavedViewTimeRange are declared as interfaces, so
                 * neither carries the index signature JSONObject requires and
                 * a direct cast does not compile. Hopping through unknown is
                 * what the rest of this file does with the same shapes.
                 */
                data: JSONFunctions.serialize({
                  query: filterOptions,
                  timeRange: serializeSavedViewTimeRange(timeRange),
                  columns: selectedColumns,
                  sortField: sortField,
                  sortOrder: sortOrder,
                  pageSize: pageSize,
                } as unknown as JSONObject) as JSONObject,
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
