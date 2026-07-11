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
  Handle,
  MarkerType,
  Node,
  NodeProps,
  Position,
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import TelemetryEntityRelationship from "Common/Models/DatabaseModels/TelemetryEntityRelationship";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Input from "Common/UI/Components/Input/Input";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import Link from "Common/UI/Components/Link/Link";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import useTranslateValue from "Common/UI/Utils/Translation";
import Navigation from "Common/UI/Utils/Navigation";
import computeNestedLayout, {
  NestedLayoutBox,
} from "../../Utils/NestedGraphLayout";
import EntityDetailPanel from "./EntityDetailPanel";
import { labelForRelationship, metaForEntityType } from "./TopologyMeta";

/*
 * Infrastructure topology: the co-occurrence containment graph (runs-on /
 * member-of / hosted-on / part-of / instance-of). Service-to-service call
 * edges live in the sibling Service Map tab.
 *
 * Containment renders as NESTING, not arrows: each structural entity picks
 * one containment edge as its parent (part-of beats runs-on beats
 * member-of; more specific containers beat broader ones, so a pod nests in
 * its node rather than directly in the cluster) and is drawn inside that
 * parent's box — the mental model of a rack diagram. Relationships not
 * expressed by the nesting (a pod's namespace membership, hosted-on,
 * instance-of, and anything touching non-structural entities like
 * services) still render as edges, with plain-language labels on hover.
 */

const LEAF_WIDTH: number = 180;
const LEAF_HEIGHT: number = 64;
const LAYOUT_OPTIONS: {
  leafWidth: number;
  leafHeight: number;
  padding: number;
  headerHeight: number;
  gapX: number;
  gapY: number;
  rootGapX: number;
  rootGapY: number;
  maxRowWidth: number;
} = {
  leafWidth: LEAF_WIDTH,
  leafHeight: LEAF_HEIGHT,
  padding: 16,
  headerHeight: 30,
  gapX: 24,
  gapY: 20,
  rootGapX: 60,
  rootGapY: 50,
  maxRowWidth: 1400,
};

/*
 * Only structural entities nest inside a parent box; workloads like
 * services span many pods/hosts, so nesting them under one would lie.
 */
const NESTABLE_CHILD_TYPES: Set<EntityType> = new Set<EntityType>([
  EntityType.Container,
  EntityType.Process,
  EntityType.KubernetesPod,
  EntityType.KubernetesNode,
  EntityType.KubernetesNamespace,
  EntityType.KubernetesDeployment,
  EntityType.ProxmoxNode,
  EntityType.ProxmoxGuest,
  EntityType.DockerSwarmNode,
  EntityType.DockerSwarmService,
  EntityType.DockerSwarmTask,
]);

// Higher wins when two candidate parents tie on relationship priority.
const CONTAINER_SPECIFICITY: Partial<Record<EntityType, number>> = {
  [EntityType.KubernetesCluster]: 0,
  [EntityType.ProxmoxCluster]: 0,
  [EntityType.CephCluster]: 0,
  [EntityType.DockerSwarmCluster]: 0,
  [EntityType.Host]: 1,
  [EntityType.KubernetesNamespace]: 1,
  [EntityType.KubernetesNode]: 2,
  [EntityType.KubernetesDeployment]: 2,
  [EntityType.ProxmoxNode]: 2,
  [EntityType.DockerSwarmNode]: 2,
  [EntityType.KubernetesPod]: 3,
  [EntityType.ProxmoxGuest]: 3,
  [EntityType.DockerSwarmTask]: 3,
  [EntityType.Container]: 4,
};

const NESTING_RELATIONSHIP_PRIORITY: Partial<
  Record<EntityRelationshipType, number>
> = {
  [EntityRelationshipType.PartOf]: 3,
  [EntityRelationshipType.RunsOn]: 2,
  [EntityRelationshipType.MemberOf]: 1,
};

interface ContainerNodeData {
  title: string;
  typeLabel: string;
  color: string;
  dimmed: boolean;
}

/*
 * A container box: header label at the top, children render inside.
 * Invisible handles so edges touching the container still attach (custom
 * React Flow nodes without <Handle>s silently drop their edges).
 */
const InfraContainerNode: FunctionComponent<NodeProps<ContainerNodeData>> = (
  props: NodeProps<ContainerNodeData>,
): ReactElement => {
  const { data } = props;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: `2px solid ${data.color}`,
        borderRadius: 10,
        background: `${data.color}0d`,
        opacity: data.dimmed ? 0.25 : 1,
        cursor: "pointer",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: "none" }}
      />
      <div
        style={{
          padding: "6px 10px",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--ou-text-primary, #111827)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {data.title}
        <span
          style={{
            marginLeft: 8,
            fontWeight: 400,
            color: "#6b7280",
            fontSize: 11,
          }}
        >
          {data.typeLabel}
        </span>
      </div>
    </div>
  );
};

const INFRA_NODE_TYPES: Record<
  string,
  FunctionComponent<NodeProps<ContainerNodeData>>
