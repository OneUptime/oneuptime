import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import TelemetryViewer from "Common/UI/Components/TelemetryViewer/TelemetryViewer";
import TelemetryLoadErrorUtil, {
  TelemetryLoadError,
} from "Common/UI/Utils/Telemetry/TelemetryLoadError";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
  FacetValue,
  HistogramBucket,
  HistogramSeriesOption,
  SearchHelpRow,
} from "Common/UI/Components/TelemetryViewer/types";
import Service from "Common/Models/DatabaseModels/Service";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, {
  ListResult as ModelListResult,
} from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import useAttributeValueSuggestions, {
  AttributeValueSuggestionsState,
} from "Common/UI/Utils/Telemetry/UseAttributeValueSuggestions";
import { getTimeRangeScope } from "Common/UI/Utils/Telemetry/AttributeValueSuggestions";
import {
  parseTelemetryFilterTuples,
  serializeTelemetryFilterTuplesAsPairs,
  TelemetryFilterTuple,
} from "../../Utils/TelemetryTabScope";
import { writeTelemetryViewerUrlState } from "../../Utils/TelemetryViewerUrlState";
import SecurityEventAttributeUtil from "./SecurityEventAttributeUtil";
import SecurityEventAttributeColumnPicker from "./SecurityEventAttributeColumnPicker";
import {
  SecurityEventAttributeColumn,
  buildSecurityEventAttributeColumns,
  mergeSecurityEventAttributeKeys,
  normalizeSecurityEventAttributeColumnKeys,
  readSecurityEventAttributeColumnKeys,
  toggleSecurityEventAttributeColumnKey,
  writeSecurityEventAttributeColumnKeys,
} from "./SecurityEventAttributeColumns";
import SecurityEventDetailPanel from "./SecurityEventDetailPanel";
import SecurityEventListRow from "./SecurityEventListRow";
import SecurityEventsEmptyState from "./SecurityEventsEmptyState";
import SecurityEventsNoResults from "./SecurityEventsNoResults";
import {
  SECURITY_EVENT_FACET_KEYS,
  applySecurityEventFacetFiltersToQuery,
  buildSecurityEventFacetAggregateBy,
  buildSecurityEventFacetConfigs,
  buildSecurityEventFacetValues,
  getSecurityEventFacetChipDisplayKey,
  getSecurityEventFacetChipDisplayValue,
  toSecurityEventExcludeFacetKey,
  SECURITY_EVENT_FACET_VALUE_LIMIT,
} from "./SecurityEventsFacets";
import {
  SECURITY_EVENT_SEARCH_COMBINED_EXAMPLE,
  SECURITY_EVENT_SEARCH_HELP_ROWS,
  SECURITY_EVENT_SEARCH_PLACEHOLDER,
  SECURITY_EVENT_SEARCH_SUGGESTIONS,
  SECURITY_EVENT_FIELD_ALIASES,
  SECURITY_EVENT_SEARCH_FIELD_KEYS,
  SecurityEventSearchFilters,
  applySecurityEventSearchToQuery,
  parseSecurityEventSearch,
} from "./SecurityEventsSearchQuery";
import {
  SecurityEventVolume,
  buildSecurityEventVolumeAggregateBy,
  buildSecurityEventVolumeFromResult,
  getSecurityEventVolumeSeries,
} from "./SecurityEventVolume";
import {
  SECURITY_EVENTS_RANGE_PARAM,
  getSecurityEventsTimeRangeParams,
  parseLegacyTableAttributeFilters,
  readSecurityEventsTimeRange,
} from "./SecurityEventsTimeRange";
import {
  SecurityHuntFilters,
  securityHuntFiltersToMap,
} from "Common/Types/SecurityEvent/SecurityHunt";
import { HuntSearchState } from "./Hunts/HuntsModel";
import { EVENT_PLURAL, EVENT_SINGULAR } from "./Hunts/HuntsCopy";
import SaveAsHuntButton from "./Hunts/SaveAsHuntButton";
import useAddEventsToCase, {
  AddEventsToCaseActions,
} from "./Hunts/useAddEventsToCase";

export const SECURITY_EVENTS_VIEWER_TEST_ID: string = "security-events-viewer";

export const SECURITY_EVENTS_VOLUME_TOTAL_TEST_ID: string =
  "security-events-volume-total";

const DEFAULT_PAGE_SIZE: number = 50;
const LIVE_POLL_INTERVAL_MS: number = 15000;

/*
 * Every field the row and the detail panel read has to be on the wire
 * whether or not it is visible, because both render straight off the listed
 * row rather than refetching the event they were handed.
 */
