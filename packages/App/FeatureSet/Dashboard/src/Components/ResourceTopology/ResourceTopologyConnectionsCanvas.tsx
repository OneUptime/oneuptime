import React, {
  CSSProperties,
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
  BaseEdge,
  Controls,
  Edge,
  EdgeProps,
  FitViewOptions,
  Handle,
  MarkerType,
  Node,
  NodeOrigin,
  NodeProps,
  Position,
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { joinList } from "Common/UI/Utils/ListSeparator";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { LayoutPoint } from "../../Utils/LayeredGraphLayout";
import {
  ResourceTopologyNode,
  ResourceTopologyRelation,
  ResourceTopologyGraph,
} from "./ResourceTopologyModel";
import {
  TopologyConnectionsEdge,
  TopologyConnectionsView,
} from "./ResourceTopologyConnections";
import {
  CONNECTIONS_NODE_SIZES,
  ConnectionsLayoutShape,
  ConnectionsNodeVariant,
  clipToCard,
  getConnectionsLayoutShape,
  getConnectionsNodeVariant,
  layoutTopologyConnections,
} from "./ResourceTopologyConnectionsLayout";
import {
  ResourceTopologyKindInfo,
  getResourceTopologyKind,
} from "./ResourceTopologyKinds";
import { RESOURCE_TOPOLOGY_HEALTH_COLORS } from "./ResourceTopologyLook";
import {
  describeTopologyIssues,
  describeTopologyPart,
  renderTopologyText,
  topologyKindLabel,
  topologyNodeName,
  tx,
} from "./ResourceTopologyNodes";

/*
 * The Connections view drawn: one thing in the middle, what it is connected
 * to on a ring around it and what those are connected to further out,
 * placed by the Security Events layout (ResourceTopologyConnectionsLayout,
 * over CorrelationGraphLayout) so the two read alike.
 *
 *   - The middle is a filled indigo card: the part picked (its kind over
 *     its name, ringed red or amber when it needs attention), the resource
 *     on its own view, or the filter ("Your filter") a search or "Needs
 *     attention" gathers by. A part or the resource opens its panel.
 *   - The ring is cards: each part's kind icon and name, and under it what
 *     it is - or, when it needs attention, how it is doing - edged and
 *     tinted in its health's colour, with its open incidents and alerts
 *     counted. The outer ring is pills: icon, name and a health dot.
 *   - A line is a connection, its arrow pointing the way its words read
 *     ("Runs in" from an interface to its network), clipped to the cards'
 *     edges so the arrow shows. On a busy drawing a line's words show when
 *     one of its ends is hovered or focused, which also lights its lines.
 *   - Every part is a button: clicking it, or Enter on it, moves it to the
 *     middle. The tab order is the drawing's, middle first.
 */

const CONNECTIONS_NODE_TYPE: string = "connections";
const CONNECTIONS_EDGE_TYPE: string = "connections";

// Every line's words show while there are no more lines than this.
export const CONNECTIONS_EDGE_LABEL_LIMIT: number = 24;
// A line shorter than this, between the cards' edges, carries no words.
export const CONNECTIONS_LABEL_MIN_LINE: number = 64;

const FIT_VIEW_OPTIONS: FitViewOptions = { padding: 0.08, maxZoom: 1 };
const NODE_ORIGIN: NodeOrigin = [0.5, 0.5];

const ACCENT: string = "#6366f1";
const CENTER_FILL: string = "#4f46e5";
const QUIET_LINE: string = "var(--ou-border-strong, #cbd5e1)";
const GATHER_LINE: string = "var(--ou-chart-tick, #94a3b8)";

interface ConnectionsNodeData {
  variant: ConnectionsNodeVariant;
  eyebrow: string;
  title: string;
  // A ring card's second line: what it is, or how it is doing.
  line: string;
  // Its tooltip, and its button's name.
  description: string;
  icon: IconProp;
  kindColor: string;
  // Its health's colour, null when there is nothing to say (a filter).
  healthColor: string | null;
  needsAttention: boolean;
  isCritical: boolean;
  issueCount: number;
  isHighlighted: boolean;
  onActivate: (() => void) | null;
  onHover: (hovered: boolean) => void;
  testId: string;
}

interface ConnectionsEdgeData {
  sourceSize: { width: number; height: number };
  targetSize: { width: number; height: number };
}

/*
 * React Flow drops every edge that touches a custom node without handles:
 * these are invisible points at the card's centre, as Security Events'.
 */
const CENTRE_HANDLE_STYLE: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  right: "auto",
  bottom: "auto",
  transform: "translate(-50%, -50%)",
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 0,
  background: "transparent",
  opacity: 0,
  pointerEvents: "none",
};

