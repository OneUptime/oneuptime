import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyNode,
  NetworkTopologyNodeStatus,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  TopologyPoint,
  clamp,
  computeTopologyLayout,
} from "../NetworkDevice/TopologyLayout";
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
const NODE_RADIUS: number = 16;

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

  const layout: Map<string, TopologyPoint> = useMemo(() => {
    return computeTopologyLayout(nodes, edges, VIEW_WIDTH, VIEW_HEIGHT);
  }, [props.topology]);

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
        ((event.clientY - rect.top) / rect.height) * VIEW_HEIGHT;
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
      const cy: number = VIEW_HEIGHT / 2;
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
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
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
          event.currentTarget.setPointerCapture?.(event.pointerId);
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
            ((event.clientY - drag.y) / rect.height) * VIEW_HEIGHT;
          drag.moved +=
            Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y);
          drag.x = event.clientX;
          drag.y = event.clientY;
          if (drag.moved > 5) {
            suppressClick.current = true;
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
          {/* Edges drawn first so nodes render on top. */}
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
                    strokeDasharray={state === "down" ? "6 4" : undefined}
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