const LIST_SELECT: Select<SecurityEvent> = {
  time: true,
  eventUid: true,
  severityName: true,
  severityId: true,
  categoryName: true,
  categoryUid: true,
  className: true,
  classUid: true,
  activityName: true,
  statusName: true,
  message: true,
  vendorName: true,
  productName: true,
  ruleId: true,
  ruleName: true,
  mitreTactics: true,
  mitreTechniques: true,
  principalUser: true,
  principalHost: true,
  principalIp: true,
  principalProcess: true,
  processName: true,
  processPath: true,
  processCommandLine: true,
  parentProcessName: true,
  parentProcessPath: true,
  parentProcessCommandLine: true,
  targetUser: true,
  targetHost: true,
  targetIp: true,
  targetPort: true,
  targetResource: true,
  observables: true,
  traceId: true,
  spanId: true,
  sessionId: true,
  requestOutcome: true,
  attributes: true,
};

/*
 * What the project's newest event says about an empty list:
 *  - undefined: not asked yet, or the lookup failed
 *  - null:      the project has never received a security event
 *  - Date:      it has, and this is when the newest one arrived
 */
type LatestEventTime = Date | null | undefined;

interface InitialUrlState {
  timeRange: RangeStartAndEndDateTime;
  facetFilters: Map<string, Set<string>>;
  search: string;
  page: number;
  pageSize: number;
}

/*
 * Hoisted: eslint's wrap-regex wants an inline regex parenthesised and
 * prettier wants the parentheses gone, and the two rules fight forever over
 * the same line.
 */
const POSITIVE_INT_REGEX: RegExp = /^\d+$/;

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw || !POSITIVE_INT_REGEX.test(raw)) {
    return fallback;
  }

  const parsed: number = Number(raw);

  return parsed > 0 ? parsed : fallback;
}

/*
 * A hunt opened on its page (Pages/SecurityEvents/HuntView): what it keeps -
 * its search, its chips and the window it opens on - which the page starts
 * from when its address says nothing else.
 */
export interface SecurityEventsViewerHunt {
  id: ObjectID;
  searchQuery: string;
  filters: SecurityHuntFilters;
  timeRange: RangeStartAndEndDateTime;
}

export interface ComponentProps {
  hunt?: SecurityEventsViewerHunt | undefined;
  /*
   * Told what the page searches - its submitted search, its chips and its
   * window - each time one changes: a hunt's page compares it with what the
   * hunt keeps.
   */
  onSearchStateChange?: ((state: HuntSearchState) => void) | undefined;
}

/*
 * Where the page starts: its address (a shared link, a refresh, Back), and,
 * on a hunt's page, the hunt where the address says nothing - its search
 * and chips when the address names neither, its window when it names none
 * (a notification's link names the window its run read, and the hunt's
 * search with it).
 */
function readInitialUrlState(
  search: string,
  hunt?: SecurityEventsViewerHunt | undefined,
): InitialUrlState {
  const params: URLSearchParams = new URLSearchParams(search);
  const startsFromHunt: boolean = Boolean(
    hunt && !params.has("search") && !params.has("filters"),
  );

  const facetFilters: Map<string, Set<string>> = new Map();

  const addFilter: (facetKey: string, value: string) => void = (
    facetKey: string,
    value: string,
  ): void => {
    const existing: Set<string> = facetFilters.get(facetKey) || new Set();
    existing.add(value);
    facetFilters.set(facetKey, existing);
  };

  for (const tuple of parseTelemetryFilterTuples(params.get("filters"))) {
    for (const value of tuple[1]) {
      addFilter(tuple[0], value);
    }
  }

  /*
   * A link written for the model table this explorer replaced — the
   * connection diagnostics' "view these events" among them — still names its
   * attribute filter in the table's own param. Read back as chips so an old
   * link narrows the list rather than quietly opening all of it.
   */
  for (const [facetKey, value] of parseLegacyTableAttributeFilters(search)) {
    addFilter(facetKey, value);
  }

  return {
    timeRange:
      hunt && !params.has(SECURITY_EVENTS_RANGE_PARAM)
        ? hunt.timeRange
        : readSecurityEventsTimeRange(search),
    facetFilters:
      startsFromHunt && hunt
        ? securityHuntFiltersToMap(hunt.filters)
        : facetFilters,
    search:
      startsFromHunt && hunt ? hunt.searchQuery : params.get("search") || "",
    page: parsePositiveInt(params.get("page"), 1),
    pageSize: parsePositiveInt(params.get("pageSize"), DEFAULT_PAGE_SIZE),
  };
}

function toFilterTuples(
  filters: Map<string, Set<string>>,
): Array<TelemetryFilterTuple> {
  return Array.from(filters.entries())
    .map((entry: [string, Set<string>]): TelemetryFilterTuple => {
      return [entry[0], Array.from(entry[1])];
    })
    .filter((tuple: TelemetryFilterTuple): boolean => {
      return tuple[1].length > 0;
    });
}

