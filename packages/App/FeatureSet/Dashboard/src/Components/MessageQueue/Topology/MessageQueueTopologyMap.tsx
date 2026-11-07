import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
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
  MarkerType,
  Node,
  NodeChange,
  NodeProps,
  ReactFlowInstance,
  Viewport,
} from "reactflow";
import "reactflow/dist/style.css";
import FlowViewportGuard from "../../Topology/FlowViewportGuard";
import {
  FlowExtent,
  FlowViewportPosition,
  UNBOUNDED_FLOW_EXTENT,
  hasViewportMoved,
} from "../../Topology/FlowViewport";
import TopologyNodeCard, {
  TOPOLOGY_NODE_HEIGHT,
  TOPOLOGY_NODE_WIDTH,
} from "../../Topology/TopologyNodeCard";
import { MessageQueueHeadlineEntry } from "./UseMessageQueueBrokerHeadlines";
import {
  MESSAGE_QUEUE_TOPOLOGY_EDGE_COLORS,
  MessageQueueTopologyEdge,
  MessageQueueTopologyLayout,
  MessageQueueTopologyModel,
  MessageQueueTopologyNode,
  MessageQueueTopologyNodeKind,
  MessageQueueTopologyVisibility,
  getMessageQueueTopologyEdgeWidth,
} from "./MessageQueueTopologyModel";
import {
  MESSAGE_QUEUE_TOPOLOGY_EDGE_LABEL_OPTIONS,
  MessageQueueTopologyCard,
  MessageQueueTopologyEdgeLabel,
  getMessageQueueTopologyCard,
  getMessageQueueTopologyEdgeLabel,
  getMessageQueueTopologyNodeLabel,
  getMessageQueueTopologySubtitle,
} from "./MessageQueueTopologyPresentation";

/*
 * The topology's canvas: React Flow, with the shared topology card
 * (TopologyNodeCard) for queues, services and brokers alike, left to right
 * the way messages travel (MessageQueueTopologyModel.layoutMessageQueueTopology),
 * and the Service Map's canvas rules - the wheel scrolls the page, Ctrl +
 * scroll or a pinch zooms, cards stay put, the measured sizes are handed
 * back so a redraw never strands the map unmeasured (issue #4117), and
 * FlowViewportGuard frames the drawing once React Flow has measured it.
 */

export const MESSAGE_QUEUE_TOPOLOGY_COLUMN_GAP: number =
  TOPOLOGY_NODE_WIDTH + 110;
export const MESSAGE_QUEUE_TOPOLOGY_ROW_GAP: number = TOPOLOGY_NODE_HEIGHT + 20;
export const MESSAGE_QUEUE_TOPOLOGY_FIT_VIEW_OPTIONS: FitViewOptions = {
  padding: 0.18,
  maxZoom: 1,
};
export const MESSAGE_QUEUE_TOPOLOGY_PAN_MARGIN: number = TOPOLOGY_NODE_HEIGHT;
/*
 * How long the canvas must show nothing before it says so: a new drawing is
 * hidden for a frame or two while React Flow measures it.
 */
export const MESSAGE_QUEUE_TOPOLOGY_OUT_OF_VIEW_DELAY_MS: number = 800;

const KIND_ICONS: Record<MessageQueueTopologyNodeKind, IconProp> = {
  queue: IconProp.QueueList,
  service: IconProp.SquareStack,
  broker: IconProp.ServerStack,
};

interface TopologyNodeData {
  node: MessageQueueTopologyNode;
  title: string;
  subtitle: string;
  card: MessageQueueTopologyCard;
  dimmed: boolean;
  selected: boolean;
}

const MessageQueueTopologyCanvasNode: FunctionComponent<
  NodeProps<TopologyNodeData>
