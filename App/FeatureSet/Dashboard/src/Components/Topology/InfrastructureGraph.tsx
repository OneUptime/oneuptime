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
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import TelemetryEntityRelationship from "Common/Models/DatabaseModels/TelemetryEntityRelationship";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Input from "Common/UI/Components/Input/Input";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
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
import { labelForRelationship, metaForEntityType } from "./TopologyMeta";

/*
 * Infrastructure topology: the co-occurrence containment graph (runs-on /
 * member-of / hosted-on / part-of / instance-of). Service-to-service call
 * edges live in the sibling Service Map tab. Containment edges point
 * child → parent, so the layout runs on REVERSED edges to put clusters and
 * hosts at the top and pods/containers below them — the mental model of a
 * rack diagram. Edge labels are plain language and appear on hover only.
 */

const X_GAP: number = 230;
const Y_GAP: number = 120;

export interface ComponentProps {
  entities: Array<TelemetryEntity>;
  relationships: Array<TelemetryEntityRelationship>;
  /** Seconds the depends-on metrics were aggregated over (cron window). */
  metricsWindowSeconds: number;
}

const InfrastructureGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const [searchText, setSearchText] = useState<string>("");
  const [excludedTypes, setExcludedTypes] = useState<Set<string>>(
    new Set<string>(),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const flowInstance: React.MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);

  const entityByKey: Map<string, TelemetryEntity> = useMemo(() => {
    const map: Map<string, TelemetryEntity> = new Map<
      string,
      TelemetryEntity
    >();
    for (const entity of props.entities) {
      if (entity.entityKey) {
        map.set(entity.entityKey, entity);
      }
    }
    return map;
  }, [props.entities]);

  const infraEdges: Array<TelemetryEntityRelationship> = useMemo(() => {
    return props.relationships.filter(
      (relationship: TelemetryEntityRelationship) => {
        return (
          relationship.relationshipType !== EntityRelationshipType.DependsOn &&
          Boolean(relationship.fromEntityKey) &&
          Boolean(relationship.toEntityKey)
        );
      },
    );
  }, [props.relationships]);

  // Types present among graphable nodes — drives the filter checkboxes.
  const presentTypes: Array<string> = useMemo(() => {
    const types: Set<string> = new Set<string>();
    for (const relationship of infraEdges) {
      for (const key of [
        relationship.fromEntityKey,
        relationship.toEntityKey,
      ]) {
        const entity: TelemetryEntity | undefined = entityByKey.get(key || "");
        types.add(entity?.entityType || "unknown");
      }
    }
    return Array.from(types).sort();
  }, [infraEdges, entityByKey]);

  // Focus mode: everything connected to the focused node, both directions.
  const focusedKeys: Set<string> | null = useMemo(() => {
    if (!focusKey) {
      return null;
    }
    const neighbors: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();
    for (const edge of infraEdges) {
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
  }, [focusKey, infraEdges]);

  const { nodes, edges } = useMemo((): {
    nodes: Array<Node>;
    edges: Array<Edge>;
  } => {
    // Only graph entities that participate in at least one relationship.
    const nodeKeys: Set<string> = new Set<string>();
    for (const relationship of infraEdges) {
      nodeKeys.add(relationship.fromEntityKey!);
      nodeKeys.add(relationship.toEntityKey!);
    }

    const visibleKeys: Set<string> = new Set<string>();
    for (const key of nodeKeys) {
      const entity: TelemetryEntity | undefined = entityByKey.get(key);
      const typeLabel: string = entity?.entityType || "unknown";
      if (excludedTypes.has(typeLabel)) {
        continue;
      }
      if (focusedKeys && !focusedKeys.has(key)) {
        continue;
      }
      visibleKeys.add(key);
    }

    const visibleEdges: Array<TelemetryEntityRelationship> = infraEdges.filter(
      (relationship: TelemetryEntityRelationship) => {
        return (
          visibleKeys.has(relationship.fromEntityKey!) &&
          visibleKeys.has(relationship.toEntityKey!)
        );
      },
    );

    /*
     * Containment arrows point child → parent; reverse them for layering
     * so parents (clusters, hosts) land on the top layers.
     */
    const layout: Map<string, LayoutPoint> = computeLayeredLayout(
      Array.from(visibleKeys),
      visibleEdges.map((relationship: TelemetryEntityRelationship) => {
        return {
          from: relationship.toEntityKey!,
          to: relationship.fromEntityKey!,
        };
      }),
      { xGap: X_GAP, yGap: Y_GAP },
    );

    const lowerSearch: string = searchText.trim().toLowerCase();

    const builtNodes: Array<Node> = Array.from(visibleKeys).map(
      (key: string): Node => {
        const entity: TelemetryEntity | undefined = entityByKey.get(key);
        const label: string = entity?.displayName || "Unnamed entity";
        const typeMeta: { label: string; color: string } = metaForEntityType(
          entity?.entityType,
        );
        const dimmed: boolean = Boolean(
          lowerSearch && !label.toLowerCase().includes(lowerSearch),
        );
        return {
          id: key,
          position: layout.get(key) || { x: 0, y: 0 },
          data: { label: `${label}\n${typeMeta.label}` },
          style: {
            fontSize: "12px",
            whiteSpace: "pre-line",
            border: `2px solid ${typeMeta.color}`,
            borderRadius: 8,
            backgroundColor: "var(--ou-surface-primary, #ffffff)",
            color: "var(--ou-text-primary, #111827)",
            width: 180,
            opacity: dimmed ? 0.25 : 1,
            cursor: "pointer",
          },
        };
      },
    );

    const builtEdges: Array<Edge> = visibleEdges.map(
      (relationship: TelemetryEntityRelationship): Edge => {
        const id: string = `${relationship.fromEntityKey}-${relationship.relationshipType}-${relationship.toEntityKey}`;
        return {
          id,
          source: relationship.fromEntityKey!,
          target: relationship.toEntityKey!,
          type: "smoothstep",
          /*
           * Plain-language label, on hover only — labels on every edge
           * turn a real deployment into visual noise.
           */
          label:
            hoveredEdgeId === id
              ? labelForRelationship(relationship.relationshipType)
              : undefined,
          labelStyle: { fontSize: 11, fill: "#374151" },
          labelBgStyle: {
            fill: "var(--ou-surface-primary, #ffffff)",
            fillOpacity: 0.9,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
          style: { stroke: "#94a3b8" },
        };
      },
    );

    return { nodes: builtNodes, edges: builtEdges };
  }, [
    infraEdges,
    entityByKey,
    excludedTypes,
    focusedKeys,
    searchText,
    hoveredEdgeId,
  ]);

  // Re-fit when the visible graph changes (focus set, filters, new data).
  useEffect(() => {
    if (flowInstance.current && nodes.length > 0) {
      flowInstance.current.fitView({ padding: 0.15 });
    }
  }, [focusKey, nodes.length]);

  const selectedEntity: TelemetryEntity | null =
    (selectedKey && entityByKey.get(selectedKey)) || null;

  if (infraEdges.length === 0) {
    return (
      <EmptyState
        id="topology-empty"
        icon={IconProp.FlowDiagram}
        title="No infrastructure topology discovered yet"
        description="As telemetry carrying multiple entities (e.g. a service running in a Kubernetes pod on a node) is ingested, the relationships between them will appear here as a map — no configuration needed."
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
      <div className="mb-3 bg-white border border-gray-200 rounded-xl shadow-sm p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="md:w-72">
            <Input
              dataTestId="topology-search"
              placeholder={translateString("Search entities by name") || ""}
              value={searchText}
              onChange={(value: string) => {
                setSearchText(value);
              }}
            />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {presentTypes.map((typeLabel: string): ReactElement => {
              return (
                <CheckboxElement
                  key={typeLabel}
                  dataTestId={`topology-type-filter-${typeLabel}`}
                  title={metaForEntityType(typeLabel).label}
                  value={!excludedTypes.has(typeLabel)}
                  onChange={(checked: boolean) => {
                    setExcludedTypes((previous: Set<string>): Set<string> => {
                      const next: Set<string> = new Set<string>(previous);
                      if (checked) {
                        next.delete(typeLabel);
                      } else {
                        next.add(typeLabel);
                      }
                      return next;
                    });
                  }}
                />
              );
            })}
          </div>
          {focusKey && (
            <button
              type="button"
              data-testid="topology-clear-focus"
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
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {translateString(
            "Hover over a connection to see how two entities are related. Click an entity for details.",
          ) || ""}
        </p>
      </div>

      {nodes.length === 0 ? (
        <EmptyState
          id="topology-filtered-empty"
          icon={IconProp.FlowDiagram}
          title="No entities match your filters"
          description="Adjust the search text or re-enable entity types to see the map."
        />
      ) : (
        <div style={{ height: "70vh", width: "100%" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView={true}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={true}
            nodesConnectable={false}
            elementsSelectable={true}
            onInit={(instance: ReactFlowInstance) => {
              flowInstance.current = instance;
            }}
            onNodeClick={(_event: React.MouseEvent, node: Node) => {
              setSelectedKey(node.id);
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
              gap={16}
              size={1}
              color="var(--ou-chart-grid, #cbd5e1)"
            />
          </ReactFlow>
        </div>
      )}

      {selectedEntity && (
        <EntityDetailPanel
          entity={selectedEntity}
          relationships={props.relationships}
          entityByKey={entityByKey}
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
    </Fragment>
  );
};

export default InfrastructureGraph;
