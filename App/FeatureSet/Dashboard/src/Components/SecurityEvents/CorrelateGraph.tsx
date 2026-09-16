import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  FitViewOptions,
  Node,
  NodeOrigin,
  ReactFlowInstance,
  Viewport,
} from "reactflow";
import "reactflow/dist/style.css";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { Slate500 } from "Common/Types/BrandColors";
import Input from "Common/UI/Components/Input/Input";
import Icon from "Common/UI/Components/Icon/Icon";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue from "Common/UI/Utils/Translation";
import { useTranslation } from "react-i18next";
import { LayoutPoint } from "../../Utils/LayeredGraphLayout";
import computeCorrelationLayout from "../../Utils/CorrelationGraphLayout";
import {
  CompiledCorrelationQueries,
  CorrelationCondition,
  CorrelationConnector,
  CorrelationFieldKey,
  CorrelationFilter,
  CorrelationOperator,
  CorrelationOperatorLabels,
  compileCorrelationFilter,
  describeCorrelationCondition,
  describeCorrelationFilter,
  getCorrelationFieldDefinition,
  getEqualityObservables,
  parseCorrelationFilter,
  serializeCorrelationFilter,
} from "../../Utils/SecurityEventCorrelation";
import {
  CENTER_NODE_ID,
  CLASS_NODE_PREFIX,
  CorrelationGraphData,
  CorrelationGraphEdge,
  CorrelationGraphNode,
  CorrelationGraphSummary,
  CorrelationNeighborhood,
  OBSERVABLE_NODE_PREFIX,
  UNCLASSIFIED_CLASS_NAME,
  buildCorrelationGraph,
  dedupeSecurityEvents,
  getCorrelationGraphSummary,
  getCorrelationNeighborhood,
  rankClassNodes,
  rankObservableNodes,
} from "../../Utils/CorrelationGraph";
import ExceptionSegmentedControl from "../Exceptions/ExceptionSegmentedControl";
import CorrelateFilterBuilder, {
  getDefaultCorrelationCondition,
} from "./CorrelateFilterBuilder";
import CorrelateFilterChips from "./CorrelateFilterChips";
import {
  CORRELATE_NODE_SIZES,
  CORRELATE_NODE_TYPE,
  CORRELATE_NODE_TYPES,
  CorrelateNodeData,
} from "./CorrelateNodeCard";
import {
  CorrelateClassEventsPanel,
  CorrelateObservablePivotPanel,
  CorrelateOverview,
} from "./CorrelateInspector";
import {
  CorrelateGraphLegend,
  CorrelateResultStats,
} from "./CorrelateResultSummary";
import SecurityEventDetail from "./SecurityEventDetail";

/*
 * Entity-neighborhood graph over security events: the applied filter in the
 * middle, one node per event class that matched it, one node per
 * co-occurring observable (capped at the most frequent 30).
 *
 * The filter is either the quick single-observable search (the original
 * UX, kept as a shorthand) or a chain of field/operator/value conditions
 * with one AND/OR connector. AND compiles to a single server query; OR runs
 * one query per condition and unions the results by event id (the analytics
 * query API has no cross-column OR). Filter + time range live in the URL
 * (`q`, `hours` — plus `observable` as a simple deep-link param other pages
 * use), so a correlation is shareable and pivots survive reloads.
 *
 * Selecting a class lists its events (each opens the full event detail);
 * selecting an observable offers pivots (focus / add condition / exclude).
 * The overview under the graph lists the same nodes as buttons, which is
 * also the keyboard path — React Flow never fires onNodeClick from the
 * keyboard.
 */

const EVENT_LIMIT: number = 200;
const DRILL_DOWN_ROW_LIMIT: number = 50;

// Edge counts stay readable only on small graphs (or around a selection).
const EDGE_LABEL_LIMIT: number = 24;

const MIN_CANVAS_HEIGHT: number = 420;
const MAX_CANVAS_HEIGHT: number = 680;

// Phones: the canvas follows the drawing's shape instead.
const MIN_NARROW_CANVAS_HEIGHT: number = 280;
const MAX_NARROW_CANVAS_HEIGHT: number = 520;

// Width of the selection panel that floats over the canvas (22rem).
const INSPECTOR_WIDTH_PX: number = 352;

/*
 * Below this width the graph is drawn round rather than wide, since a phone
 * canvas is about as tall as it is wide.
 */
const WIDE_CANVAS_QUERY: string = "(min-width: 768px)";
const WIDE_LAYOUT_STRETCH: number = 1.6;
const NARROW_LAYOUT_STRETCH: number = 1;

/*
 * The selection panel only floats over the canvas once the canvas is wide
 * enough to lose 22rem and still show the graph; below this it stacks
 * under the canvas.
 */
const FLOATING_PANEL_QUERY: string = "(min-width: 1280px)";

const SELECTED_ACCENT: string = "#6366f1";

const FIT_VIEW_OPTIONS: FitViewOptions = { padding: 0.16, maxZoom: 1 };
const NODE_ORIGIN: NodeOrigin = [0.5, 0.5];

const timeRangeOptions: Array<DropdownOption> = [
  { label: "Last 1 hour", value: 1 },
  { label: "Last 6 hours", value: 6 },
  { label: "Last 24 hours", value: 24 },
  { label: "Last 7 days", value: 168 },
  { label: "Last 30 days", value: 720 },
];

const widenLabels: Record<number, string> = {
  6: "Search last 6 hours",
  24: "Search last 24 hours",
  168: "Search last 7 days",
  720: "Search last 30 days",
};

const eventSelect: Select<SecurityEvent> = {
  _id: true,
  time: true,
  eventUid: true,
  categoryName: true,
  className: true,
  activityName: true,
  severityName: true,
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
  targetUser: true,
  targetHost: true,
  targetIp: true,
  targetPort: true,
  targetResource: true,
  observables: true,
  attributes: true,
} as Select<SecurityEvent>;

type BuilderMode = "auto" | "close" | "keep";
type SearchMode = "simple" | "builder";
type ErrorKind = "filter" | "request";

interface ResultWindow {
  start: Date;
  end: Date;
}

interface GraphLayout {
  positions: Map<string, LayoutPoint>;
  canvasHeight: number;
}

function singleObservableFilter(observable: string): CorrelationFilter {
  return {
    conditions: [
      {
        field: CorrelationFieldKey.Observable,
        operator: CorrelationOperator.Equals,
        value: observable,
      },
    ],
    connector: "and",
  };
}

/*
 * The quick input mirrors the applied filter only when the filter is
 * exactly one "Observable is X" condition — anything richer belongs to the
 * builder.
 */
function quickValueForFilter(filter: CorrelationFilter | null): string {
  if (
    filter &&
    filter.conditions.length === 1 &&
    filter.conditions[0]!.field === CorrelationFieldKey.Observable &&
    filter.conditions[0]!.operator === CorrelationOperator.Equals
  ) {
    return filter.conditions[0]!.value;
  }
  return "";
}

