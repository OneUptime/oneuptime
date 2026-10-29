import FlameGraph from "./FlameGraph";
import TraceServiceMap from "./TraceServiceMap";
import TraceHeader from "./TraceDetail/TraceHeader";
import TraceOperations from "./TraceDetail/TraceOperations";
import TraceSignals from "./TraceDetail/TraceSignals";
import TraceSpanPanel from "./TraceDetail/TraceSpanPanel";
import TracePerformanceSuggestion from "./TraceDetail/TracePerformanceSuggestion";
import {
  getShownSpanIds,
  getShownSpanSearch,
} from "./TraceDetail/TracePerformanceSuggestionCopy";
import TraceWaterfall from "./TraceDetail/TraceWaterfall";
import ExceptionSegmentedControl from "../Exceptions/ExceptionSegmentedControl";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { isAiOfferedForSelectedProject } from "../../Utils/UseAiOffered";
import { PROFILE_SPAN_ID_LIMIT } from "../../Utils/TraceCorrelatedSignals";
import {
  PodEntityKeySet,
  collectPodEntityKeys,
} from "../../Utils/TracePodLogs";
import {
  OperationSummary,
  ServiceSummary,
  SpanLoadState,
  SpanPage,
  TraceServiceInfo,
  TraceSummary,
  buildServiceInfoMap,
  getServiceInfo,
  getSpanLoadState,
  pluralize,
  readSpanPage,
  summarizeOperations,
  summarizeServices,
  summarizeTrace,
} from "../../Utils/TraceDetailPresentation";
import {
  FULL_VIEWPORT,
  SpanSubtreeIds,
  SpanTree,
  SpanVisibility,
  TimeViewport,
  WaterfallNode,
  WaterfallRow,
  WaterfallSpan,
  buildSpanFilterPredicate,
  buildSpanTree,
  countMatches,
  filterSpanTree,
  flattenVisibleRows,
  getCollapsibleSpanIds,
  getSubtreeSpanIds,
  getViewportForSpan,
  revealSpans,
  toCriticalPathSpanData,
  toWaterfallSpans,
} from "../../Utils/TraceWaterfall";
import Span from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import TelemetryServiceUtil from "Common/UI/Utils/TelemetryService";
import CriticalPathUtil, {
  CriticalPathResult,
  SpanSelfTime,
} from "Common/Utils/Traces/CriticalPath";
import SuggestionOffer from "Common/Utils/Suggestions/SuggestionOffer";
import {
  NO_TRACE_PERFORMANCE_FIX_SUGGESTION,
  TracePerformanceFixSuggestion,
  parseTracePerformanceFixSuggestion,
} from "Common/Utils/Suggestions/TracePerformanceFixSuggestion";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type TraceViewMode =
  | "waterfall"
  | "flamegraph"
  | "servicemap"
  | "operations";

export const INITIAL_SPAN_FETCH_SIZE: number = 500;
export const SPAN_PAGE_SIZE: number = 500;
const MAX_SPAN_FETCH_BATCH: number = LIMIT_PER_PROJECT;

const EMPTY_ID_SET: Set<string> = new Set();

const SPAN_SELECT: Select<Span> = {
  startTime: true,
  endTime: true,
  startTimeUnixNano: true,
  endTimeUnixNano: true,
  name: true,
  traceId: true,
  parentSpanId: true,
  spanId: true,
  kind: true,
  primaryEntityId: true,
  durationUnixNano: true,
  statusCode: true,
  // The span's pod: its logs are read by pod and time when none carry the trace.
  k8sPodEntityKey: true,
};

export interface ComponentProps {
  traceId: string;
  // Spans named by the link that opened the page (?spanId=a,b).
  highlightSpanIds?: string[];
}

export const PERFORMANCE_FIX_SUGGESTION_PATH: string =
  "/ai-investigation/performance-fix-suggestion";

export const CREATE_PERFORMANCE_FIX_TASK_PATH: string =
  "/ai-investigation/create-performance-fix-task";

/*
 * Where the span panel sits beside the waterfall (its xl: classes below);
 * narrower, it is a sheet over the page.
 */
export const SPAN_PANEL_BESIDE_WATERFALL_QUERY: string = "(min-width: 1280px)";

function isSpanPanelBesideWaterfall(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(SPAN_PANEL_BESIDE_WATERFALL_QUERY).matches
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element: HTMLElement | null = target as HTMLElement | null;
  if (!element || !element.tagName) {
    return false;
  }
  return (
    element.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName.toUpperCase())
  );
}