const RESTING_SHADOW: string =
  "var(--ou-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.08))";
const HIGHLIGHT_SHADOW: string = `0 0 0 2px ${ACCENT}, var(--ou-shadow-md, 0 4px 12px rgba(15, 23, 42, 0.12))`;

const ConnectionsEdge: FunctionComponent<EdgeProps<ConnectionsEdgeData>> = (
  props: EdgeProps<ConnectionsEdgeData>,
): ReactElement => {
  const source: LayoutPoint = { x: props.sourceX, y: props.sourceY };
  const target: LayoutPoint = { x: props.targetX, y: props.targetY };
  const sourceSize: { width: number; height: number } = props.data
    ?.sourceSize || { width: 0, height: 0 };
  const targetSize: { width: number; height: number } = props.data
    ?.targetSize || { width: 0, height: 0 };
  const start: LayoutPoint = clipToCard(source, target, sourceSize);
  const end: LayoutPoint = clipToCard(target, source, targetSize);
  // A line too short for its words keeps them for its two ends' panels.
  const length: number = Math.hypot(end.x - start.x, end.y - start.y);

  return (
    <BaseEdge
      path={`M ${start.x},${start.y} L ${end.x},${end.y}`}
      labelX={(start.x + end.x) / 2}
      labelY={(start.y + end.y) / 2}
      label={length >= CONNECTIONS_LABEL_MIN_LINE ? props.label : undefined}
      labelStyle={props.labelStyle || {}}
      labelShowBg={props.labelShowBg ?? true}
      labelBgStyle={props.labelBgStyle || {}}
      labelBgPadding={props.labelBgPadding || [6, 2]}
      labelBgBorderRadius={props.labelBgBorderRadius ?? 4}
      style={props.style || {}}
      {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})}
      {...(props.markerStart ? { markerStart: props.markerStart } : {})}
      interactionWidth={0}
    />
  );
};

