import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyNode,
  NetworkTopologyNodeStatus,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  TieredTopologyModel,
  TopologyGroupBox,
  TopologyPoint,
  clamp,
  computeTieredTopologyModel,
  computeTopologyLayout,
  wrapNodeLabel,
} from "../NetworkDevice/TopologyLayout";
import {
  endpointTooltipForNode,
  isEndpointNode,
  isFdbEdge,
} from "../NetworkDevice/EndpointNodeUtil";
import {
  LINK_STATE_COLORS,
  NetworkLinkState,
  describeEndpoint,
  edgeKeyForEdge,
  edgeStrokeWidthForEdge,
  linkStateForEdge,
  nodeMatchesSearch,
} from "./NetworkTopologyMeta";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * Live network topology graph: devices as nodes, LLDP/CDP links as edges.
 * Edge color tracks link state (red = an end is operationally down, amber =
 * saturated, neutral otherwise) and stroke width tracks utilization. Node
 * and edge clicks open detail panels in the parent; search dims
 * non-matching nodes. Pan/zoom state lives here, so a background refresh
 * that swaps the topology prop preserves the viewport (the layout is
 * deterministic — unchanged graphs keep their coordinates).
 */

export interface ComponentProps {
  topology: NetworkTopology;
  /** Nodes not matching this render dimmed. Empty string shows everything. */
  searchText?: string | undefined;
  /*
   * "tiered" lays the graph out as routers → switches → endpoints (for
   * unit-scale site views); "force" (the default) keeps the organic
   * force-directed layout used by the project-wide map.
   */
  layoutMode?: "force" | "tiered" | undefined;
  onNodeClick?: ((node: NetworkTopologyNode) => void) | undefined;
  onEdgeClick?: ((edge: NetworkTopologyEdge) => void) | undefined;
  /**
   * Rendered under the empty-state text (e.g. a setup link). Injected by
   * the caller so this component stays free of router imports.
   */
  emptyStateFooter?: ReactElement | undefined;
}

// Layout constants. The SVG uses a fixed viewBox and scales responsively.
const VIEW_WIDTH: number = 1000;
const VIEW_HEIGHT: number = 700;
/*
 * Tiered layouts grow downward with their endpoint rows; the viewBox
 * stretches with them up to this cap, beyond which the rest is reachable
 * by panning (an unbounded viewBox would make the page arbitrarily tall).
 */
const MAX_TIERED_VIEW_HEIGHT: number = 2100;
/*
 * ...and shrink to fit a short one. A tiered unit graph is usually much
 * shorter than the force layout's canvas, and padding it out to
 * VIEW_HEIGHT would waste a third of the frame and scale every node down.
 */
const MIN_TIERED_VIEW_HEIGHT: number = 420;
// Clearance under the lowest endpoint row: its group box plus its label.
const TIERED_VIEW_BOTTOM_PADDING: number = 96;
const NODE_RADIUS: number = 16;
// Endpoint nodes are small rounded rects so leaf fans stay readable.
const ENDPOINT_HALF_WIDTH: number = 9;
const ENDPOINT_HALF_HEIGHT: number = 7;
// Baseline-to-baseline distance for a wrapped endpoint label.
const ENDPOINT_LABEL_LINE_HEIGHT: number = 11;

/*
 * Endpoint palette: muted violet, deliberately outside the green/red/gray
 * status range so endpoints never read as up/down devices.
 */
const ENDPOINT_FILL: string = "#a78bfa"; // violet-400
const ENDPOINT_STROKE: string = "#7c3aed"; // violet-600

interface StatusColors {
  stroke: string;
  fill: string;
}

const getStatusColors: (status: NetworkTopologyNodeStatus) => StatusColors = (
  status: NetworkTopologyNodeStatus,
): StatusColors => {
  if (status === "up") {
    return { stroke: "#16a34a", fill: "#16a34a" }; // green-600
  }
  if (status === "down") {
    return { stroke: "#dc2626", fill: "#dc2626" }; // red-600
  }
  return { stroke: "#9ca3af", fill: "#9ca3af" }; // gray-400
};

