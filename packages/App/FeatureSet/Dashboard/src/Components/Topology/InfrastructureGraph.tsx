import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
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
import IconProp from "Common/Types/Icon/IconProp";
import useTranslateValue from "Common/UI/Utils/Translation";
import { getInventoryTypeIcon } from "../Inventory/InventoryTypeCatalog";
import TopologyNodeCard, {
  TOPOLOGY_NODE_HEIGHT,
  TOPOLOGY_NODE_WIDTH,
  TopologyNodeStat,
} from "./TopologyNodeCard";
import {
  InfrastructureNode,
  InfrastructureTopologyModel,
  describeInfrastructureNode,
  summarizeCounts,
} from "./InfrastructureTopologyModel";
import { formatLastSeen } from "./TopologyActivity";
import { HEALTH_COLORS, metaForEntityType } from "./TopologyMeta";

/*
 * The map of ONE level of the infrastructure tree: the things directly inside
 * the selected scope, and the services running on them. Never the whole
 * estate at once — a fleet stays one grouped card until the user opens it, so
 * the drawing stays a handful of readable cards at every level instead of
 * hundreds of boxes.
 *
 * Services sit in a column on the left with an arrow to every card they run
 * on, so the picture reads as "what runs where".
 */

export const MAX_MAP_CARDS: number = 48;
// Taller columns than this shrink the whole drawing below readable size.
const MAX_ROWS_PER_COLUMN: number = 8;
const COLUMN_GAP: number = TOPOLOGY_NODE_WIDTH + 120;
const CARD_GAP_X: number = TOPOLOGY_NODE_WIDTH + 28;
const CARD_GAP_Y: number = TOPOLOGY_NODE_HEIGHT + 24;
const OVERFLOW_ID: string = "__more__";
const SERVICE_PREFIX: string = "service:";

export interface ComponentProps {
  model: InfrastructureTopologyModel;
  /** Nodes drawn as cards — normally the scope's children. */
  nodeIds: Array<string>;
  onOpenNode: (id: string) => void;
  onOpenService?: ((serviceKey: string) => void) | undefined;
  onShowAll?: (() => void) | undefined;
  now?: Date | undefined;
}

interface CardData {
  kind: "infrastructure" | "service" | "overflow";
  title: string;
  subtitle: string;
  icon: IconProp;
  color: string;
  statusColor: string;
  statusLabel: string;
  stats: Array<TopologyNodeStat>;
  footer?: string | undefined;
  stacked: boolean;
  dimmed: boolean;
}

const InfrastructureCard: FunctionComponent<NodeProps<CardData>> = (
  props: NodeProps<CardData>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  return (
    <TopologyNodeCard
      testId={`infrastructure-map-node-${props.id}`}
      title={props.data.title}
      subtitle={translateString(props.data.subtitle) || props.data.subtitle}
      icon={props.data.icon}
      color={props.data.color}
      statusColor={props.data.statusColor}
      statusLabel={
        translateString(props.data.statusLabel) || props.data.statusLabel
      }
      stats={props.data.stats}
      footer={props.data.footer}
      stacked={props.data.stacked}
      dimmed={props.data.dimmed}
    />
  );
};

const NODE_TYPES: Record<string, FunctionComponent<NodeProps<CardData>>> = {
  infrastructureCard: InfrastructureCard,
};

export function cardForNode(
  model: InfrastructureTopologyModel,
  node: InfrastructureNode,
  now: Date,
): CardData {
  const typeMeta: { label: string; color: string } = metaForEntityType(
    node.entityType || undefined,
  );
  const services: Array<string> = node.serviceKeys.map(
    (key: string): string => {
      return model.serviceByKey.get(key)?.displayName || key;
    },
  );
  const footer: string | undefined =
    services.length > 0
      ? `Runs ${services.slice(0, 3).join(", ")}${services.length > 3 ? ` +${services.length - 3}` : ""}`
      : undefined;
  const parent: InfrastructureNode | undefined = node.parentId
    ? model.nodes.get(node.parentId)
    : undefined;
  const location: string =
    parent && parent.kind === "resource" ? ` · ${parent.name}` : "";
  const subtitle: string =
    node.kind === "group"
      ? `${typeMeta.label} replicas${location}`
      : node.kind === "category"
        ? "Category"
        : `${typeMeta.label}${location}`;
  return {
    kind: "infrastructure",
    title: node.name,
    subtitle,
    icon:
      node.kind === "group"
        ? IconProp.Squares
        : getInventoryTypeIcon(node.entityType || ""),
    color: typeMeta.color,
    statusColor: node.isActive ? HEALTH_COLORS.healthy : HEALTH_COLORS.unknown,
    /*
     * One line says whether it is running and what it is made of; a machine
     * says when it last reported instead.
     */
    statusLabel: `${node.isActive ? "Active" : "Inactive"} · ${
      node.kind === "resource" && node.childIds.length === 0
        ? `seen ${formatLastSeen(node.lastSeenAt || undefined, now)}`
        : node.kind === "resource"
          ? summarizeCounts(node.countsByType, 2)
          : describeInfrastructureNode(node)
    }`,
    stats: [],
    footer,
    stacked: node.kind === "group",
    dimmed: !node.isActive,
  };
}