const ConnectionsNodeCard: FunctionComponent<NodeProps<ConnectionsNodeData>> = (
  props: NodeProps<ConnectionsNodeData>,
): ReactElement => {
  const data: ConnectionsNodeData = props.data;
  const size: { width: number; height: number } =
    CONNECTIONS_NODE_SIZES[data.variant];
  const health: string = data.healthColor || "transparent";

  const handles: ReactElement = (
    <>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={CENTRE_HANDLE_STYLE}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        style={CENTRE_HANDLE_STYLE}
      />
    </>
  );

  const frame: CSSProperties = {
    position: "relative",
    width: size.width,
    height: size.height,
    boxSizing: "border-box",
    overflow: "hidden",
    transition: "box-shadow 120ms ease",
    textAlign: "start",
    cursor: data.onActivate ? "pointer" : "default",
  };

  const hoverHandlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  } = {
    onMouseEnter: () => {
      data.onHover(true);
    },
    onMouseLeave: () => {
      data.onHover(false);
    },
    onFocus: () => {
      data.onHover(true);
    },
    onBlur: () => {
      data.onHover(false);
    },
  };

  const body: (style: CSSProperties, children: ReactElement) => ReactElement = (
    style: CSSProperties,
    children: ReactElement,
  ): ReactElement => {
    // A part is a button; a filter in the middle is only words.
    return data.onActivate ? (
      <button
        type="button"
        data-testid={data.testId}
        title={data.description}
        aria-label={data.description}
        className="focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        style={{ ...frame, ...style }}
        onClick={(event: React.MouseEvent) => {
          event.stopPropagation();
          data.onActivate?.();
        }}
        {...hoverHandlers}
      >
        {children}
      </button>
    ) : (
      <div
        data-testid={data.testId}
        title={data.description}
        role="img"
        aria-label={data.description}
        style={{ ...frame, ...style }}
      >
        {children}
      </div>
    );
  };

  if (data.variant === "center") {
    return (
      <>
        {handles}
        {body(
          {
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            background: CENTER_FILL,
            color: "#ffffff",
            borderRadius: 12,
            padding: "8px 12px",
            boxShadow: data.needsAttention
              ? `0 0 0 3px ${health}, 0 4px 14px rgba(79, 70, 229, 0.28)`
              : "0 4px 14px rgba(79, 70, 229, 0.28)",
          },
          <>
            <span
              className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase leading-4 tracking-wide"
              style={{ opacity: 0.85 }}
            >
              <Icon icon={data.icon} className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{data.eyebrow}</span>
            </span>
            <bdi className="block truncate text-[13px] font-semibold leading-[18px]">
              {data.title}
            </bdi>
          </>,
        )}
      </>
    );
  }

  if (data.variant === "ring") {
    const accent: string = data.needsAttention ? health : data.kindColor;

    return (
      <>
        {handles}
        {body(
          {
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 2,
            background: data.needsAttention
              ? `color-mix(in srgb, ${health} 9%, var(--ou-surface-primary, #ffffff))`
              : "var(--ou-surface-primary, #ffffff)",
            color: "var(--ou-text-primary, #111827)",
            border: "1px solid var(--ou-border-default, #e5e7eb)",
            borderRadius: 10,
            paddingBlock: 6,
            paddingInlineStart: 14,
            paddingInlineEnd: 10,
            boxShadow: data.isHighlighted ? HIGHLIGHT_SHADOW : RESTING_SHADOW,
          },
          <>
            <span
              aria-hidden={true}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                insetInlineStart: 0,
                width: 4,
                background: accent,
              }}
            />
            <span className="flex min-w-0 items-center gap-1.5">
              <span style={{ color: data.kindColor }} className="flex-shrink-0">
                <Icon icon={data.icon} className="h-3.5 w-3.5" />
              </span>
              <bdi className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-[18px]">
                {data.title}
              </bdi>
              {data.issueCount > 0 ? (
                <span
                  className="flex-shrink-0 rounded-full px-1.5 text-xs font-semibold tabular-nums leading-4 text-white"
                  style={{
                    background: data.isCritical
                      ? RESOURCE_TOPOLOGY_HEALTH_COLORS.critical
                      : RESOURCE_TOPOLOGY_HEALTH_COLORS.warning,
                  }}
                >
                  {data.issueCount}
                </span>
              ) : null}
            </span>
            <span
              className="flex min-w-0 items-center gap-1.5 text-xs leading-4"
              style={{ color: "var(--ou-text-secondary, #4b5563)" }}
            >
              <span
                aria-hidden={true}
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: health }}
              />
              <span className="truncate">{data.line}</span>
            </span>
          </>,
        )}
      </>
    );
  }

  return (
    <>
      {handles}
      {body(
        {
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "var(--ou-surface-primary, #ffffff)",
          color: "var(--ou-text-primary, #111827)",
          border: `1px solid ${
            data.needsAttention ? health : "var(--ou-border-strong, #d1d5db)"
          }`,
          borderRadius: 999,
          paddingInline: 10,
          boxShadow: data.isHighlighted ? HIGHLIGHT_SHADOW : RESTING_SHADOW,
        },
        <>
          <span style={{ color: data.kindColor }} className="flex-shrink-0">
            <Icon icon={data.icon} className="h-3 w-3" />
          </span>
          <bdi className="min-w-0 flex-1 truncate text-xs">{data.title}</bdi>
          <span
            aria-hidden={true}
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: health }}
          />
        </>,
      )}
    </>
  );
};

/*
 * Module scope on purpose: React Flow re-mounts every node when it is
 * handed a new nodeTypes object.
 */
const CONNECTIONS_NODE_TYPES: Record<
  string,
  FunctionComponent<NodeProps<ConnectionsNodeData>>
> = {
  [CONNECTIONS_NODE_TYPE]: ConnectionsNodeCard,
};

const CONNECTIONS_EDGE_TYPES: Record<
  string,
  FunctionComponent<EdgeProps<ConnectionsEdgeData>>