const MIN_ZOOM: number = 0.3;
const MAX_ZOOM: number = 5;

interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

const IDENTITY_VIEW: ViewTransform = { scale: 1, tx: 0, ty: 0 };

const NetworkDeviceGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const nodes: Array<NetworkTopologyNode> = props.topology?.nodes || [];
  const edges: Array<NetworkTopologyEdge> = props.topology?.edges || [];
  const searchText: string = props.searchText || "";
  const layoutMode: "force" | "tiered" = props.layoutMode || "force";

  const model: TieredTopologyModel = useMemo(() => {
    if (layoutMode === "tiered") {
      return computeTieredTopologyModel(nodes, edges, VIEW_WIDTH);
    }
    return {
      positions: computeTopologyLayout(nodes, edges, VIEW_WIDTH, VIEW_HEIGHT),
      // The force layout has no tiers, so it has no endpoint groups.
      groups: [],
    };
  }, [props.topology, layoutMode]);

  const layout: Map<string, TopologyPoint> = model.positions;
  const groupBoxes: Array<TopologyGroupBox> = model.groups;

  /*
   * The force layout always fits the fixed viewBox; the tiered layout may
   * be taller, so the viewBox grows (to a cap) to show it without zooming.
   */
  const viewHeight: number = useMemo(() => {
    if (layoutMode !== "tiered") {
      return VIEW_HEIGHT;
    }
    let maxY: number = 0;
    for (const point of layout.values()) {
      if (point.y > maxY) {
        maxY = point.y;
      }
    }
    return clamp(
      maxY + TIERED_VIEW_BOTTOM_PADDING,
      MIN_TIERED_VIEW_HEIGHT,
      MAX_TIERED_VIEW_HEIGHT,
    );
  }, [layout, layoutMode]);

  // The native (non-React) wheel listener below needs the current height.
  const viewHeightRef: React.MutableRefObject<number> =
    useRef<number>(viewHeight);
  viewHeightRef.current = viewHeight;

  const dimmedNodeIds: Set<string> = useMemo(() => {
    const dimmed: Set<string> = new Set<string>();
    if (!searchText.trim()) {
      return dimmed;
    }
    for (const node of nodes) {
      if (!nodeMatchesSearch(node, searchText)) {
        dimmed.add(node.id);
      }
    }
    return dimmed;
  }, [nodes, searchText]);

  /*
   * Pan/zoom: a transform on a <g> wrapper inside the fixed viewBox.
   * Wheel-zoom needs a NATIVE non-passive listener (React's synthetic
   * wheel handlers cannot preventDefault, so the page would scroll).
   * Dragging pans; a drag suppresses the click that follows it so panning
   * over a device does not open it.
   */
  const containerRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<ViewTransform>(IDENTITY_VIEW);
  const dragState: React.MutableRefObject<{
    pointerId: number;
    x: number;
    y: number;
    moved: number;
  } | null> = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const suppressClick: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const endDrag: (pointerId: number) => void = (pointerId: number): void => {
    if (dragState.current && dragState.current.pointerId === pointerId) {
      dragState.current = null;
      setIsDragging(false);
    }
  };

  useEffect(() => {
    const element: HTMLDivElement | null = containerRef.current;
    if (!element) {
      return undefined;
    }
    const onWheel: (event: WheelEvent) => void = (event: WheelEvent): void => {
      event.preventDefault();
      const svg: SVGSVGElement | null = element.querySelector("svg");
      const rect: DOMRect = (svg || element).getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return;
      }
      const px: number =
        ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;
      const py: number =
        ((event.clientY - rect.top) / rect.height) * viewHeightRef.current;
      setView((current: ViewTransform): ViewTransform => {
        const factor: number = Math.exp(-event.deltaY * 0.0015);
        const scale: number = clamp(current.scale * factor, MIN_ZOOM, MAX_ZOOM);
        // Keep the world point under the cursor fixed while zooming.
        const wx: number = (px - current.tx) / current.scale;
        const wy: number = (py - current.ty) / current.scale;
        return { scale, tx: px - scale * wx, ty: py - scale * wy };
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, []);

  const zoomBy: (factor: number) => void = (factor: number): void => {
    setView((current: ViewTransform): ViewTransform => {
      const scale: number = clamp(current.scale * factor, MIN_ZOOM, MAX_ZOOM);
      // Zoom around the viewBox centre for button zooms.
      const cx: number = VIEW_WIDTH / 2;
      const cy: number = viewHeightRef.current / 2;
      const wx: number = (cx - current.tx) / current.scale;
      const wy: number = (cy - current.ty) / current.scale;
      return { scale, tx: cx - scale * wx, ty: cy - scale * wy };
    });
  };

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 px-6">
        <div className="text-center max-w-md">
          <div className="text-sm font-medium text-gray-900">
            No network topology discovered yet.
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Add network devices and enable interface monitoring — LLDP and CDP
            neighbors appear here as devices report them.
          </p>
          {props.emptyStateFooter ? (
            <p className="mt-3">{props.emptyStateFooter}</p>
          ) : (
            <></>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full relative"
      style={{ overflow: "hidden", touchAction: "none" }}
    >
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
        {[
          {
            label: "+",
            action: () => {
              return zoomBy(1.3);
            },
            title: "Zoom in",
          },
          {
            label: "−",
            action: () => {
              return zoomBy(1 / 1.3);
            },
            title: "Zoom out",
          },
          {
            label: "⟲",
            action: () => {
              return setView(IDENTITY_VIEW);
            },
            title: "Reset view",
          },
        ].map(
          (button: {
            label: string;
            action: () => void;
            title: string;
          }): ReactElement => {
            return (
              <button
                key={button.title}
                type="button"
                title={button.title}
                aria-label={button.title}
                className="h-7 w-7 rounded border border-gray-300 bg-white text-sm text-gray-700 shadow-sm hover:bg-gray-50"
                onClick={button.action}
              >
                {button.label}
              </button>
            );
          },
        )}
      </div>
      <svg
        role="img"
        aria-label="Network topology graph"
        viewBox={`0 0 ${VIEW_WIDTH} ${viewHeight}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: "100%",
          height: "auto",
          minWidth: "480px",
          cursor: isDragging ? "grabbing" : "grab",
        }}
        onPointerDown={(event: React.PointerEvent<SVGSVGElement>) => {
          // One drag at a time — a second touch must not corrupt the pan.
          if (event.button !== 0 || dragState.current) {
            return;
          }
          dragState.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: 0,
          };
          setIsDragging(true);
          suppressClick.current = false;
          /*
           * Capture is NOT taken here: pointer capture retargets the
           * eventual click to the SVG (Chromium/Safari retarget to the
           * capture element, Firefox to the common ancestor), which would
           * stop node/edge onClick from ever firing. It is taken in
           * onPointerMove once the pointer has actually moved — the same
           * threshold that suppresses the click.
           */
        }}
        onPointerMove={(event: React.PointerEvent<SVGSVGElement>) => {
          const drag: {
            pointerId: number;
            x: number;
            y: number;
            moved: number;
          } | null = dragState.current;
          if (!drag || drag.pointerId !== event.pointerId) {
            return;
          }
          const rect: DOMRect = event.currentTarget.getBoundingClientRect();
          if (!rect.width || !rect.height) {
            return;
          }
          const dx: number =
            ((event.clientX - drag.x) / rect.width) * VIEW_WIDTH;
          const dy: number =
            ((event.clientY - drag.y) / rect.height) * viewHeight;
          drag.moved +=
            Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y);
          drag.x = event.clientX;
          drag.y = event.clientY;
          if (drag.moved > 5) {
            /*
             * A real pan is in progress: the click is suppressed anyway, so
             * capturing now (and not on pointerdown) keeps the drag tracking
             * outside the SVG without eating stationary clicks on nodes and
             * edges (capture retargets the click to the capturing element).
             */
            suppressClick.current = true;
            if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) {
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }
          }
          setView((current: ViewTransform): ViewTransform => {
            return { ...current, tx: current.tx + dx, ty: current.ty + dy };
          });
        }}
        onPointerUp={(event: React.PointerEvent<SVGSVGElement>) => {
          endDrag(event.pointerId);
        }}
        onPointerCancel={(event: React.PointerEvent<SVGSVGElement>) => {
          endDrag(event.pointerId);
        }}
        onPointerLeave={(event: React.PointerEvent<SVGSVGElement>) => {
          endDrag(event.pointerId);
        }}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {/*
           * Tiered mode only: one soft panel behind each switch's block of
           * endpoints. Whitespace alone does not carry "these devices hang
           * off this switch" at density, so the block gets a visible hull.
           */}
          <g>
            {groupBoxes.map((box: TopologyGroupBox): ReactElement => {
              return (
                <rect
                  key={`group-${box.anchorNodeId || "unattached"}`}
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  rx={10}
                  fill="var(--ou-surface-secondary, #f9fafb)"
                  fillOpacity={0.7}
                  stroke="var(--ou-border-subtle, #f3f4f6)"
                  strokeWidth={1}
                  strokeDasharray={box.anchorNodeId ? undefined : "4 4"}
                />
              );
            })}
          </g>

          {/* Edges drawn next so nodes render on top. */}
          <g>
            {edges.map((edge: NetworkTopologyEdge): ReactElement | null => {
              const from: TopologyPoint | undefined = layout.get(
                edge.fromNodeId,
              );
              const to: TopologyPoint | undefined = layout.get(edge.toNodeId);
              if (!from || !to) {
                return null;
              }
              const state: NetworkLinkState = linkStateForEdge(edge);
              const color: string = LINK_STATE_COLORS[state];
              const width: number = edgeStrokeWidthForEdge(edge);
              /*
               * Dash precedence: an operationally-down link keeps its long
               * warning dash; otherwise FDB attachments (endpoint links)
               * get a short dash so they read as learned, not cabled.
               */
              const dashArray: string | undefined =
                state === "down" ? "6 4" : isFdbEdge(edge) ? "3 3" : undefined;
              const edgeTitle: string = `${describeEndpoint(
                edge.fromInterface,
                edge.fromPort,
              )} ↔ ${describeEndpoint(edge.toInterface, edge.toPort)}${
                edge.protocols && edge.protocols.length > 0
                  ? ` (${edge.protocols.join(" + ").toUpperCase()})`
                  : ""
              }`;
              const isClickable: boolean = Boolean(props.onEdgeClick);
              return (
                <g
                  key={`edge-${edgeKeyForEdge(edge)}`}
                  style={isClickable ? { cursor: "pointer" } : undefined}
                  onClick={
                    isClickable
                      ? () => {
                          if (suppressClick.current) {
                            return;
                          }
                          props.onEdgeClick!(edge);
                        }
                      : undefined
                  }
                >
                  <title>{edgeTitle}</title>
                  {/* Wide invisible line so thin edges stay clickable. */}
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke="transparent"
                    strokeWidth={12}
                  />
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={color}
                    strokeWidth={width}
                    strokeDasharray={dashArray}
                  />
                </g>
              );
            })}
          </g>

          {/* Nodes. */}
          <g>
            {nodes.map((node: NetworkTopologyNode): ReactElement | null => {
              const point: TopologyPoint | undefined = layout.get(node.id);
              if (!point) {
                return null;
              }
              const colors: StatusColors = getStatusColors(node.status);
              const isDimmed: boolean = dimmedNodeIds.has(node.id);
              const isClickableNode: boolean = Boolean(props.onNodeClick);

              /*
               * Endpoints render as small violet rounded rects — visually
               * distinct from both filled managed devices and hollow
               * unmanaged peers, and small enough that a fan of leaf nodes
               * stays legible.
               */
              if (isEndpointNode(node)) {
                return (
                  <g
                    key={`node-${node.id}`}
                    style={isClickableNode ? { cursor: "pointer" } : undefined}
                    opacity={isDimmed ? 0.25 : 1}
                    onClick={
                      isClickableNode
                        ? () => {
                            if (suppressClick.current) {
                              return;
                            }
                            props.onNodeClick!(node);
                          }
                        : undefined
                    }
                  >
                    <title>{endpointTooltipForNode(node)}</title>
                    <rect
                      x={point.x - ENDPOINT_HALF_WIDTH}
                      y={point.y - ENDPOINT_HALF_HEIGHT}
                      width={ENDPOINT_HALF_WIDTH * 2}
                      height={ENDPOINT_HALF_HEIGHT * 2}
                      rx={3}
                      fill={ENDPOINT_FILL}
                      fillOpacity={0.85}
                      stroke={ENDPOINT_STROKE}
                      strokeWidth={1.5}
                    />
                    {/*
                     * Endpoint names are long relative to the tight
                     * endpoint spacing, so they wrap onto a second line
                     * (and truncate past that). The full name is always in
                     * the <title> tooltip above.
                     */}
                    <text
                      x={point.x}
                      y={point.y + ENDPOINT_HALF_HEIGHT + 12}
                      textAnchor="middle"
                      fontSize={10}
                      fill="var(--ou-text-secondary, #374151)"
                    >
                      {wrapNodeLabel(node.name).map(
                        (line: string, lineIndex: number): ReactElement => {
                          return (
                            <tspan
                              key={`${node.id}-label-${lineIndex}`}
                              x={point.x}
                              dy={
                                lineIndex === 0 ? 0 : ENDPOINT_LABEL_LINE_HEIGHT
                              }
                            >
                              {line}
                            </tspan>
                          );
                        },
                      )}
                    </text>
                  </g>
                );
              }

              const hasInterfaceCounts: boolean =
                node.interfacesUp !== undefined ||
                node.interfacesDown !== undefined;
              const interfacesSummary: string = hasInterfaceCounts
                ? `${node.interfacesUp ?? 0} up / ${
                    node.interfacesDown ?? 0
                  } down`
                : "";
              const vendorSummary: string = [node.vendor, node.deviceModel]
                .filter(Boolean)
                .join(" ");
              const tooltip: string = `${node.name} (${node.status}${
                node.isManaged ? "" : ", unmanaged"
              })${vendorSummary ? ` — ${vendorSummary}` : ""}${
                interfacesSummary ? ` — ${interfacesSummary}` : ""
              }`;

              const isClickable: boolean = Boolean(props.onNodeClick);

              return (
                <g
                  key={`node-${node.id}`}
                  style={isClickable ? { cursor: "pointer" } : undefined}
                  opacity={isDimmed ? 0.25 : 1}
                  onClick={
                    isClickable
                      ? () => {
                          if (suppressClick.current) {
                            return;
                          }
                          props.onNodeClick!(node);
                        }
                      : undefined
                  }
                >
                  <title>{tooltip}</title>
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={NODE_RADIUS}
                    fill={
                      node.isManaged
                        ? colors.fill
                        : "var(--ou-surface-primary, #ffffff)"
                    }
                    fillOpacity={node.isManaged ? 0.85 : 1}
                    stroke={colors.stroke}
                    strokeWidth={2}
                    strokeDasharray={node.isManaged ? undefined : "4 3"}
                  />
                  {hasInterfaceCounts ? (
                    <text
                      x={point.x}
                      y={point.y + 4}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={600}
                      fill={
                        node.isManaged
                          ? "#ffffff"
                          : "var(--ou-text-secondary, #374151)"
                      }
                    >
                      {`${node.interfacesUp ?? 0}/${node.interfacesDown ?? 0}`}
                    </text>
                  ) : null}
                  <text
                    x={point.x}
                    y={point.y + NODE_RADIUS + 14}
                    textAnchor="middle"
                    fontSize={12}
                    fill="var(--ou-text-secondary, #374151)"
                  >
                    {node.name}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>
    </div>
  );
};

export default NetworkDeviceGraph;
