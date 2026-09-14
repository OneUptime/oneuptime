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
  Handle,
  MarkerType,
  Node,
  NodeProps,
  Position,
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import useTranslateValue from "Common/UI/Utils/Translation";
import computeNestedLayout, {
  NestedLayoutBox,
} from "../../Utils/NestedGraphLayout";
import computeInfraParenting, { infraEdgeId } from "./InfrastructureNesting";
import ServiceNodeCard from "./ServiceNodeCard";
import { labelForRelationship, metaForEntityType } from "./TopologyMeta";
import { getInfrastructureGraphNodeKeys } from "./TopologyInventoryData";

/*
 * Infrastructure topology: the co-occurrence containment graph (runs-on /
 * member-of / hosted-on / part-of / instance-of). Service-to-service call
 * edges live in the sibling Service Map tab.
 *
 * Containment renders as NESTING, not arrows (see InfrastructureNesting.ts
 * for how each node's single parent is picked):
 *   - structural containment nests a pod in its node, a container in its
 *     host, and so on — the mental model of a rack diagram; and
 *   - workload grouping nests the fleet of hosts/pods a service runs on
 *     inside that service, so "one service across 120 hosts" reads as one
 *     labelled box instead of 120 loose boxes tied to a hub by 120 edges.
 * Relationships not expressed by the nesting still render as edges, with
 * plain-language labels on hover.
 */

const LEAF_WIDTH: number = 200;
const LEAF_HEIGHT: number = 48;
/*
 * Light, neutral border for leaf cards — the type is carried by the color
 * dot, so 120 fleet chips read as a calm texture, not 120 loud borders.
 */
const LEAF_BORDER_COLOR: string = "#e2e8f0";

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
  headerHeight: 44,
  gapX: 14,
  gapY: 12,
  rootGapX: 48,
  rootGapY: 44,
  maxRowWidth: 1500,
};

interface ContainerNodeData {
  title: string;
  typeLabel: string;
  color: string;
  /** e.g. "120 hosts" — visible child count, from the applied layout. */
  countLabel: string;
  dimmed: boolean;
}

interface LeafNodeData {
  title: string;
  typeLabel: string;
  color: string;
  /** Standalone leaves show their type; grouped chips omit it (redundant). */
  showType: boolean;
  dimmed: boolean;
}

/*
 * A container box: a strong type-colored header (name, type, and a count
 * pill), children render inside. Invisible handles so edges touching the
 * container still attach (custom React Flow nodes without <Handle>s silently
 * drop their edges).
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
        borderRadius: 12,
        background: `${data.color}0d`,
        opacity: data.dimmed ? 0.35 : 1,
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
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 12px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              backgroundColor: data.color,
              flexShrink: 0,
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.1)",
            }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ou-text-primary, #111827)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {data.title}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 400,
              color: "#6b7280",
              flexShrink: 0,
            }}
          >
            {data.typeLabel}
          </span>
        </div>
        <span
          style={{
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 600,
            color: data.color,
            background: `${data.color}1a`,
            borderRadius: 999,
            padding: "2px 8px",
            whiteSpace: "nowrap",
          }}
        >
          {data.countLabel}
        </span>
      </div>
    </div>
  );
};

/*
 * A leaf node: the shared service-graph card so the Infrastructure map and
 * the Service Map speak one visual language. Type is carried by the color
 * dot; the border stays a calm neutral.
 */
const InfraLeafNode: FunctionComponent<NodeProps<LeafNodeData>> = (
  props: NodeProps<LeafNodeData>,
): ReactElement => {
  const { data } = props;
  return (
    <ServiceNodeCard
      label={data.title}
      health="unknown"
      borderColor={LEAF_BORDER_COLOR}
      colorDot={data.color}
      dimmed={data.dimmed}
      statLines={
        data.showType
          ? [
              <span key="type" style={{ color: "#6b7280" }}>
                {data.typeLabel}
              </span>,
            ]
          : undefined
      }
    />
  );
};

const INFRA_NODE_TYPES: Record<string, FunctionComponent<NodeProps>> = {
  infraContainer: InfraContainerNode as FunctionComponent<NodeProps>,
  infraLeaf: InfraLeafNode as FunctionComponent<NodeProps>,
};