/*
 * "Any of one condition" is just that condition. Normalizing keeps the
 * AND-only pivots (Exclude, Filter to this class) available once an OR
 * filter is trimmed to a single condition — the connector switch is hidden
 * for one row, so there would be no way back.
 */
export function normalizeCorrelationFilter(
  filter: CorrelationFilter | null,
): CorrelationFilter | null {
  if (filter && filter.conditions.length <= 1 && filter.connector !== "and") {
    return { ...filter, connector: "and" };
  }
  return filter;
}

// The next longer preset after `hours`, or null when already at the longest.
export function getNextWiderTimeRange(hours: number): number | null {
  const longer: Array<number> = timeRangeOptions
    .map((option: DropdownOption): number => {
      return option.value as number;
    })
    .filter((value: number): boolean => {
      return value > hours;
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });
  return longer.length > 0 ? longer[0]! : null;
}

/*
 * Canvas height from the drawing, so small graphs don't float in space.
 * Pass `narrowCanvasWidth` on phones: the height then follows the
 * drawing's aspect ratio at that width, since a fixed tall canvas leaves
 * half of a narrow screen empty.
 */
export function getCanvasHeight(
  nodes: Array<CorrelationGraphNode>,
  positions: Map<string, LayoutPoint>,
  narrowCanvasWidth?: number | undefined,
): number {
  let minX: number = Infinity;
  let maxX: number = -Infinity;
  let minY: number = Infinity;
  let maxY: number = -Infinity;
  for (const node of nodes) {
    const point: LayoutPoint | undefined = positions.get(node.id);
    if (!point) {
      continue;
    }
    const halfWidth: number = CORRELATE_NODE_SIZES[node.kind].width / 2;
    const halfHeight: number = CORRELATE_NODE_SIZES[node.kind].height / 2;
    minX = Math.min(minX, point.x - halfWidth);
    maxX = Math.max(maxX, point.x + halfWidth);
    minY = Math.min(minY, point.y - halfHeight);
    maxY = Math.max(maxY, point.y + halfHeight);
  }
  const drawingHeight: number = Number.isFinite(minY) ? maxY - minY : 0;
  const drawingWidth: number = Number.isFinite(minX) ? maxX - minX : 0;

  if (narrowCanvasWidth && narrowCanvasWidth > 0 && drawingWidth > 0) {
    return Math.round(
      Math.min(
        MAX_NARROW_CANVAS_HEIGHT,
        Math.max(
          MIN_NARROW_CANVAS_HEIGHT,
          (narrowCanvasWidth * drawingHeight) / drawingWidth,
        ),
      ),
    );
  }

  return Math.round(
    Math.min(
      MAX_CANVAS_HEIGHT,
      Math.max(MIN_CANVAS_HEIGHT, drawingHeight * 0.85 + 60),
    ),
  );
}

// Without matchMedia (tests, old browsers) assume a desktop-sized screen.
function matchesMedia(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return true;
  }
  return window.matchMedia(query).matches;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>((): boolean => {
    return matchesMedia(query);
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }
    const mediaQuery: MediaQueryList = window.matchMedia(query);
    const onChange: () => void = (): void => {
      setMatches(mediaQuery.matches);
    };
    onChange();
    mediaQuery.addEventListener?.("change", onChange);
    return () => {
      mediaQuery.removeEventListener?.("change", onChange);
    };
  }, [query]);

  return matches;
}

