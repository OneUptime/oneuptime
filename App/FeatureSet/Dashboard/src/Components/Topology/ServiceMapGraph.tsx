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
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import TelemetryEntityRelationship from "Common/Models/DatabaseModels/TelemetryEntityRelationship";
import EntityType from "Common/Types/Telemetry/EntityType";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import useTranslateValue from "Common/UI/Utils/Translation";
import computeLayeredLayout, {
  LayoutPoint,
} from "../../Utils/LayeredGraphLayout";
import EntityDetailPanel from "./EntityDetailPanel";
import EdgeDetailPanel from "./EdgeDetailPanel";
import ServiceNodeCard from "./ServiceNodeCard";
import {
  ServiceIncidentStatus,
  fetchServiceIncidentStatuses,
} from "./IncidentOverlay";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import {
  HEALTH_COLORS,
  TrafficHealth,
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
 * edge/node color tracks error rate, and every edge is annotated with its
 * recent rate / error % / latency from the ComputeServiceDependencies cron.
 */

const X_GAP: number = 260;
const Y_GAP: number = 150;

export interface ComponentProps {
  entities: Array<TelemetryEntity>;
  relationships: Array<TelemetryEntityRelationship>;
  /** Seconds the depends-on metrics were aggregated over (cron window). */
  metricsWindowSeconds: number;
  /** The page's picked range — drives the edge drill-down history query. */
  timeRange: RangeStartAndEndDateTime;
}

interface ServiceNodeData {
  label: string;
  health: TrafficHealth;
  rateText: string | null;
  errorText: string | null;
  dimmed: boolean;
  incidentCount: number;
  incidentColor: string | null;
}

// Fallback border when an incident has no severity color configured.
const INCIDENT_FALLBACK_COLOR: string = "#dc2626";

/*
 * Custom node: service name plus served-traffic badges (rate and error %
 * of calls INTO this service — what it is answering right now). Entry
 * services with no measured callers show no badge.
 */
const ServiceMapNode: FunctionComponent<NodeProps<ServiceNodeData>> = (
  props: NodeProps<ServiceNodeData>,
): ReactElement => {
  const { data } = props;
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
            {data.errorText} err
          </span>
        )}
      </span>,
    );
  }
  return (
    <ServiceNodeCard
      label={data.label}
      health={data.health}
      borderColor={
        data.incidentCount > 0
          ? data.incidentColor || INCIDENT_FALLBACK_COLOR
          : undefined
      }
      dimmed={data.dimmed}
      statLines={statLines}
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

  const [searchText, setSearchText] = useState<string>("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const flowInstance: React.MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);

  const serviceEntities: Array<TelemetryEntity> = useMemo(() => {
    return props.entities.filter((entity: TelemetryEntity) => {
      return entity.entityType === EntityType.Service && entity.entityKey;
    });
  }, [props.entities]);

  const entityByKey: Map<string, TelemetryEntity> = useMemo(() => {
    const map: Map<string, TelemetryEntity> = new Map<
      string,
      TelemetryEntity
    >();
    for (const entity of serviceEntities) {
      map.set(entity.entityKey!, entity);
    }
    return map;
  }, [serviceEntities]);

  // Incident overlay: active incidents per service, keyed by lowercase name.
  const [incidentStatuses, setIncidentStatuses] = useState<
    Map<string, ServiceIncidentStatus>
  >(new Map<string, ServiceIncidentStatus>());

  useEffect(() => {
    let cancelled: boolean = false;
    const names: Array<string> = serviceEntities
      .map((entity: TelemetryEntity) => {
        return entity.displayName || "";
      })
      .filter(Boolean);
    if (names.length === 0) {
      setIncidentStatuses(new Map<string, ServiceIncidentStatus>());
      return undefined;
    }
    fetchServiceIncidentStatuses(names)
      .then((statuses: Map<string, ServiceIncidentStatus>) => {
        if (!cancelled) {
          setIncidentStatuses(statuses);
        }
      })
      .catch((err: unknown) => {
        /*
         * Best-effort overlay — the map is still useful without it — but
         * keep the failure observable instead of fully silent.
         */
        // eslint-disable-next-line no-console
        console.error("Service Map incident overlay failed to load:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceEntities]);

  const dependsOnEdges: Array<TelemetryEntityRelationship> = useMemo(() => {
    return props.relationships.filter(
      (relationship: TelemetryEntityRelationship) => {
        return (
          relationship.relationshipType === EntityRelationshipType.DependsOn &&
          Boolean(relationship.fromEntityKey) &&
          Boolean(relationship.toEntityKey) &&
          entityByKey.has(relationship.fromEntityKey!) &&
          entityByKey.has(relationship.toEntityKey!)
        );
      },
    );
  }, [props.relationships, entityByKey]);

  // Focus mode: every service reachable from the focused one, both ways.
  const focusedKeys: Set<string> | null = useMemo(() => {
    if (!focusKey) {
      return null;
    }
    const neighbors: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();
    for (const edge of dependsOnEdges) {
      neighbors.set(edge.fromEntityKey!, [
        ...(neighbors.get(edge.fromEntityKey!) || []),
        edge.toEntityKey!,
      ]);
      neighbors.set(edge.toEntityKey!, [
        ...(neighbors.get(edge.toEntityKey!) || []),
        edge.fromEntityKey!,
      ]);
    }
    const reached: Set<string> = new Set<string>([focusKey]);
    const queue: Array<string> = [focusKey];
    while (queue.length > 0) {
      const current: string = queue.shift()!;
      for (const neighbor of neighbors.get(current) || []) {
        if (!reached.has(neighbor)) {
          reached.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return reached;
  }, [focusKey, dependsOnEdges]);

  const { nodes, edges } = useMemo((): {
    nodes: Array<Node<ServiceNodeData>>;
    edges: Array<Edge>;
  } => {
    const visibleServices: Array<TelemetryEntity> = serviceEntities.filter(
      (entity: TelemetryEntity) => {
        return !focusedKeys || focusedKeys.has(entity.entityKey!);
      },
    );
    const visibleKeys: Set<string> = new Set<string>(
      visibleServices.map((entity: TelemetryEntity) => {
        return entity.entityKey!;
      }),
    );
    const visibleEdges: Array<TelemetryEntityRelationship> =
      dependsOnEdges.filter((relationship: TelemetryEntityRelationship) => {
        return (
          visibleKeys.has(relationship.fromEntityKey!) &&
          visibleKeys.has(relationship.toEntityKey!)
        );
      });

    // Served traffic per service: aggregate over inbound depends-on edges.
    const inboundCalls: Map<string, { calls: number; errors: number }> =
      new Map<string, { calls: number; errors: number }>();
    for (const relationship of visibleEdges) {
      if (!relationship.callCount) {
        continue;
      }
      const current: { calls: number; errors: number } = inboundCalls.get(
        relationship.toEntityKey!,
      ) || { calls: 0, errors: 0 };
      current.calls += relationship.callCount;
      current.errors += relationship.errorCount || 0;
      inboundCalls.set(relationship.toEntityKey!, current);
    }

    // Connected services get the layered layout; isolated ones a row below.
    const connectedKeys: Set<string> = new Set<string>();
    for (const relationship of visibleEdges) {
      connectedKeys.add(relationship.fromEntityKey!);
      connectedKeys.add(relationship.toEntityKey!);
    }
    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      Array.from(connectedKeys),
      visibleEdges.map((relationship: TelemetryEntityRelationship) => {
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
    const isolated: Array<TelemetryEntity> = visibleServices
      .filter((entity: TelemetryEntity) => {
        return !connectedKeys.has(entity.entityKey!);
      })
      .sort((a: TelemetryEntity, b: TelemetryEntity) => {
        return (a.displayName || "").localeCompare(b.displayName || "");
      });

    const lowerSearch: string = searchText.trim().toLowerCase();
    const builtNodes: Array<Node<ServiceNodeData>> = visibleServices.map(
      (entity: TelemetryEntity): Node<ServiceNodeData> => {
        const key: string = entity.entityKey!;
        const served: { calls: number; errors: number } | undefined =
          inboundCalls.get(key);
        const health: TrafficHealth = healthForErrorRate(
          served?.calls,
          served?.errors,
        );
        const label: string = entity.displayName || "Unnamed service";
        const dimmed: boolean = Boolean(
          lowerSearch && !label.toLowerCase().includes(lowerSearch),
        );
        const point: LayoutPoint = layout.get(key) || {
          x:
            isolated.findIndex((candidate: TelemetryEntity) => {
              return candidate.entityKey === key;
            }) * X_GAP,
          y: (layout.size > 0 ? maxY + Y_GAP : 0) + Y_GAP,
        };
        const incidentStatus: ServiceIncidentStatus | undefined =
          incidentStatuses.get(label.toLowerCase());
        return {
          id: key,
          type: "serviceMapNode",
          position: point,
          data: {
            label,
            health,
            rateText: served
              ? formatCallRate(served.calls, props.metricsWindowSeconds)
              : null,
            errorText: served
              ? formatErrorRate(served.calls, served.errors)
              : null,
            dimmed,
            incidentCount: incidentStatus?.activeIncidentCount || 0,
            incidentColor: incidentStatus?.worstSeverityColor || null,
          },
        };
      },
    );

    const builtEdges: Array<Edge> = visibleEdges.map(
      (relationship: TelemetryEntityRelationship): Edge => {
        const health: TrafficHealth = healthForErrorRate(
          relationship.callCount,
          relationship.errorCount,
        );
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
          animated: true,
          label: hasMetrics
            ? `${formatCallRate(relationship.callCount!, props.metricsWindowSeconds)} · ${formatErrorRate(relationship.callCount, relationship.errorCount)} · ${formatDurationMs(relationship.avgDurationMs)}`
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
    serviceEntities,
    dependsOnEdges,
    focusedKeys,
    searchText,
    incidentStatuses,
    props.metricsWindowSeconds,
  ]);

  // Re-fit when the visible graph changes (focus set, search, new data).
  useEffect(() => {
    if (flowInstance.current && nodes.length > 0) {
      flowInstance.current.fitView({ padding: 0.2 });
    }
  }, [focusKey, nodes.length]);

  const selectedEntity: TelemetryEntity | null =
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
    <Fragment>
      <div className="mb-3 flex flex-col md:flex-row md:items-center gap-3">
        <div className="md:w-72">
          <Input
            dataTestId="service-map-search"
            placeholder={translateString("Search services by name") || ""}
            value={searchText}
            onChange={(value: string) => {
              setSearchText(value);
            }}
          />
        </div>
        {focusKey && (
          <button
            type="button"
            data-testid="service-map-clear-focus"
            className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-700 hover:bg-indigo-100"
            onClick={() => {
              setFocusKey(null);
            }}
          >
            {translateString("Focused on") || "Focused on"}{" "}
            {entityByKey.get(focusKey)?.displayName || focusKey}
            <span aria-hidden={true}>✕</span>
          </button>
        )}
        <p className="text-xs text-gray-500 md:ml-auto">
          {translateString(
            "Edge labels show recent call rate, error rate and average latency. Click an edge for its history.",
          ) || ""}
        </p>
      </div>

      <div style={{ height: "70vh", width: "100%" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView={true}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={true}
          onInit={(instance: ReactFlowInstance) => {
            flowInstance.current = instance;
          }}
          onNodeClick={(_event: React.MouseEvent, node: Node) => {
            /*
             * Panels are exclusive — SideOver has no backdrop, so two
             * would stack on top of each other.
             */
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
            gap={16}
            size={1}
            color="var(--ou-chart-grid, #cbd5e1)"
          />
        </ReactFlow>
      </div>

      {selectedEntity && (
        <EntityDetailPanel
          entity={selectedEntity}
          relationships={dependsOnEdges}
          entityByKey={entityByKey}
          incidentStatus={
            incidentStatuses.get(
              (selectedEntity.displayName || "").toLowerCase(),
            ) || null
          }
          metricsWindowSeconds={props.metricsWindowSeconds}
          onClose={() => {
            setSelectedKey(null);
          }}
          onFocus={(entityKey: string) => {
            setFocusKey(entityKey);
            setSelectedKey(null);
          }}
        />
      )}

      {(() => {
        if (!selectedEdgeId) {
          return <></>;
        }
        const relationship: TelemetryEntityRelationship | undefined =
          dependsOnEdges.find((candidate: TelemetryEntityRelationship) => {
            return (
              `${candidate.fromEntityKey}->${candidate.toEntityKey}` ===
              selectedEdgeId
            );
          });
        const fromEntity: TelemetryEntity | undefined = entityByKey.get(
          relationship?.fromEntityKey || "",
        );
        const toEntity: TelemetryEntity | undefined = entityByKey.get(
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
    </Fragment>
  );
};

export default ServiceMapGraph;
