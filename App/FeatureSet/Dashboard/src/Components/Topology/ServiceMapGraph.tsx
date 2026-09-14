import React, {
  Fragment,
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
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import useTranslateValue from "Common/UI/Utils/Translation";
import Navigation from "Common/UI/Utils/Navigation";
import computeLayeredLayout, {
  LayoutPoint,
} from "../../Utils/LayeredGraphLayout";
import EntityDetailPanel from "./EntityDetailPanel";
import EdgeDetailPanel from "./EdgeDetailPanel";
import ServiceNodeCard from "./ServiceNodeCard";
import {
  ServiceOperationalStatus,
  fetchServiceOperationalStatuses,
} from "./OperationalOverlay";
import {
  ServiceMapEntry,
  ServiceMapModel,
  ServiceMapVisibility,
  SERVICE_TRAFFIC_LABELS,
  buildServiceMapModel,
  resolveServiceMapVisibility,
  serviceIsolatedPosition,
} from "./ServiceMapViewModel";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import {
  HEALTH_COLORS,
  edgeWidthForCalls,
  formatCallRate,
  formatDurationMs,
  formatErrorRate,
  healthForErrorRate,
} from "./TopologyMeta";

/*
 * Service Map: services and their call relationships only (`depends-on`
 * edges derived from cross-service span pairs). Infrastructure containment
 * lives in the sibling Infrastructure tab. Edge width tracks call volume,
 * edge/node color tracks error rate, and optional labels expose recent rate,
 * error percentage or latency from the ComputeServiceDependencies cron.
 */

const X_GAP: number = 260;
const Y_GAP: number = 180;
const SERVICES_PER_PAGE: number = 40;

export interface ComponentProps {
  entities: Array<InventoryItem>;
  relationships: Array<InventoryItemRelationship>;
  /** Seconds the depends-on metrics were aggregated over (cron window). */
  metricsWindowSeconds: number;
  /** The page's picked range — drives the edge drill-down history query. */
  timeRange: RangeStartAndEndDateTime;
}

interface ServiceNodeData extends ServiceMapEntry {
  rateText: string | null;
  errorText: string | null;
  dimmed: boolean;
}

type ServiceView = "list" | "map";
type ConnectionMetric = "none" | "calls" | "errors" | "latency";

// Fallbacks when a severity has no color configured.
const INCIDENT_FALLBACK_COLOR: string = "#dc2626";
const ALERT_FALLBACK_COLOR: string = "#f59e0b";

/*
 * Custom node: service name plus served-traffic badges (rate and error %
 * of calls INTO this service — what it is answering right now). Entry
 * services with no measured callers show no badge.
 */
const ServiceMapNode: FunctionComponent<NodeProps<ServiceNodeData>> = (
  props: NodeProps<ServiceNodeData>,
): ReactElement => {
  const { data } = props;
  const { translateString } = useTranslateValue();
  const statLines: Array<ReactElement> = [];
  if (data.incidentCount > 0) {
    statLines.push(
      <span
        key="incidents"
        style={{
          color: data.incidentColor || INCIDENT_FALLBACK_COLOR,
          fontWeight: 600,
        }}
      >
        ⚠ {data.incidentCount} active incident
        {data.incidentCount === 1 ? "" : "s"}
      </span>,
    );
  }
  if (data.alertCount > 0) {
    statLines.push(
      <span
        key="alerts"
        style={{
          color: data.alertColor || ALERT_FALLBACK_COLOR,
          fontWeight: 600,
        }}
      >
        ⚠ {data.alertCount} active alert
        {data.alertCount === 1 ? "" : "s"}
      </span>,
    );
  }
  if (data.rateText) {
    statLines.push(
      <span key="traffic">
        {data.rateText}
        {data.errorText && (
          <span
            style={{
              color: HEALTH_COLORS[data.health],
              marginLeft: 8,
            }}
          >
            {data.errorText} errors
          </span>
        )}
      </span>,
    );
  }
  // Border precedence: incident > alert > traffic health.
  let borderColor: string | undefined = undefined;
  if (data.incidentCount > 0) {
    borderColor = data.incidentColor || INCIDENT_FALLBACK_COLOR;
  } else if (data.alertCount > 0) {
    borderColor = data.alertColor || ALERT_FALLBACK_COLOR;
  }
  return (
    <ServiceNodeCard
      label={data.label}
      health={data.health}
      borderColor={borderColor}
      dimmed={data.dimmed}
      statLines={statLines}
      statusLabel={translateString(SERVICE_TRAFFIC_LABELS[data.health]) || ""}
    />
  );
};

const NODE_TYPES: Record<
  string,
  FunctionComponent<NodeProps<ServiceNodeData>>
> = {
  serviceMapNode: ServiceMapNode,
};

const ServiceMapGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  /*
   * Search and focus live in the URL (replaceState — no history flood) so
   * a filtered/focused view is shareable. A focus key that does not exist
   * in this graph (e.g. carried over from the other tab) is ignored.
   */
  const [searchText, setSearchTextState] = useState<string>(
    Navigation.getQueryStringByName("search") || "",
  );
  const [view, setView] = useState<ServiceView>(
    Navigation.getQueryStringByName("serviceView") === "map" ? "map" : "list",
  );
  const [attentionOnly, setAttentionOnly] = useState<boolean>(false);
  const [page, setPage] = useState<number>(0);
  const [connectionMetric, setConnectionMetric] =
    useState<ConnectionMetric>("none");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [focusKey, setFocusKeyState] = useState<string | null>(
    Navigation.getQueryStringByName("focus"),
  );

  /*
   * Debounce the URL mirror: per-keystroke replaceState trips Safari's
   * rate limit; React state stays the source of truth.
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

  const [operationalStatuses, setOperationalStatuses] = useState<
    Map<string, ServiceOperationalStatus>
  >(new Map<string, ServiceOperationalStatus>());
  const baseModel: ServiceMapModel = useMemo(() => {
    return buildServiceMapModel(props.entities, props.relationships);
  }, [props.entities, props.relationships]);
  const model: ServiceMapModel = useMemo(() => {
    return buildServiceMapModel(
      props.entities,
      props.relationships,
      operationalStatuses,
    );
  }, [props.entities, props.relationships, operationalStatuses]);
  const serviceEntities: Array<InventoryItem> = useMemo(() => {
    return baseModel.entries.map((entry: ServiceMapEntry) => {
      return entry.entity;
    });
  }, [baseModel]);
  const entityByKey: Map<string, InventoryItem> = useMemo(() => {
    return new Map<string, InventoryItem>(
      model.entries.map((entry: ServiceMapEntry) => {
        return [entry.key, entry.entity];
      }),
    );
  }, [model]);
  const dependsOnEdges: Array<InventoryItemRelationship> = model.relationships;

  useEffect(() => {
    return () => {
      if (searchUrlTimeout.current) {
        clearTimeout(searchUrlTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled: boolean = false;
    const names: Array<string> = serviceEntities
      .map((entity: InventoryItem) => {
        return entity.displayName || "";
      })
      .filter(Boolean);
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
  }, [serviceEntities]);

  const visibility: ServiceMapVisibility = useMemo(() => {
    return resolveServiceMapVisibility({
      model,
      search: searchText,
      focusKey,
      attentionOnly,
    });
  }, [model, searchText, focusKey, attentionOnly]);
  const effectiveFocusKey: string | null = visibility.effectiveFocusKey;
  const matchedEntries: Array<ServiceMapEntry> = model.entries.filter(
    (entry: ServiceMapEntry) => {
      return visibility.matchedKeys.has(entry.key);
    },
  );
  const attentionCount: number = model.entries.filter(
    (entry: ServiceMapEntry) => {
      return entry.needsAttention;
    },
  ).length;
  const pageCount: number = Math.max(
    1,
    Math.ceil(matchedEntries.length / SERVICES_PER_PAGE),
  );
  const currentPage: number = Math.min(page, pageCount - 1);
  const pageEntries: Array<ServiceMapEntry> = matchedEntries.slice(
    currentPage * SERVICES_PER_PAGE,
    (currentPage + 1) * SERVICES_PER_PAGE,
  );
  useEffect(() => {
    setPage(0);
  }, [searchText, effectiveFocusKey, attentionOnly]);
  useEffect(() => {
    setPage((value: number) => {
      return Math.min(value, pageCount - 1);
    });
  }, [pageCount]);
  const isolatedCount: number = model.entries.filter(
    (entry: ServiceMapEntry) => {
      return entry.callers === 0 && entry.dependencies === 0;
    },
  ).length;
  const changeView: (value: ServiceView) => void = (
    value: ServiceView,
  ): void => {
    setView(value);
    Navigation.setQueryString({ serviceView: value === "map" ? "map" : null });
  };
  const resetFilters: () => void = (): void => {
    setSearchText("");
    setFocusKey(null);
    setAttentionOnly(false);
  };
  const viewConnections: (key: string) => void = (key: string): void => {
    setSelectedKey(null);
    setSelectedEdgeId(null);
    setSearchText("");
    setAttentionOnly(false);
    setFocusKey(key);
    changeView("map");
  };

  const { nodes, edges } = useMemo((): {
    nodes: Array<Node<ServiceNodeData>>;
    edges: Array<Edge>;
  } => {
    if (view !== "map") {
      return { nodes: [], edges: [] };
    }
    const visibleServices: Array<ServiceMapEntry> = model.entries.filter(
      (entry: ServiceMapEntry) => {
        return visibility.visibleKeys.has(entry.key);
      },
    );
    const visibleEdges: Array<InventoryItemRelationship> =
      dependsOnEdges.filter((relationship: InventoryItemRelationship) => {
        return (
          visibility.visibleKeys.has(relationship.fromEntityKey!) &&
          visibility.visibleKeys.has(relationship.toEntityKey!)
        );
      });

    // Connected services get the layered layout; isolated ones a grid below.
    const connectedKeys: Set<string> = new Set<string>();
    for (const relationship of visibleEdges) {
      connectedKeys.add(relationship.fromEntityKey!);
      connectedKeys.add(relationship.toEntityKey!);
    }
    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      Array.from(connectedKeys),
      visibleEdges.map((relationship: InventoryItemRelationship) => {
        return {
          from: relationship.fromEntityKey!,
          to: relationship.toEntityKey!,
        };
      }),
      { xGap: X_GAP, yGap: Y_GAP },
    );
    let maxY: number = 0;
    for (const [, point] of layout) {
      maxY = Math.max(maxY, point.y);
    }
    const isolated: Array<ServiceMapEntry> = visibleServices.filter(
      (entry: ServiceMapEntry) => {
        return !connectedKeys.has(entry.key);
      },
    );
    const builtNodes: Array<Node<ServiceNodeData>> = visibleServices.map(
      (entry: ServiceMapEntry): Node<ServiceNodeData> => {
        const point: LayoutPoint =
          layout.get(entry.key) ||
          serviceIsolatedPosition({
            index: isolated.findIndex((candidate: ServiceMapEntry) => {
              return candidate.key === entry.key;
            }),
            count: isolated.length,
            xGap: X_GAP,
            yGap: Y_GAP,
            startY: layout.size > 0 ? maxY + Y_GAP : 0,
          });
        return {
          id: entry.key,
          type: "serviceMapNode",
          position: point,
          data: {
            ...entry,
            rateText:
              entry.calls > 0
                ? formatCallRate(entry.calls, props.metricsWindowSeconds)
                : null,
            errorText:
              entry.calls > 0
                ? formatErrorRate(entry.calls, entry.errors)
                : null,
            dimmed: visibility.contextKeys.has(entry.key),
          },
        };
      },
    );

    const builtEdges: Array<Edge> = visibleEdges.map(
      (relationship: InventoryItemRelationship): Edge => {
        const health: ReturnType<typeof healthForErrorRate> =
          healthForErrorRate(relationship.callCount, relationship.errorCount);
        const color: string =
          health === "unknown" ? "#94a3b8" : HEALTH_COLORS[health];
        const hasMetrics: boolean = Boolean(
          relationship.callCount && relationship.callCount > 0,
        );
        return {
          id: `${relationship.fromEntityKey}->${relationship.toEntityKey}`,
          source: relationship.fromEntityKey!,
          target: relationship.toEntityKey!,
          type: "smoothstep",
          animated: false,
          label:
            hasMetrics && connectionMetric !== "none"
              ? connectionMetric === "calls"
                ? formatCallRate(
                    relationship.callCount!,
                    props.metricsWindowSeconds,
                  )
                : connectionMetric === "errors"
                  ? `${formatErrorRate(relationship.callCount, relationship.errorCount)} errors`
                  : formatDurationMs(relationship.avgDurationMs)
              : undefined,
          labelStyle: { fontSize: 10, fill: "#6b7280" },
          labelBgStyle: {
            fill: "var(--ou-surface-primary, #ffffff)",
            fillOpacity: 0.85,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color },
          style: {
            stroke: color,
            strokeWidth: edgeWidthForCalls(relationship.callCount),
          },
        };
      },
    );

    return { nodes: builtNodes, edges: builtEdges };
  }, [
    model,
    dependsOnEdges,
    visibility,
    connectionMetric,
    props.metricsWindowSeconds,
    view,
  ]);

  const visibleGraphKey: string = nodes
    .map((node: Node<ServiceNodeData>) => {
      return node.id;
    })
    .join("|");

  /*
   * Re-fit when the visible graph changes. A new controlled `nodes` array
   * wipes React Flow's measured dimensions, and fitView no-ops (returns
   * false) until nodes re-measure — retry on animation frames until it
   * lands.
   */
  useEffect(() => {
    if (view !== "map" || nodes.length === 0) {
      return undefined;
    }
    let raf: number = 0;
    let attempts: number = 20;
    const tryFit: () => void = (): void => {
      const didFit: boolean = Boolean(
        flowInstance.current &&
          nodes.length > 0 &&
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

  const selectedEntity: InventoryItem | null =
    (selectedKey && entityByKey.get(selectedKey)) || null;

  if (serviceEntities.length === 0) {
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
            {translateString(
              "View telemetry setup documentation to send OpenTelemetry data",
            ) || ""}
          </Link>
        }
      />
    );
  }

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
            value: model.entries.length,
            detail: "Discovered in your environment",
            color: "text-gray-900",
          },
          {
            label: "Dependencies",
            value: dependsOnEdges.length,
            detail: "Observed service-to-service links",
            color: "text-indigo-600",
          },
          {
            label: "Need attention",
            value: attentionCount,
            detail: "Call errors, incidents or alerts",
            color: attentionCount > 0 ? "text-amber-600" : "text-gray-900",
          },
          {
            label: "Without connections",
            value: isolatedCount,
            detail: "No service dependencies observed",
            color: "text-gray-900",
          },
        ].map(
          (stat: {
            label: string;
            value: number;
            detail: string;
            color: string;
          }) => {
            return (
              <div
                key={stat.label}
                className="min-w-0 rounded-xl border border-gray-200 bg-white px-5 py-4"
              >
                <p className="text-xs font-medium text-gray-500">
                  {translateString(stat.label)}
                </p>
                <p
                  className={`mt-2 text-3xl font-semibold tracking-tight ${stat.color}`}
                >
                  {stat.value}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {translateString(stat.detail)}
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
              {translateString("Service dependencies")}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {translateString(
                "Find a service, check its traffic, and explore what it depends on.",
              )}
            </p>
          </div>
          <div
            className="inline-flex max-w-full self-start rounded-lg bg-gray-100 p-1"
            role="group"
            aria-label={translateString("Service view") || "Service view"}
          >
            {(["list", "map"] as Array<ServiceView>).map(
              (option: ServiceView) => {
                return (
                  <button
                    key={option}
                    type="button"
                    data-testid={`service-map-view-${option}`}
                    aria-pressed={view === option}
                    className={`min-w-0 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${view === option ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                    onClick={() => {
                      changeView(option);
                    }}
                  >
                    {translateString(
                      option === "list" ? "Service list" : "Dependency map",
                    )}
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
              ariaLabel={
                translateString("Search services") || "Search services"
              }
              placeholder={translateString("Search services by name") || ""}
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
            {translateString("Needs attention")}
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
              {translateString("Reset filters")}
            </button>
          )}
          <p
            className="text-xs text-gray-500 md:ml-auto"
            role="status"
            aria-live="polite"
            data-testid="service-map-result-count"
          >
            {matchedEntries.length} {translateString("of")}{" "}
            {model.entries.length} {translateString("services")}
            {view === "map" && visibility.contextKeys.size > 0 && (
              <span>
                {" "}
                · {visibility.contextKeys.size}{" "}
                {translateString("connected services for context")}
              </span>
            )}
          </p>
        </div>

        {effectiveFocusKey && (
          <div className="flex flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50 px-5 py-3 text-sm text-indigo-800">
            <span>
              {translateString("Direct connections of")}{" "}
              <strong>
                {entityByKey.get(effectiveFocusKey)?.displayName ||
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
              {translateString("Show all services")}
            </button>
          </div>
        )}

        {matchedEntries.length === 0 ? (
          <div
            className="px-6 py-16 text-center"
            data-testid="service-map-no-results"
          >
            <h3 className="text-base font-semibold text-gray-900">
              {translateString("No services match your filters")}
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              {translateString(
                "Try a different service name or clear your filters to see every service.",
              )}
            </p>
            <button
              type="button"
              className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              onClick={resetFilters}
            >
              {translateString("Clear filters")}
            </button>
          </div>
        ) : view === "list" ? (
          <div className="min-w-0 w-full max-w-full">
            <div
              className="relative min-w-0 w-full max-w-full overflow-x-auto"
              data-testid="service-map-table-scroll"
              role="region"
              aria-label={
                translateString("Service directory table") ||
                "Service directory table"
              }
              tabIndex={0}
            >
              <table
                className="w-full text-left text-sm"
                data-testid="service-map-list"
              >
                <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">
                      {translateString("Service")}
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      {translateString("Status")}
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 font-medium"
                      title={
                        translateString(
                          "Calls received from other services in the metrics window",
                        ) || ""
                      }
                    >
                      {translateString("Incoming calls")}
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      {translateString("Error rate")}
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      {translateString("Connections")}
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      <span className="sr-only">
                        {translateString("Actions")}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pageEntries.map((entry: ServiceMapEntry) => {
                    const color: string =
                      entry.incidentCount > 0
                        ? entry.incidentColor || INCIDENT_FALLBACK_COLOR
                        : entry.alertCount > 0
                          ? entry.alertColor || ALERT_FALLBACK_COLOR
                          : HEALTH_COLORS[entry.health];
                    return (
                      <tr
                        key={entry.key}
                        className="hover:bg-gray-50"
                        data-testid="service-map-list-row"
                      >
                        <td className="px-5 py-4">
                          <button
                            type="button"
                            className="max-w-xs break-words text-left font-semibold text-gray-900 hover:text-indigo-600"
                            onClick={() => {
                              setSelectedEdgeId(null);
                              setSelectedKey(entry.key);
                            }}
                          >
                            {entry.label}
                          </button>
                          <p className="mt-1 text-xs text-gray-500">
                            {translateString("Service")}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2 whitespace-nowrap text-xs text-gray-700">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: color }}
                              aria-hidden={true}
                            />
                            {entry.incidentCount > 0
                              ? `${entry.incidentCount} ${translateString(entry.incidentCount === 1 ? "active incident" : "active incidents")}`
                              : entry.alertCount > 0
                                ? `${entry.alertCount} ${translateString(entry.alertCount === 1 ? "active alert" : "active alerts")}`
                                : translateString(
                                    SERVICE_TRAFFIC_LABELS[entry.health],
                                  )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-gray-700">
                          {entry.calls > 0
                            ? formatCallRate(
                                entry.calls,
                                props.metricsWindowSeconds,
                              )
                            : "—"}
                        </td>
                        <td
                          className={`px-4 py-4 ${
                            entry.health === "critical"
                              ? "text-red-700"
                              : entry.health === "degraded"
                                ? "text-amber-700"
                                : entry.health === "healthy"
                                  ? "text-green-700"
                                  : "text-gray-500"
                          }`}
                        >
                          {formatErrorRate(entry.calls, entry.errors)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-xs text-gray-500">
                          {entry.callers}{" "}
                          {translateString(
                            entry.callers === 1 ? "caller" : "callers",
                          )}{" "}
                          · {entry.dependencies}{" "}
                          {translateString(
                            entry.dependencies === 1
                              ? "dependency"
                              : "dependencies",
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            className="whitespace-nowrap text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                            aria-label={`${translateString("View connections for")} ${entry.label}`}
                            onClick={() => {
                              viewConnections(entry.key);
                            }}
                          >
                            {translateString("View connections")}{" "}
                            <span aria-hidden={true}>→</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {matchedEntries.length > SERVICES_PER_PAGE && (
              <div
                className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-3 text-xs text-gray-500"
                data-testid="service-map-pagination"
              >
                <p>
                  {translateString("Showing")}{" "}
                  {currentPage * SERVICES_PER_PAGE + 1}–
                  {Math.min(
                    (currentPage + 1) * SERVICES_PER_PAGE,
                    matchedEntries.length,
                  )}{" "}
                  {translateString("of")} {matchedEntries.length}{" "}
                  {translateString("services")}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label={
                      translateString("Previous service page") ||
                      "Previous service page"
                    }
                    disabled={currentPage === 0}
                    className="rounded-md border border-gray-200 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => {
                      setPage(currentPage - 1);
                    }}
                  >
                    {translateString("Previous")}
                  </button>
                  <span>
                    {translateString("Page")} {currentPage + 1}{" "}
                    {translateString("of")} {pageCount}
                  </span>
                  <button
                    type="button"
                    aria-label={
                      translateString("Next service page") ||
                      "Next service page"
                    }
                    disabled={currentPage >= pageCount - 1}
                    className="rounded-md border border-gray-200 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => {
                      setPage(currentPage + 1);
                    }}
                  >
                    {translateString("Next")}
                  </button>
                </div>
              </div>
            )}
            <div className="border-t border-gray-200 bg-gray-50 px-5 py-3 text-xs text-gray-500">
              {translateString(
                "Incoming calls and errors are measured between services. A service with no incoming calls is not necessarily unhealthy.",
              )}
            </div>
          </div>
        ) : (
          <Fragment>
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-5 py-3">
              <label className="flex items-center gap-2 text-xs text-gray-600">
                {translateString("Connection labels")}
                <select
                  className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs"
                  aria-label={
                    translateString("Connection labels") || "Connection labels"
                  }
                  value={connectionMetric}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                    setConnectionMetric(event.target.value as ConnectionMetric);
                  }}
                >
                  <option value="none">{translateString("None")}</option>
                  <option value="calls">{translateString("Call rate")}</option>
                  <option value="errors">
                    {translateString("Error rate")}
                  </option>
                  <option value="latency">
                    {translateString("Average latency")}
                  </option>
                </select>
              </label>
              <p className="text-xs text-gray-500">
                {translateString(
                  "Arrows point from caller to dependency. Thicker lines mean more calls. Select a service or connection for details.",
                )}
              </p>
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
                {translateString("Fit to screen")}
              </button>
            </div>
            <div
              style={{ height: "62vh", minHeight: 420, width: "100%" }}
              className="bg-gray-50"
              data-testid="service-map-canvas"
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                fitView={true}
                fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
                minZoom={0.08}
                maxZoom={1.5}
                proOptions={{ hideAttribution: true }}
                nodesDraggable={true}
                nodesConnectable={false}
                elementsSelectable={true}
                onInit={(instance: ReactFlowInstance) => {
                  flowInstance.current = instance;
                }}
                onNodeClick={(_event: React.MouseEvent, node: Node) => {
                  setSelectedEdgeId(null);
                  setSelectedKey(node.id);
                }}
                onEdgeClick={(_event: React.MouseEvent, edge: Edge) => {
                  setSelectedKey(null);
                  setSelectedEdgeId(edge.id);
                }}
              >
                <Controls showInteractive={false} />
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={20}
                  size={1}
                  color="var(--ou-chart-grid, #e2e8f0)"
                />
              </ReactFlow>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-200 px-5 py-3 text-xs text-gray-500">
              <span className="font-medium text-gray-700">
                {translateString("Incoming traffic")}
              </span>
              {Object.entries(SERVICE_TRAFFIC_LABELS).map(
                ([health, label]: [string, string]) => {
                  return (
                    <span
                      key={health}
                      className="inline-flex items-center gap-1.5"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor:
                            HEALTH_COLORS[health as keyof typeof HEALTH_COLORS],
                        }}
                        aria-hidden={true}
                      />
                      {translateString(label)}
                    </span>
                  );
                },
              )}
              <span className="ml-auto">
                {translateString(
                  "Drag the background to pan · Use + / − to zoom",
                )}
              </span>
            </div>
          </Fragment>
        )}
      </div>

      {selectedEntity && (
        <EntityDetailPanel
          entity={selectedEntity}
          relationships={dependsOnEdges}
          entityByKey={entityByKey}
          incidentStatus={
            operationalStatuses.get(
              (selectedEntity.displayName || "").toLowerCase(),
            ) || null
          }
          metricsWindowSeconds={props.metricsWindowSeconds}
          onSelectEntity={(entityKey: string) => {
            setSelectedEdgeId(null);
            setSelectedKey(entityKey);
          }}
          onClose={() => {
            setSelectedKey(null);
          }}
          onFocus={(entityKey: string) => {
            viewConnections(entityKey);
            setSelectedKey(null);
          }}
        />
      )}

      {(() => {
        if (!selectedEdgeId) {
          return <></>;
        }
        const relationship: InventoryItemRelationship | undefined =
          dependsOnEdges.find((candidate: InventoryItemRelationship) => {
            return (
              `${candidate.fromEntityKey}->${candidate.toEntityKey}` ===
              selectedEdgeId
            );
          });
        const fromEntity: InventoryItem | undefined = entityByKey.get(
          relationship?.fromEntityKey || "",
        );
        const toEntity: InventoryItem | undefined = entityByKey.get(
          relationship?.toEntityKey || "",
        );
        if (!relationship || !fromEntity || !toEntity) {
          return <></>;
        }
        return (
          <EdgeDetailPanel
            key={selectedEdgeId}
            fromEntity={fromEntity}
            toEntity={toEntity}
            relationship={relationship}
            timeRange={props.timeRange}
            metricsWindowSeconds={props.metricsWindowSeconds}
            onClose={() => {
              setSelectedEdgeId(null);
            }}
          />
        );
      })()}
    </div>
  );
};

export default ServiceMapGraph;