> = {
  infraContainer: InfraContainerNode,
};

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

  /*
   * Search and focus live in the URL (replaceState — no history flood) so
   * a filtered/focused view is shareable. A focus key that does not exist
   * in this graph (e.g. carried over from the other tab) is ignored.
   */
  const [searchText, setSearchTextState] = useState<string>(
    Navigation.getQueryStringByName("infraSearch") || "",
  );
  const [excludedTypes, setExcludedTypes] = useState<Set<string>>(
    new Set<string>(),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusKey, setFocusKeyState] = useState<string | null>(
    Navigation.getQueryStringByName("infraFocus"),
  );

  /*
   * Debounce the URL mirror: per-keystroke replaceState trips Safari's
   * rate limit; React state stays the source of truth. Params are
   * namespaced per tab so Service Map state never leaks into this graph.
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
      Navigation.setQueryString({ infraSearch: value || null });
    }, 250);
  };
  const setFocusKey: (value: string | null) => void = (
    value: string | null,
  ): void => {
    setFocusKeyState(value);
    Navigation.setQueryString({ infraFocus: value });
  };
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

  // Keys that actually render in this graph (entities with 1+ edge).
  const graphNodeKeys: Set<string> = useMemo(() => {
    const keys: Set<string> = new Set<string>();
    for (const relationship of infraEdges) {
      keys.add(relationship.fromEntityKey!);
      keys.add(relationship.toEntityKey!);
    }
    return keys;
  }, [infraEdges]);

  // Only honor a focus key that exists in THIS graph.
  const effectiveFocusKey: string | null =
    focusKey && graphNodeKeys.has(focusKey) ? focusKey : null;

  // Focus mode: everything connected to the focused node, both directions.
  const focusedKeys: Set<string> | null = useMemo(() => {
    if (!effectiveFocusKey) {
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
    const reached: Set<string> = new Set<string>([effectiveFocusKey]);
    const queue: Array<string> = [effectiveFocusKey];
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
  }, [effectiveFocusKey, infraEdges]);

  const { nodes, edges } = useMemo((): {
    nodes: Array<Node>;
    edges: Array<Edge>;
  } => {
    const visibleKeys: Set<string> = new Set<string>();
    for (const key of graphNodeKeys) {
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
     * Pick one containment edge per structural entity as its nesting
     * parent: highest relationship priority wins, then the most specific
     * container type, then the lexicographically smallest key so the
     * choice is deterministic. Edges chosen for nesting are not drawn.
     */
    const parentOf: Map<string, string> = new Map<string, string>();
    const nestingEdgeKeys: Set<string> = new Set<string>();
    const candidateByChild: Map<
      string,
      { relationship: TelemetryEntityRelationship; score: [number, number] }
    > = new Map<
      string,
      { relationship: TelemetryEntityRelationship; score: [number, number] }
    >();
    for (const relationship of visibleEdges) {
      const childKey: string = relationship.fromEntityKey!;
      const parentKey: string = relationship.toEntityKey!;
      const childType: EntityType | undefined =
        entityByKey.get(childKey)?.entityType;
      const parentType: EntityType | undefined =
        entityByKey.get(parentKey)?.entityType;
      if (!childType || !NESTABLE_CHILD_TYPES.has(childType)) {
        continue;
      }
      const priority: number =
        NESTING_RELATIONSHIP_PRIORITY[
          relationship.relationshipType as EntityRelationshipType
        ] || 0;
      if (priority === 0) {
        continue;
      }
      const specificity: number =
        (parentType && CONTAINER_SPECIFICITY[parentType]) ?? -1;
      const score: [number, number] = [priority, specificity];
      const current:
        | {
            relationship: TelemetryEntityRelationship;
            score: [number, number];
          }
        | undefined = candidateByChild.get(childKey);
      const better: boolean =
        !current ||
        score[0] > current.score[0] ||
        (score[0] === current.score[0] && score[1] > current.score[1]) ||
        (score[0] === current.score[0] &&
          score[1] === current.score[1] &&
          parentKey < (current.relationship.toEntityKey || ""));
      if (better) {
        candidateByChild.set(childKey, { relationship, score });
      }
    }
    for (const [childKey, candidate] of candidateByChild) {
      parentOf.set(childKey, candidate.relationship.toEntityKey!);
      nestingEdgeKeys.add(
        `${candidate.relationship.fromEntityKey}-${candidate.relationship.relationshipType}-${candidate.relationship.toEntityKey}`,
      );
    }

    const layout: Map<string, NestedLayoutBox> = computeNestedLayout(
      Array.from(visibleKeys),
      parentOf,
      LAYOUT_OPTIONS,
    );

    const lowerSearch: string = searchText.trim().toLowerCase();
    const hasChildren: Set<string> = new Set<string>(parentOf.values());

    /*
     * React Flow requires a parent node to appear in the array before its
     * children — order by nesting depth.
     */
    const depthOf: (key: string) => number = (key: string): number => {
      let depth: number = 0;
      let cursor: string | undefined = layout.get(key)?.parentId || undefined;
      while (cursor && depth < 100) {
        depth++;
        cursor = layout.get(cursor)?.parentId || undefined;
      }
      return depth;
    };

    const orderedKeys: Array<string> = Array.from(visibleKeys).sort(
      (a: string, b: string) => {
        const diff: number = depthOf(a) - depthOf(b);
        if (diff !== 0) {
          return diff;
        }
        return a.localeCompare(b);
      },
    );

    const builtNodes: Array<Node> = orderedKeys.map((key: string): Node => {
      const entity: TelemetryEntity | undefined = entityByKey.get(key);
      const label: string = entity?.displayName || "Unnamed entity";
      const typeMeta: { label: string; color: string } = metaForEntityType(
        entity?.entityType,
      );
      const dimmed: boolean = Boolean(
        lowerSearch && !label.toLowerCase().includes(lowerSearch),
      );
      const box: NestedLayoutBox = layout.get(key) || {
        x: 0,
        y: 0,
        width: LEAF_WIDTH,
        height: LEAF_HEIGHT,
        parentId: null,
      };
      const isContainer: boolean = hasChildren.has(key);

      const common: Partial<Node> = {
        position: { x: box.x, y: box.y },
        ...(box.parentId
          ? { parentNode: box.parentId, extent: "parent" as const }
          : {}),
      };

      if (isContainer) {
        return {
          id: key,
          type: "infraContainer",
          ...common,
          data: {
            title: label,
            typeLabel: typeMeta.label,
            color: typeMeta.color,
            dimmed,
          },
          style: { width: box.width, height: box.height },
        } as Node;
      }

      return {
        id: key,
        ...common,
        data: { label: `${label}\n${typeMeta.label}` },
        style: {
          fontSize: "12px",
          whiteSpace: "pre-line",
          border: `2px solid ${typeMeta.color}`,
          borderRadius: 8,
          backgroundColor: "var(--ou-surface-primary, #ffffff)",
          color: "var(--ou-text-primary, #111827)",
          width: LEAF_WIDTH,
          opacity: dimmed ? 0.25 : 1,
          cursor: "pointer",
        },
      } as Node;
    });

    const builtEdges: Array<Edge> = visibleEdges
      .filter((relationship: TelemetryEntityRelationship) => {
        // Relationships expressed by the nesting are not drawn as arrows.
        return !nestingEdgeKeys.has(
          `${relationship.fromEntityKey}-${relationship.relationshipType}-${relationship.toEntityKey}`,
        );
      })
      .map((relationship: TelemetryEntityRelationship): Edge => {
        const id: string = `${relationship.fromEntityKey}-${relationship.relationshipType}-${relationship.toEntityKey}`;
        return {
          id,
          source: relationship.fromEntityKey!,
          target: relationship.toEntityKey!,
          type: "smoothstep",
          data: { relationshipType: relationship.relationshipType },
          labelStyle: { fontSize: 11, fill: "#374151" },
          labelBgStyle: {
            fill: "var(--ou-surface-primary, #ffffff)",
            fillOpacity: 0.9,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
          style: { stroke: "#94a3b8" },
        };
      });

    return { nodes: builtNodes, edges: builtEdges };
  }, [
    infraEdges,
    graphNodeKeys,
    entityByKey,
    excludedTypes,
    focusedKeys,
    searchText,
  ]);

  /*
   * Hover labels live in a separate cheap memo: only the edges array
   * changes on hover, so React Flow never rebuilds (and re-measures)
   * every node while the mouse crosses edges.
   */
  const displayEdges: Array<Edge> = useMemo(() => {
    if (!hoveredEdgeId) {
      return edges;
    }
    return edges.map((edge: Edge): Edge => {
      if (edge.id !== hoveredEdgeId) {
        return edge;
      }
      return {
        ...edge,
        label: labelForRelationship(
          (edge.data as { relationshipType?: string } | undefined)
            ?.relationshipType,
        ),
      };
    });
  }, [edges, hoveredEdgeId]);

  /*
   * Re-fit when the visible graph changes. A new controlled `nodes` array
   * wipes React Flow's measured dimensions, and fitView no-ops (returns
   * false) until nodes re-measure — retry on animation frames until it
   * lands.
   */
  useEffect(() => {
    let raf: number = 0;
    let attempts: number = 20;
    const tryFit: () => void = (): void => {
      const didFit: boolean = Boolean(
        flowInstance.current &&
          nodes.length > 0 &&
          flowInstance.current.fitView({ padding: 0.15 }),
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
          {effectiveFocusKey && (
            <button
              type="button"
              data-testid="topology-clear-focus"
              className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-700 hover:bg-indigo-100"
              onClick={() => {
                setFocusKey(null);
              }}
            >
              {translateString("Focused on") || "Focused on"}{" "}
              {entityByKey.get(effectiveFocusKey)?.displayName ||
                effectiveFocusKey}
              <span aria-hidden={true}>✕</span>
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {translateString(
            "Entities are nested inside what contains them. Hover over a connection to see how two entities are related; click anything for details.",
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
            edges={displayEdges}
            nodeTypes={INFRA_NODE_TYPES}
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
