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
import computeInfraParenting, { infraEdgeId } from "./InfrastructureNesting";
import EntityDetailPanel from "./EntityDetailPanel";
import ServiceNodeCard from "./ServiceNodeCard";
import { labelForRelationship, metaForEntityType } from "./TopologyMeta";

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

const WORKLOAD_GROUPING_RELATIONSHIPS: Set<EntityRelationshipType> =
  new Set<EntityRelationshipType>([
    EntityRelationshipType.HostedOn,
    EntityRelationshipType.RunsOn,
  ]);

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

  /*
   * The layout is deliberately independent of searchText: search only dims
   * non-matching nodes, so recomputing the two-pass parenting + nested
   * layout on every keystroke (potentially ~1000 nodes) would be wasted
   * work. Dimming is applied in a cheap downstream memo (displayNodes).
   */
  const { baseNodes, edges, appliedParent } = useMemo((): {
    baseNodes: Array<Node>;
    edges: Array<Edge>;
    appliedParent: Map<string, string>;
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

    const entityTypeByKey: Map<string, EntityType | string | undefined> =
      new Map<string, EntityType | string | undefined>();
    for (const key of visibleKeys) {
      entityTypeByKey.set(key, entityByKey.get(key)?.entityType);
    }

    const { parentOf, nestingEdgeByChild } = computeInfraParenting(
      visibleEdges.map((relationship: TelemetryEntityRelationship) => {
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
      const entity: TelemetryEntity | undefined = entityByKey.get(key);
      const label: string = entity?.displayName || "Unnamed entity";
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
      .filter((relationship: TelemetryEntityRelationship) => {
        const id: string = infraEdgeId(
          relationship.fromEntityKey!,
          relationship.relationshipType!,
          relationship.toEntityKey!,
        );
        // Relationships expressed by the applied nesting are not drawn.
        if (consumedEdgeIds.has(id)) {
          return false;
        }
        /*
         * Suppress secondary workload edges: a host on several services
         * nests under one of them, but the OTHER services' hosted-on/
         * runs-on edges would otherwise pierce into that group's box and
         * rebuild a mini-hairball. The extra memberships still show in the
         * node's detail panel. Never draw an edge terminating on a node
         * nested inside a different service's box.
         */
        const parentOfTarget: string | undefined = appliedParent.get(
          relationship.toEntityKey!,
        );
        if (
          WORKLOAD_GROUPING_RELATIONSHIPS.has(
            relationship.relationshipType as EntityRelationshipType,
          ) &&
          entityByKey.get(relationship.fromEntityKey!)?.entityType ===
            EntityType.Service &&
          parentOfTarget &&
          entityByKey.get(parentOfTarget)?.entityType === EntityType.Service
        ) {
          return false;
        }
        return true;
      })
      .map((relationship: TelemetryEntityRelationship): Edge => {
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
  }, [infraEdges, graphNodeKeys, entityByKey, excludedTypes, focusedKeys]);

  /*
   * Apply search dimming here (cheap: no relayout). A container stays bright
   * if it OR any descendant matches — React Flow multiplies a parent's
   * opacity onto its children, so dimming a matched chip's container would
   * hide the very node the search found.
   */
  const displayNodes: Array<Node> = useMemo(() => {
    const lower: string = searchText.trim().toLowerCase();
    if (!lower) {
      return baseNodes;
    }
    const bright: Set<string> = new Set<string>();
    for (const node of baseNodes) {
      const title: string = (
        (node.data as { title?: string } | undefined)?.title || ""
      ).toLowerCase();
      if (title.includes(lower)) {
        let cursor: string | undefined = node.id;
        while (cursor && !bright.has(cursor)) {
          bright.add(cursor);
          cursor = appliedParent.get(cursor);
        }
      }
    }
    return baseNodes.map((node: Node): Node => {
      const dimmed: boolean = !bright.has(node.id);
      return {
        ...node,
        data: { ...(node.data as Record<string, unknown>), dimmed },
      } as Node;
    });
  }, [baseNodes, appliedParent, searchText]);

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
          flowInstance.current.fitView({ padding: 0.12 }),
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
  }, [focusKey, baseNodes.length]);

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
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          {presentTypes.map((typeLabel: string): ReactElement => {
            const meta: { label: string; color: string } =
              metaForEntityType(typeLabel);
            return (
              <span
                key={typeLabel}
                className="inline-flex items-center gap-1.5 text-xs text-gray-500"
              >
                <span
                  className="inline-block"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    backgroundColor: meta.color,
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.1)",
                  }}
                />
                {meta.label}
              </span>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {translateString(
            "Hosts and workloads are grouped inside what they run on. Search to find one; hover a connection to see how two entities relate; click anything for details.",
          ) || ""}
        </p>
      </div>

      {baseNodes.length === 0 ? (
        <EmptyState
          id="topology-filtered-empty"
          icon={IconProp.FlowDiagram}
          title="No entities match your filters"
          description="Adjust the search text or re-enable entity types to see the map."
        />
      ) : (
        <div style={{ height: "70vh", width: "100%" }}>
          <ReactFlow
            nodes={displayNodes}
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
