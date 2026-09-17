import React, {
  FunctionComponent,
  ReactElement,
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
  MarkerType,
  Node,
  NodeProps,
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import useTranslateValue from "Common/UI/Utils/Translation";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import EntityDetailPanel, { EntityTrafficSummary } from "./EntityDetailPanel";
import EdgeDetailPanel from "./EdgeDetailPanel";
import TopologyNodeCard, {
  TOPOLOGY_NODE_HEIGHT,
  TOPOLOGY_NODE_WIDTH,
  TopologyNodeStat,
} from "./TopologyNodeCard";
import {
  ServiceOperationalStatus,
  fetchServiceOperationalStatuses,
} from "./OperationalOverlay";
import {
  SERVICE_STATUS_LABELS,
  ServiceMapEdge,
  ServiceMapEntry,
  ServiceMapLayout,
  ServiceMapModel,
  ServiceMapNodeKind,
  ServiceMapStatus,
  ServiceMapVisibility,
  buildServiceMapModel,
  layoutServiceMap,
  resolveServiceMapVisibility,
  summarizeRunsOn,
} from "./ServiceMapViewModel";
import {
  HEALTH_COLORS,
  SERVICE_MAP_TOLERATED_ERROR_RATE,
  edgeWidthForCalls,
  formatCallRate,
  formatDurationMs,
  formatErrorRate,
  metaForEntityType,
} from "./TopologyMeta";

/*
 * Service Map: the project's services and everything they call — other
 * services, databases, remote APIs — drawn left to right in the direction a
 * request travels. Node color is the health of the calls a node answered;
 * edge width is call volume and edge color its error rate.
 *
 * Every figure is the latest ~15-minute window computed by the
 * ComputeServiceDependencies worker; the edge drawer has the history.
 */

const COLUMN_GAP: number = TOPOLOGY_NODE_WIDTH + 110;
const ROW_GAP: number = TOPOLOGY_NODE_HEIGHT + 20;
const ROWS_PER_PAGE: number = 40;
/*
 * Past this many nodes a whole-project drawing stops being readable, so the
 * view opens as a table and the map is one search or focus away.
 */
export const MAX_NODES_FOR_DEFAULT_MAP: number = 60;

export interface ComponentProps {
  entities: Array<InventoryItem>;
  relationships: Array<InventoryItemRelationship>;
  /** Seconds the depends-on metrics were aggregated over (cron window). */
  metricsWindowSeconds: number;
  /** The page's picked range — drives the edge drill-down history query. */
  timeRange: RangeStartAndEndDateTime;
  /** Start of the loaded range; services silent since then are inactive. */
  rangeStart?: Date | null | undefined;
  includeInactive?: boolean | undefined;
  /** Show where a service runs in the Infrastructure view. */
  onOpenInfrastructure?: ((resourceKey: string) => void) | undefined;
}

type ServiceView = "list" | "map";
type ConnectionMetric = "none" | "calls" | "errors" | "latency";

const INCIDENT_FALLBACK_COLOR: string = "#dc2626";
const ALERT_FALLBACK_COLOR: string = "#f59e0b";

export const STATUS_COLORS: Record<ServiceMapStatus, string> = {
  healthy: HEALTH_COLORS.healthy,
  degraded: HEALTH_COLORS.degraded,
  critical: HEALTH_COLORS.critical,
  entry: "#6366f1",
  isolated: HEALTH_COLORS.unknown,
};

const KIND_ICONS: Record<ServiceMapNodeKind, IconProp> = {
  service: IconProp.SquareStack,
  database: IconProp.Database,
  remote: IconProp.Globe,
  external: IconProp.ExternalLink,
};

export function statusColorForEntry(entry: ServiceMapEntry): string {
  if (entry.incidentCount > 0) {
    return entry.incidentColor || INCIDENT_FALLBACK_COLOR;
  }
  if (entry.alertCount > 0) {
    return entry.alertColor || ALERT_FALLBACK_COLOR;
  }
  return STATUS_COLORS[entry.status];
}

export function statusLabelForEntry(entry: ServiceMapEntry): string {
  if (entry.incidentCount > 0) {
    return `${entry.incidentCount} active incident${entry.incidentCount === 1 ? "" : "s"}`;
  }
  if (entry.alertCount > 0) {
    return `${entry.alertCount} active alert${entry.alertCount === 1 ? "" : "s"}`;
  }
  return SERVICE_STATUS_LABELS[entry.status];
}

export function subtitleForEntry(entry: ServiceMapEntry): string {
  return entry.detailLabel
    ? `${entry.typeLabel} · ${entry.detailLabel}`
    : entry.typeLabel;
}

interface ServiceNodeData {
  entry: ServiceMapEntry;
  label: string;
  stats: Array<TopologyNodeStat>;
  footer: string | undefined;
  dimmed: boolean;
  selected: boolean;
}

const ServiceMapCanvasNode: FunctionComponent<NodeProps<ServiceNodeData>> = (
  props: NodeProps<ServiceNodeData>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const entry: ServiceMapEntry = props.data.entry;
  return (
    <TopologyNodeCard
      testId={`service-map-node-${entry.key}`}
      title={entry.label}
      subtitle={translateString(subtitleForEntry(entry)) || ""}
      icon={KIND_ICONS[entry.kind]}
      color={metaForEntityType(entry.entity.entityType).color}
      statusColor={statusColorForEntry(entry)}
      statusLabel={translateString(statusLabelForEntry(entry)) || ""}
      stats={props.data.stats}
      footer={props.data.footer}
      dimmed={props.data.dimmed}
      selected={props.data.selected}
    />
  );
};

const NODE_TYPES: Record<
  string,
  FunctionComponent<NodeProps<ServiceNodeData>>
> = {
  serviceMapNode: ServiceMapCanvasNode,
};

export function statsForEntry(
  entry: ServiceMapEntry,
  windowSeconds: number,
): Array<TopologyNodeStat> {
  const served: boolean = entry.inbound.calls > 0;
  const traffic: ServiceMapEntry["inbound"] = served
    ? entry.inbound
    : entry.outbound;
  if (traffic.calls <= 0) {
    return [];
  }
  const errorRate: number = traffic.errors / traffic.calls;
  return [
    {
      label: served ? "in" : "out",
      value: formatCallRate(traffic.calls, windowSeconds),
    },
    {
      label: "errors",
      value: formatErrorRate(traffic.calls, traffic.errors),
      color:
        errorRate >= 0.05
          ? HEALTH_COLORS.critical
          : errorRate > SERVICE_MAP_TOLERATED_ERROR_RATE
            ? "#b45309"
            : undefined,
    },
    {
      label: "avg",
      value:
        traffic.avgDurationMs === null
          ? "—"
          : formatDurationMs(traffic.avgDurationMs),
    },
  ];
}

const ServiceMapGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const t: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  const [searchText, setSearchTextState] = useState<string>(
    Navigation.getQueryStringByName("search") || "",
  );
  const initialView: string | null =
    Navigation.getQueryStringByName("serviceView");
  const [viewChoice, setViewChoice] = useState<ServiceView | null>(
    initialView === "map" || initialView === "list" ? initialView : null,
  );
  const [attentionOnly, setAttentionOnly] = useState<boolean>(false);
  const [page, setPage] = useState<number>(0);
  const [connectionMetric, setConnectionMetric] =
    useState<ConnectionMetric>("none");
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [focusKey, setFocusKeyState] = useState<string | null>(
    Navigation.getQueryStringByName("focus"),
  );

  /*
   * Debounce the URL mirror: per-keystroke replaceState trips Safari's rate
   * limit; React state stays the source of truth.
   */
  const searchUrlTimeout: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setSearchText: (value: string) => void = (value: string): void => {
    setSearchTextState(value);
    if (searchUrlTimeout.current) {
      clearTimeout(searchUrlTimeout.current);
    }
    searchUrlTimeout.current = setTimeout(() => {
      Navigation.setQueryString({ search: value || null });
    }, 250);
  };
  const setFocusKey: (value: string | null) => void = (
    value: string | null,
  ): void => {
    setFocusKeyState(value);
    Navigation.setQueryString({ focus: value });
  };
  const flowInstance: React.MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);

  useEffect(() => {
    return () => {
      if (searchUrlTimeout.current) {
        clearTimeout(searchUrlTimeout.current);
      }
    };
  }, []);

  const [operationalStatuses, setOperationalStatuses] = useState<
    Map<string, ServiceOperationalStatus>
  >(new Map<string, ServiceOperationalStatus>());

  const modelOptions: {
    rangeStart: Date | undefined;
    includeInactive: boolean;
  } = {
    rangeStart: props.rangeStart || undefined,
    includeInactive: Boolean(props.includeInactive),
  };
  const baseModel: ServiceMapModel = useMemo(() => {
    return buildServiceMapModel(props.entities, props.relationships, {
      ...modelOptions,
    });
  }, [
    props.entities,
    props.relationships,
    props.rangeStart,
    props.includeInactive,
  ]);
  const model: ServiceMapModel = useMemo(() => {
    return buildServiceMapModel(props.entities, props.relationships, {
      ...modelOptions,
      statuses: operationalStatuses,
    });
  }, [
    props.entities,
    props.relationships,
    props.rangeStart,
    props.includeInactive,
    operationalStatuses,
  ]);

  const serviceNames: string = useMemo(() => {
    return baseModel.entries
      .filter((entry: ServiceMapEntry): boolean => {
        return entry.kind === "service";
      })
      .map((entry: ServiceMapEntry): string => {
        return entry.label;
      })
      .join("\n");
  }, [baseModel]);

  useEffect(() => {
    let cancelled: boolean = false;
    const names: Array<string> = serviceNames
      ? serviceNames.split("\n").filter(Boolean)
      : [];
    if (names.length === 0) {
      setOperationalStatuses(new Map<string, ServiceOperationalStatus>());
      return undefined;
    }
    fetchServiceOperationalStatuses(names)
      .then((statuses: Map<string, ServiceOperationalStatus>) => {
        if (!cancelled) {
          setOperationalStatuses(statuses);
        }
      })
      .catch((err: unknown) => {
        /*
         * Best-effort overlay — the map is still useful without it — but
         * keep the failure observable instead of fully silent.
         */
        // eslint-disable-next-line no-console
        console.error("Service Map operational overlay failed to load:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceNames]);

  const entityByKey: Map<string, InventoryItem> = useMemo(() => {
    const map: Map<string, InventoryItem> = new Map<string, InventoryItem>();
    for (const entity of props.entities) {
      if (entity.entityKey) {
        map.set(entity.entityKey, entity);
      }
    }
    return map;
  }, [props.entities]);

  const visibility: ServiceMapVisibility = useMemo(() => {
    return resolveServiceMapVisibility({
      model,
      search: searchText,
      focusKey,
      attentionOnly,
    });
  }, [model, searchText, focusKey, attentionOnly]);
  const effectiveFocusKey: string | null = visibility.effectiveFocusKey;

  /*
   * The default follows the size of the whole map, never the current filter:
   * typing in the search box must not flip the view out from under the user.
   */
  const view: ServiceView =
    viewChoice ||
    (model.entries.length <= MAX_NODES_FOR_DEFAULT_MAP ? "map" : "list");

  const matchedEntries: Array<ServiceMapEntry> = model.entries.filter(
    (entry: ServiceMapEntry): boolean => {
      return visibility.matchedKeys.has(entry.key);
    },
  );
  const serviceCount: number = model.entries.filter(
    (entry: ServiceMapEntry): boolean => {
      return entry.kind === "service";
    },
  ).length;
  const dependencyCount: number = model.entries.length - serviceCount;
  const attentionCount: number = model.entries.filter(
    (entry: ServiceMapEntry): boolean => {
      return entry.needsAttention;
    },
  ).length;
  const pageCount: number = Math.max(
    1,
    Math.ceil(matchedEntries.length / ROWS_PER_PAGE),
  );
  const currentPage: number = Math.min(page, pageCount - 1);
  const pageEntries: Array<ServiceMapEntry> = matchedEntries.slice(
    currentPage * ROWS_PER_PAGE,
    (currentPage + 1) * ROWS_PER_PAGE,
  );
  useEffect(() => {
    setPage(0);
  }, [searchText, effectiveFocusKey, attentionOnly]);

  const changeView: (value: ServiceView) => void = (
    value: ServiceView,
  ): void => {
    setViewChoice(value);
    Navigation.setQueryString({ serviceView: value });
  };
  const resetFilters: () => void = (): void => {
    setSearchText("");
    setFocusKey(null);
    setAttentionOnly(false);
  };
  const focusOn: (key: string) => void = (key: string): void => {
    setSelectedKey(null);
    setSelectedEdgeId(null);
    setSearchText("");
    setAttentionOnly(false);
    setFocusKey(key);
    changeView("map");
  };
  const selectNode: (key: string) => void = (key: string): void => {
    setSelectedEdgeId(null);
    setSelectedKey(key);
  };

  // The table never draws, so a large catalog never pays for a layout.
  const layout: ServiceMapLayout = useMemo(() => {
    if (view !== "map") {
      return {
        positions: new Map<string, { x: number; y: number }>(),
        unconnectedKeys: [],
      };
    }
    return layoutServiceMap({
      visibleKeys: visibility.visibleKeys,
      edges: model.edges,
      columnGap: COLUMN_GAP,
      rowGap: ROW_GAP,
    });
  }, [visibility, model, view]);

  const { nodes, edges } = useMemo((): {
    nodes: Array<Node<ServiceNodeData>>;
    edges: Array<Edge>;
  } => {
    if (view !== "map") {
      return { nodes: [], edges: [] };
    }
    const builtNodes: Array<Node<ServiceNodeData>> = [];
    for (const [key, position] of layout.positions) {
      const entry: ServiceMapEntry | undefined = model.entryByKey.get(key);
      if (!entry) {
        continue;
      }
      const runsOn: string | null = summarizeRunsOn(entry.runsOn, entityByKey);
      builtNodes.push({
        id: key,
        type: "serviceMapNode",
        position,
        data: {
          entry,
          label: entry.label,
          stats: statsForEntry(entry, props.metricsWindowSeconds),
          footer:
            entry.kind === "service"
              ? runsOn
                ? `Runs on ${runsOn}`
                : undefined
              : `Called by ${entry.callers} service${entry.callers === 1 ? "" : "s"}`,
          dimmed: visibility.contextKeys.has(key),
          selected: selectedKey === key,
        },
      });
    }

    const builtEdges: Array<Edge> = model.edges
      .filter((edge: ServiceMapEdge): boolean => {
        return layout.positions.has(edge.from) && layout.positions.has(edge.to);
      })
      .map((edge: ServiceMapEdge): Edge => {
        const color: string =
          edge.health === "unknown" ? "#94a3b8" : HEALTH_COLORS[edge.health];
        const hasMetrics: boolean = edge.calls > 0;
        const metric: ConnectionMetric =
          connectionMetric !== "none"
            ? connectionMetric
            : hoveredEdgeId === edge.id
              ? "calls"
              : "none";
        const label: string | undefined =
          hasMetrics && metric !== "none"
            ? metric === "calls"
              ? formatCallRate(edge.calls, props.metricsWindowSeconds)
              : metric === "errors"
                ? `${formatErrorRate(edge.calls, edge.errors)} errors`
                : formatDurationMs(edge.avgDurationMs ?? undefined)
            : undefined;
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: "default",
          animated: false,
          label,
          /*
           * Keep the metric chip readable in both themes. A fixed slate fill
           * becomes dark text on the dark surface, which makes the label all
           * but disappear. The opaque, bordered background also separates a
           * label from the several colored edges that can cross behind it.
           */
          labelShowBg: true,
          labelStyle: {
            fontSize: 11,
            fill: "var(--ou-text-secondary, #4b5563)",
            fontWeight: 600,
          },
          labelBgStyle: {
            fill: "var(--ou-surface-primary, #ffffff)",
            fillOpacity: 1,
            stroke: "var(--ou-border-default, #e5e7eb)",
            strokeWidth: 1,
          },
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 6,
          markerEnd: { type: MarkerType.ArrowClosed, color },
          style: {
            stroke: color,
            strokeWidth:
              edgeWidthForCalls(edge.calls) +
              (selectedEdgeId === edge.id ? 1.5 : 0),
            opacity:
              visibility.contextKeys.has(edge.from) &&
              visibility.contextKeys.has(edge.to)
                ? 0.35
                : 1,
          },
        };
      });

    return { nodes: builtNodes, edges: builtEdges };
  }, [
    layout,
    model,
    visibility,
    connectionMetric,
    hoveredEdgeId,
    selectedKey,
    selectedEdgeId,
    props.metricsWindowSeconds,
    view,
    entityByKey,
  ]);

  /*
   * Size the canvas to the drawing, within bounds: a three-node map should
   * not float in a screen of dots, and a long column of callers should not
   * be shrunk until its text is unreadable.
   */
  let drawingHeight: number = 0;
  for (const position of layout.positions.values()) {
    drawingHeight = Math.max(drawingHeight, position.y + TOPOLOGY_NODE_HEIGHT);
  }
  const canvasHeight: number = Math.round(
    Math.min(880, Math.max(460, drawingHeight * 0.85 + 120)),
  );

  const visibleGraphKey: string = Array.from(layout.positions.keys()).join("|");

  /*
   * Re-fit when the visible graph changes. A new controlled `nodes` array
   * wipes React Flow's measured dimensions, and fitView no-ops (returns
   * false) until nodes re-measure — retry on animation frames until it
   * lands.
   */
  useEffect(() => {
    if (view !== "map" || layout.positions.size === 0) {
      return undefined;
    }
    let raf: number = 0;
    let attempts: number = 20;
    const tryFit: () => void = (): void => {
      const didFit: boolean = Boolean(
        flowInstance.current &&
          flowInstance.current.fitView({ padding: 0.18, maxZoom: 1 }),
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
  }, [visibleGraphKey, view]);

  const selectedEntry: ServiceMapEntry | null =
    (selectedKey && model.entryByKey.get(selectedKey)) || null;

  if (serviceCount === 0 && baseModel.inactiveServiceCount === 0) {
    return (
      <EmptyState
        id="service-map-empty"
        icon={IconProp.SquareStack}
        title="No services discovered yet"
        description="Send traces from your services with OpenTelemetry and the call graph between them will appear here automatically — no configuration needed."
        footer={
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.TRACES_DOCUMENTATION] as Route,
            )}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            {t("View telemetry setup documentation to send OpenTelemetry data")}
          </Link>
        }
      />
    );
  }

  const unconnectedEntries: Array<ServiceMapEntry> = layout.unconnectedKeys
    .map((key: string): ServiceMapEntry | undefined => {
      return model.entryByKey.get(key);
    })
    .filter((entry: ServiceMapEntry | undefined): entry is ServiceMapEntry => {
      return Boolean(entry);
    })
    .sort((a: ServiceMapEntry, b: ServiceMapEntry): number => {
      return a.label.localeCompare(b.label);
    });

  const renderNoConnections: () => ReactElement = (): ReactElement => {
    return (
      <div
        className="border-b border-gray-200 bg-gradient-to-b from-indigo-50/60 to-white px-6 py-8"
        data-testid="service-map-no-connections"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4 sm:flex-row">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
            <Icon icon={IconProp.FlowDiagram} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">
              {t("No calls between services in this time range")}
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              {t(
                "Your services are reporting, but OneUptime has not seen one call another yet. Connections are discovered from telemetry every 10 minutes when any of these is true:",
              )}
            </p>
            <ul className="mt-3 space-y-2 text-sm text-gray-600">
              <li className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-400" />
                <span>
                  {t(
                    "Requests carry W3C trace context (the traceparent header) from one instrumented service to the next. OpenTelemetry HTTP and gRPC instrumentations do this automatically.",
                  )}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-400" />
                <span>
                  {t(
                    "Services report client spans for the databases and APIs they call (db.system.name, server.address). Those appear as dependencies even though they send no telemetry.",
                  )}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-400" />
                <span>
                  {t(
                    "The OneUptime Kubernetes agent runs with eBPF enabled. It observes calls between pods without any code changes.",
                  )}
                </span>
              </li>
            </ul>
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.TRACES_DOCUMENTATION] as Route,
              )}
              className="mt-4 inline-flex text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              {t("Set up tracing")} <span aria-hidden={true}>&nbsp;→</span>
            </Link>
          </div>
        </div>
      </div>
    );
  };

  const renderUnconnected: () => ReactElement = (): ReactElement => {
    if (unconnectedEntries.length === 0) {
      return <></>;
    }
    return (
      <section
        className="border-t border-gray-200 px-5 py-4"
        aria-label={t("Not connected")}
        data-testid="service-map-unconnected"
      >
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t(
            model.edges.length === 0
              ? "Services reporting"
              : "Not connected to anything in this view",
          )}{" "}
          <span className="font-normal normal-case text-gray-400">
            ({unconnectedEntries.length})
          </span>
        </h4>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {unconnectedEntries.map((entry: ServiceMapEntry): ReactElement => {
            const runsOn: string | null = summarizeRunsOn(
              entry.runsOn,
              entityByKey,
            );
            return (
              <button
                key={entry.key}
                type="button"
                data-testid="service-map-unconnected-item"
                className={`flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${selectedKey === entry.key ? "border-indigo-300 bg-indigo-50" : "border-gray-200 bg-white"}`}
                onClick={() => {
                  selectNode(entry.key);
                }}
              >
                <span
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"
                  style={{
                    color: metaForEntityType(entry.entity.entityType).color,
                    background: `${metaForEntityType(entry.entity.entityType).color}1a`,
                  }}
                >
                  <Icon icon={KIND_ICONS[entry.kind]} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">
                    {entry.label}
                  </span>
                  <span className="block truncate text-xs text-gray-500">
                    {runsOn
                      ? `${t(subtitleForEntry(entry))} · ${runsOn}`
                      : t(subtitleForEntry(entry))}
                  </span>
                </span>
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: statusColorForEntry(entry) }}
                  aria-hidden={true}
                />
              </button>
            );
          })}
        </div>
      </section>
    );
  };

  const renderTable: () => ReactElement = (): ReactElement => {
    return (
      <div className="min-w-0 w-full max-w-full">
        <div
          className="relative min-w-0 w-full max-w-full overflow-x-auto"
          data-testid="service-map-table-scroll"
          role="region"
          aria-label={t("Service directory table")}
          tabIndex={0}
        >
          <table
            className="w-full text-left text-sm"
            data-testid="service-map-list"
          >
            <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  {t("Name")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("Status")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("Requests")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("Error rate")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("Avg latency")}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("Connections")}
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  <span className="sr-only">{t("Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageEntries.map((entry: ServiceMapEntry): ReactElement => {
                const color: string = statusColorForEntry(entry);
                const runsOn: string | null = summarizeRunsOn(
                  entry.runsOn,
                  entityByKey,
                );
                return (
                  <tr
                    key={entry.key}
                    className="hover:bg-gray-50"
                    data-testid="service-map-list-row"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"
                          style={{
                            color: metaForEntityType(entry.entity.entityType)
                              .color,
                            background: `${metaForEntityType(entry.entity.entityType).color}1a`,
                          }}
                          aria-hidden={true}
                        >
                          <Icon
                            icon={KIND_ICONS[entry.kind]}
                            className="h-4 w-4"
                          />
                        </span>
                        <span className="min-w-0">
                          <button
                            type="button"
                            className="max-w-xs break-words text-left font-semibold text-gray-900 hover:text-indigo-600"
                            onClick={() => {
                              selectNode(entry.key);
                            }}
                          >
                            {entry.label}
                          </button>
                          <span className="mt-0.5 block text-xs text-gray-500">
                            {t(subtitleForEntry(entry))}
                            {runsOn ? ` · ${runsOn}` : ""}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 whitespace-nowrap text-xs text-gray-700">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: color }}
                          aria-hidden={true}
                        />
                        {t(statusLabelForEntry(entry))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                      {entry.inbound.calls > 0
                        ? formatCallRate(
                            entry.inbound.calls,
                            props.metricsWindowSeconds,
                          )
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                      {formatErrorRate(
                        entry.inbound.calls,
                        entry.inbound.errors,
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                      {entry.inbound.avgDurationMs === null
                        ? "—"
                        : formatDurationMs(entry.inbound.avgDurationMs)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                      {entry.callers}{" "}
                      {t(entry.callers === 1 ? "caller" : "callers")} ·{" "}
                      {entry.dependencies}{" "}
                      {t(
                        entry.dependencies === 1
                          ? "dependency"
                          : "dependencies",
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        className="whitespace-nowrap text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                        aria-label={`${t("Show on map")} ${entry.label}`}
                        onClick={() => {
                          focusOn(entry.key);
                        }}
                      >
                        {t("Show on map")} <span aria-hidden={true}>→</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {matchedEntries.length > ROWS_PER_PAGE && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-3 text-xs text-gray-500"
            data-testid="service-map-pagination"
          >
            <p>
              {t("Showing")} {currentPage * ROWS_PER_PAGE + 1}–
              {Math.min(
                (currentPage + 1) * ROWS_PER_PAGE,
                matchedEntries.length,
              )}{" "}
              {t("of")} {matchedEntries.length}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label={t("Previous page")}
                disabled={currentPage === 0}
                className="rounded-md border border-gray-200 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  setPage(currentPage - 1);
                }}
              >
                {t("Previous")}
              </button>
              <span>
                {t("Page")} {currentPage + 1} {t("of")} {pageCount}
              </span>
              <button
                type="button"
                aria-label={t("Next page")}
                disabled={currentPage >= pageCount - 1}
                className="rounded-md border border-gray-200 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => {
                  setPage(currentPage + 1);
                }}
              >
                {t("Next")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMap: () => ReactElement = (): ReactElement => {
    return (
      <>
        {model.edges.length === 0 ? (
          renderNoConnections()
        ) : layout.positions.size === 0 ? (
          <div
            className="border-b border-gray-200 px-6 py-10 text-center text-sm text-gray-500"
            data-testid="service-map-nothing-connected"
          >
            {t(
              "None of the services in this view are connected. Clear the filters to see the whole map.",
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-5 py-3">
              <label className="flex items-center gap-2 text-xs text-gray-600">
                {t("Connection labels")}
                <select
                  className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs"
                  aria-label={t("Connection labels")}
                  value={connectionMetric}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                    setConnectionMetric(event.target.value as ConnectionMetric);
                  }}
                >
                  <option value="none">{t("On hover")}</option>
                  <option value="calls">{t("Request rate")}</option>
                  <option value="errors">{t("Error rate")}</option>
                  <option value="latency">{t("Average latency")}</option>
                </select>
              </label>
              <button
                type="button"
                className="ml-auto rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                onClick={() => {
                  flowInstance.current?.fitView({
                    padding: 0.18,
                    maxZoom: 1,
                    duration: 300,
                  });
                }}
              >
                {t("Fit to screen")}
              </button>
            </div>
            <div
              style={{ height: canvasHeight, width: "100%" }}
              className="bg-slate-50"
              data-testid="service-map-canvas"
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                fitView={true}
                fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
                minZoom={0.1}
                maxZoom={1.5}
                proOptions={{ hideAttribution: true }}
                nodesDraggable={true}
                nodesConnectable={false}
                elementsSelectable={true}
                onInit={(instance: ReactFlowInstance) => {
                  flowInstance.current = instance;
                }}
                onNodeClick={(_event: React.MouseEvent, node: Node) => {
                  selectNode(node.id);
                }}
                onEdgeClick={(_event: React.MouseEvent, edge: Edge) => {
                  setSelectedKey(null);
                  setSelectedEdgeId(edge.id);
                }}
                onEdgeMouseEnter={(_event: React.MouseEvent, edge: Edge) => {
                  setHoveredEdgeId(edge.id);
                }}
                onEdgeMouseLeave={() => {
                  setHoveredEdgeId(null);
                }}
              >
                <Controls showInteractive={false} />
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={22}
                  size={1}
                  color="var(--ou-chart-grid, #cbd5e1)"
                />
              </ReactFlow>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-200 px-5 py-3 text-xs text-gray-500">
              {(
                [
                  "healthy",
                  "degraded",
                  "critical",
                  "entry",
                ] as Array<ServiceMapStatus>
              ).map((status: ServiceMapStatus): ReactElement => {
                return (
                  <span
                    key={status}
                    className="inline-flex items-center gap-1.5"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[status] }}
                      aria-hidden={true}
                    />
                    {t(SERVICE_STATUS_LABELS[status])}
                  </span>
                );
              })}
              <span className="ml-auto">
                {t(
                  "Arrows point from caller to callee · thicker lines carry more requests",
                )}
              </span>
            </div>
          </>
        )}
        {renderUnconnected()}
      </>
    );
  };

  const selectedEdge: ServiceMapEdge | undefined = selectedEdgeId
    ? model.edges.find((edge: ServiceMapEdge): boolean => {
        return edge.id === selectedEdgeId;
      })
    : undefined;

  const trafficFor: (entry: ServiceMapEntry) => EntityTrafficSummary = (
    entry: ServiceMapEntry,
  ): EntityTrafficSummary => {
    return {
      inbound: entry.inbound,
      outbound: entry.outbound,
      statusLabel: statusLabelForEntry(entry),
      statusColor: statusColorForEntry(entry),
      subtitle: subtitleForEntry(entry),
    };
  };

  return (
    <div
      className="min-w-0 w-full max-w-full"
      data-testid="service-map-explorer"
    >
      <div
        className="mb-5 grid min-w-0 w-full max-w-full grid-cols-2 gap-3 xl:grid-cols-4"
        data-testid="service-map-summary"
      >
        {[
          {
            label: "Services",
            value: serviceCount,
            detail:
              baseModel.inactiveServiceCount > 0 && !props.includeInactive
                ? `${baseModel.inactiveServiceCount} inactive not shown`
                : "Reporting in this time range",
            icon: IconProp.SquareStack,
          },
          {
            label: "Dependencies",
            value: dependencyCount,
            detail: "Databases and APIs your services call",
            icon: IconProp.Database,
          },
          {
            label: "Connections",
            value: model.edges.length,
            detail: "Distinct caller → callee pairs",
            icon: IconProp.FlowDiagram,
          },
          {
            label: "Need attention",
            value: attentionCount,
            detail: "Errors, incidents or alerts",
            icon: IconProp.Alert,
          },
        ].map(
          (stat: {
            label: string;
            value: number;
            detail: string;
            icon: IconProp;
          }): ReactElement => {
            const warn: boolean =
              stat.label === "Need attention" && stat.value > 0;
            return (
              <div
                key={stat.label}
                className="min-w-0 rounded-xl border border-gray-200 bg-white px-5 py-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-gray-500">
                    {t(stat.label)}
                  </p>
                  <Icon
                    icon={stat.icon}
                    className={`h-4 w-4 ${warn ? "text-amber-500" : "text-indigo-400"}`}
                  />
                </div>
                <p
                  className={`mt-2 text-3xl font-semibold tracking-tight ${warn ? "text-amber-600" : "text-gray-900"}`}
                >
                  {stat.value}
                </p>
                <p className="mt-1 truncate text-xs text-gray-500">
                  {t(stat.detail)}
                </p>
              </div>
            );
          },
        )}
      </div>

      <div className="min-w-0 w-full max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-gray-200 px-5 py-4 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-gray-900">
              {t("Service dependencies")}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {t(
                "Who calls whom, how much, and how healthy those calls are. Select anything for details.",
              )}
            </p>
          </div>
          <div
            className="inline-flex max-w-full self-start rounded-lg bg-gray-100 p-1"
            role="group"
            aria-label={t("Service view")}
          >
            {(["map", "list"] as Array<ServiceView>).map(
              (option: ServiceView): ReactElement => {
                return (
                  <button
                    key={option}
                    type="button"
                    data-testid={`service-map-view-${option}`}
                    aria-pressed={view === option}
                    className={`flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${view === option ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                    onClick={() => {
                      changeView(option);
                    }}
                  >
                    <Icon
                      icon={
                        option === "map"
                          ? IconProp.FlowDiagram
                          : IconProp.TableCells
                      }
                      className="h-4 w-4"
                    />
                    {t(option === "map" ? "Map" : "Table")}
                  </button>
                );
              },
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-3 md:flex-row md:items-center">
          <div className="min-w-0 w-full md:w-80">
            <Input
              dataTestId="service-map-search"
              ariaLabel={t("Search services")}
              placeholder={t("Search services and dependencies")}
              value={searchText}
              onChange={(value: string) => {
                setSearchText(value);
              }}
            />
          </div>
          <button
            type="button"
            data-testid="service-map-attention-filter"
            aria-pressed={attentionOnly}
            className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${attentionOnly ? "border-amber-300 bg-amber-50 text-amber-800" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
            onClick={() => {
              setAttentionOnly(!attentionOnly);
            }}
          >
            <span
              className="h-2 w-2 rounded-full bg-amber-500"
              aria-hidden={true}
            />
            {t("Needs attention")}
            <span className="rounded bg-gray-100 px-1.5 text-xs text-gray-600">
              {attentionCount}
            </span>
          </button>
          {(searchText.trim() || effectiveFocusKey || attentionOnly) && (
            <button
              type="button"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
              onClick={resetFilters}
              data-testid="service-map-reset-filters"
            >
              {t("Reset filters")}
            </button>
          )}
          <p
            className="text-xs text-gray-500 md:ml-auto"
            role="status"
            aria-live="polite"
            data-testid="service-map-result-count"
          >
            {matchedEntries.length} {t("of")} {model.entries.length}{" "}
            {t(model.entries.length === 1 ? "item" : "items")}
            {view === "map" && visibility.contextKeys.size > 0 && (
              <span>
                {" "}
                · {visibility.contextKeys.size} {t("connected for context")}
              </span>
            )}
          </p>
        </div>

        {effectiveFocusKey && (
          <div className="flex flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50 px-5 py-3 text-sm text-indigo-800">
            <span>
              {t("Direct connections of")}{" "}
              <strong>
                {model.entryByKey.get(effectiveFocusKey)?.label ||
                  effectiveFocusKey}
              </strong>
            </span>
            <button
              type="button"
              data-testid="service-map-clear-focus"
              className="ml-auto font-medium hover:underline"
              onClick={() => {
                setFocusKey(null);
              }}
            >
              {t("Show everything")}
            </button>
          </div>
        )}

        {view === "list" &&
          !viewChoice &&
          model.entries.length > MAX_NODES_FOR_DEFAULT_MAP && (
            <div className="border-b border-gray-200 bg-gray-50 px-5 py-2 text-xs text-gray-500">
              {t(
                "This project has too many services to draw at once. Search, or use “Show on map” on a row, to see a readable map of part of it.",
              )}
            </div>
          )}

        {matchedEntries.length === 0 ? (
          <div
            className="px-6 py-16 text-center"
            data-testid="service-map-no-results"
          >
            <h3 className="text-base font-semibold text-gray-900">
              {t("No services match your filters")}
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              {t(
                serviceCount === 0
                  ? "No service reported in the selected time range. Pick a longer range or show inactive resources."
                  : "Try a different name or clear your filters to see everything.",
              )}
            </p>
            {(searchText.trim() || effectiveFocusKey || attentionOnly) && (
              <button
                type="button"
                className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                onClick={resetFilters}
              >
                {t("Clear filters")}
              </button>
            )}
          </div>
        ) : view === "list" ? (
          renderTable()
        ) : (
          renderMap()
        )}
      </div>

      {selectedEntry && (
        <EntityDetailPanel
          entity={selectedEntry.entity}
          relationships={props.relationships}
          entityByKey={entityByKey}
          traffic={trafficFor(selectedEntry)}
          incidentStatus={
            selectedEntry.kind === "service"
              ? operationalStatuses.get(selectedEntry.label.toLowerCase()) ||
                null
              : null
          }
          metricsWindowSeconds={props.metricsWindowSeconds}
          onSelectEntity={(entityKey: string) => {
            if (model.entryByKey.has(entityKey)) {
              selectNode(entityKey);
            } else if (props.onOpenInfrastructure) {
              setSelectedKey(null);
              props.onOpenInfrastructure(entityKey);
            }
          }}
          onClose={() => {
            setSelectedKey(null);
          }}
          onFocus={(entityKey: string) => {
            focusOn(entityKey);
          }}
          focusButtonLabel="Show its connections"
          onOpenInfrastructure={props.onOpenInfrastructure}
        />
      )}

      {selectedEdge &&
        model.entryByKey.get(selectedEdge.from) &&
        model.entryByKey.get(selectedEdge.to) && (
          <EdgeDetailPanel
            key={selectedEdge.id}
            fromEntity={model.entryByKey.get(selectedEdge.from)!.entity}
            toEntity={model.entryByKey.get(selectedEdge.to)!.entity}
            relationship={selectedEdge.relationship}
            timeRange={props.timeRange}
            metricsWindowSeconds={props.metricsWindowSeconds}
            onClose={() => {
              setSelectedEdgeId(null);
            }}
          />
        )}
    </div>
  );
};

export default ServiceMapGraph;