/*
 * Security Events, as a telemetry explorer.
 *
 * The same shell the traces, metrics and exceptions explorers render — search
 * bar, facet sidebar, severity-stacked volume histogram, dense list rows, a
 * detail drawer and pagination — over the SecurityEvent ClickHouse table.
 * The list, the histogram and the facet counts are all built from ONE query,
 * so the chart never counts events the list would not show and a facet count
 * never promises rows a click cannot reach.
 *
 * What is on screen can be kept: Save as Hunt on the toolbar saves the
 * search as a hunt (Hunts/SaveAsHuntButton), and the events ticked are
 * kept on a case with Add to Case (Hunts/useAddEventsToCase), as one is from
 * its panel. On a hunt's page (`hunt`) the search starts as the hunt keeps
 * it, the page says what it searches as it changes, and what is kept on a
 * case names the hunt that found it.
 */
const SecurityEventsViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  const [initialUrlState] = useState<InitialUrlState>((): InitialUrlState => {
    return readInitialUrlState(Navigation.getQueryString(), props.hunt);
  });

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    initialUrlState.timeRange,
  );

  /*
   * A relative range ("Past 1 Day") is turned into dates once per pick, not
   * once per render: the dates are part of the query, and a query that moved
   * every render would refetch forever. Refresh re-reads it from now by
   * bumping windowVersion.
   */
  const [windowVersion, setWindowVersion] = useState<number>(0);

  /*
   * A custom window re-read from now is the same window, so the query does
   * not change and nothing would refetch. Refresh bumps this instead, which
   * every fetch below depends on.
   */
  const [refreshVersion, setRefreshVersion] = useState<number>(0);

  /*
   * windowVersion is a dependency on purpose and is read by nothing inside:
   * bumping it is how Refresh and the live poll re-resolve a RELATIVE range
   * against the clock, which produces new dates from an unchanged timeRange.
   */
  const timeWindow: InBetween<Date> = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
  }, [timeRange, windowVersion]);

  const [searchValue, setSearchValue] = useState<string>(
    initialUrlState.search,
  );
  const [submittedSearch, setSubmittedSearch] = useState<string>(
    initialUrlState.search,
  );

  const [facetFilters, setFacetFilters] = useState<Map<string, Set<string>>>(
    initialUrlState.facetFilters,
  );

  const [page, setPage] = useState<number>(initialUrlState.page);
  const [pageSize, setPageSize] = useState<number>(initialUrlState.pageSize);

  const [events, setEvents] = useState<Array<SecurityEvent>>([]);
  /*
   * The list endpoint's `count`: a lower bound, not a total (it skips
   * COUNT(*)), so the footer pages on `hasMore` instead of numbering pages
   * by it. The window's total is the volume chart's, in its header.
   */
  const [totalCount, setTotalCount] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  /*
   * Why the list did not load (issue #4707): a search that took too long
   * says so where the rows go, with the filters left to narrow it.
   */
  const [error, setError] = useState<TelemetryLoadError | undefined>(undefined);
  // Why the volume chart did not load; it says so in its own card.
  const [volumeError, setVolumeError] = useState<
    TelemetryLoadError | undefined
  >(undefined);
  // Facets the time limit stopped, and why the facets did not load at all.
  const [timedOutFacets, setTimedOutFacets] = useState<Array<string>>([]);
  const [facetError, setFacetError] = useState<TelemetryLoadError | undefined>(
    undefined,
  );

  const [volume, setVolume] = useState<SecurityEventVolume | null>(null);
  const [isVolumeLoading, setIsVolumeLoading] = useState<boolean>(true);

  const [facetData, setFacetData] = useState<FacetData>({});
  const [facetLoading, setFacetLoading] = useState<boolean>(true);

  const [isLive, setIsLive] = useState<boolean>(false);
  const [selectedEvent, setSelectedEvent] = useState<SecurityEvent | null>(
    null,
  );

  const [attributeKeys, setAttributeKeys] = useState<Array<string>>([]);
  const [attributesLoading, setAttributesLoading] = useState<boolean>(false);
  // The key list could not load: the `@key:` value picker then asks for any key.
  const [attributesFailed, setAttributesFailed] = useState<boolean>(false);

  const [latestEventTime, setLatestEventTime] =
    useState<LatestEventTime>(undefined);

  /*
   * The source attributes this viewer chose to see on every row. Read once
   * per mount; every change is written straight back, so the choice follows
   * them to the next visit.
   */
  const [attributeColumnKeys, setAttributeColumnKeys] = useState<Array<string>>(
    (): Array<string> => {
      return readSecurityEventAttributeColumnKeys(projectId?.toString() || "");
    },
  );

  /*
   * Source id -> Service name. The aggregate route can only hand back the
   * ObjectID a row is attributed to, so the Source facet and its chips are
   * named from Postgres here — exactly as the other explorers name their
   * Service facet.
   */
  const [sourceNames, setSourceNames] = useState<Record<string, string>>({});

  /*
   * Results for a query the page has since left must not land on the new
   * one; each fetch takes a ticket and only the newest may write.
   */
  const listRequestId: React.MutableRefObject<number> = useRef<number>(0);
  const volumeRequestId: React.MutableRefObject<number> = useRef<number>(0);
  const facetRequestId: React.MutableRefObject<number> = useRef<number>(0);

  // --- The one query everything is built from ---

  const searchFilters: SecurityEventSearchFilters = useMemo(() => {
    return parseSecurityEventSearch(submittedSearch);
  }, [submittedSearch]);

  const listQuery: Query<SecurityEvent> = useMemo(() => {
    const base: Query<SecurityEvent> = {
      projectId: projectId,
      time: new InBetween<Date>(timeWindow.startValue, timeWindow.endValue),
    } as Query<SecurityEvent>;

    /*
     * Search first, chips second: a chip is an explicit click on a value the
     * user can see and remove, so when both name the same column the chip is
     * the one they are steering with.
     */
    return applySecurityEventFacetFiltersToQuery({
      query: applySecurityEventSearchToQuery({
        query: base,
        filters: searchFilters,
      }),
      filters: facetFilters,
    });
  }, [projectId?.toString(), timeWindow, searchFilters, facetFilters]);

  // --- What the page searches, for a hunt's page ---

  useEffect(() => {
    props.onSearchStateChange?.({
      search: submittedSearch,
      filters: facetFilters,
      timeRange: timeRange,
    });
  }, [submittedSearch, facetFilters, timeRange]);

  // --- Keeping events on a case ---

  const addToCase: AddEventsToCaseActions = useAddEventsToCase({
    huntId: props.hunt?.id,
  });

  // --- URL state ---

  useEffect(() => {
    const tuples: Array<TelemetryFilterTuple> = toFilterTuples(facetFilters);

    writeTelemetryViewerUrlState({
      ...(getSecurityEventsTimeRangeParams(timeRange) as Dictionary<
        string | null
      >),
      filters: serializeTelemetryFilterTuplesAsPairs(tuples),
      search: submittedSearch ? submittedSearch : null,
      page: page > 1 ? page.toString() : null,
      pageSize: pageSize !== DEFAULT_PAGE_SIZE ? pageSize.toString() : null,
    });
  }, [timeRange, facetFilters, submittedSearch, page, pageSize]);

  // --- List ---

  const fetchEvents: (options?: {
    skipLoadingState?: boolean | undefined;
  }) => Promise<void> = useCallback(
    async (options?: {
      skipLoadingState?: boolean | undefined;
    }): Promise<void> => {
      const requestId: number = ++listRequestId.current;

      if (!options?.skipLoadingState) {
        setIsLoading(true);
      }

      try {
        const result: ListResult<SecurityEvent> =
          await AnalyticsModelAPI.getList<SecurityEvent>({
            modelType: SecurityEvent,
            query: listQuery,
            limit: pageSize,
            skip: (page - 1) * pageSize,
            select: LIST_SELECT,
            sort: { time: SortOrder.Descending },
          });

        if (requestId !== listRequestId.current) {
          return;
        }

        setEvents(result.data);
        setTotalCount(result.count);
        setHasMore(result.hasMore);
        setError(undefined);
      } catch (err) {
        if (requestId !== listRequestId.current) {
          return;
        }

        setError(TelemetryLoadErrorUtil.fromError(err));
        setEvents([]);
        setTotalCount(0);
        setHasMore(false);
      } finally {
        if (requestId === listRequestId.current) {
          setIsLoading(false);
        }
      }
    },
    [listQuery, page, pageSize],
  );

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents, refreshVersion]);

  // --- Histogram ---

  const fetchVolume: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestId: number = ++volumeRequestId.current;
      const startDate: Date = new Date(timeWindow.startValue);
      const endDate: Date = new Date(timeWindow.endValue);

      setIsVolumeLoading(true);

      try {
        const result: AggregatedResult =
          await AnalyticsModelAPI.aggregate<SecurityEvent>({
            modelType: SecurityEvent,
            aggregateBy: buildSecurityEventVolumeAggregateBy({
              query: listQuery,
              startDate: startDate,
              endDate: endDate,
            }),
          });

        if (requestId !== volumeRequestId.current) {
          return;
        }

        setVolume(
          buildSecurityEventVolumeFromResult({
            result: result,
            startDate: startDate,
            endDate: endDate,
          }),
        );
        setVolumeError(undefined);
      } catch (err) {
        if (requestId !== volumeRequestId.current) {
          return;
        }

        /*
         * The chart is a secondary read of the same rows the list is already
         * showing. A failed count never puts a banner over a list that loaded
         * fine: the chart's own card says why it has no bars (issue #4707).
         */
        setVolume(null);
        setVolumeError(TelemetryLoadErrorUtil.fromError(err));
      } finally {
        if (requestId === volumeRequestId.current) {
          setIsVolumeLoading(false);
        }
      }
    }, [listQuery, timeWindow]);

  useEffect(() => {
    void fetchVolume();
  }, [fetchVolume, refreshVersion]);

  // --- Facets ---

  const fetchFacets: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestId: number = ++facetRequestId.current;
      const startDate: Date = new Date(timeWindow.startValue);
      const endDate: Date = new Date(timeWindow.endValue);

      setFacetLoading(true);

      /*
       * One GROUP BY per facet, in parallel and settled independently, so a
       * facet that errors leaves the others intact — the same contract the
       * logs / traces facet endpoints honour server-side.
       *
       * Every facet is counted over the FULL list query, its own selection
       * included, so picking "Severity: Critical" collapses the Severity
       * section to that one row. That is deliberate, and is what the other
       * explorers' facet endpoints do (the logs one is handed `severityTexts`
       * the same way): a facet count is a promise about the rows the list is
       * showing, and counting a dimension over a wider set than the list
       * covers would offer a click that returns something other than the
       * number beside it.
       */
      const results: Array<PromiseSettledResult<Array<FacetValue>>> =
        await Promise.allSettled(
          SECURITY_EVENT_FACET_KEYS.map(
            async (facetKey: string): Promise<Array<FacetValue>> => {
              const result: AggregatedResult =
                await AnalyticsModelAPI.aggregate<SecurityEvent>({
                  modelType: SecurityEvent,
                  aggregateBy: buildSecurityEventFacetAggregateBy({
                    query: listQuery,
                    facetKey: facetKey,
                    startDate: startDate,
                    endDate: endDate,
                    limit: SECURITY_EVENT_FACET_VALUE_LIMIT,
                  }),
                });

              return buildSecurityEventFacetValues({
                rows: result?.data || [],
                facetKey: facetKey,
              });
            },
          ),
        );

      if (requestId !== facetRequestId.current) {
        return;
      }

      const nextFacetData: FacetData = {};

      const stoppedFacets: Array<string> = [];
      const failures: Array<unknown> = [];

      SECURITY_EVENT_FACET_KEYS.forEach((facetKey: string, index: number) => {
        const result: PromiseSettledResult<Array<FacetValue>> | undefined =
          results[index];

        nextFacetData[facetKey] =
          result && result.status === "fulfilled" ? result.value : [];

        if (result && result.status === "rejected") {
          failures.push(result.reason);

          if (TelemetryLoadErrorUtil.isTimedOut(result.reason)) {
            stoppedFacets.push(facetKey);
          }
        }
      });

      setFacetData(nextFacetData);
      /*
       * A facet the time limit stopped is named, so the sidebar says so
       * instead of "No values" (issue #4707). Every facet failing for
       * another reason is the facets not loading at all.
       */
      setTimedOutFacets(stoppedFacets);
      setFacetError(
        stoppedFacets.length === 0 &&
          failures.length > 0 &&
          failures.length === SECURITY_EVENT_FACET_KEYS.length
          ? TelemetryLoadErrorUtil.fromError(failures[0])
          : undefined,
      );
      setFacetLoading(false);
    }, [listQuery, timeWindow]);

  useEffect(() => {
    void fetchFacets();
  }, [fetchFacets, refreshVersion]);

  // --- "Nothing here" vs "nothing ever" ---

  const isWindowEmpty: boolean =
    !isLoading && !error && events.length === 0 && page === 1;

  useEffect(() => {
    if (!isWindowEmpty) {
      return undefined;
    }

    let isCancelled: boolean = false;

    AnalyticsModelAPI.getList<SecurityEvent>({
      modelType: SecurityEvent,
      query: { projectId: projectId } as Query<SecurityEvent>,
      limit: 1,
      skip: 0,
      select: { time: true },
      sort: { time: SortOrder.Descending },
    })
      .then((result: ListResult<SecurityEvent>) => {
        if (isCancelled) {
          return;
        }

        const time: Date | undefined = result.data[0]?.time;
        setLatestEventTime(time ? new Date(time) : null);
      })
      .catch(() => {
        if (!isCancelled) {
          setLatestEventTime(undefined);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isWindowEmpty, projectId?.toString()]);

  // --- Source names ---

  useEffect(() => {
    let isCancelled: boolean = false;

    ModelAPI.getList<Service>({
      modelType: Service,
      query: { projectId: projectId },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: { name: true },
      sort: { name: SortOrder.Ascending },
    })
      .then((result: ModelListResult<Service>) => {
        if (isCancelled) {
          return;
        }

        const names: Record<string, string> = {};

        for (const service of result.data) {
          if (service.id && service.name) {
            names[service.id.toString()] = service.name;
          }
        }

        setSourceNames(names);
      })
      .catch(() => {
        /*
         * Non-critical: the Source facet then lists raw ids, which still
         * filter correctly — better than hiding the dimension outright.
         */
      });

    return () => {
      isCancelled = true;
    };
  }, [projectId?.toString()]);

  // --- Search bar completions ---

  useEffect(() => {
    let isCancelled: boolean = false;

    setAttributesLoading(true);

    SecurityEventAttributeUtil.getAttributeKeys()
      .then((keys: Array<string>) => {
        if (!isCancelled) {
          setAttributeKeys(keys);
        }
      })
      .catch(() => {
        // Non-critical: the bar still accepts hand-typed attribute keys.
        if (!isCancelled) {
          setAttributesFailed(true);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setAttributesLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  /*
   * The values the search bar offers once `@key:` is typed: looked up after
   * the reader pauses, for a key the project's security events have, once
   * per key and time range, from the events in the range on screen
   * (issue #4708).
   */
  const attributeValues: AttributeValueSuggestionsState =
    useAttributeValueSuggestions({
      searchText: searchValue,
      attributeKeys: attributeKeys,
      isAttributeKeysLoading: attributesLoading,
      hasAttributeKeysFailed: attributesFailed,
      ignoreKey: (key: string): boolean => {
        return SECURITY_EVENT_SEARCH_FIELD_KEYS.has(key.toLowerCase());
      },
      scope: `security-events|${projectId?.toString() || ""}|${getTimeRangeScope(timeRange)}`,
      fetchValues: (attributeKey: string): Promise<Array<string>> => {
        return SecurityEventAttributeUtil.getAttributeValues(
          attributeKey,
          undefined,
          timeRange,
        );
      },
    });

  // --- Live ---

  useEffect(() => {
    if (!isLive) {
      return undefined;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      /*
       * A relative window has to be re-read from now, or "live" would keep
       * refetching a window that stopped moving when it was picked.
       */
      if (timeRange.range === TimeRange.CUSTOM) {
        setRefreshVersion((version: number): number => {
          return version + 1;
        });
        return;
      }

      setWindowVersion((version: number): number => {
        return version + 1;
      });
    }, LIVE_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [isLive, timeRange.range]);

  // --- Attribute columns ---

  const attributeColumns: Array<SecurityEventAttributeColumn> = useMemo(() => {
    return buildSecurityEventAttributeColumns(attributeColumnKeys);
  }, [attributeColumnKeys]);

  const pickerAttributeKeys: Array<string> = useMemo(() => {
    return mergeSecurityEventAttributeKeys({
      attributeKeys: attributeKeys,
      events: events,
    });
  }, [attributeKeys, events]);

  const updateAttributeColumnKeys: (keys: Array<string>) => void = useCallback(
    (keys: Array<string>): void => {
      const next: Array<string> =
        normalizeSecurityEventAttributeColumnKeys(keys);

      setAttributeColumnKeys(next);
      writeSecurityEventAttributeColumnKeys(projectId?.toString() || "", next);
    },
    [projectId?.toString()],
  );

  const toggleAttributeColumn: (attributeKey: string) => void = useCallback(
    (attributeKey: string): void => {
      updateAttributeColumnKeys(
        toggleSecurityEventAttributeColumnKey(
          attributeColumnKeys,
          attributeKey,
        ),
      );
    },
    [attributeColumnKeys, updateAttributeColumnKeys],
  );

  // --- Filter actions ---

  /*
   * Include or exclude one value: the value ends up in exactly that state.
   * Including a value it currently excludes (or the reverse) flips it.
   *
   * Never a toggle. The sidebar takes a checked or excluded value off
   * through handleRemoveFilter, the chip's own x, and the drawer's "Filter
   * by" is an add: pressing it on a value that is already applied used to
   * take the filter off again.
   */
  const applyFacetSelection: (
    facetKey: string,
    value: string,
    isExcluded: boolean,
  ) => void = useCallback(
    (facetKey: string, value: string, isExcluded: boolean): void => {
      if (!value) {
        return;
      }

      const includeKey: string = facetKey;
      const excludeKey: string = toSecurityEventExcludeFacetKey(facetKey);
      const targetKey: string = isExcluded ? excludeKey : includeKey;
      const oppositeKey: string = isExcluded ? includeKey : excludeKey;

      setFacetFilters(
        (previous: Map<string, Set<string>>): Map<string, Set<string>> => {
          const opposite: Set<string> | undefined = previous.get(oppositeKey);
          const isApplied: boolean = Boolean(
            previous.get(targetKey)?.has(value),
          );

          if (isApplied && !opposite?.has(value)) {
            return previous;
          }

          const next: Map<string, Set<string>> = new Map(previous);

          if (opposite?.has(value)) {
            const remaining: Set<string> = new Set(opposite);
            remaining.delete(value);

            if (remaining.size === 0) {
              next.delete(oppositeKey);
            } else {
              next.set(oppositeKey, remaining);
            }
          }

          next.set(
            targetKey,
            new Set<string>([...Array.from(next.get(targetKey) || []), value]),
          );

          return next;
        },
      );

      setPage(1);
    },
    [],
  );

  const handleFacetInclude: (facetKey: string, value: string) => void =
    useCallback(
      (facetKey: string, value: string): void => {
        applyFacetSelection(facetKey, value, false);
      },
      [applyFacetSelection],
    );

  const handleFacetExclude: (facetKey: string, value: string) => void =
    useCallback(
      (facetKey: string, value: string): void => {
        applyFacetSelection(facetKey, value, true);
      },
      [applyFacetSelection],
    );

  const handleRemoveFilter: (facetKey: string, value: string) => void =
    useCallback((facetKey: string, value: string): void => {
      setFacetFilters(
        (previous: Map<string, Set<string>>): Map<string, Set<string>> => {
          const current: Set<string> | undefined = previous.get(facetKey);

          if (!current?.has(value)) {
            return previous;
          }

          const next: Map<string, Set<string>> = new Map(previous);
          const remaining: Set<string> = new Set(current);
          remaining.delete(value);

          if (remaining.size === 0) {
            next.delete(facetKey);
          } else {
            next.set(facetKey, remaining);
          }

          return next;
        },
      );

      setPage(1);
    }, []);

  const handleClearAllFilters: () => void = useCallback((): void => {
    setFacetFilters(new Map());
    setSearchValue("");
    setSubmittedSearch("");
    setPage(1);
  }, []);

  const isSelectedEvent: (item: SecurityEvent) => boolean = useCallback(
    (item: SecurityEvent): boolean => {
      if (!selectedEvent) {
        return false;
      }

      const uid: string = selectedEvent.eventUid?.toString() || "";

      /*
       * eventUid is a source-assigned id (or a content hash when the source
       * has none), so an empty one is possible on a pre-normalization row.
       * Fall back to identity there rather than marking every uid-less row
       * on the page as the open one.
       */
      return uid ? item.eventUid?.toString() === uid : item === selectedEvent;
    },
    [selectedEvent],
  );

  const activeFilters: Array<ActiveFilter> = useMemo(() => {
    const filters: Array<ActiveFilter> = [];

    for (const [facetKey, values] of facetFilters.entries()) {
      for (const value of values) {
        filters.push({
          facetKey: facetKey,
          value: value,
          displayKey: getSecurityEventFacetChipDisplayKey(facetKey),
          displayValue: getSecurityEventFacetChipDisplayValue(
            facetKey,
            value,
            sourceNames,
          ),
        });
      }
    }

    return filters;
  }, [facetFilters, sourceNames]);

  const facetConfigs: Array<FacetConfig> = useMemo(() => {
    return buildSecurityEventFacetConfigs({ sourceNames: sourceNames });
  }, [sourceNames]);

  const histogramSeries: Array<HistogramSeriesOption> = useMemo(() => {
    return getSecurityEventVolumeSeries();
  }, []);

  const histogramBuckets: Array<HistogramBucket> = volume?.buckets || [];

  // --- Time ---

  const applyTimeRange: (nextTimeRange: RangeStartAndEndDateTime) => void =
    useCallback((nextTimeRange: RangeStartAndEndDateTime): void => {
      setTimeRange(nextTimeRange);
      setPage(1);
    }, []);

  /*
   * The chart already hands over whole buckets (it is given their width
   * below), cut at the end of the window being zoomed out of, so the window
   * is applied as it comes.
   */
  const handleHistogramTimeRangeSelect: (
    startDate: Date,
    endDate: Date,
  ) => void = useCallback(
    (startDate: Date, endDate: Date): void => {
      applyTimeRange({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(startDate, endDate),
      });
    },
    [applyTimeRange],
  );

  const refresh: () => void = useCallback((): void => {
    if (timeRange.range === TimeRange.CUSTOM) {
      setRefreshVersion((version: number): number => {
        return version + 1;
      });
      return;
    }

    setWindowVersion((version: number): number => {
      return version + 1;
    });
  }, [timeRange.range]);

  // --- Empty state ---

  const hasNarrowedTheList: boolean =
    activeFilters.length > 0 || submittedSearch.trim().length > 0;

  const emptyContent: ReactElement =
    latestEventTime === null && !hasNarrowedTheList ? (
      <SecurityEventsEmptyState />
    ) : (
      <SecurityEventsNoResults
        latestEventTime={latestEventTime || undefined}
        windowStartDate={new Date(timeWindow.startValue)}
        onShowTimeRange={applyTimeRange}
      />
    );

  return (
    <div
      className="flex min-h-0 w-full flex-1 flex-col"
      data-testid={SECURITY_EVENTS_VIEWER_TEST_ID}
    >
      <TelemetryViewer<SecurityEvent>
        items={events}
        isLoading={isLoading}
        error={error || undefined}
        onRefresh={refresh}
        emptyContent={emptyContent}
        itemLabel="security events"
        bulk={{
          buttons: addToCase.bulkActions,
          singularLabel: EVENT_SINGULAR,
          pluralLabel: EVENT_PLURAL,
          getItemId: (item: SecurityEvent): string => {
            return item.eventUid?.toString() || "";
          },
          itemToString: (item: SecurityEvent): string => {
            return (
              item.message ||
              item.className ||
              item.eventUid?.toString() ||
              "Security event"
            );
          },
        }}
        getRowKey={(item: SecurityEvent, index: number): string => {
          return `${item.eventUid?.toString() || "event"}-${index}`;
        }}
        renderRow={(item: SecurityEvent): ReactElement => {
          return (
            <SecurityEventListRow
              securityEvent={item}
              /*
               * By uid rather than by reference: a live poll or a refresh
               * replaces every row object, and a reference check would drop
               * the highlight off the row the open drawer is showing.
               */
              isSelected={isSelectedEvent(item)}
              onClick={() => {
                setSelectedEvent(item);
              }}
              attributeColumns={attributeColumns}
            />
          );
        }}
        // Search
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onSearchSubmit={() => {
          setSubmittedSearch(searchValue);
          setPage(1);
        }}
        searchPlaceholder={SECURITY_EVENT_SEARCH_PLACEHOLDER}
        searchSuggestions={[...SECURITY_EVENT_SEARCH_SUGGESTIONS]}
        searchAttributeSuggestions={attributeKeys}
        searchValueSuggestions={attributeValues.valueSuggestions}
        searchAttributesLoading={attributesLoading}
        searchValuesLoading={attributeValues.isLoading}
        searchValuesError={attributeValues.error}
        onRetrySearchValues={attributeValues.retry}
        searchHasNoValues={attributeValues.hasNoValues}
        searchFieldAliasMap={SECURITY_EVENT_FIELD_ALIASES}
        searchHelpRows={SECURITY_EVENT_SEARCH_HELP_ROWS as Array<SearchHelpRow>}
        searchHelpCombinedExample={SECURITY_EVENT_SEARCH_COMBINED_EXAMPLE}
        /*
         * Every field of this signal is a real column or a map entry that the
         * shared grammar compiles losslessly, so a typed `key:value` is always
         * routed through the search string rather than turned into a chip.
         * Returning false keeps the token in the input and submits it.
         */
        onSearchFieldValueSelect={(): boolean => {
          return false;
        }}
        // Time
        timeRange={timeRange}
        onTimeRangeChange={applyTimeRange}
        // Live
        live={{
          isLive: isLive,
          onToggle: setIsLive,
        }}
        toolbarTrailingActions={
          <>
            {/* A hunt's page saves its changes in its own header. */}
            {props.hunt ? (
              <></>
            ) : (
              <SaveAsHuntButton
                state={{
                  search: submittedSearch,
                  filters: facetFilters,
                  timeRange: timeRange,
                }}
              />
            )}
            <SecurityEventAttributeColumnPicker
              attributeKeys={pickerAttributeKeys}
              isLoading={attributesLoading}
              selectedKeys={attributeColumnKeys}
              onChange={updateAttributeColumnKeys}
            />
          </>
        }
        // Facets
        showFacetSidebar={true}
        facetData={facetData}
        facetConfigs={facetConfigs}
        facetLoading={facetLoading}
        timedOutFacets={timedOutFacets}
        facetError={facetError}
        onRetryFacets={() => {
          void fetchFacets();
        }}
        onFacetInclude={handleFacetInclude}
        onFacetExclude={handleFacetExclude}
        // Active filters
        activeFilters={activeFilters}
        onRemoveFilter={handleRemoveFilter}
        onClearAllFilters={handleClearAllFilters}
        // Histogram
        showHistogram={true}
        histogramBuckets={histogramBuckets}
        histogramSeries={histogramSeries}
        histogramTitle="Security Event Volume"
        histogramLoading={isVolumeLoading}
        histogramError={volumeError}
        onRetryHistogram={() => {
          void fetchVolume();
        }}
        histogramBucketIntervalMs={volume?.intervalMs}
        onHistogramTimeRangeSelect={handleHistogramTimeRangeSelect}
        /*
         * The histogram renders nothing at all when it has no buckets AND no
         * header actions, so an empty window would leave a hole where the
         * chart was. This keeps the frame — and states the count the window
         * holds, which on an empty one is the answer.
         *
         * Not while the chart could not load (issue #4707): the total is
         * read from the same answer, so "Counting events..." would wait
         * beside the chart's own message for a count that is not coming.
         */
        histogramHeaderActions={
          volumeError && !isVolumeLoading ? undefined : (
            <span
              className="whitespace-nowrap text-[11px] text-gray-500"
              data-testid={SECURITY_EVENTS_VOLUME_TOTAL_TEST_ID}
            >
              {isVolumeLoading || !volume ? (
                "Counting events..."
              ) : (
                <>
                  <span className="font-semibold tabular-nums text-gray-900">
                    {volume.total.toLocaleString()}
                  </span>{" "}
                  {volume.total === 1 ? "event" : "events"}
                </>
              )}
            </span>
          )
        }
        // Pagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        hasMore={hasMore}
        onPageChange={setPage}
        onPageSizeChange={(size: number) => {
          setPageSize(size);
          setPage(1);
        }}
        detailPanel={
          selectedEvent ? (
            <SecurityEventDetailPanel
              securityEvent={selectedEvent}
              onClose={() => {
                setSelectedEvent(null);
              }}
              onFilterBy={(facetKey: string, value: string) => {
                handleFacetInclude(facetKey, value);
              }}
              attributeColumnKeys={attributeColumnKeys}
              onToggleAttributeColumn={toggleAttributeColumn}
              huntId={props.hunt?.id}
            />
          ) : null
        }
      />
      {addToCase.modals}
    </div>
  );
};

export default SecurityEventsViewer;