> = {
  [CONNECTIONS_EDGE_TYPE]: ConnectionsEdge,
};

/*
 * A line's words: each connection between the two once, in the reader's
 * language, read from the end it starts at.
 */
export function describeConnectionLine(
  translator: Translator,
  relations: ReadonlyArray<ResourceTopologyRelation>,
): string {
  const words: Array<string> = [];

  for (const relation of relations) {
    const word: string = tx(relation.label, translator);

    if (!words.includes(word)) {
      words.push(word);
    }
  }

  return joinList(words);
}

export interface ComponentProps {
  graph: ResourceTopologyGraph;
  view: TopologyConnectionsView;
  height: number;
  // The middle when it is a filter: "Your filter" over its words.
  filterTitle: string;
  // A sentence under the middle when nothing is around it.
  emptyText?: string | undefined;
  // Moves a part to the middle.
  onCenter: (nodeId: string) => void;
  // Opens the panel of the part, or the resource, in the middle.
  onOpenDetails: (nodeId: string) => void;
}

const ResourceTopologyConnectionsCanvas: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const wrapperRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const flowInstance: React.MutableRefObject<ReactFlowInstance | null> =
    useRef<ReactFlowInstance | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [canvasWidth, setCanvasWidth] = useState<number>(0);
  const callbacksRef: React.MutableRefObject<{
    onCenter: (nodeId: string) => void;
    onOpenDetails: (nodeId: string) => void;
  }> = useRef({
    onCenter: props.onCenter,
    onOpenDetails: props.onOpenDetails,
  });
  callbacksRef.current = {
    onCenter: props.onCenter,
    onOpenDetails: props.onOpenDetails,
  };

  // The canvas's width: the rings are drawn as wide as it is.
  useEffect(() => {
    const wrapper: HTMLDivElement | null = wrapperRef.current;

    if (!wrapper) {
      return undefined;
    }

    const update: () => void = (): void => {
      setCanvasWidth(wrapper.clientWidth);
    };

    update();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer: ResizeObserver = new ResizeObserver(update);
    observer.observe(wrapper);

    return () => {
      observer.disconnect();
    };
  }, []);

  const view: TopologyConnectionsView = props.view;
  const shape: ConnectionsLayoutShape = useMemo(() => {
    return getConnectionsLayoutShape({
      width: canvasWidth,
      height: props.height,
    });
  }, [canvasWidth, props.height]);

  // A hovered part that is no longer drawn lights nothing.
  useEffect(() => {
    setHoveredId(null);
  }, [view]);

  const positions: Map<string, LayoutPoint> = useMemo((): Map<
    string,
    LayoutPoint
  > => {
    return layoutTopologyConnections(view, shape);
  }, [view, shape]);

  // What a hovered or focused part is joined to: lit, the rest dimmed.
  const hood: Set<string> | null = useMemo((): Set<string> | null => {
    if (!hoveredId) {
      return null;
    }

    const ids: Set<string> = new Set<string>([hoveredId]);

    for (const edge of view.edges) {
      if (edge.from === hoveredId) {
        ids.add(edge.to);
      } else if (edge.to === hoveredId) {
        ids.add(edge.from);
      }
    }

    return ids;
  }, [hoveredId, view]);

  const variantOf: (id: string) => ConnectionsNodeVariant = (
    id: string,
  ): ConnectionsNodeVariant => {
    return getConnectionsNodeVariant(view, id);
  };

  const nodes: Array<Node<ConnectionsNodeData>> = useMemo((): Array<
    Node<ConnectionsNodeData>
  > => {
    const ids: Array<string> = [view.centerId, ...view.ring, ...view.outerRing];

    return ids.map((id: string): Node<ConnectionsNodeData> => {
      const variant: ConnectionsNodeVariant = variantOf(id);
      const part: ResourceTopologyNode | undefined = props.graph.nodes.get(id);
      const kind: ResourceTopologyKindInfo | null = part
        ? getResourceTopologyKind(part.kind)
        : null;
      const isFilter: boolean = variant === "center" && !part;
      const issueCount: number = part ? part.issues.length : 0;
      const incidents: number = part
        ? part.issues.filter((issue: { type: string }): boolean => {
            return issue.type === "incident";
          }).length
        : 0;
      // Troubled by its own state, or only by what is open on it.
      const ownTrouble: boolean =
        part?.health === "critical" || part?.health === "warning";
      const healthColor: string | null = part
        ? RESOURCE_TOPOLOGY_HEALTH_COLORS[part.effectiveHealth]
        : null;
      const status: string = part
        ? renderTopologyText(translator, part.status)
        : "";
      // What it is, as its own page names it ("Virtual Machine"), else its kind.
      const what: string = part
        ? part.context || topologyKindLabel(translator, part)
        : "";
      const size: { width: number; height: number } =
        CONNECTIONS_NODE_SIZES[variant];

      const data: ConnectionsNodeData = {
        variant,
        eyebrow: isFilter
          ? tx("Your filter", translator)
          : part
            ? topologyKindLabel(translator, part)
            : "",
        title: isFilter
          ? props.filterTitle
          : part
            ? topologyNodeName(translator, part)
            : "",
        /*
         * What it is - or, when it needs attention, why: how it is doing,
         * or the incidents and alerts open on it when they are the reason.
         */
        line:
          part?.needsAttention && ownTrouble && status
            ? status
            : part?.needsAttention && issueCount > 0
              ? describeTopologyIssues(
                  translator,
                  incidents,
                  issueCount - incidents,
                )
              : what || status,
        description: isFilter
          ? joinList([tx("Your filter", translator), props.filterTitle])
          : part
            ? variant === "center"
              ? joinList([
                  describeTopologyPart(translator, part),
                  tx("Show details", translator),
                ])
              : joinList(
                  [
                    describeTopologyPart(translator, part),
                    part.context || "",
                  ].filter((text: string): boolean => {
                    return text.length > 0;
                  }),
                )
            : "",
        icon: isFilter ? IconProp.Filter : kind?.icon || IconProp.Cube,
        kindColor: kind?.color || ACCENT,
        healthColor,
        needsAttention: Boolean(part?.needsAttention),
        isCritical: part?.effectiveHealth === "critical",
        issueCount,
        /*
         * A hovered card lights its own lines and words; the other cards
         * stay as they are, so a card that lands under the pointer after a
         * click does not dim the whole drawing.
         */
        isHighlighted: Boolean(
          hood && hoveredId === id && variant !== "center",
        ),
        onActivate: part
          ? variant === "center"
            ? () => {
                callbacksRef.current.onOpenDetails(id);
              }
            : () => {
                callbacksRef.current.onCenter(id);
              }
          : null,
        onHover: (hovered: boolean) => {
          setHoveredId((current: string | null): string | null => {
            if (hovered) {
              return id;
            }

            return current === id ? null : current;
          });
        },
        testId: `resource-topology-connections-node-${variant}`,
      };

      return {
        id,
        type: CONNECTIONS_NODE_TYPE,
        position: positions.get(id) || { x: 0, y: 0 },
        width: size.width,
        height: size.height,
        draggable: false,
        selectable: false,
        focusable: false,
        data,
      };
    });
  }, [
    view,
    positions,
    hood,
    hoveredId,
    props.graph,
    props.filterTitle,
    translator.language,
  ]);

  const edges: Array<Edge<ConnectionsEdgeData>> = useMemo((): Array<
    Edge<ConnectionsEdgeData>
  > => {
    const showAll: boolean = view.edges.length <= CONNECTIONS_EDGE_LABEL_LIMIT;

    return view.edges.map(
      (edge: TopologyConnectionsEdge): Edge<ConnectionsEdgeData> => {
        const inHood: boolean = Boolean(
          hood &&
            hoveredId &&
            (edge.from === hoveredId || edge.to === hoveredId),
        );
        const gathers: boolean = edge.relations.length === 0;
        const forward: boolean = edge.relations.some(
          (relation: ResourceTopologyRelation): boolean => {
            return relation.from === edge.from;
          },
        );
        const backward: boolean = edge.relations.some(
          (relation: ResourceTopologyRelation): boolean => {
            return relation.from === edge.to;
          },
        );
        const stroke: string = inHood
          ? ACCENT
          : gathers
            ? GATHER_LINE
            : edge.touchesCenter
              ? ACCENT
              : QUIET_LINE;
        const showLabel: boolean = !gathers && (inHood || (!hood && showAll));
        const marker: {
          type: MarkerType;
          color: string;
          width: number;
          height: number;
        } = {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 14,
          height: 14,
        };

        const built: Edge<ConnectionsEdgeData> = {
          id: edge.id,
          source: edge.from,
          target: edge.to,
          type: CONNECTIONS_EDGE_TYPE,
          focusable: false,
          data: {
            sourceSize: CONNECTIONS_NODE_SIZES[variantOf(edge.from)],
            targetSize: CONNECTIONS_NODE_SIZES[variantOf(edge.to)],
          },
          style: {
            stroke,
            strokeWidth: edge.touchesCenter || inHood ? 2 : 1.5,
            strokeDasharray: gathers ? "4 4" : undefined,
            opacity: hood && !inHood ? 0.3 : edge.touchesCenter ? 0.75 : 0.9,
          },
        };

        if (forward) {
          built.markerEnd = marker;
        }

        if (backward) {
          built.markerStart = marker;
        }

        if (showLabel) {
          built.label = describeConnectionLine(translator, edge.relations);
          built.labelShowBg = true;
          built.labelStyle = {
            fontSize: 11,
            fontWeight: 600,
            fill: "var(--ou-text-secondary, #4b5563)",
          };
          built.labelBgStyle = {
            fill: "var(--ou-surface-primary, #ffffff)",
            fillOpacity: 0.95,
            stroke: "var(--ou-border-default, #e5e7eb)",
            strokeWidth: 1,
          };
        }

        return built;
      },
    );
  }, [view, hood, hoveredId, translator.language]);

  /*
   * Framed again when another part moves to the middle or the canvas
   * changes shape. React Flow learns the pane's size in the frame after a
   * commit, so the fit waits a frame and retries until the cards are
   * measured.
   */
  const viewKey: string = `${view.centerId}#${view.ring.join("|")}#${view.outerRing.join("|")}#${shape.horizontalStretch}#${props.height}`;

  useEffect(() => {
    let frame: number = 0;
    let attempts: number = 20;
    let framesToWait: number = 2;

    const tryFit: () => void = (): void => {
      if (framesToWait > 0) {
        framesToWait--;
        frame = requestAnimationFrame(tryFit);
        return;
      }

      const didFit: boolean = Boolean(
        flowInstance.current && flowInstance.current.fitView(FIT_VIEW_OPTIONS),
      );

      if (!didFit && attempts > 0) {
        attempts--;
        frame = requestAnimationFrame(tryFit);
      }
    };

    tryFit();

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [viewKey]);

  return (
    <div
      ref={wrapperRef}
      data-testid="resource-topology-connections"
      data-center={view.centerKind}
      role="group"
      aria-label={tx("Connections", translator)}
      style={{ height: props.height, width: "100%" }}
      className="relative bg-slate-50"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={CONNECTIONS_NODE_TYPES}
        edgeTypes={CONNECTIONS_EDGE_TYPES}
        nodeOrigin={NODE_ORIGIN}
        fitView={true}
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.1}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        /*
         * As the map: the wheel scrolls the page, Ctrl + scroll or a pinch
         * zooms, a double-click does not.
         */
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        onInit={(instance: ReactFlowInstance) => {
          flowInstance.current = instance;
        }}
        /*
         * The cards' own buttons do the work. React Flow only lets pointer
         * events reach a node that is selectable, draggable or clickable.
         */
        onNodeClick={() => {
          // The card's button handles the click.
        }}
      >
        <Controls
          showInteractive={false}
          position="bottom-left"
          fitViewOptions={FIT_VIEW_OPTIONS}
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="var(--ou-chart-grid, #cbd5e1)"
        />
      </ReactFlow>
      {props.emptyText && view.ring.length === 0 ? (
        <p
          role="status"
          data-testid="resource-topology-connections-empty"
          className="pointer-events-none absolute inset-x-4 bottom-12 text-center text-sm text-gray-500"
        >
          {props.emptyText}
        </p>
      ) : null}
    </div>
  );
};

export default ResourceTopologyConnectionsCanvas;
