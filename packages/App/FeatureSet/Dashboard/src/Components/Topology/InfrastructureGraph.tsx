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
import IconProp from "Common/Types/Icon/IconProp";
import useTranslateValue from "Common/UI/Utils/Translation";
import computeLayeredLayout, {
  LayoutPoint,
} from "../../Utils/LayeredGraphLayout";
import { getInventoryTypeIcon } from "../Inventory/InventoryTypeCatalog";
import TopologyNodeCard, {
  TOPOLOGY_NODE_HEIGHT,
  TOPOLOGY_NODE_WIDTH,
  TopologyNodeStat,
} from "./TopologyNodeCard";
import {
  InfrastructureNode,
  InfrastructureTopologyModel,
  InfrastructureTraffic,
  InfrastructureTrafficLink,
  computeInfrastructureTraffic,
  describeInfrastructureNode,
  isContainerNode,
  summarizeCounts,
} from "./InfrastructureTopologyModel";
import { formatLastSeen } from "./TopologyActivity";
import {
  HEALTH_COLORS,
  edgeWidthForCalls,
  formatCallRate,
  formatDurationMs,
  formatErrorRate,
  metaForEntityType,
} from "./TopologyMeta";

/*
 * The map of ONE level of the infrastructure tree: the things directly inside
 * the selected scope, the services running on them, and the traffic between
 * them. Never the whole estate at once — a fleet stays one grouped card until
 * the user opens it, so the drawing stays a handful of readable cards at
 * every level instead of hundreds of boxes.
 *
 * Services sit in a column on the left with an arrow to every card they run
 * on, so the picture reads as "what runs where". When services on one card
 * call services on another, a line joins the two cards, colored by error
 * rate and labeled with the calls' rate, errors or latency, and the cards
 * that talk are laid out left to right in call order so the lines rarely
 * cross a card. A collection (thousands of IoT devices, say) is always a
 * single card with its count.
 */

export const MAX_MAP_CARDS: number = 48;
// Taller columns than this shrink the whole drawing below readable size.
const MAX_ROWS_PER_COLUMN: number = 8;
const COLUMN_GAP: number = TOPOLOGY_NODE_WIDTH + 120;
const CARD_GAP_X: number = TOPOLOGY_NODE_WIDTH + 28;
const CARD_GAP_Y: number = TOPOLOGY_NODE_HEIGHT + 24;
// Room between call layers for a line and its label.
const TRAFFIC_COLUMN_GAP: number = TOPOLOGY_NODE_WIDTH + 140;
const OVERFLOW_ID: string = "__more__";
const SERVICE_PREFIX: string = "service:";
export const TRAFFIC_EDGE_PREFIX: string = "traffic:";

/* What a traffic line is labeled with: always one metric, or on hover. */
export type TrafficLabel = "hover" | "calls" | "errors" | "latency";

export interface ComponentProps {
  model: InfrastructureTopologyModel;
  /** Nodes drawn as cards — normally the scope's children. */
  nodeIds: Array<string>;
  onOpenNode: (id: string) => void;
  onOpenService?: ((serviceKey: string) => void) | undefined;
  /** A traffic line was clicked. */
  onOpenTraffic?: ((link: InfrastructureTrafficLink) => void) | undefined;
  onShowAll?: (() => void) | undefined;
  /** Seconds the calls' traffic was measured over (the rate's window). */
  metricsWindowSeconds?: number | undefined;
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
      : node.kind === "collection"
        ? "Collection"
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
     * says when it last reported instead. A collection is one card however
     * many items it holds, so its line carries the count.
     */
    statusLabel: `${node.isActive ? "Active" : "Inactive"} · ${
      node.kind === "resource" && !isContainerNode(node)
        ? `seen ${formatLastSeen(node.lastSeenAt || undefined, now)}`
        : node.kind === "resource"
          ? summarizeCounts(node.countsByType, 2)
          : describeInfrastructureNode(node)
    }`,
    stats: [],
    footer,
    stacked: node.kind === "group" || node.kind === "collection",
    dimmed: !node.isActive,
  };
}

export interface InfrastructureMapLayout {
  nodes: Array<Node<CardData>>;
  /* Placement arrows: a service to every card it runs on. */
  edges: Array<Edge>;
  /* Traffic between the cards drawn (see trafficEdges for its lines). */
  traffic: InfrastructureTraffic;
}

/*
 * Cards whose services call each other are laid out in call order —
 * callers to the left of what they call, as on the Service Map — so a line
 * rarely has to cross a card. The rest follow in columns to their right, in
 * the order they came (cards that run something first). Positions are
 * relative to the card area; returns its height in rows.
 */