const TraceExplorer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const traceId: string = props.traceId;

  const [services, setServices] = useState<Array<Service>>([]);
  const [spans, setSpans] = useState<Array<Span>>([]);
  /*
   * How many spans the trace has: counted exactly, or settled by the page
   * that ended it. Null until one of those says (see readSpanPage).
   */
  const [totalSpanCount, setTotalSpanCount] = useState<number | null>(null);
  // Whether the newest page said more spans follow it.
  const [hasMoreSpans, setHasMoreSpans] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingMoreSpans, setIsLoadingMoreSpans] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<TraceViewMode>("waterfall");
  const [searchText, setSearchText] = useState<string>("");
  const [errorsOnly, setErrorsOnly] = useState<boolean>(false);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Array<string>>(
    [],
  );
  const [showCriticalPath, setShowCriticalPath] = useState<boolean>(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(EMPTY_ID_SET);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<TimeViewport>(FULL_VIEWPORT);
  const [revealRequest, setRevealRequest] = useState<number>(0);

  /*
   * "Fix performance with AI" (the FixPerformance recipe): what the server
   * offers for this trace, and the fix started from this page.
   */
  const [perfFixSuggestion, setPerfFixSuggestion] =
    useState<TracePerformanceFixSuggestion>(
      NO_TRACE_PERFORMANCE_FIX_SUGGESTION,
    );
  const [isCreatingPerfFixTask, setIsCreatingPerfFixTask] =
    useState<boolean>(false);
  const [perfFixRunId, setPerfFixRunId] = useState<string | null>(null);
  const [perfFixError, setPerfFixError] = useState<string | null>(null);

  // Responses from a previous trace (or an older refresh) never land.
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);
  const appliedLinkRef: React.MutableRefObject<string> = useRef<string>("");
  const loadedSpanCountRef: React.MutableRefObject<number> = useRef<number>(0);
  const searchInputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const spansSectionRef: React.RefObject<HTMLElement> =
    useRef<HTMLElement>(null);

  loadedSpanCountRef.current = spans.length;

  const fetchSpanPage: (
    skip: number,
    limit: number,
  ) => Promise<ListResult<Span>> = useCallback(
    async (skip: number, limit: number): Promise<ListResult<Span>> => {
      return AnalyticsModelAPI.getList<Span>({
        modelType: Span,
        select: SPAN_SELECT,
        query: {
          traceId: traceId,
        },
        sort: {
          startTimeUnixNano: SortOrder.Ascending,
        },
        skip,
        limit,
      });
    },
    [traceId],
  );

  /*
   * The trace's exact span count, for "500 of 3,102" and the size of the
   * batches. The list endpoint's `count` is only a lower bound
   * (readSpanPage), so the spans are counted separately, with the list's
   * own query. Asked only when the first page says more spans follow. A
   * count that fails leaves the total unknown, and the rest of the trace
   * still loads a page at a time.
   */
  const countTraceSpans: (generation: number) => Promise<void> = useCallback(
    async (generation: number): Promise<void> => {
      let total: number | null = null;

      try {
        total = await AnalyticsModelAPI.count<Span>(
          Span,
          {
            traceId: traceId,
          },
          undefined,
          { exact: true },
        );
      } catch {
        total = null;
      }

      if (generation === loadGenerationRef.current) {
        setTotalSpanCount(total);
      }
    },
    [traceId],
  );

  /*
   * Ask the server whether this trace is worth "Fix performance with AI".
   * It runs the span-tree analysis the create route gates on (with the
   * spans' attributes, which this page does not load), so the page offers
   * exactly what the server would accept. A project with AI switched off is
   * not asked at all. Throws when the answer cannot be read.
   */
  const fetchPerfFixSuggestion: () => Promise<TracePerformanceFixSuggestion> =
    useCallback(async (): Promise<TracePerformanceFixSuggestion> => {
      if (!isAiOfferedForSelectedProject()) {
        return NO_TRACE_PERFORMANCE_FIX_SUGGESTION;
      }

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(
            APP_API_URL.toString() + PERFORMANCE_FIX_SUGGESTION_PATH,
          ),
          data: {
            traceId: traceId,
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      return response instanceof HTTPErrorResponse
        ? NO_TRACE_PERFORMANCE_FIX_SUGGESTION
        : parseTracePerformanceFixSuggestion(response.data);
    }, [traceId]);

  /*
   * Any failure means no suggestion: the button is an offer, never
   * something the page depends on.
   */
  const loadPerfFixSuggestion: (generation: number) => Promise<void> =
    useCallback(
      async (generation: number): Promise<void> => {
        let suggestion: TracePerformanceFixSuggestion =
          NO_TRACE_PERFORMANCE_FIX_SUGGESTION;

        try {
          suggestion = await fetchPerfFixSuggestion();
        } catch {
          suggestion = NO_TRACE_PERFORMANCE_FIX_SUGGESTION;
        }

        if (generation === loadGenerationRef.current) {
          setPerfFixSuggestion(suggestion);
        }
      },
      [fetchPerfFixSuggestion],
    );

  const loadTrace: (mode: "initial" | "refresh") => Promise<void> = useCallback(
    async (mode: "initial" | "refresh"): Promise<void> => {
      loadGenerationRef.current += 1;
      const generation: number = loadGenerationRef.current;

      // In parallel with the spans; it never holds the page up.
      void loadPerfFixSuggestion(generation);

      if (mode === "initial") {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setIsLoadingMoreSpans(false);
      setError(null);

      // A refresh keeps as many spans as the reader had already loaded.
      const limit: number =
        mode === "initial"
          ? INITIAL_SPAN_FETCH_SIZE
          : Math.min(
              MAX_SPAN_FETCH_BATCH,
              Math.max(INITIAL_SPAN_FETCH_SIZE, loadedSpanCountRef.current),
            );

      try {
        const [servicesResult, spanResult] = await Promise.all([
          ModelAPI.getList<Service>({
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            modelType: Service,
            sort: {
              name: SortOrder.Ascending,
            },
            select: {
              name: true,
              _id: true,
              serviceColor: true,
            },
          }),
          fetchSpanPage(0, limit),
        ]);

        if (generation !== loadGenerationRef.current) {
          return;
        }

        const page: SpanPage = readSpanPage({
          loadedSpanCount: spanResult.data.length,
          rowCount: spanResult.data.length,
          limit,
          count: spanResult.count,
          hasMore: spanResult.hasMore,
        });

        setServices(servicesResult.data);
        setSpans(spanResult.data);
        setHasMoreSpans(page.hasMore);

        if (page.totalSpanCount !== null) {
          setTotalSpanCount(page.totalSpanCount);
        } else {
          // A refresh keeps the total it showed until the new count lands.
          void countTraceSpans(generation);
        }
      } catch (err) {
        if (generation === loadGenerationRef.current) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (generation === loadGenerationRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [fetchSpanPage, countTraceSpans, loadPerfFixSuggestion],
  );

  // A new trace starts from a clean slate.
  useEffect(() => {
    setServices([]);
    setSpans([]);
    setTotalSpanCount(null);
    setHasMoreSpans(false);
    setError(null);
    setViewMode("waterfall");
    setSearchText("");
    setErrorsOnly(false);
    setSelectedServiceIds([]);
    setShowCriticalPath(false);
    setCollapsedIds(EMPTY_ID_SET);
    setSelectedSpanId(null);
    setViewport(FULL_VIEWPORT);
    setPerfFixSuggestion(NO_TRACE_PERFORMANCE_FIX_SUGGESTION);
    setIsCreatingPerfFixTask(false);
    setPerfFixRunId(null);
    setPerfFixError(null);
    appliedLinkRef.current = "";
    loadedSpanCountRef.current = 0;

    void loadTrace("initial");

    return () => {
      loadGenerationRef.current += 1;
    };
  }, [traceId]);

  const loadState: SpanLoadState = getSpanLoadState({
    loadedSpanCount: spans.length,
    totalSpanCount,
    hasMore: hasMoreSpans,
    pageSize: SPAN_PAGE_SIZE,
  });

  const loadMoreSpans: (loadAll: boolean) => Promise<void> = async (
    loadAll: boolean,
  ): Promise<void> => {
    if (!loadState.hasMore || isLoadingMoreSpans) {
      return;
    }

    const generation: number = loadGenerationRef.current;
    let state: SpanLoadState = loadState;

    setIsLoadingMoreSpans(true);
    setError(null);

    try {
      do {
        const batchSize: number = loadAll
          ? Math.min(
              MAX_SPAN_FETCH_BATCH,
              state.remainingSpanCount ?? MAX_SPAN_FETCH_BATCH,
            )
          : state.nextBatchSize;
        const result: ListResult<Span> = await fetchSpanPage(
          state.loadedSpanCount,
          batchSize,
        );

        if (generation !== loadGenerationRef.current) {
          return;
        }

        const fetched: Array<Span> = result.data;
        const loaded: number = state.loadedSpanCount + fetched.length;
        const page: SpanPage = readSpanPage({
          loadedSpanCount: loaded,
          rowCount: fetched.length,
          limit: batchSize,
          count: result.count,
          hasMore: result.hasMore,
        });

        setSpans((previous: Array<Span>) => {
          return [...previous, ...fetched];
        });
        setHasMoreSpans(page.hasMore);

        // A batch only settles the total when it ends the trace.
        if (page.totalSpanCount !== null) {
          setTotalSpanCount(page.totalSpanCount);
        }

        state = getSpanLoadState({
          loadedSpanCount: loaded,
          totalSpanCount: page.totalSpanCount ?? state.totalSpanCount,
          hasMore: page.hasMore,
          pageSize: SPAN_PAGE_SIZE,
        });
      } while (loadAll && state.hasMore);
    } catch (err) {
      if (generation === loadGenerationRef.current) {
        setError(API.getFriendlyMessage(err));
      }
    } finally {
      if (generation === loadGenerationRef.current) {
        setIsLoadingMoreSpans(false);
      }
    }
  };

  /*
   * Human-triggered FixPerformance: the server re-runs the same gates the
   * suggestion passed (AI on, a finding worth fixing, a repository, no fix
   * already on its way) and enqueues an AI task that opens a
   * performance-fix pull request.
   *
   * A refusal asks the server again what it offers now. A fix someone else
   * started meanwhile (or that finished), a repository disconnected since
   * the page loaded, or something Code's gate now says (a Runner gone,
   * the credits used up) is then said in the strip's own words - a link to
   * that fix, or the step that clears it - rather than as the server's
   * refusal. Anything else keeps the button and shows the reason beside
   * the finding.
   */
  const createPerformanceFixTask: () => Promise<void> =
    async (): Promise<void> => {
      const generation: number = loadGenerationRef.current;
      setIsCreatingPerfFixTask(true);
      setPerfFixError(null);

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(
              APP_API_URL.toString() + CREATE_PERFORMANCE_FIX_TASK_PATH,
            ),
            data: {
              traceId: traceId,
            },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const aiRunId: string | undefined = (response.data as JSONObject)[
          "aiRunId"
        ] as string | undefined;

        setPerfFixRunId(aiRunId || null);
      } catch (err) {
        const reason: string = API.getFriendlyMessage(err);
        let latest: TracePerformanceFixSuggestion | null = null;

        try {
          latest = await fetchPerfFixSuggestion();
        } catch {
          latest = null;
        }

        // A refresh since the click has read the offer again itself.
        if (
          generation === loadGenerationRef.current &&
          latest &&
          (latest.offer === SuggestionOffer.InProgress ||
            latest.offer === SuggestionOffer.SetUp ||
            latest.offer === SuggestionOffer.Done)
        ) {
          setPerfFixSuggestion(latest);
        } else {
          setPerfFixError(reason);
        }
      }

      setIsCreatingPerfFixTask(false);
    };

  const waterfallSpans: Array<WaterfallSpan> = useMemo(() => {
    return toWaterfallSpans(spans);
  }, [spans]);

  const tree: SpanTree = useMemo(() => {
    return buildSpanTree(waterfallSpans);
  }, [waterfallSpans]);

  // The pods the spans ran in: the Logs tab reads them by pod and time.
  const tracePods: PodEntityKeySet = useMemo(() => {
    return collectPodEntityKeys(
      waterfallSpans.map((span: WaterfallSpan): string | undefined => {
        return span.k8sPodEntityKey;
      }),
    );
  }, [waterfallSpans]);

  /*
   * Telemetry without a service.name is tagged with the project id and has no
   * Service row; fold a synthetic "Unknown Service" in when a span references
   * it, so it renders with a name instead of a blank.
   */
  const servicesWithUnknown: Array<Service> = useMemo(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      return services;
    }
    return TelemetryServiceUtil.withUnknownServiceIfReferenced({
      services,
      referencedServiceIds: new Set(
        waterfallSpans
          .map((span: WaterfallSpan) => {
            return span.serviceId;
          })
          .filter(Boolean),
      ),
      projectId,
    });
  }, [services, waterfallSpans]);

  const serviceInfoById: Map<string, TraceServiceInfo> = useMemo(() => {
    return buildServiceInfoMap(servicesWithUnknown);
  }, [servicesWithUnknown]);

  const serviceNameById: Map<string, string> = useMemo(() => {
    const map: Map<string, string> = new Map();
    for (const [id, info] of serviceInfoById.entries()) {
      map.set(id, info.name);
    }
    return map;
  }, [serviceInfoById]);

  const selfTimes: Map<string, SpanSelfTime> = useMemo(() => {
    return CriticalPathUtil.computeSelfTimes(
      toCriticalPathSpanData(waterfallSpans),
    );
  }, [waterfallSpans]);

  const summary: TraceSummary = useMemo(() => {
    return summarizeTrace(tree, loadState.totalSpanCount);
  }, [tree, loadState.totalSpanCount]);

  const serviceSummaries: Array<ServiceSummary> = useMemo(() => {
    return summarizeServices({
      spans: waterfallSpans,
      selfTimes,
      serviceInfoById,
    });
  }, [waterfallSpans, selfTimes, serviceInfoById]);

  const visibility: Map<string, SpanVisibility> | null = useMemo(() => {
    return filterSpanTree(
      tree,
      buildSpanFilterPredicate({
        searchText,
        errorsOnly,
        serviceIds: selectedServiceIds,
        serviceNameById,
      }),
    );
  }, [tree, searchText, errorsOnly, selectedServiceIds, serviceNameById]);

  const matchCount: number = countMatches(visibility);

  const rows: Array<WaterfallRow> = useMemo(() => {
    return flattenVisibleRows(tree, collapsedIds, visibility);
  }, [tree, collapsedIds, visibility]);

  // Matches in tree order, collapsed or not, for "next / previous match".
  const matchIds: Array<string> = useMemo(() => {
    if (!visibility) {
      return [];
    }
    return flattenVisibleRows(tree, EMPTY_ID_SET, visibility)
      .filter((row: WaterfallRow) => {
        return !row.isContext;
      })
      .map((row: WaterfallRow) => {
        return row.node.span.spanId;
      });
  }, [tree, visibility]);

  const criticalPath: CriticalPathResult | null = useMemo(() => {
    if (!showCriticalPath || waterfallSpans.length === 0) {
      return null;
    }
    return CriticalPathUtil.computeCriticalPath(
      toCriticalPathSpanData(waterfallSpans),
    );
  }, [showCriticalPath, waterfallSpans]);

  const criticalPathSpanIds: Set<string> | null = useMemo(() => {
    return criticalPath ? new Set(criticalPath.criticalPathSpanIds) : null;
  }, [criticalPath]);

  const visibleSpanModels: Array<Span> = useMemo(() => {
    if (!visibility) {
      return spans;
    }
    return spans.filter((_span: Span, index: number) => {
      const waterfallSpan: WaterfallSpan | undefined = waterfallSpans[index];
      return Boolean(waterfallSpan && visibility.has(waterfallSpan.spanId));
    });
  }, [spans, waterfallSpans, visibility]);

  const operations: Array<OperationSummary> = useMemo(() => {
    const matchingSpans: Array<WaterfallSpan> = visibility
      ? waterfallSpans.filter((span: WaterfallSpan) => {
          return visibility.get(span.spanId) === "match";
        })
      : waterfallSpans;
    return summarizeOperations({ spans: matchingSpans, selfTimes });
  }, [waterfallSpans, visibility, selfTimes]);

  const linkedSpanIds: Set<string> = useMemo(() => {
    return new Set(
      (props.highlightSpanIds || [])
        .map((spanId: string) => {
          return spanId.trim();
        })
        .filter((spanId: string) => {
          return spanId.length > 0;
        }),
    );
  }, [props.highlightSpanIds]);

  const selectSpan: (spanId: string | null) => void = useCallback(
    (spanId: string | null): void => {
      if (spanId) {
        setCollapsedIds((previous: Set<string>) => {
          return revealSpans(tree, previous, [spanId]);
        });
        setRevealRequest((request: number) => {
          return request + 1;
        });
      }
      setSelectedSpanId(spanId);
    },
    [tree],
  );

  /*
   * Open the span a link pointed at, once per trace: expand its ancestors,
   * select it and scroll to it. A span in a batch that has not loaded yet is
   * picked up when that batch arrives.
   */
  useEffect(() => {
    if (linkedSpanIds.size === 0 || tree.spanCount === 0) {
      return;
    }
    const linkKey: string = `${traceId}|${[...linkedSpanIds].join(",")}`;
    if (appliedLinkRef.current === linkKey) {
      return;
    }
    const presentIds: Array<string> = [...linkedSpanIds].filter(
      (spanId: string) => {
        return tree.nodesById.has(spanId);
      },
    );
    if (presentIds.length === 0) {
      return;
    }
    appliedLinkRef.current = linkKey;
    setCollapsedIds((previous: Set<string>) => {
      return revealSpans(tree, previous, presentIds);
    });
    setSelectedSpanId(presentIds[0]!);
    setRevealRequest((request: number) => {
      return request + 1;
    });
  }, [tree, linkedSpanIds, traceId]);

  // A refresh that no longer contains the selected span closes its panel.
  useEffect(() => {
    if (selectedSpanId && !isLoading && !tree.nodesById.has(selectedSpanId)) {
      setSelectedSpanId(null);
    }
  }, [tree, selectedSpanId, isLoading]);

  // "/" focuses the span search from anywhere on the page.
  useEffect(() => {
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const goToMatch: (direction: 1 | -1) => void = (direction: 1 | -1): void => {
    if (matchIds.length === 0) {
      return;
    }
    const currentIndex: number = selectedSpanId
      ? matchIds.indexOf(selectedSpanId)
      : -1;
    const nextIndex: number =
      currentIndex === -1
        ? direction === 1
          ? 0
          : matchIds.length - 1
        : (currentIndex + direction + matchIds.length) % matchIds.length;
    if (viewMode === "operations") {
      setViewMode("waterfall");
    }
    selectSpan(matchIds[nextIndex]!);
  };

  const toggleService: (serviceId: string) => void = (
    serviceId: string,
  ): void => {
    setSelectedServiceIds((previous: Array<string>) => {
      return previous.includes(serviceId)
        ? previous.filter((id: string) => {
            return id !== serviceId;
          })
        : [...previous, serviceId];
    });
  };

  const clearFilters: () => void = (): void => {
    setSearchText("");
    setErrorsOnly(false);
    setSelectedServiceIds([]);
  };

  const shareUrl: string = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }
    try {
      const url: globalThis.URL = new globalThis.URL(window.location.href);
      url.searchParams.delete("spanId");
      return url.toString();
    } catch {
      return window.location.href;
    }
  }, [traceId]);

  const traceWindow: { startTime: Date; endTime: Date } | null = useMemo(() => {
    if (tree.spanCount === 0) {
      return null;
    }
    return {
      startTime: new Date(Math.floor(tree.startTimeUnixNano / 1000000)),
      endTime: new Date(Math.ceil(tree.endTimeUnixNano / 1000000)),
    };
  }, [tree]);

  const selectedNode: WaterfallNode | undefined = selectedSpanId
    ? tree.nodesById.get(selectedSpanId)
    : undefined;

  // The selected span and the spans under it: what its Profile tab covers.
  const selectedSubtree: SpanSubtreeIds | null = useMemo(() => {
    if (!selectedSpanId) {
      return null;
    }
    return getSubtreeSpanIds(tree, selectedSpanId, PROFILE_SPAN_ID_LIMIT);
  }, [tree, selectedSpanId]);

  const hasActiveFilter: boolean = visibility !== null;

  /*
   * The fix to link to: the one started here, or the one the server says
   * is already on its way for this trace, or already did its work.
   */
  const perfFixLinkedRunId: string | null =
    perfFixRunId ||
    (perfFixSuggestion.offer === SuggestionOffer.InProgress ||
    perfFixSuggestion.offer === SuggestionOffer.Done
      ? perfFixSuggestion.aiRunId
      : null);

  const perfFixTaskRoute: Route | null = perfFixLinkedRunId
    ? RouteUtil.populateRouteParams(RouteMap[PageMap.CODE_TASK_VIEW] as Route, {
        modelId: perfFixLinkedRunId,
      })
    : null;

  /*
   * "Show them": the finding's spans in the waterfall, scrolled into view.
   * Nothing on the page may hide them: their shared name becomes the search
   * (marking every one of them), or the search is cleared when they have
   * none, and the errors-only and service filters are let go. The first of
   * them is opened - beside the waterfall where the panel fits. On a
   * narrower screen the panel is a sheet over the page, so spans the search
   * already marks are left in view rather than covered; one span, or spans
   * with no name to search by, are pointed at by opening the first.
   */
  const perfFixSpanIds: Array<string> = perfFixSuggestion.finding
    ? getShownSpanIds(perfFixSuggestion.finding, (spanId: string): boolean => {
        return tree.nodesById.has(spanId);
      })
    : [];

  const showPerfFixSpans: (() => void) | undefined =
    perfFixSuggestion.finding && perfFixSpanIds.length > 0
      ? (): void => {
          const search: string = getShownSpanSearch(perfFixSuggestion.finding!);
          setSearchText(search);
          setErrorsOnly(false);
          setSelectedServiceIds([]);
          setViewMode("waterfall");
          setCollapsedIds((previous: Set<string>) => {
            return revealSpans(tree, previous, perfFixSpanIds);
          });

          if (!search || isSpanPanelBesideWaterfall()) {
            selectSpan(perfFixSpanIds[0]!);
          } else {
            setSelectedSpanId(null);
          }

          const section: HTMLElement | null = spansSectionRef.current;
          if (section && typeof section.scrollIntoView === "function") {
            section.scrollIntoView({
              behavior: prefersReducedMotion() ? "auto" : "smooth",
              block: "start",
            });
          }
        }
      : undefined;

  if (isLoading && spans.length === 0) {
    return (
      <div
        className="mb-8 space-y-4"
        data-testid="trace-loading"
        aria-busy="true"
        aria-label="Loading trace"
      >
        <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-5">
          <div className="h-3 w-40 rounded bg-gray-200" />
          <div className="mt-3 h-5 w-2/3 rounded bg-gray-200" />
          <div className="mt-3 h-3 w-1/3 rounded bg-gray-100" />
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
            {[0, 1, 2, 3, 4].map((index: number): ReactElement => {
              return <div key={index} className="h-10 rounded bg-gray-100" />;
            })}
          </div>
        </div>
        <div className="animate-pulse space-y-2 rounded-xl border border-gray-200 bg-white p-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((index: number): ReactElement => {
            return (
              <div key={index} className="flex items-center gap-4">
                <div
                  className="h-4 rounded bg-gray-100"
                  style={{
                    width: `${20 + ((index * 7) % 12)}%`,
                    marginLeft: `${(index % 4) * 16}px`,
                  }}
                />
                <div className="h-3 flex-1 rounded bg-gray-50">
                  <div
                    className="h-3 rounded bg-gray-200"
                    style={{
                      marginLeft: `${index * 6}%`,
                      width: `${60 - index * 6}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (error && spans.length === 0) {
    return (
      <div className="mb-8" data-testid="trace-error">
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void loadTrace("initial");
          }}
        />
      </div>
    );
  }

  const viewOptions: Array<{
    value: TraceViewMode;
    label: string;
    hint?: string;
  }> = [
    { value: "waterfall", label: "Waterfall" },
    { value: "flamegraph", label: "Flame graph" },
    { value: "servicemap", label: "Service map" },
    {
      value: "operations",
      label: "Operations",
      hint: operations.length.toLocaleString(),
    },
  ];

  const renderView: () => ReactElement = (): ReactElement => {
    if (viewMode === "flamegraph") {
      return (
        <div className="rounded-lg border border-gray-200 p-4">
          <FlameGraph
            spans={visibleSpanModels}
            telemetryServices={servicesWithUnknown}
            onSpanSelect={(spanId: string) => {
              selectSpan(spanId);
            }}
            selectedSpanId={selectedSpanId || undefined}
          />
        </div>
      );
    }

    if (viewMode === "servicemap") {
      return (
        <div className="rounded-lg border border-gray-200 p-4">
          <TraceServiceMap
            spans={visibleSpanModels}
            telemetryServices={servicesWithUnknown}
            onSpanSelect={(spanId: string) => {
              selectSpan(spanId);
            }}
          />
        </div>
      );
    }

    if (viewMode === "operations") {
      return (
        <TraceOperations
          operations={operations}
          serviceInfoById={serviceInfoById}
          onSelectOperation={(operation: OperationSummary) => {
            setSearchText(operation.name);
            setViewMode("waterfall");
            selectSpan(operation.slowestSpanId);
          }}
        />
      );
    }

    return (
      <TraceWaterfall
        tree={tree}
        rows={rows}
        serviceInfoById={serviceInfoById}
        selectedSpanId={selectedSpanId}
        onSelectSpan={selectSpan}
        onSetCollapsed={(spanId: string, isCollapsed: boolean) => {
          setCollapsedIds((previous: Set<string>) => {
            if (previous.has(spanId) === isCollapsed) {
              return previous;
            }
            const next: Set<string> = new Set(previous);
            if (isCollapsed) {
              next.add(spanId);
            } else {
              next.delete(spanId);
            }
            return next;
          });
        }}
        onExpandAll={() => {
          setCollapsedIds(EMPTY_ID_SET);
        }}
        onCollapseAll={() => {
          const collapsible: Set<string> = getCollapsibleSpanIds(tree);
          // Keep the roots open so the reader still sees their children.
          for (const root of tree.roots) {
            collapsible.delete(root.span.spanId);
          }
          setCollapsedIds(collapsible);
        }}
        linkedSpanIds={linkedSpanIds}
        criticalPathSpanIds={criticalPathSpanIds}
        searchText={searchText}
        viewport={viewport}
        onViewportChange={setViewport}
        revealRequest={revealRequest}
        emptyMessage="No spans match the current filters."
      />
    );
  };

  return (
    <div className="mb-8 space-y-4" data-testid="trace-explorer">
      {tree.spanCount > 0 ? (
        <TraceHeader
          traceId={traceId}
          summary={summary}
          hasMoreSpans={loadState.hasMore}
          serviceInfoById={serviceInfoById}
          services={serviceSummaries}
          selectedServiceIds={selectedServiceIds}
          onToggleService={toggleService}
          onClearServices={() => {
            setSelectedServiceIds([]);
          }}
          onShowErrors={() => {
            setErrorsOnly(true);
            if (viewMode === "operations") {
              setViewMode("waterfall");
            }
          }}
          isRefreshing={isRefreshing}
          onRefresh={() => {
            void loadTrace("refresh");
          }}
          shareUrl={shareUrl}
          performanceSuggestion={
            perfFixSuggestion.offer !== SuggestionOffer.None ? (
              <TracePerformanceSuggestion
                suggestion={perfFixSuggestion}
                taskRoute={perfFixTaskRoute}
                connectRepositoryRoute={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.CODE] as Route,
                )}
                isCreating={isCreatingPerfFixTask}
                error={perfFixError}
                onFix={() => {
                  void createPerformanceFixTask();
                }}
                onShowSpans={showPerfFixSpans}
              />
            ) : null
          }
        />
      ) : (
        <div
          className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center"
          data-testid="trace-empty"
        >
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-gray-100">
            <Icon icon={IconProp.Search} className="h-5 w-5 text-gray-500" />
          </div>
          <h2 className="mt-3 text-base font-semibold text-gray-900">
            No spans found for this trace
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            Spans usually arrive within a minute of the request finishing.
            Refresh to check again, or look for its logs below.
          </p>
          <p className="mt-2 font-mono text-xs text-gray-400">{traceId}</p>
          <div className="mt-4 flex justify-center">
            <Button
              title="Refresh"
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              isLoading={isRefreshing}
              onClick={() => {
                void loadTrace("refresh");
              }}
            />
          </div>
        </div>
      )}

      {tree.spanCount > 0 && (
        <section
          ref={spansSectionRef}
          className="scroll-mt-4 rounded-xl border border-gray-200 bg-white shadow-sm"
          data-testid="trace-spans"
        >
          <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
            {/* Four views do not fit a phone's width: let them scroll. */}
            <div className="max-w-full overflow-x-auto">
              <ExceptionSegmentedControl<TraceViewMode>
                label="Trace view"
                options={viewOptions}
                value={viewMode}
                onChange={setViewMode}
                testId="trace-view"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/*
               * A row of its own on a phone: beside the two filters it was
               * squeezed to nothing, its match count and arrows spilling
               * out of the card.
               */}
              <div className="relative flex w-full min-w-0 items-center sm:w-auto sm:flex-none">
                <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center">
                  <Icon
                    icon={IconProp.Search}
                    className="h-4 w-4 text-gray-400"
                  />
                </span>
                <input
                  data-unsaved-changes-ignore
                  ref={searchInputRef}
                  type="text"
                  value={searchText}
                  placeholder="Search spans by name, ID or service"
                  aria-label="Search spans"
                  data-testid="trace-search"
                  className={`w-full rounded-md border border-gray-300 py-1.5 pl-8 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:w-80 ${searchText.trim().length > 0 ? "pr-36" : "pr-8"}`}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setSearchText(event.target.value);
                  }}
                  onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      goToMatch(event.shiftKey ? -1 : 1);
                    } else if (event.key === "Escape") {
                      setSearchText("");
                    }
                  }}
                />
                <div className="absolute right-1.5 flex items-center gap-0.5">
                  {searchText.trim().length > 0 ? (
                    <>
                      <span
                        className="mr-1 whitespace-nowrap text-xs tabular-nums text-gray-500"
                        data-testid="trace-search-count"
                        aria-live="polite"
                      >
                        {matchIds.length > 0 &&
                        selectedSpanId &&
                        matchIds.includes(selectedSpanId)
                          ? `${matchIds.indexOf(selectedSpanId) + 1} of ${matchCount}`
                          : pluralize(matchCount, "match", "matches")}
                      </span>
                      <button
                        type="button"
                        className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
                        aria-label="Previous match"
                        disabled={matchCount === 0}
                        onClick={() => {
                          goToMatch(-1);
                        }}
                      >
                        <Icon
                          icon={IconProp.ChevronUp}
                          className="h-3.5 w-3.5"
                        />
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
                        aria-label="Next match"
                        disabled={matchCount === 0}
                        onClick={() => {
                          goToMatch(1);
                        }}
                      >
                        <Icon
                          icon={IconProp.ChevronDown}
                          className="h-3.5 w-3.5"
                        />
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label="Clear search"
                        onClick={() => {
                          setSearchText("");
                        }}
                      >
                        <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <kbd
                      className="rounded border border-gray-200 bg-gray-50 px-1.5 font-sans text-[10px] text-gray-400"
                      title="Press / to search"
                    >
                      /
                    </kbd>
                  )}
                </div>
              </div>
              <button
                type="button"
                aria-pressed={errorsOnly}
                data-testid="trace-errors-only"
                disabled={summary.errorCount === 0 && !errorsOnly}
                title={
                  summary.errorCount === 0
                    ? "No span in this trace has an error status"
                    : "Show only spans with an error status"
                }
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                  errorsOnly
                    ? "border-red-300 bg-red-50 text-red-700"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                }`}
                onClick={() => {
                  setErrorsOnly(!errorsOnly);
                }}
              >
                <Icon icon={IconProp.Error} className="h-4 w-4" />
                Errors only
                <span
                  className={`rounded-full px-1.5 text-xs tabular-nums ${errorsOnly ? "bg-red-100" : "bg-gray-100 text-gray-600"}`}
                >
                  {summary.errorCount.toLocaleString()}
                </span>
              </button>
              {viewMode === "waterfall" && (
                <button
                  type="button"
                  aria-pressed={showCriticalPath}
                  data-testid="trace-critical-path"
                  title="Highlight the chain of spans that determined how long the trace took"
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium ${
                    showCriticalPath
                      ? "border-gray-800 bg-gray-900 text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                  onClick={() => {
                    setShowCriticalPath(!showCriticalPath);
                  }}
                >
                  <Icon icon={IconProp.Bolt} className="h-4 w-4" />
                  Critical path
                </button>
              )}
            </div>
          </div>

          {(hasActiveFilter ||
            (showCriticalPath && criticalPath && viewMode === "waterfall")) && (
            <div
              className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50/60 px-4 py-2 text-xs text-gray-600"
              data-testid="trace-filter-summary"
            >
              {hasActiveFilter && (
                <>
                  <span className="font-medium text-gray-700">
                    {pluralize(matchCount, "span")} of{" "}
                    {tree.spanCount.toLocaleString()} match
                  </span>
                  {searchText.trim() && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 ring-1 ring-gray-200">
                      Search: “{searchText.trim()}”
                      <button
                        type="button"
                        aria-label="Remove search filter"
                        className="text-gray-400 hover:text-gray-700"
                        onClick={() => {
                          setSearchText("");
                        }}
                      >
                        <Icon icon={IconProp.Close} className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                  {errorsOnly && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 ring-1 ring-gray-200">
                      Errors only
                      <button
                        type="button"
                        aria-label="Remove errors only filter"
                        className="text-gray-400 hover:text-gray-700"
                        onClick={() => {
                          setErrorsOnly(false);
                        }}
                      >
                        <Icon icon={IconProp.Close} className="h-3 w-3" />
                      </button>
                    </span>
                  )}
                  {selectedServiceIds.map((serviceId: string): ReactElement => {
                    const service: TraceServiceInfo = getServiceInfo(
                      serviceInfoById,
                      serviceId,
                    );
                    return (
                      <span
                        key={serviceId}
                        className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 ring-1 ring-gray-200"
                      >
                        <span
                          className="h-2 w-2 rounded-sm"
                          style={{ backgroundColor: service.color }}
                          aria-hidden="true"
                        />
                        {service.name}
                        <button
                          type="button"
                          aria-label={`Remove ${service.name} filter`}
                          className="text-gray-400 hover:text-gray-700"
                          onClick={() => {
                            toggleService(serviceId);
                          }}
                        >
                          <Icon icon={IconProp.Close} className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                  <button
                    type="button"
                    className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                    data-testid="trace-clear-filters"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </button>
                </>
              )}
              {showCriticalPath && criticalPath && viewMode === "waterfall" && (
                <span
                  className={hasActiveFilter ? "sm:ml-auto" : ""}
                  data-testid="trace-critical-path-summary"
                >
                  <span className="font-medium text-gray-800">
                    Critical path:
                  </span>{" "}
                  {pluralize(criticalPath.criticalPathSpanIds.length, "span")} ·
                  outlined in the waterfall; other spans are dimmed
                </span>
              )}
            </div>
          )}

          {(loadState.hasMore || (error && spans.length > 0)) && (
            <div
              className="flex flex-col gap-2 border-b border-gray-200 bg-sky-50/60 px-4 py-2 text-xs text-sky-900 sm:flex-row sm:items-center sm:justify-between"
              data-testid="trace-load-more"
            >
              {error && spans.length > 0 ? (
                <span className="text-red-700" role="alert">
                  {error}
                </span>
              ) : (
                <span>
                  {loadState.totalSpanCount === null ? (
                    <>
                      Showing the first{" "}
                      {loadState.loadedSpanCount.toLocaleString()} spans.
                    </>
                  ) : (
                    <>
                      Showing {loadState.loadedSpanCount.toLocaleString()} of{" "}
                      {loadState.totalSpanCount.toLocaleString()} spans.
                    </>
                  )}{" "}
                  Large traces load in batches; totals above cover the loaded
                  spans.
                </span>
              )}
              {loadState.hasMore && (
                <div className="flex flex-none items-center gap-2">
                  {isLoadingMoreSpans ? (
                    <span className="inline-flex items-center gap-2 font-medium">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
                      Loading spans…
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="rounded-md border border-sky-200 bg-white px-2.5 py-1 font-medium text-sky-800 hover:bg-gray-50"
                        data-testid="trace-load-next"
                        onClick={() => {
                          void loadMoreSpans(false);
                        }}
                      >
                        {/*
                         * Until the spans are counted, the next page may
                         * hold fewer than a page's worth: no number.
                         */}
                        {loadState.totalSpanCount === null ? (
                          "Load more spans"
                        ) : (
                          <>
                            Load{" "}
                            {pluralize(
                              loadState.nextBatchSize,
                              "more span",
                              "more spans",
                            )}
                          </>
                        )}
                      </button>
                      {loadState.remainingSpanCount !== null &&
                        loadState.remainingSpanCount >
                          loadState.nextBatchSize && (
                          <button
                            type="button"
                            className="rounded-md border border-sky-200 bg-white px-2.5 py-1 font-medium text-sky-800 hover:bg-gray-50"
                            data-testid="trace-load-all"
                            onClick={() => {
                              void loadMoreSpans(true);
                            }}
                          >
                            Load all{" "}
                            {loadState.remainingSpanCount.toLocaleString()}
                          </button>
                        )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-start gap-4 p-4">
            <div className="min-w-0 flex-1">{renderView()}</div>
            {selectedNode && selectedSubtree && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-gray-900/30 xl:hidden"
                  aria-hidden="true"
                  onClick={() => {
                    setSelectedSpanId(null);
                  }}
                />
                <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-hidden border-l border-gray-200 bg-white shadow-xl xl:sticky xl:inset-auto xl:top-4 xl:z-auto xl:h-[min(760px,calc(100vh-2rem))] xl:w-[420px] xl:max-w-none xl:flex-none xl:rounded-lg xl:border xl:shadow-none 2xl:w-[480px]">
                  <TraceSpanPanel
                    traceId={traceId}
                    span={selectedNode.span}
                    service={getServiceInfo(
                      serviceInfoById,
                      selectedNode.span.serviceId,
                    )}
                    parentSpan={
                      tree.parentById.has(selectedNode.span.spanId)
                        ? tree.nodesById.get(
                            tree.parentById.get(selectedNode.span.spanId)!,
                          )!.span
                        : null
                    }
                    parentService={
                      tree.parentById.has(selectedNode.span.spanId)
                        ? getServiceInfo(
                            serviceInfoById,
                            tree.nodesById.get(
                              tree.parentById.get(selectedNode.span.spanId)!,
                            )!.span.serviceId,
                          )
                        : null
                    }
                    childCount={selectedNode.children.length}
                    subtree={selectedSubtree}
                    selfTime={selfTimes.get(selectedNode.span.spanId)}
                    traceStartUnixNano={tree.startTimeUnixNano}
                    traceDurationUnixNano={tree.durationUnixNano}
                    isOnCriticalPath={Boolean(
                      criticalPathSpanIds?.has(selectedNode.span.spanId),
                    )}
                    onClose={() => {
                      setSelectedSpanId(null);
                    }}
                    onSelectSpan={(spanId: string) => {
                      selectSpan(spanId);
                    }}
                    onZoomToSpan={() => {
                      setViewMode("waterfall");
                      setViewport(
                        getViewportForSpan({
                          span: selectedNode.span,
                          traceStartUnixNano: tree.startTimeUnixNano,
                          traceDurationUnixNano: tree.durationUnixNano,
                        }),
                      );
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </section>
      )}

      <TraceSignals
        traceId={traceId}
        traceWindow={traceWindow}
        rootServiceId={tree.roots[0]?.span.serviceId || null}
        rootServiceName={
          tree.roots[0]?.span.serviceId
            ? serviceNameById.get(tree.roots[0].span.serviceId) || null
            : null
        }
        podEntityKeys={tracePods.keys}
        podCount={tracePods.totalCount}
      />
    </div>
  );
};

export default TraceExplorer;