> = (props: NodeProps<TopologyNodeData>): ReactElement => {
  const data: TopologyNodeData = props.data;
  return (
    <TopologyNodeCard
      testId={`message-queue-topology-node-${data.node.key}`}
      title={data.title}
      subtitle={data.subtitle}
      icon={KIND_ICONS[data.node.kind]}
      color={data.node.color}
      statusColor={data.card.statusColor}
      statusLabel={data.card.statusLabel}
      stats={data.card.stats}
      footer={data.card.footer}
      dimmed={data.dimmed}
      selected={data.selected}
      stacked={data.node.kind === "broker"}
    />
  );
};

const NODE_TYPES: Record<
  string,
  FunctionComponent<NodeProps<TopologyNodeData>>
> = {
  messageQueueTopologyNode: MessageQueueTopologyCanvasNode,
};

export interface ComponentProps {
  model: MessageQueueTopologyModel;
  visibility: MessageQueueTopologyVisibility;
  layout: MessageQueueTopologyLayout;
  selectedKey: string | null;
  selectedEdgeId: string | null;
  headlines: Map<string, MessageQueueHeadlineEntry>;
  edgeLabel: MessageQueueTopologyEdgeLabel;
  onEdgeLabelChange: (value: MessageQueueTopologyEdgeLabel) => void;
  onSelectNode: (key: string) => void;
  onSelectEdge: (id: string) => void;
}