// Width of an element, kept current with a ResizeObserver where available.
function useElementWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState<number>(0);

  useEffect(() => {
    if (!element) {
      return undefined;
    }
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer: ResizeObserver = new ResizeObserver(() => {
      setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);

  return width;
}

function getEdgeWidth(count: number): number {
  return 1 + Math.min(3, Math.log2(Math.max(1, count)));
}

const CorrelateGraph: FunctionComponent = (): ReactElement => {
  const { translateString } = useTranslateValue();
  const { i18n } = useTranslation();
  const language: string = i18n?.language || "";
  const t: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  const [quickValue, setQuickValue] = useState<string>("");
  const [draftConditions, setDraftConditions] = useState<
    Array<CorrelationCondition>
  >([]);
  const [draftConnector, setDraftConnector] =
    useState<CorrelationConnector>("and");
  const [isBuilderOpen, setIsBuilderOpen] = useState<boolean>(false);
  const [appliedFilter, setAppliedFilter] = useState<CorrelationFilter | null>(
    null,
  );
  const [timeRangeInHours, setTimeRangeInHours] = useState<number>(24);
  const [events, setEvents] = useState<Array<SecurityEvent>>([]);
  /*
   * The filter the events on screen were fetched for. During a reload the
   * previous graph stays up (dimmed) and keeps describing its own filter.
   */
  const [resultFilter, setResultFilter] = useState<CorrelationFilter | null>(
    null,
  );
  const [resultWindow, setResultWindow] = useState<ResultWindow | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  const [refreshNonce, setRefreshNonce] = useState<number>(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [detailEvent, setDetailEvent] = useState<SecurityEvent | null>(null);
  const isWideCanvas: boolean = useMediaQuery(WIDE_CANVAS_QUERY);
  const isFloatingPanel: boolean = useMediaQuery(FLOATING_PANEL_QUERY);
  const [canvasElement, setCanvasElement] = useState<HTMLDivElement | null>(
    null,
  );
  const canvasWidth: number = useElementWidth(canvasElement);

  const flowInstance: React.MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);
  const fetchRequestId: React.MutableRefObject<number> = useRef<number>(0);
  const canvasRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const inspectorRef: React.MutableRefObject<HTMLElement | null> =
    useRef<HTMLElement | null>(null);
  // Where keyboard focus goes back to when a panel opened from a list closes.
  const returnFocusRef: React.MutableRefObject<HTMLElement | null> =
    useRef<HTMLElement | null>(null);

  const setCanvasRef: (element: HTMLDivElement | null) => void = useCallback(
    (element: HTMLDivElement | null): void => {
      canvasRef.current = element;
      setCanvasElement(element);
    },
    [],
  );

  const syncUrl: (filter: CorrelationFilter | null, hours: number) => void =
    useCallback((filter: CorrelationFilter | null, hours: number): void => {
      Navigation.setQueryString({
        q: filter ? serializeCorrelationFilter(filter) : null,
        hours: filter ? String(hours) : null,
        observable: null,
      });
    }, []);

  const applyFilter: (
    filter: CorrelationFilter | null,
    builderMode?: BuilderMode,
  ) => void = useCallback(
    (
      requestedFilter: CorrelationFilter | null,
      builderMode?: BuilderMode,
    ): void => {
      const filter: CorrelationFilter | null =
        normalizeCorrelationFilter(requestedFilter);
      setAppliedFilter(filter);
      setQuickValue(quickValueForFilter(filter));
      setDraftConditions(filter ? [...filter.conditions] : []);
      setDraftConnector(filter ? filter.connector : "and");
      setSelectedNodeId(null);
      setDetailEvent(null);
      syncUrl(filter, timeRangeInHours);

      /*
       * A filter the quick input can't show (anything but one "Observable
       * is X") is only editable in the builder, so pivots that produce one
       * open it instead of leaving a blank search box behind.
       */
      if (builderMode === "close") {
        setIsBuilderOpen(false);
      } else if (
        builderMode === "auto" &&
        filter &&
        !quickValueForFilter(filter)
      ) {
        setIsBuilderOpen(true);
      }
    },
    [syncUrl, timeRangeInHours],
  );

  // Seed from the URL — deep links from the events table and shared views.
  useEffect(() => {
    const rawHours: string | null = Navigation.getQueryStringByName("hours");
    let initialHours: number = 24;
    if (rawHours) {
      const parsedHours: number = parseInt(rawHours, 10);
      if (
        timeRangeOptions.some((option: DropdownOption) => {
          return option.value === parsedHours;
        })
      ) {
        initialHours = parsedHours;
        setTimeRangeInHours(parsedHours);
      }
    }

    const parsedFilter: CorrelationFilter | null = parseCorrelationFilter(
      Navigation.getQueryStringByName("q"),
    );
    const rawObservable: string | null =
      Navigation.getQueryStringByName("observable");

    const initialFilter: CorrelationFilter | null = normalizeCorrelationFilter(
      parsedFilter ||
        (rawObservable && rawObservable.trim()
          ? singleObservableFilter(rawObservable.trim())
          : null),
    );

    if (initialFilter) {
      setAppliedFilter(initialFilter);
      setQuickValue(quickValueForFilter(initialFilter));
      setDraftConditions([...initialFilter.conditions]);
      setDraftConnector(initialFilter.connector);
      if (!quickValueForFilter(initialFilter)) {
        setIsBuilderOpen(true);
      }
      syncUrl(initialFilter, initialHours);
    }
    // Mount-only: the URL is an input here, not a subscription.
  }, []);

  useEffect(() => {
    /*
     * Every effect run supersedes whatever fetch is in flight — including
     * the early-return branches below, which would otherwise let a stale
     * response pass the requestId guard and overwrite the cleared state.
     */
    const requestId: number = ++fetchRequestId.current;

    if (!appliedFilter) {
      setEvents([]);
      setResultFilter(null);
      setResultWindow(null);
      setError("");
      setErrorKind(null);
      setIsTruncated(false);
      setIsLoading(false);
      return;
    }

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      setIsLoading(false);
      return;
    }

    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.getSomeHoursAgo(timeRangeInHours);

    const compiled: CompiledCorrelationQueries = compileCorrelationFilter(
      appliedFilter,
      {
        projectId: projectId,
        startDate: startDate,
        endDate: endDate,
      },
    );

    if (compiled.error) {
      // A filter the user can fix — not an outage.
      setError(compiled.error);
      setErrorKind("filter");
      setEvents([]);
      setResultFilter(null);
      setResultWindow(null);
      setIsTruncated(false);
      setIsLoading(false);
      return;
    }

    if (compiled.queries.length === 0) {
      setEvents([]);
      setResultFilter(appliedFilter);
      setResultWindow({ start: startDate, end: endDate });
      setError("");
      setErrorKind(null);
      setIsTruncated(false);
      setIsLoading(false);
      return;
    }

    // The previous graph stays on screen under a loading overlay.
    setIsLoading(true);
    setError("");
    setErrorKind(null);

    const showRequestError: (err: unknown) => void = (err: unknown): void => {
      setError(API.getFriendlyMessage(err));
      setErrorKind("request");
      setEvents([]);
      setResultFilter(null);
      setResultWindow(null);
      setIsTruncated(false);
    };

    const fetchAll: () => Promise<void> = async (): Promise<void> => {
      try {
        const listResults: Array<ListResult<SecurityEvent>> = await Promise.all(
          compiled.queries.map(
            (
              query: Query<SecurityEvent>,
            ): Promise<ListResult<SecurityEvent>> => {
              return AnalyticsModelAPI.getList<SecurityEvent>({
                modelType: SecurityEvent,
                query: query,
                limit: EVENT_LIMIT,
                skip: 0,
                select: eventSelect,
                sort: {
                  time: SortOrder.Descending,
                },
                requestOptions: {},
              });
            },
          ),
        );

        if (requestId !== fetchRequestId.current) {
          return; // A newer correlation superseded this one.
        }

        setEvents(
          dedupeSecurityEvents(
            listResults.map((listResult: ListResult<SecurityEvent>) => {
              return listResult.data;
            }),
          ),
        );
        setIsTruncated(
          listResults.some((listResult: ListResult<SecurityEvent>) => {
            return listResult.data.length >= EVENT_LIMIT;
          }),
        );
        setResultFilter(appliedFilter);
        setResultWindow({ start: startDate, end: endDate });
      } catch (err) {
        if (requestId === fetchRequestId.current) {
          showRequestError(err);
        }
      } finally {
        if (requestId === fetchRequestId.current) {
          setIsLoading(false);
        }
      }
    };

    fetchAll().catch((err: unknown) => {
      if (requestId === fetchRequestId.current) {
        showRequestError(err);
        setIsLoading(false);
      }
    });
  }, [appliedFilter, timeRangeInHours, refreshNonce]);

  const graphData: CorrelationGraphData = useMemo((): CorrelationGraphData => {
    if (!resultFilter || events.length === 0) {
      return { nodes: [], edges: [], droppedCoObservableCount: 0 };
    }

    const centerLabel: string =
      resultFilter.conditions.length === 1
        ? describeCorrelationCondition(resultFilter.conditions[0]!)
        : `${resultFilter.conditions.length} conditions (${
            resultFilter.connector === "or" ? "ANY" : "ALL"
          })`;

    return buildCorrelationGraph({
      events: events,
      centerLabel: centerLabel,
      excludedObservables: getEqualityObservables(resultFilter),
    });
  }, [events, resultFilter]);

  const summary: CorrelationGraphSummary =
    useMemo((): CorrelationGraphSummary => {
      return getCorrelationGraphSummary(graphData);
    }, [graphData]);

  const rankedClasses: Array<CorrelationGraphNode> =
    useMemo((): Array<CorrelationGraphNode> => {
      return rankClassNodes(graphData);
    }, [graphData]);

  const rankedObservables: Array<CorrelationGraphNode> =
    useMemo((): Array<CorrelationGraphNode> => {
      return rankObservableNodes(graphData);
    }, [graphData]);

  const positions: Map<string, LayoutPoint> = useMemo((): Map<
    string,
    LayoutPoint
  > => {
    return computeCorrelationLayout(graphData.nodes, graphData.edges, {
      horizontalStretch: isWideCanvas
        ? WIDE_LAYOUT_STRETCH
        : NARROW_LAYOUT_STRETCH,
    });
  }, [graphData, isWideCanvas]);

  const layout: GraphLayout = useMemo((): GraphLayout => {
    return {
      positions,
      canvasHeight: getCanvasHeight(
        graphData.nodes,
        positions,
        isWideCanvas ? undefined : canvasWidth,
      ),
    };
  }, [graphData, positions, isWideCanvas, canvasWidth]);

  /*
   * Forget a selection whose node is gone once fresh results land, so it
   * can't silently reopen if a later refresh brings the node back.
   */
  useEffect(() => {
    if (
      !isLoading &&
      selectedNodeId &&
      !graphData.nodes.some((node: CorrelationGraphNode): boolean => {
        return node.id === selectedNodeId;
      })
    ) {
      setSelectedNodeId(null);
    }
  }, [graphData, isLoading]);

  /*
   * A selection only means something while its node is on screen — a
   * refresh can drop the class or observable it pointed at.
   */
  const selectedNode: CorrelationGraphNode | undefined = useMemo(():
    | CorrelationGraphNode
    | undefined => {
    if (!selectedNodeId) {
      return undefined;
    }
    return graphData.nodes.find((node: CorrelationGraphNode): boolean => {
      return node.id === selectedNodeId && node.kind !== "center";
    });
  }, [graphData, selectedNodeId]);

  const activeSelectionId: string | null = selectedNode
    ? selectedNode.id
    : null;

  const { nodes, edges } = useMemo((): {
    nodes: Array<Node<CorrelateNodeData>>;
    edges: Array<Edge>;
  } => {
    if (graphData.nodes.length === 0 || !resultFilter) {
      return { nodes: [], edges: [] };
    }

    const hood: CorrelationNeighborhood | null = isLoading
      ? null
      : getCorrelationNeighborhood(graphData, activeSelectionId);

    const builtNodes: Array<Node<CorrelateNodeData>> = graphData.nodes.map(
      (node: CorrelationGraphNode): Node<CorrelateNodeData> => {
        const point: LayoutPoint = layout.positions.get(node.id) || {
          x: 0,
          y: 0,
        };
        const size: { width: number; height: number } =
          CORRELATE_NODE_SIZES[node.kind];

        const baseData: Pick<
          CorrelateNodeData,
          "label" | "kind" | "isSelected" | "isDimmed"
        > = {
          label: node.label,
          kind: node.kind,
          isSelected: node.id === activeSelectionId,
          isDimmed: hood ? !hood.nodeIds.has(node.id) : false,
        };

        let data: CorrelateNodeData;
        if (node.kind === "center") {
          const isSingle: boolean = resultFilter.conditions.length === 1;
          const single: CorrelationCondition | undefined = isSingle
            ? resultFilter.conditions[0]
            : undefined;
          /*
           * "Your filter" only fits the plain "Observable is X" search.
           * Anything else says what the value means — "Observable is not"
           * must never read like the thing being searched for.
           */
          let eyebrow: string = t(
            resultFilter.connector === "or" ? "Match any" : "Match all",
          );
          if (single) {
            eyebrow = quickValueForFilter(resultFilter)
              ? t("Your filter")
              : `${t(getCorrelationFieldDefinition(single.field).label)} ${t(
                  CorrelationOperatorLabels[single.operator],
                )}`;
          }
          data = {
            ...baseData,
            eyebrow,
            title: isSingle
              ? resultFilter.conditions[0]!.value
              : `${resultFilter.conditions.length} ${t("conditions")}`,
            isMonospace: isSingle,
            tooltip: describeCorrelationFilter(resultFilter),
          };
        } else if (node.kind === "class") {
          data = {
            ...baseData,
            label: `${node.label} (${node.count || 0})`,
            title: node.label,
            count: node.count || 0,
            countIsLowerBound: isTruncated,
            worstSeverity: node.worstSeverity,
            tooltip: `${node.label} (${node.count || 0})`,
          };
        } else {
          data = {
            ...baseData,
            title: node.label,
            isMonospace: true,
            count: node.count || 0,
            countIsLowerBound: isTruncated,
            tooltip: node.label,
          };
        }

        /*
         * Explicit width/height keep React Flow v11 from hiding every node
         * for a re-measure each time a selection rebuilds this array.
         */
        return {
          id: node.id,
          type: CORRELATE_NODE_TYPE,
          position: point,
          width: size.width,
          height: size.height,
          draggable: false,
          selectable: false,
          focusable: false,
          data,
        };
      },
    );

    const showAllLabels: boolean = graphData.edges.length <= EDGE_LABEL_LIMIT;

    const nodeLabels: Map<string, string> = new Map<string, string>();
    for (const node of graphData.nodes) {
      nodeLabels.set(
        node.id,
        node.kind === "center"
          ? describeCorrelationFilter(resultFilter)
          : node.label,
      );
    }

    const builtEdges: Array<Edge> = graphData.edges.map(
      (edge: CorrelationGraphEdge): Edge => {
        const isCenterEdge: boolean = edge.from === CENTER_NODE_ID;
        const inHood: boolean = hood ? hood.edgeIds.has(edge.id) : false;
        const showLabel: boolean =
          !isCenterEdge && (hood ? inHood : showAllLabels);

        let stroke: string = "var(--ou-border-strong, #d1d5db)";
        if (inHood) {
          stroke = SELECTED_ACCENT;
        } else if (isCenterEdge) {
          stroke = "var(--ou-chart-tick, #94a3b8)";
        }

        const built: Edge = {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: "straight",
          focusable: false,
          // React Flow's default reads "Edge from class:X to observable:Y".
          ariaLabel: `${nodeLabels.get(edge.from) || edge.from} – ${
            nodeLabels.get(edge.to) || edge.to
          }: ${edge.count} ${t(edge.count === 1 ? "event" : "events")}`,
          style: {
            stroke,
            strokeWidth: getEdgeWidth(edge.count),
            opacity: hood && !inHood ? 0.15 : 0.85,
          },
        };

        if (showLabel) {
          built.label = String(edge.count);
          built.labelShowBg = true;
          built.labelBgPadding = [6, 2];
          built.labelBgBorderRadius = 4;
          built.labelStyle = {
            fontSize: 11,
            fontWeight: 600,
            fill: "var(--ou-text-secondary, #4b5563)",
          };
          built.labelBgStyle = {
            fill: "var(--ou-surface-primary, #ffffff)",
            fillOpacity: 0.95,
            stroke: "var(--ou-border-default, #e5e7eb)",
            strokeWidth: 1,
          };
        }

        return built;
      },
    );

    return { nodes: builtNodes, edges: builtEdges };
    /*
     * `t` is a new closure every render; `language` stands in for it so the
     * cards follow a language switch without rebuilding on every render.
     */
  }, [
    graphData,
    positions,
    activeSelectionId,
    resultFilter,
    isTruncated,
    isLoading,
    language,
  ]);

  /*
   * Re-fit when a different graph lands or the canvas changes size (not on
   * selection).
   */
  const graphKey: string = `${graphData.nodes
    .map((node: CorrelationGraphNode): string => {
      return node.id;
    })
    .join("|")}#${resultWindow ? resultWindow.end.getTime() : 0}#${
    isWideCanvas ? "wide" : "narrow"
  }#${layout.canvasHeight}`;

  useEffect(() => {
    let raf: number = 0;
    let attempts: number = 20;
    /*
     * React Flow learns the pane's new size from a ResizeObserver, which
     * only runs in the frame after this commit — fitting any earlier uses
     * the old height and clips the graph. So skip one frame first, then
     * retry until the nodes are measured.
     */
    let framesToWait: number = 2;
    const tryFit: () => void = (): void => {
      if (framesToWait > 0) {
        framesToWait--;
        raf = requestAnimationFrame(tryFit);
        return;
      }
      const didFit: boolean = Boolean(
        flowInstance.current &&
          graphData.nodes.length > 0 &&
          flowInstance.current.fitView(FIT_VIEW_OPTIONS),
      );
      if (!didFit && attempts > 0) {
        attempts--;
        raf = requestAnimationFrame(tryFit);
      }
    };
    tryFit();
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [graphKey]);

  const fitNow: () => void = (): void => {
    flowInstance.current?.fitView({ ...FIT_VIEW_OPTIONS, duration: 300 });
  };

  /*
   * Bring a selection into view. The panel floats over the right of the
   * canvas on wide screens, so the canvas scrolls into view and a node the
   * panel (or the canvas edge) would hide is panned into the free area. On
   * narrower screens the panel sits under the canvas and scrolls into view.
   */
  const revealSelection: (nodeId: string, moveFocus: boolean) => void = (
    nodeId: string,
    moveFocus: boolean,
  ): void => {
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      return;
    }

    // The panel mounts with this render, so wait for it.
    window.requestAnimationFrame(() => {
      const panel: HTMLElement | null = inspectorRef.current;
      const scrollTarget: HTMLElement | null = isFloatingPanel
        ? canvasRef.current
        : panel;
      const rect: DOMRect | undefined = scrollTarget?.getBoundingClientRect();
      if (
        scrollTarget &&
        rect &&
        (rect.top < 0 || rect.bottom > window.innerHeight)
      ) {
        scrollTarget.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      }
      if (moveFocus && panel) {
        panel.focus({ preventScroll: true });
      }
    });

    if (!isFloatingPanel) {
      return;
    }

    const instance: ReactFlowInstance | null = flowInstance.current;
    const point: LayoutPoint | undefined = layout.positions.get(nodeId);
    const width: number = canvasRef.current?.clientWidth || 0;
    const height: number = canvasRef.current?.clientHeight || 0;
    if (!instance || !point || !width || !height) {
      return;
    }

    const viewport: Viewport = instance.getViewport();
    const size: { width: number; height: number } =
      CORRELATE_NODE_SIZES[
        nodeId.startsWith(CLASS_NODE_PREFIX) ? "class" : "observable"
      ];
    const margin: number = 24;
    const screenX: number = point.x * viewport.zoom + viewport.x;
    const screenY: number = point.y * viewport.zoom + viewport.y;
    const halfWidth: number = (size.width / 2) * viewport.zoom;
    const halfHeight: number = (size.height / 2) * viewport.zoom;
    const visibleRight: number = width - INSPECTOR_WIDTH_PX - margin;

    const isVisible: boolean =
      screenX - halfWidth >= margin &&
      screenX + halfWidth <= visibleRight &&
      screenY - halfHeight >= margin &&
      screenY + halfHeight <= height - margin;

    if (isVisible) {
      return;
    }

    // Centre the node in the part of the canvas the panel leaves free.
    const freeCentreX: number = (width - INSPECTOR_WIDTH_PX) / 2;
    const shiftX: number = (width / 2 - freeCentreX) / viewport.zoom;
    instance.setCenter(point.x + shiftX, point.y, {
      zoom: viewport.zoom,
      duration: 300,
    });
  };

  /*
   * `fromList` marks selections made outside the graph (overview rows, the
   * stat tile, Seen-in chips): keyboard focus follows them into the panel
   * and returns to where it came from when the panel closes.
   */
  const selectNode: (nodeId: string | null, fromList?: boolean) => void = (
    nodeId: string | null,
    fromList?: boolean,
  ): void => {
    setSelectedNodeId(nodeId);
    if (!nodeId) {
      return;
    }
    if (fromList && typeof document !== "undefined") {
      const active: Element | null = document.activeElement;
      if (
        active instanceof HTMLElement &&
        !inspectorRef.current?.contains(active)
      ) {
        returnFocusRef.current = active;
      }
    } else if (!fromList) {
      returnFocusRef.current = null;
    }
    revealSelection(nodeId, Boolean(fromList));
  };

  const closeSelection: () => void = (): void => {
    setSelectedNodeId(null);
    const returnTo: HTMLElement | null = returnFocusRef.current;
    returnFocusRef.current = null;
    if (returnTo && returnTo.isConnected) {
      returnTo.focus({ preventScroll: false });
    }
  };

  const appendCondition: (condition: CorrelationCondition) => void =
    useCallback(
      (condition: CorrelationCondition): void => {
        if (!appliedFilter) {
          applyFilter({ conditions: [condition], connector: "and" }, "auto");
          return;
        }
        applyFilter(
          {
            conditions: [...appliedFilter.conditions, condition],
            connector: appliedFilter.connector,
          },
          "auto",
        );
      },
      [appliedFilter, applyFilter],
    );

  const focusObservable: (observable: string) => void = (
    observable: string,
  ): void => {
    applyFilter(singleObservableFilter(observable), "close");
  };

  const applyDraft: () => void = (): void => {
    if (isBuilderOpen) {
      applyFilter({
        conditions: draftConditions,
        connector: draftConnector,
      });
      return;
    }
    if (quickValue.trim()) {
      applyFilter(singleObservableFilter(quickValue.trim()));
    }
  };

  const openBuilder: () => void = (): void => {
    /*
     * Seed the builder from what is on screen. Freshly typed (unapplied)
     * quick text wins over a stale draft — the user just told us what they
     * want to correlate on.
     */
    const trimmedQuickValue: string = quickValue.trim();
    if (
      trimmedQuickValue &&
      trimmedQuickValue !== quickValueForFilter(appliedFilter)
    ) {
      setDraftConditions(singleObservableFilter(trimmedQuickValue).conditions);
      setDraftConnector("and");
    } else if (draftConditions.length === 0) {
      if (trimmedQuickValue) {
        setDraftConditions(
          singleObservableFilter(trimmedQuickValue).conditions,
        );
      } else {
        setDraftConditions([getDefaultCorrelationCondition()]);
      }
    }
    setIsBuilderOpen(true);
  };

  const closeBuilder: () => void = (): void => {
    setIsBuilderOpen(false);
    setQuickValue(quickValueForFilter(appliedFilter));
  };

  const changeTimeRange: (hours: number) => void = (hours: number): void => {
    setTimeRangeInHours(hours);
    setSelectedNodeId(null);
    if (appliedFilter) {
      syncUrl(appliedFilter, hours);
    }
  };

  const refresh: () => void = (): void => {
    setRefreshNonce((nonce: number): number => {
      return nonce + 1;
    });
  };

  /*
   * Correlate stays disabled until every builder row has a value —
   * matching the quick-search path, and keeping an all-empty default row
   * from ever becoming an error state, a blank chip, and a q URL param
   * that degrades to "no filter" when the link is shared.
   */
  const hasDraftToApply: boolean = isBuilderOpen
    ? draftConditions.length > 0 &&
      draftConditions.every((draftCondition: CorrelationCondition) => {
        return Boolean(draftCondition.value.trim());
      })
    : Boolean(quickValue.trim());

  const renderCorrelateButton: () => ReactElement = (): ReactElement => {
    return (
      <Button
        title="Correlate"
        dataTestId="security-events-correlate-button"
        buttonStyle={ButtonStyleType.PRIMARY}
        icon={IconProp.Graph}
        disabled={!hasDraftToApply || isLoading}
        onClick={applyDraft}
      />
    );
  };

  const renderQueryPanel: () => ReactElement = (): ReactElement => {
    return (
      <section
        data-testid="correlate-query-panel"
        className="rounded-xl border border-gray-200 bg-white shadow-sm"
      >
        <div className="px-4 pt-4 md:px-5">
          <h2 className="text-base font-semibold text-gray-900">
            {t("Correlate")}
          </h2>
          <p className="mt-0.5 max-w-3xl text-sm text-gray-500">
            {t(
              "Start from a host, user, or IP address to see every event class it appears in and the observables seen alongside it.",
            )}
          </p>
        </div>

        <div
          data-testid="correlate-toolbar"
          className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-5"
        >
          <div className="shrink-0">
            <ExceptionSegmentedControl<SearchMode>
              label={t("Search mode")}
              testId="security-events-correlate-toggle"
              value={isBuilderOpen ? "builder" : "simple"}
              options={[
                { value: "simple", label: t("Observable") },
                { value: "builder", label: t("Conditions") },
              ]}
              onChange={(mode: SearchMode) => {
                if (mode === "builder") {
                  openBuilder();
                } else {
                  closeBuilder();
                }
              }}
            />
          </div>

          {isBuilderOpen ? (
            <p className="min-w-[12rem] flex-1 basis-full text-sm text-gray-500 sm:basis-64">
              {t("Combine fields with AND or OR below, then press Correlate.")}
            </p>
          ) : (
            <div className="relative min-w-[12rem] flex-1 basis-full sm:basis-64 lg:max-w-md">
              <span className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center">
                <Icon
                  icon={IconProp.Search}
                  className="h-4 w-4 text-gray-400"
                />
              </span>
              <Input
                dataTestId="security-events-correlate-observable"
                ariaLabel={t("Observable")}
                placeholder="Search a host, user, or IP address"
                disableSpellCheck={true}
                outerDivClassName="relative w-full rounded-md shadow-sm"
                className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={quickValue}
                onChange={(value: string) => {
                  setQuickValue(value);
                }}
                onEnterPress={() => {
                  if (quickValue.trim() && !isLoading) {
                    applyFilter(singleObservableFilter(quickValue.trim()));
                  }
                }}
              />
            </div>
          )}

          <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:items-center [&_button]:ml-0">
            <div
              className="w-full sm:w-44"
              data-testid="security-events-correlate-time-range"
            >
              <Dropdown
                ariaLabel={t("Time Range")}
                isClearable={false}
                options={timeRangeOptions}
                value={
                  timeRangeOptions.find((option: DropdownOption) => {
                    return option.value === timeRangeInHours;
                  }) || timeRangeOptions[2]
                }
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  if (typeof value === "number") {
                    changeTimeRange(value);
                  }
                }}
              />
            </div>
            {!isBuilderOpen && renderCorrelateButton()}
          </div>
        </div>

        {isBuilderOpen && (
          <div className="border-t border-gray-200 px-4 py-4 md:px-5">
            <CorrelateFilterBuilder
              conditions={draftConditions}
              connector={draftConnector}
              onChange={(
                conditions: Array<CorrelationCondition>,
                connector: CorrelationConnector,
              ) => {
                setDraftConditions(conditions);
                setDraftConnector(connector);
              }}
              onSubmit={() => {
                if (hasDraftToApply && !isLoading) {
                  applyDraft();
                }
              }}
              footerAction={renderCorrelateButton()}
            />
          </div>
        )}

        {appliedFilter && (
          <div
            data-testid="correlate-applied-filter"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-b-xl border-t border-gray-200 bg-gray-50 px-4 py-2.5 md:px-5"
          >
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {t("Applied filter")}
            </span>
            <CorrelateFilterChips
              filter={appliedFilter}
              onRemoveCondition={(index: number) => {
                const remaining: Array<CorrelationCondition> =
                  appliedFilter.conditions.filter(
                    (
                      _condition: CorrelationCondition,
                      conditionIndex: number,
                    ) => {
                      return conditionIndex !== index;
                    },
                  );
                applyFilter(
                  remaining.length > 0
                    ? {
                        conditions: remaining,
                        connector: appliedFilter.connector,
                      }
                    : null,
                  remaining.length > 0 ? "auto" : "close",
                );
              }}
              onClearAll={() => {
                applyFilter(null, "close");
              }}
            />
          </div>
        )}
      </section>
    );
  };

  const renderStartState: () => ReactElement = (): ReactElement => {
    const steps: Array<{ title: string; body: string }> = [
      {
        title: "Search",
        body: "Enter an observable, or build conditions across hosts, users, IPs, severity and more.",
      },
      {
        title: "Read the graph",
        body: "Event classes surround your filter, marked by their worst severity. Observables seen in the same events sit on the outer ring.",
      },
      {
        title: "Pivot",
        body: "Select a class to list its events, or an observable to correlate on it, add it to the filter, or exclude it.",
      },
    ];

    return (
      <section
        data-testid="correlate-results"
        className="rounded-xl border border-gray-200 bg-white shadow-sm"
      >
        <EmptyState
          id="security-events-correlate-empty"
          icon={IconProp.Graph}
          paddingClassName="px-4 py-12"
          title="Correlate security events"
          description="Search for a host, user, or IP address, or switch to Conditions to combine fields with AND or OR."
          footer={
            <ol
              data-testid="correlate-start-steps"
              className="grid w-full max-w-3xl gap-3 text-left sm:grid-cols-3"
            >
              {steps.map(
                (
                  step: { title: string; body: string },
                  index: number,
                ): ReactElement => {
                  return (
                    <li
                      key={step.title}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                    >
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                        {index + 1}
                      </span>
                      <p className="mt-2 text-sm font-medium text-gray-900">
                        {t(step.title)}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {t(step.body)}
                      </p>
                    </li>
                  );
                },
              )}
            </ol>
          }
        />
      </section>
    );
  };

  const renderNoResults: () => ReactElement = (): ReactElement => {
    const widerRange: number | null = getNextWiderTimeRange(timeRangeInHours);
    const conditionCount: number = appliedFilter
      ? appliedFilter.conditions.length
      : 0;

    const actions: Array<ReactElement> = [];

    if (widerRange !== null && widenLabels[widerRange]) {
      actions.push(
        <Button
          key="widen"
          dataTestId="correlate-no-results-widen"
          title={widenLabels[widerRange]}
          icon={IconProp.Clock}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          onClick={() => {
            changeTimeRange(widerRange);
          }}
        />,
      );
    }

    if (appliedFilter && conditionCount > 1) {
      actions.push(
        <Button
          key="remove-last"
          dataTestId="correlate-no-results-remove-last"
          title="Remove last condition"
          icon={IconProp.Minus}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          onClick={() => {
            applyFilter(
              {
                conditions: appliedFilter.conditions.slice(0, -1),
                connector: appliedFilter.connector,
              },
              "auto",
            );
          }}
        />,
      );
    }

    if (!isBuilderOpen) {
      actions.push(
        <Button
          key="edit"
          dataTestId="correlate-no-results-edit"
          title="Edit conditions"
          icon={IconProp.Filter}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          onClick={openBuilder}
        />,
      );
    }

    return (
      <EmptyState
        id="security-events-correlate-no-results"
        icon={IconProp.Search}
        paddingClassName="px-4 py-12"
        title="No events found"
        description="No security events matched this filter in the selected time range."
        footer={actions.length > 0 ? <>{actions}</> : undefined}
      />
    );
  };

  const renderInspectorPanel: () => ReactElement | null =
    (): ReactElement | null => {
      if (!selectedNode || isLoading || error || !appliedFilter) {
        return null;
      }

      if (selectedNode.kind === "class") {
        const className: string = selectedNode.label;
        const classEvents: Array<SecurityEvent> = events.filter(
          (event: SecurityEvent): boolean => {
            return (event.className || UNCLASSIFIED_CLASS_NAME) === className;
          },
        );

        return (
          <CorrelateClassEventsPanel
            className={className}
            events={classEvents}
            worstSeverity={selectedNode.worstSeverity}
            countIsLowerBound={isTruncated}
            canFilterToClass={
              appliedFilter.connector === "and" &&
              className !== UNCLASSIFIED_CLASS_NAME
            }
            showOrModeNote={appliedFilter.connector === "or"}
            rowLimit={DRILL_DOWN_ROW_LIMIT}
            onFilterToClass={() => {
              appendCondition({
                field: CorrelationFieldKey.EventClass,
                operator: CorrelationOperator.Equals,
                value: className,
              });
            }}
            onClose={closeSelection}
            onOpenEvent={(event: SecurityEvent) => {
              setDetailEvent(event);
            }}
          />
        );
      }

      const observable: string = selectedNode.label;
      const linkedClasses: Array<{
        id: string;
        name: string;
        worstSeverity?: CorrelationGraphNode["worstSeverity"];
        count: number;
      }> = [];
      for (const edge of graphData.edges) {
        if (edge.to !== selectedNode.id) {
          continue;
        }
        const classNode: CorrelationGraphNode | undefined =
          graphData.nodes.find((node: CorrelationGraphNode): boolean => {
            return node.id === edge.from;
          });
        if (classNode) {
          linkedClasses.push({
            id: classNode.id,
            name: classNode.label,
            worstSeverity: classNode.worstSeverity,
            count: edge.count,
          });
        }
      }

      return (
        <CorrelateObservablePivotPanel
          value={observable}
          eventCount={selectedNode.count || 0}
          countIsLowerBound={isTruncated}
          classes={linkedClasses}
          connector={appliedFilter.connector}
          canExclude={appliedFilter.connector === "and"}
          onFocus={() => {
            focusObservable(observable);
          }}
          onAdd={() => {
            appendCondition({
              field: CorrelationFieldKey.Observable,
              operator: CorrelationOperator.Equals,
              value: observable,
            });
          }}
          onExclude={() => {
            appendCondition({
              field: CorrelationFieldKey.Observable,
              operator: CorrelationOperator.NotEquals,
              value: observable,
            });
          }}
          onSelectClass={(classId: string) => {
            selectNode(classId, true);
          }}
          onDismiss={closeSelection}
        />
      );
    };

  /*
   * The result count doubles as the page's live region, so it stays mounted
   * in every state (visually hidden until there is a graph) — a region that
   * only appears together with its first message is not announced.
   */
  const renderResultsHeader: () => ReactElement = (): ReactElement => {
    const hasResults: boolean = !errorKind && events.length > 0;

    let status: ReactNode = null;
    if (isLoading) {
      status = t("Correlating events…");
    } else if (!errorKind) {
      status = (
        <>
          {events.length}
          {isTruncated ? "+" : ""}{" "}
          {t(events.length === 1 ? "matching event" : "matching events")}.
        </>
      );
    }

    return (
      <div
        data-testid="correlate-results-header"
        className={
          hasResults
            ? "flex flex-col gap-3 border-b border-gray-200 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-5"
            : "sr-only"
        }
      >
        <div className="min-w-0">
          <p
            role="status"
            aria-live="polite"
            data-testid="correlate-result-count"
            className="text-sm font-semibold text-gray-900"
          >
            {status}
          </p>
          {hasResults && resultWindow && (
            <p
              data-testid="correlate-result-window"
              className="mt-0.5 text-xs text-gray-500"
            >
              {t("Searched")}{" "}
              {OneUptimeDate.getDateAsLocalShortDateTimeString(
                resultWindow.start,
              )}{" "}
              –{" "}
              {OneUptimeDate.getDateAsLocalShortDateTimeString(
                resultWindow.end,
              )}
            </p>
          )}
        </div>
        {hasResults && (
          <div className="flex items-center gap-2 [&_button]:ml-0">
            <Button
              dataTestId="correlate-fit-view"
              title="Fit to screen"
              icon={IconProp.Expand}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              onClick={fitNow}
            />
            <Button
              dataTestId="correlate-refresh"
              title="Refresh"
              icon={IconProp.Refresh}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              isLoading={isLoading}
              onClick={refresh}
            />
          </div>
        )}
      </div>
    );
  };

  const renderResults: () => ReactElement = (): ReactElement => {
    const inspectorPanel: ReactElement | null = renderInspectorPanel();

    return (
      <>
        <CorrelateResultStats
          eventCount={events.length}
          isTruncated={isTruncated}
          summary={summary}
          isStale={isLoading}
          onSelectNode={(nodeId: string) => {
            selectNode(nodeId, true);
          }}
        />

        {isTruncated && (
          <div className="px-4 pt-3 md:px-5">
            <div
              data-testid="correlate-truncation-notice"
              role="status"
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800"
            >
              <Icon icon={IconProp.Alert} className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {t(
                  "Each search returns only its 200 most recent events, and at least one reached that limit. Older matches in this time range are missing — treat counts as lower bounds. Narrow the time range or add a condition to see everything.",
                )}
              </p>
            </div>
          </div>
        )}

        <div
          className={`relative ${
            isTruncated ? "mt-3 border-t border-gray-200" : ""
          }`}
        >
          <div
            ref={setCanvasRef}
            data-testid="correlate-canvas"
            role="region"
            aria-label={t("Correlation graph")}
            aria-describedby="correlate-canvas-hint"
            className="relative isolate min-w-0 bg-slate-50"
            style={{ height: `min(${layout.canvasHeight}px, 72vh)` }}
          >
            <p id="correlate-canvas-hint" className="sr-only">
              {t("The same results are listed below the graph.")}
            </p>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={CORRELATE_NODE_TYPES}
              nodeOrigin={NODE_ORIGIN}
              fitView={true}
              fitViewOptions={FIT_VIEW_OPTIONS}
              minZoom={0.1}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
              nodesDraggable={false}
              nodesConnectable={false}
              nodesFocusable={false}
              edgesFocusable={false}
              elementsSelectable={false}
              zoomOnScroll={false}
              zoomOnDoubleClick={false}
              preventScrolling={false}
              onInit={(instance: ReactFlowInstance) => {
                flowInstance.current = instance;
              }}
              onNodeClick={(_event: React.MouseEvent, node: Node) => {
                if (
                  node.id.startsWith(OBSERVABLE_NODE_PREFIX) ||
                  node.id.startsWith(CLASS_NODE_PREFIX)
                ) {
                  selectNode(node.id);
                  return;
                }
                selectNode(null);
              }}
              onPaneClick={() => {
                selectNode(null);
              }}
            >
              <Controls
                showInteractive={false}
                fitViewOptions={FIT_VIEW_OPTIONS}
              />
              <Background
                variant={BackgroundVariant.Dots}
                gap={22}
                size={1}
                color="var(--ou-chart-cursor, #d1d5db)"
              />
            </ReactFlow>
            {isLoading && (
              <div
                data-testid="correlate-canvas-loading"
                className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"
              >
                <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm">
                  <Icon
                    icon={IconProp.Spinner}
                    className="h-3.5 w-3.5 animate-spin"
                  />
                  {t("Correlating events…")}
                </span>
              </div>
            )}
          </div>

          {inspectorPanel && (
            <aside
              ref={inspectorRef}
              tabIndex={-1}
              data-testid="correlate-inspector"
              aria-label={t("Details")}
              className="max-h-[28rem] overflow-y-auto border-t border-gray-200 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 xl:absolute xl:bottom-3 xl:right-3 xl:top-3 xl:z-20 xl:max-h-none xl:w-[22rem] xl:rounded-xl xl:border xl:shadow-lg"
            >
              {inspectorPanel}
            </aside>
          )}
        </div>

        <CorrelateGraphLegend
          droppedObservableCount={graphData.droppedCoObservableCount}
        />

        <div className="border-t border-gray-200">
          <CorrelateOverview
            classes={rankedClasses}
            observables={rankedObservables}
            droppedObservableCount={graphData.droppedCoObservableCount}
            countsAreLowerBounds={isTruncated}
            isStale={isLoading}
            onSelectNode={(nodeId: string) => {
              selectNode(nodeId, true);
            }}
          />
        </div>
      </>
    );
  };

  const renderResultsBody: () => ReactElement = (): ReactElement => {
    if (errorKind === "filter") {
      return (
        <div className="p-4 md:p-5">
          <AlertBanner
            dataTestId="correlate-filter-error"
            type={AlertBannerType.Warning}
            title="This filter can't run"
            rightElement={
              isBuilderOpen ? undefined : (
                <Button
                  dataTestId="correlate-edit-conditions"
                  title="Edit conditions"
                  icon={IconProp.Filter}
                  buttonStyle={ButtonStyleType.NORMAL}
                  buttonSize={ButtonSize.Small}
                  onClick={openBuilder}
                />
              )
            }
          >
            <p>{error}</p>
          </AlertBanner>
        </div>
      );
    }

    if (errorKind === "request") {
      return (
        <div className="p-4 md:p-5">
          <AlertBanner
            dataTestId="correlate-request-error"
            type={AlertBannerType.Danger}
            title="Couldn't load security events"
            rightElement={
              <Button
                dataTestId="correlate-retry"
                title="Try again"
                icon={IconProp.Refresh}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                onClick={refresh}
              />
            }
          >
            <p>{error}</p>
          </AlertBanner>
        </div>
      );
    }

    if (events.length === 0 && isLoading) {
      return (
        <div
          data-testid="correlate-loading"
          className="flex flex-col items-center justify-center gap-3 bg-slate-50"
          style={{ height: MIN_CANVAS_HEIGHT }}
        >
          {/*
           * The Loader is its own status region; the result count above
           * already announces the load, so this copy stays silent.
           */}
          <div aria-hidden="true">
            <Loader loaderType={LoaderType.Bar} size={180} color={Slate500} />
          </div>
          <p className="text-sm text-gray-500">{t("Correlating events…")}</p>
        </div>
      );
    }

    if (events.length === 0) {
      return renderNoResults();
    }

    return renderResults();
  };

  return (
    <div className="space-y-4" data-testid="security-events-correlate">
      {renderQueryPanel()}

      {appliedFilter ? (
        <section
          data-testid="correlate-results"
          aria-busy={isLoading}
          className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
        >
          {renderResultsHeader()}
          {renderResultsBody()}
        </section>
      ) : (
        renderStartState()
      )}

      {detailEvent && (
        <SecurityEventDetail
          securityEvent={detailEvent}
          onClose={() => {
            setDetailEvent(null);
          }}
          onCorrelateObservable={(observable: string) => {
            setDetailEvent(null);
            focusObservable(observable);
          }}
        />
      )}
    </div>
  );
};

export default CorrelateGraph;