export interface InfrastructureMapLayout {
  nodes: Array<Node<CardData>>;
  edges: Array<Edge>;
}

export function layoutInfrastructureMap(data: {
  model: InfrastructureTopologyModel;
  nodeIds: Array<string>;
  now: Date;
}): InfrastructureMapLayout {
  const { model } = data;
  const cards: Array<InfrastructureNode> = data.nodeIds
    .map((id: string): InfrastructureNode | undefined => {
      return model.nodes.get(id);
    })
    .filter(
      (node: InfrastructureNode | undefined): node is InfrastructureNode => {
        return Boolean(node);
      },
    );
  /*
   * Cards that run something come first, so they sit next to the service
   * column and their arrows stay short; the rest keep tree order.
   */
  const ordered: Array<InfrastructureNode> = cards
    .map((node: InfrastructureNode, index: number) => {
      return { node, index };
    })
    .sort(
      (
        a: { node: InfrastructureNode; index: number },
        b: { node: InfrastructureNode; index: number },
      ): number => {
        return (
          Number(b.node.serviceKeys.length > 0) -
            Number(a.node.serviceKeys.length > 0) || a.index - b.index
        );
      },
    )
    .map((item: { node: InfrastructureNode; index: number }) => {
      return item.node;
    });
  const shown: Array<InfrastructureNode> =
    ordered.length > MAX_MAP_CARDS
      ? ordered.slice(0, MAX_MAP_CARDS - 1)
      : ordered;
  const overflow: number = cards.length - shown.length;

  // Services ordered by the first card they run on, to keep arrows untangled.
  const firstCardIndex: Map<string, number> = new Map<string, number>();
  shown.forEach((node: InfrastructureNode, index: number) => {
    for (const key of node.serviceKeys) {
      if (!firstCardIndex.has(key)) {
        firstCardIndex.set(key, index);
      }
    }
  });
  const serviceKeys: Array<string> = Array.from(firstCardIndex.keys()).sort(
    (a: string, b: string): number => {
      return (
        firstCardIndex.get(a)! - firstCardIndex.get(b)! ||
        (model.serviceByKey.get(a)?.displayName || a).localeCompare(
          model.serviceByKey.get(b)?.displayName || b,
        )
      );
    },
  );

  /*
   * Card slots, column by column. Cards that run a service fill the columns
   * nearest the service column, so an arrow never has to pass behind another
   * card to reach its target; everything else starts in the next column.
   * Without services there are no arrows, and a compact grid reads best.
   */
  const slots: Map<string, { column: number; row: number }> = new Map<
    string,
    { column: number; row: number }
  >();
  const slotIds: Array<string> = [
    ...shown.map((node: InfrastructureNode): string => {
      return node.id;
    }),
    ...(overflow > 0 ? [OVERFLOW_ID] : []),
  ];
  let rows: number = 0;
  if (serviceKeys.length === 0) {
    const columns: number = Math.max(
      1,
      Math.min(3, Math.round(Math.sqrt(slotIds.length * 0.6))),
    );
    slotIds.forEach((id: string, index: number) => {
      slots.set(id, {
        column: index % columns,
        row: Math.floor(index / columns),
      });
    });
    rows = Math.ceil(slotIds.length / columns);
  } else {
    const running: number = shown.filter(
      (node: InfrastructureNode): boolean => {
        return node.serviceKeys.length > 0;
      },
    ).length;
    const rowsPerColumn: number = Math.max(
      MAX_ROWS_PER_COLUMN,
      Math.ceil(running / 3),
    );
    const runningColumns: number = Math.ceil(running / rowsPerColumn);
    slotIds.forEach((id: string, index: number) => {
      const isRunning: boolean = index < running;
      const position: number = isRunning ? index : index - running;
      slots.set(id, {
        column:
          (isRunning ? 0 : runningColumns) +
          Math.floor(position / rowsPerColumn),
        row: position % rowsPerColumn,
      });
    });
    rows = Math.min(rowsPerColumn, Math.max(running, slotIds.length - running));
  }
  const offsetX: number = serviceKeys.length > 0 ? COLUMN_GAP : 0;

  const nodes: Array<Node<CardData>> = [];
  const serviceColumnHeight: number = serviceKeys.length * CARD_GAP_Y;
  const cardAreaHeight: number = rows * CARD_GAP_Y;
  const serviceOffsetY: number = Math.max(
    0,
    (cardAreaHeight - serviceColumnHeight) / 2,
  );
  const cardOffsetY: number = Math.max(
    0,
    (serviceColumnHeight - cardAreaHeight) / 2,
  );

  serviceKeys.forEach((key: string, index: number) => {
    const placements: number = shown.filter(
      (node: InfrastructureNode): boolean => {
        return node.serviceKeys.includes(key);
      },
    ).length;
    nodes.push({
      id: `${SERVICE_PREFIX}${key}`,
      type: "infrastructureCard",
      position: { x: 0, y: serviceOffsetY + index * CARD_GAP_Y },
      data: {
        kind: "service",
        title: model.serviceByKey.get(key)?.displayName || key,
        subtitle: "Service",
        icon: IconProp.SquareStack,
        color: metaForEntityType("service").color,
        statusColor: "#6366f1",
        statusLabel: `Runs on ${placements} of these`,
        stats: [],
        stacked: false,
        dimmed: false,
      },
    });
  });

  const positionOf: (id: string) => { x: number; y: number } = (
    id: string,
  ): { x: number; y: number } => {
    const slot: { column: number; row: number } = slots.get(id)!;
    return {
      x: offsetX + slot.column * CARD_GAP_X,
      y: cardOffsetY + slot.row * CARD_GAP_Y,
    };
  };

  shown.forEach((node: InfrastructureNode) => {
    nodes.push({
      id: node.id,
      type: "infrastructureCard",
      position: positionOf(node.id),
      data: cardForNode(model, node, data.now),
    });
  });

  if (overflow > 0) {
    nodes.push({
      id: OVERFLOW_ID,
      type: "infrastructureCard",
      position: positionOf(OVERFLOW_ID),
      data: {
        kind: "overflow",
        title: `${overflow} more`,
        subtitle: "Not drawn",
        icon: IconProp.TableCells,
        color: "#64748b",
        statusColor: "#94a3b8",
        statusLabel: "Open the list to see everything",
        stats: [],
        stacked: true,
        dimmed: false,
      },
    });
  }

  const edges: Array<Edge> = [];
  for (const node of shown) {
    for (const key of node.serviceKeys) {
      edges.push({
        id: `${key}->${node.id}`,
        source: `${SERVICE_PREFIX}${key}`,
        target: node.id,
        type: "default",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#a5b4fc" },
        style: { stroke: "#a5b4fc", strokeWidth: 1.5 },
      });
    }
  }

  return { nodes, edges };
}

const InfrastructureGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const flowInstance: React.MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);

  const layout: InfrastructureMapLayout = useMemo(() => {
    return layoutInfrastructureMap({
      model: props.model,
      nodeIds: props.nodeIds,
      now: props.now || new Date(),
    });
  }, [props.model, props.nodeIds, props.now]);

  const layoutKey: string = layout.nodes
    .map((node: Node<CardData>): string => {
      return node.id;
    })
    .join("|");

  useEffect(() => {
    let raf: number = 0;
    let attempts: number = 16;
    const tryFit: () => void = (): void => {
      const didFit: boolean = Boolean(
        flowInstance.current &&
          layout.nodes.length > 0 &&
          flowInstance.current.fitView({ padding: 0.16, maxZoom: 1 }),
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
  }, [layoutKey]);

  if (layout.nodes.length === 0) {
    return (
      <div role="status" className="p-10 text-center text-sm text-gray-500">
        {translateString("Nothing to draw here") || "Nothing to draw here"}
      </div>
    );
  }

  let drawingHeight: number = 0;
  for (const node of layout.nodes) {
    drawingHeight = Math.max(
      drawingHeight,
      node.position.y + TOPOLOGY_NODE_HEIGHT,
    );
  }

  return (
    <div
      style={{
        height: Math.round(
          Math.min(820, Math.max(380, drawingHeight * 0.85 + 100)),
        ),
        width: "100%",
      }}
      className="bg-slate-50"
      data-testid="infrastructure-map"
    >
      <ReactFlow
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={NODE_TYPES}
        fitView={true}
        fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        onInit={(instance: ReactFlowInstance) => {
          flowInstance.current = instance;
        }}
        onNodeClick={(_event: React.MouseEvent, node: Node) => {
          if (node.id === OVERFLOW_ID) {
            props.onShowAll?.();
            return;
          }
          if (node.id.startsWith(SERVICE_PREFIX)) {
            props.onOpenService?.(node.id.substring(SERVICE_PREFIX.length));
            return;
          }
          props.onOpenNode(node.id);
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
  );
};

export default InfrastructureGraph;