const MessageQueueTopologyMap: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [panExtent, setPanExtent] = useState<FlowExtent>(UNBOUNDED_FLOW_EXTENT);
  const [drawingInView, setDrawingInView] = useState<boolean>(true);
  const [showOutOfView, setShowOutOfView] = useState<boolean>(false);
  const [canvasGeneration, setCanvasGeneration] = useState<number>(0);
  const flowInstance: React.MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);
  const autoFrame: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const gestureStart: React.MutableRefObject<FlowViewportPosition | null> =
    useRef<FlowViewportPosition | null>(null);
  /*
   * The size React Flow measured for each node, handed back with every new
   * nodes array: a node handed over without one is "unmeasured" again, and
   * two arrays in quick succession could leave the whole map blank (#4117).
   */
  const measuredSizes: React.MutableRefObject<
    Map<string, { width: number; height: number }>
  > = useRef<Map<string, { width: number; height: number }>>(new Map());
  const onNodesChange: (changes: Array<NodeChange>) => void = useCallback(
    (changes: Array<NodeChange>): void => {
      for (const change of changes) {
        if (
          change.type === "dimensions" &&
          change.dimensions &&
          change.dimensions.width > 0 &&
          change.dimensions.height > 0
        ) {
          measuredSizes.current.set(change.id, {
            width: change.dimensions.width,
            height: change.dimensions.height,
          });
        }
      }
    },
    [],
  );
  const onFlowInstance: (instance: ReactFlowInstance | null) => void =
    useCallback((instance: ReactFlowInstance | null): void => {
      flowInstance.current = instance;
    }, []);

  // The selected node's lines: drawn moving, so its flow reads at a glance.
  const selectedEdges: Set<string> = useMemo(() => {
    const ids: Set<string> = new Set<string>();
    for (const edge of props.model.edges) {
      if (edge.from === props.selectedKey || edge.to === props.selectedKey) {
        ids.add(edge.id);
      }
    }
    return ids;
  }, [props.model, props.selectedKey]);

  /*
   * Nodes and edges are built apart: hovering or selecting a line changes
   * edges only, and a new nodes array costs React Flow a pass over every
   * card.
   */
  const nodes: Array<Node<TopologyNodeData>> = useMemo((): Array<
    Node<TopologyNodeData>
  > => {
    const built: Array<Node<TopologyNodeData>> = [];
    for (const [key, position] of props.layout.positions) {
      const node: MessageQueueTopologyNode | undefined =
        props.model.nodeByKey.get(key);
      if (!node) {
        continue;
      }
      const entry: MessageQueueHeadlineEntry | undefined =
        node.kind === "queue" ? props.headlines.get(node.queue.id) : undefined;
      const size: { width: number; height: number } | undefined =
        measuredSizes.current.get(key);
      built.push({
        id: key,
        type: "messageQueueTopologyNode",
        position: position,
        ...(size ? { width: size.width, height: size.height } : {}),
        data: {
          node: node,
          title: getMessageQueueTopologyNodeLabel(node, translator),
          subtitle: getMessageQueueTopologySubtitle(node, translator),
          card: getMessageQueueTopologyCard(node, {
            windowSeconds: props.model.windowSeconds,
            headline: entry?.status === "ready" ? entry.headline : null,
            translator: translator,
          }),
          dimmed: props.visibility.contextKeys.has(key),
          selected: props.selectedKey === key,
        },
      });
    }
    return built;
  }, [
    props.layout,
    props.model,
    props.visibility,
    props.selectedKey,
    props.headlines,
    translator.language,
  ]);

  const edges: Array<Edge> = useMemo((): Array<Edge> => {
    return props.model.edges
      .filter((edge: MessageQueueTopologyEdge): boolean => {
        return (
          props.layout.positions.has(edge.from) &&
          props.layout.positions.has(edge.to)
        );
      })
      .map((edge: MessageQueueTopologyEdge): Edge => {
        const color: string = MESSAGE_QUEUE_TOPOLOGY_EDGE_COLORS[edge.health];
        const isContext: boolean =
          props.visibility.contextKeys.has(edge.from) &&
          props.visibility.contextKeys.has(edge.to);
        return {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: "default",
          animated: selectedEdges.has(edge.id),
          label: getMessageQueueTopologyEdgeLabel(
            edge,
            props.edgeLabel,
            props.model.windowSeconds,
            hoveredEdgeId === edge.id,
          ),
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
              getMessageQueueTopologyEdgeWidth(edge.messages) +
              (props.selectedEdgeId === edge.id ? 1.5 : 0),
            opacity: isContext ? 0.35 : 1,
          },
        };
      });
  }, [
    props.layout,
    props.model,
    props.visibility,
    props.edgeLabel,
    props.selectedEdgeId,
    hoveredEdgeId,
    selectedEdges,
  ]);

  let drawingHeight: number = 0;
  for (const position of props.layout.positions.values()) {
    drawingHeight = Math.max(drawingHeight, position.y + TOPOLOGY_NODE_HEIGHT);
  }
  const canvasHeight: number = Math.round(
    Math.min(880, Math.max(460, drawingHeight * 0.85 + 120)),
  );

  useEffect(() => {
    if (drawingInView) {
      setShowOutOfView(false);
      return undefined;
    }
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setShowOutOfView(true);
    }, MESSAGE_QUEUE_TOPOLOGY_OUT_OF_VIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [drawingInView]);

  const drawingKey: string = nodes
    .map((node: Node<TopologyNodeData>): string => {
      return node.id;
    })
    .join("|");

  const fitToScreen: () => void = (): void => {
    autoFrame.current = true;
    const instance: ReactFlowInstance | null = flowInstance.current;
    if (
      instance &&
      instance.fitView({
        ...MESSAGE_QUEUE_TOPOLOGY_FIT_VIEW_OPTIONS,
        duration: 300,
      })
    ) {
      return;
    }
    setShowOutOfView(false);
    setCanvasGeneration((value: number): number => {
      return value + 1;
    });
  };

  return (
    <div data-testid="message-queue-topology-map">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-5 py-3">
        <label className="flex items-center gap-2 text-xs text-gray-600">
          {translator.translateText("Line labels")}
          <select
            className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs"
            aria-label={translator.translateText("Line labels") || ""}
            data-testid="message-queue-topology-edge-label"
            value={props.edgeLabel}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              props.onEdgeLabelChange(
                event.target.value as MessageQueueTopologyEdgeLabel,
              );
            }}
          >
            {MESSAGE_QUEUE_TOPOLOGY_EDGE_LABEL_OPTIONS.map(
              (option: {
                value: MessageQueueTopologyEdgeLabel;
                label: string;
              }): ReactElement => {
                return (
                  <option key={option.value} value={option.value}>
                    {translator.translateText(option.label)}
                  </option>
                );
              },
            )}
          </select>
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <span className="text-xs text-gray-500">
            {translator.translateText("Ctrl + scroll or pinch to zoom")}
          </span>
          <button
            type="button"
            data-testid="message-queue-topology-fit"
            className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            onClick={fitToScreen}
          >
            {translator.translateText("Fit to screen")}
          </button>
        </div>
      </div>
      <div
        style={{ height: canvasHeight, width: "100%" }}
        className="relative bg-slate-50"
        data-testid="message-queue-topology-canvas"
      >
        <ReactFlow
          key={canvasGeneration}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          minZoom={0.1}
          maxZoom={1.5}
          translateExtent={panExtent}
          zoomOnScroll={false}
          preventScrolling={false}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          proOptions={{ hideAttribution: true }}
          onMoveStart={(_event: MouseEvent | TouchEvent, viewport: Viewport) => {
            gestureStart.current = viewport;
          }}
          onMoveEnd={(_event: MouseEvent | TouchEvent, viewport: Viewport) => {
            const start: FlowViewportPosition | null = gestureStart.current;
            gestureStart.current = null;
            if (!start || hasViewportMoved(start, viewport)) {
              autoFrame.current = false;
            }
          }}
          onNodeClick={(_event: React.MouseEvent, node: Node) => {
            props.onSelectNode(node.id);
          }}
          onEdgeClick={(_event: React.MouseEvent, edge: Edge) => {
            props.onSelectEdge(edge.id);
          }}
          onEdgeMouseEnter={(_event: React.MouseEvent, edge: Edge) => {
            setHoveredEdgeId(edge.id);
          }}
          onEdgeMouseLeave={() => {
            setHoveredEdgeId(null);
          }}
        >
          <Controls
            showInteractive={false}
            fitViewOptions={MESSAGE_QUEUE_TOPOLOGY_FIT_VIEW_OPTIONS}
            onZoomIn={() => {
              autoFrame.current = false;
            }}
            onZoomOut={() => {
              autoFrame.current = false;
            }}
            onFitView={() => {
              autoFrame.current = true;
            }}
          />
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1}
            color="var(--ou-chart-grid, #cbd5e1)"
          />
          <FlowViewportGuard
            drawingKey={drawingKey}
            fitViewOptions={MESSAGE_QUEUE_TOPOLOGY_FIT_VIEW_OPTIONS}
            autoFrame={autoFrame}
            panMargin={MESSAGE_QUEUE_TOPOLOGY_PAN_MARGIN}
            onInstance={onFlowInstance}
            onExtentChange={setPanExtent}
            onDrawingInViewChange={setDrawingInView}
          />
        </ReactFlow>
        {showOutOfView && (
          <div
            role="status"
            data-testid="message-queue-topology-out-of-view"
            className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm"
          >
            <span>{translator.translateText("The map is out of view.")}</span>
            <button
              type="button"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              onClick={fitToScreen}
            >
              {translator.translateText("Fit to screen")}
            </button>
          </div>
        )}
      </div>
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-200 px-5 py-3 text-xs text-gray-500"
        data-testid="message-queue-topology-legend"
      >
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: MESSAGE_QUEUE_TOPOLOGY_EDGE_COLORS.healthy }}
            aria-hidden={true}
          />
          {translator.translateText("Healthy")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor: MESSAGE_QUEUE_TOPOLOGY_EDGE_COLORS.degraded,
            }}
            aria-hidden={true}
          />
          {translator.translateText("Some errors")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor: MESSAGE_QUEUE_TOPOLOGY_EDGE_COLORS.critical,
            }}
            aria-hidden={true}
          />
          {translator.translateText("High error rate")}
        </span>
        <span className="ml-auto">
          {translator.translateText(
            "Arrows point the way messages travel · thicker lines carry more messages",
          )}
        </span>
      </div>
    </div>
  );
};

export default MessageQueueTopologyMap;