function placeTalkingCards(data: {
  slotIds: Array<string>;
  talking: Set<string>;
  links: Array<InfrastructureTrafficLink>;
  positions: Map<string, LayoutPoint>;
}): number {
  /* The layered layout stacks layers downward; this map reads rightward. */
  const layered: Map<string, LayoutPoint> = computeLayeredLayout(
    Array.from(data.talking),
    data.links.map((link: InfrastructureTrafficLink) => {
      return { from: link.from, to: link.to };
    }),
    { xGap: CARD_GAP_Y, yGap: TRAFFIC_COLUMN_GAP },
  );
  let lastLayerX: number = 0;
  let widestLayerY: number = 0;
  for (const point of layered.values()) {
    lastLayerX = Math.max(lastLayerX, point.y);
    widestLayerY = Math.max(widestLayerY, point.x);
  }
  const layeredRows: number = Math.round(widestLayerY / CARD_GAP_Y) + 1;

  const rest: Array<string> = data.slotIds.filter((id: string): boolean => {
    return !data.talking.has(id);
  });
  const rowsPerColumn: number = Math.max(MAX_ROWS_PER_COLUMN, layeredRows);
  const restRows: number = Math.min(rowsPerColumn, rest.length);
  const rows: number = Math.max(layeredRows, restRows);

  const layeredOffsetY: number = ((rows - layeredRows) / 2) * CARD_GAP_Y;
  for (const [id, point] of layered) {
    data.positions.set(id, { x: point.y, y: layeredOffsetY + point.x });
  }
  const restStartX: number = lastLayerX + COLUMN_GAP;
  const restOffsetY: number = ((rows - restRows) / 2) * CARD_GAP_Y;
  rest.forEach((id: string, index: number) => {
    data.positions.set(id, {
      x: restStartX + Math.floor(index / rowsPerColumn) * CARD_GAP_X,
      y: restOffsetY + (index % rowsPerColumn) * CARD_GAP_Y,
    });
  });
  return rows;
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
  const running: number = shown.filter((node: InfrastructureNode): boolean => {
    return node.serviceKeys.length > 0;
  }).length;

  const traffic: InfrastructureTraffic = computeInfrastructureTraffic(
    model,
    shown.map((node: InfrastructureNode): string => {
      return node.id;
    }),
  );
  const talking: Set<string> = new Set<string>();
  for (const link of traffic.links) {
    talking.add(link.from);
    talking.add(link.to);
  }

  /*
   * Card positions, relative to the card area. With traffic, the cards that
   * talk are laid out in call order (placeTalkingCards). Otherwise cards go
   * column by column: cards that run a service fill the columns nearest the
   * service column, so an arrow never has to pass behind another card to
   * reach its target, and everything else starts in the next column.
   * Without services there are no arrows, and a compact grid reads best.
   */
  const positions: Map<string, LayoutPoint> = new Map<string, LayoutPoint>();
  const slotIds: Array<string> = [
    ...shown.map((node: InfrastructureNode): string => {
      return node.id;
    }),
    ...(overflow > 0 ? [OVERFLOW_ID] : []),
  ];
  let rows: number = 0;
  if (talking.size > 0) {
    rows = placeTalkingCards({
      slotIds,
      talking,
      links: traffic.links,
      positions,
    });
  } else if (running === 0) {
    const columns: number = Math.max(
      1,
      Math.min(3, Math.round(Math.sqrt(slotIds.length * 0.6))),
    );
    slotIds.forEach((id: string, index: number) => {
      positions.set(id, {
        x: (index % columns) * CARD_GAP_X,
        y: Math.floor(index / columns) * CARD_GAP_Y,
      });
    });
    rows = Math.ceil(slotIds.length / columns);
  } else {
    const rowsPerColumn: number = Math.max(
      MAX_ROWS_PER_COLUMN,
      Math.ceil(running / 3),
    );
    const runningColumns: number = Math.ceil(running / rowsPerColumn);
    slotIds.forEach((id: string, index: number) => {
      const isRunning: boolean = index < running;
      const position: number = isRunning ? index : index - running;
      positions.set(id, {
        x:
          ((isRunning ? 0 : runningColumns) +
            Math.floor(position / rowsPerColumn)) *
          CARD_GAP_X,
        y: (position % rowsPerColumn) * CARD_GAP_Y,
      });
    });
    rows = Math.min(rowsPerColumn, Math.max(running, slotIds.length - running));
  }

  /*
   * Services ordered by the first card they run on, to keep arrows
   * untangled: in tree order, or top to bottom once traffic has placed the
   * cards.
   */
  const drawingOrder: Array<InfrastructureNode> =
    talking.size > 0
      ? [...shown].sort(
          (left: InfrastructureNode, right: InfrastructureNode): number => {
            const a: LayoutPoint = positions.get(left.id)!;
            const b: LayoutPoint = positions.get(right.id)!;
            return a.y - b.y || a.x - b.x;
          },
        )
      : shown;
  const firstCardIndex: Map<string, number> = new Map<string, number>();
  drawingOrder.forEach((node: InfrastructureNode, index: number) => {
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

  const positionOf: (id: string) => LayoutPoint = (id: string): LayoutPoint => {
    const point: LayoutPoint = positions.get(id)!;
    return {
      x: offsetX + point.x,
      y: cardOffsetY + point.y,
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

  return { nodes, edges, traffic };
}

/** "12/min", "0.4% errors" or "45ms" for a line: one metric of its traffic. */
export function trafficMetricLabel(
  link: InfrastructureTrafficLink,
  metric: Exclude<TrafficLabel, "hover">,
  metricsWindowSeconds: number,
): string {
  if (metric === "calls") {
    return formatCallRate(link.calls, metricsWindowSeconds);
  }
  if (metric === "errors") {
    return `${formatErrorRate(link.calls, link.errors)} errors`;
  }
  return formatDurationMs(link.avgDurationMs ?? undefined);
}

/*
 * What a line stands for, in words: its busiest service calls and their
 * traffic. "checkout → payments, checkout → cart: 12/min · 0.4% errors ·
 * 45ms avg".
 */
export function describeTrafficLink(
  model: InfrastructureTopologyModel,
  link: InfrastructureTrafficLink,
  metricsWindowSeconds: number,
): string {
  const name: (key: string) => string = (key: string): string => {
    return model.serviceByKey.get(key)?.displayName || key;
  };
  const calls: string = link.serviceCalls
    .slice(0, 3)
    .map((call: { from: string; to: string }): string => {
      return `${name(call.from)} → ${name(call.to)}`;
    })
    .join(", ");
  const more: string =
    link.serviceCalls.length > 3 ? ` +${link.serviceCalls.length - 3}` : "";
  const traffic: string =
    link.calls > 0
      ? `${formatCallRate(link.calls, metricsWindowSeconds)} · ${formatErrorRate(link.calls, link.errors)} errors · ${formatDurationMs(link.avgDurationMs ?? undefined)} avg`
      : "no calls counted";
  return `${calls}${more}: ${traffic}`;
}

export interface TrafficEdgeData {
  link: InfrastructureTrafficLink;
}

/*
 * The traffic lines, drawn like the Service Map's connections: colored by
 * the calls' error rate, thicker with more calls, and labeled with one
 * metric — or, "on hover", with the call rate of the hovered line only. A
 * line whose calls reported no count carries no label.
 */
export function trafficEdges(data: {
  model: InfrastructureTopologyModel;
  links: Array<InfrastructureTrafficLink>;
  label: TrafficLabel;
  hoveredId?: string | null | undefined;
  metricsWindowSeconds: number;
}): Array<Edge<TrafficEdgeData>> {
  return data.links.map(
    (link: InfrastructureTrafficLink, index: number): Edge<TrafficEdgeData> => {
      const id: string = `${TRAFFIC_EDGE_PREFIX}${index}`;
      const color: string =
        link.health === "unknown" ? "#94a3b8" : HEALTH_COLORS[link.health];
      const metric: Exclude<TrafficLabel, "hover"> | null =
        data.label !== "hover"
          ? data.label
          : data.hoveredId === id
            ? "calls"
            : null;
      return {
        id,
        source: link.from,
        target: link.to,
        type: "default",
        label:
          metric && link.calls > 0
            ? trafficMetricLabel(link, metric, data.metricsWindowSeconds)
            : undefined,
        /* Readable in both themes, over any line that crosses behind it. */
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
        ariaLabel: describeTrafficLink(
          data.model,
          link,
          data.metricsWindowSeconds,
        ),
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: {
          stroke: color,
          strokeWidth:
            edgeWidthForCalls(link.calls) + (data.hoveredId === id ? 1 : 0),
        },
        data: { link },
      };
    },
  );
}

/* The Topology page's rate window, for a map drawn without one. */
const DEFAULT_METRICS_WINDOW_SECONDS: number = 15 * 60;

const InfrastructureGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const t: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };
  const flowInstance: React.MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);
  const [trafficLabel, setTrafficLabel] = useState<TrafficLabel>("calls");
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const metricsWindowSeconds: number =
    props.metricsWindowSeconds || DEFAULT_METRICS_WINDOW_SECONDS;

  const layout: InfrastructureMapLayout = useMemo(() => {
    return layoutInfrastructureMap({
      model: props.model,
      nodeIds: props.nodeIds,
      now: props.now || new Date(),
    });
  }, [props.model, props.nodeIds, props.now]);

  const edges: Array<Edge> = useMemo(() => {
    return [
      ...layout.edges,
      ...trafficEdges({
        model: props.model,
        links: layout.traffic.links,
        label: trafficLabel,
        hoveredId: hoveredEdgeId,
        metricsWindowSeconds,
      }),
    ];
  }, [layout, props.model, trafficLabel, hoveredEdgeId, metricsWindowSeconds]);

  const hoveredLink: InfrastructureTrafficLink | null =
    (hoveredEdgeId &&
      (
        edges.find((edge: Edge): boolean => {
          return edge.id === hoveredEdgeId;
        })?.data as TrafficEdgeData | undefined
      )?.link) ||
    null;

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
        {t("Nothing to draw here")}
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

  const linkCount: number = layout.traffic.links.length;
  const runsServices: boolean = layout.nodes.some(
    (node: Node<CardData>): boolean => {
      return node.data.kind === "service";
    },
  );
  /*
   * Why there are (or are not) lines between the cards: traffic is only
   * known between services, so a scope where nothing reports a service has
   * none to draw, and says so rather than looking broken.
   */
  const trafficStatus: string =
    linkCount > 0
      ? `${linkCount.toLocaleString()} ${t(
          linkCount === 1 ? "connection" : "connections",
        )} · ${t(
          "Lines are calls between the services on these cards, measured per service.",
        )}`
      : runsServices
        ? t(
            "The services on these cards were not seen calling each other in this time range.",
          )
        : t(
            "No services are known to run on these cards, so there are no calls to draw between them.",
          );

  return (
    <div data-testid="infrastructure-map-container">
      <div
        className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-white px-4 py-2.5"
        data-testid="infrastructure-traffic-bar"
      >
        <p
          role="status"
          className="min-w-0 flex-1 text-xs text-gray-500"
          data-testid="infrastructure-traffic-status"
        >
          {trafficStatus}
          {layout.traffic.isPartial && (
            <span className="ml-1 font-medium text-amber-700">
              {t(
                "Some lines are not drawn: too many calls in this scope. Open a smaller scope to see them all.",
              )}
            </span>
          )}
        </p>
        {linkCount > 0 && (
          <label className="flex items-center gap-2 text-xs text-gray-600">
            {t("Line labels")}
            <select
              className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs"
              aria-label={t("Line labels")}
              data-testid="infrastructure-traffic-label"
              value={trafficLabel}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                setTrafficLabel(event.target.value as TrafficLabel);
              }}
            >
              <option value="calls">{t("Request rate")}</option>
              <option value="errors">{t("Error rate")}</option>
              <option value="latency">{t("Average latency")}</option>
              <option value="hover">{t("On hover")}</option>
            </select>
          </label>
        )}
      </div>
      <div
        style={{
          height: Math.round(
            Math.min(820, Math.max(380, drawingHeight * 0.85 + 100)),
          ),
          width: "100%",
          position: "relative",
        }}
        className="bg-slate-50"
        data-testid="infrastructure-map"
      >
        <ReactFlow
          nodes={layout.nodes}
          edges={edges}
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
          onEdgeClick={(_event: React.MouseEvent, edge: Edge) => {
            const link: InfrastructureTrafficLink | undefined = (
              edge.data as TrafficEdgeData | undefined
            )?.link;
            if (link) {
              props.onOpenTraffic?.(link);
            }
          }}
          onEdgeMouseEnter={(_event: React.MouseEvent, edge: Edge) => {
            if (edge.id.startsWith(TRAFFIC_EDGE_PREFIX)) {
              setHoveredEdgeId(edge.id);
            }
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
        {hoveredLink && (
          /*
           * Which calls the hovered line stands for — a line joins two cards,
           * but its traffic belongs to the services on them.
           */
          <div
            className="pointer-events-none absolute left-3 top-3 z-10 max-w-md rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 shadow-sm"
            data-testid="infrastructure-traffic-hover"
          >
            {describeTrafficLink(
              props.model,
              hoveredLink,
              metricsWindowSeconds,
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default InfrastructureGraph;