export interface ComponentProps {
  entities: Array<InventoryItem>;
  relationships: Array<InventoryItemRelationship>;
  onSelectResource?: (key: string) => void;
}

const InfrastructureGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const flowInstance: React.MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);

  const entityByKey: Map<string, InventoryItem> = useMemo(() => {
    const map: Map<string, InventoryItem> = new Map<string, InventoryItem>();
    for (const entity of props.entities) {
      if (entity.entityKey) {
        map.set(entity.entityKey, entity);
      }
    }
    return map;
  }, [props.entities]);

  const infraEdges: Array<InventoryItemRelationship> = useMemo(() => {
    return props.relationships.filter(
      (relationship: InventoryItemRelationship) => {
        return (
          relationship.relationshipType !== EntityRelationshipType.DependsOn &&
          Boolean(relationship.fromEntityKey) &&
          Boolean(relationship.toEntityKey)
        );
      },
    );
  }, [props.relationships]);

  // Every current Inventory item, plus any unresolved relationship endpoints.
  const graphNodeKeys: Set<string> = useMemo(() => {
    return getInfrastructureGraphNodeKeys({
      entities: props.entities,
      infrastructureRelationships: infraEdges,
    });
  }, [infraEdges, props.entities]);

  const { baseNodes, edges } = useMemo((): {
    baseNodes: Array<Node>;
    edges: Array<Edge>;
    appliedParent: Map<string, string>;
  } => {
    const visibleKeys: Set<string> = graphNodeKeys;

    const visibleEdges: Array<InventoryItemRelationship> = infraEdges.filter(
      (relationship: InventoryItemRelationship) => {
        return (
          visibleKeys.has(relationship.fromEntityKey!) &&
          visibleKeys.has(relationship.toEntityKey!)
        );
      },
    );

    const entityTypeByKey: Map<string, EntityType | string | undefined> =
      new Map<string, EntityType | string | undefined>();
    for (const key of visibleKeys) {
      entityTypeByKey.set(key, entityByKey.get(key)?.entityType);
    }

    const { parentOf, nestingEdgeByChild } = computeInfraParenting(
      visibleEdges.map((relationship: InventoryItemRelationship) => {
        return {
          fromEntityKey: relationship.fromEntityKey!,
          toEntityKey: relationship.toEntityKey!,
          relationshipType: relationship.relationshipType!,
        };
      }),
      entityTypeByKey,
    );

    const layout: Map<string, NestedLayoutBox> = computeNestedLayout(
      Array.from(visibleKeys),
      parentOf,
      LAYOUT_OPTIONS,
    );

    /*
     * Read the APPLIED hierarchy back from the sanitized layout — NOT from
     * parentOf. computeNestedLayout silently drops cycle/self/unknown
     * parent links, so anything that styles or hides nodes must agree with
     * where they were actually placed, or a dropped link leaves a
     * leaf-sized box wearing container chrome and an edge that is neither
     * drawn nor nested.
     */
    const appliedParent: Map<string, string> = new Map<string, string>();
    const childCount: Map<string, number> = new Map<string, number>();
    const childTypeOfParent: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();
    for (const [key, box] of layout) {
      if (box.parentId) {
        appliedParent.set(key, box.parentId);
        childCount.set(box.parentId, (childCount.get(box.parentId) || 0) + 1);
        const set: Set<string> =
          childTypeOfParent.get(box.parentId) || new Set<string>();
        set.add(entityByKey.get(key)?.entityType || "unknown");
        childTypeOfParent.set(box.parentId, set);
      }
    }
    const hasChildren: Set<string> = new Set<string>(appliedParent.values());

    // Only hide an edge if the nesting it expresses was actually applied.
    const consumedEdgeIds: Set<string> = new Set<string>();
    for (const [childKey, selection] of nestingEdgeByChild) {
      if (appliedParent.get(childKey) === selection.parentKey) {
        consumedEdgeIds.add(selection.edgeId);
      }
    }

    /*
     * React Flow requires a parent node to appear in the array before its
     * children — order by nesting depth (read from the same sanitized
     * layout, so order and hierarchy can never disagree). Depth is memoized
     * once rather than re-walked inside the sort comparator.
     */
    const depthByKey: Map<string, number> = new Map<string, number>();
    const depthOf: (key: string) => number = (key: string): number => {
      const cached: number | undefined = depthByKey.get(key);
      if (cached !== undefined) {
        return cached;
      }
      let depth: number = 0;
      let cursor: string | undefined = appliedParent.get(key);
      const guard: Set<string> = new Set<string>([key]);
      while (cursor && !guard.has(cursor) && depth < 100) {
        guard.add(cursor);
        depth++;
        cursor = appliedParent.get(cursor);
      }
      depthByKey.set(key, depth);
      return depth;
    };

    /*
     * Code-unit compare (matches computeNestedLayout's .sort()) for a
     * deterministic, locale-independent order.
     */
    const orderedKeys: Array<string> = Array.from(visibleKeys).sort(
      (a: string, b: string) => {
        const diff: number = depthOf(a) - depthOf(b);
        if (diff !== 0) {
          return diff;
        }
        return a < b ? -1 : a > b ? 1 : 0;
      },
    );

    const countLabelFor: (key: string) => string = (key: string): string => {
      const count: number = childCount.get(key) || 0;
      const types: Set<string> = childTypeOfParent.get(key) || new Set();
      if (types.size === 1) {
        const only: string = Array.from(types)[0]!;
        const noun: string = metaForEntityType(only).label.toLowerCase();
        return `${count} ${noun}${count === 1 ? "" : "s"}`;
      }
      return `${count} item${count === 1 ? "" : "s"}`;
    };

    const builtNodes: Array<Node> = orderedKeys.map((key: string): Node => {
      const entity: InventoryItem | undefined = entityByKey.get(key);
      const label: string =
        entity?.displayName || `Undiscovered resource · ${key}`;
      const typeMeta: { label: string; color: string } = metaForEntityType(
        entity?.entityType,
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
            countLabel: countLabelFor(key),
            dimmed: false,
          } as ContainerNodeData,
          style: { width: box.width, height: box.height },
        } as Node;
      }

      return {
        id: key,
        type: "infraLeaf",
        ...common,
        data: {
          title: label,
          typeLabel: typeMeta.label,
          color: typeMeta.color,
          showType: !box.parentId,
          dimmed: false,
        } as LeafNodeData,
      } as Node;
    });

    const builtEdges: Array<Edge> = visibleEdges
      .filter((relationship: InventoryItemRelationship) => {
        const id: string = infraEdgeId(
          relationship.fromEntityKey!,
          relationship.relationshipType!,
          relationship.toEntityKey!,
        );
        /*
         * Nesting expresses one relationship. Keep every other connection,
         * including a shared resource's links to services outside its group.
         */
        return !consumedEdgeIds.has(id);
      })
      .map((relationship: InventoryItemRelationship): Edge => {
        const id: string = infraEdgeId(
          relationship.fromEntityKey!,
          relationship.relationshipType!,
          relationship.toEntityKey!,
        );
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

    return { baseNodes: builtNodes, edges: builtEdges, appliedParent };
  }, [infraEdges, graphNodeKeys, entityByKey]);

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
   * lands. Only structural changes (focus / node count) refit, not dimming.
   */
  useEffect(() => {
    let raf: number = 0;
    let attempts: number = 16;
    const tryFit: () => void = (): void => {
      const didFit: boolean = Boolean(
        flowInstance.current &&
          baseNodes.length > 0 &&
          flowInstance.current.fitView({ padding: 0.15, maxZoom: 1 }),
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
  }, [baseNodes]);

  if (baseNodes.length === 0) {
    return (
      <div role="status" className="p-10 text-center text-sm text-gray-500">
        {translateString("No resources in this map")}
      </div>
    );
  }

  return (
    <div style={{ height: "min(65vh, 680px)", minHeight: 360, width: "100%" }}>
      <ReactFlow
        nodes={baseNodes}
        edges={displayEdges}
        nodeTypes={INFRA_NODE_TYPES}
        fitView={true}
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        onInit={(instance: ReactFlowInstance) => {
          flowInstance.current = instance;
        }}
        onNodeClick={(_event: React.MouseEvent, node: Node) => {
          props.onSelectResource?.(node.id);
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
          gap={20}
          size={1}
          color="var(--ou-chart-grid, #cbd5e1)"
        />
      </ReactFlow>
    </div>
  );
};

export default InfrastructureGraph;
