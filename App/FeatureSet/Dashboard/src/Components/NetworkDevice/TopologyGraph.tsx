import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyNode,
  NetworkTopologyNodeStatus,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  topology: NetworkTopology;
  /**
   * Called when a managed device node is clicked (unmanaged LLDP-only
   * neighbors have no device row to open). Omitting it keeps nodes inert.
   */
  onManagedNodeClick?: ((node: NetworkTopologyNode) => void) | undefined;
  /**
   * Rendered under the empty-state text (e.g. a setup link). Injected by
   * the caller so this component stays free of router imports — its pure
   * layout export is unit-tested in a plain node environment.
   */
  emptyStateFooter?: ReactElement | undefined;
}

// A single 2D coordinate.
export interface TopologyPoint {
  x: number;
  y: number;
}

// Layout constants. The SVG uses a fixed viewBox and scales responsively.
const VIEW_WIDTH: number = 1000;
const VIEW_HEIGHT: number = 700;
const LAYOUT_MARGIN: number = 48;
const NODE_RADIUS: number = 16;
const DEFAULT_ITERATIONS: number = 300;

/**
 * Deterministic 32-bit FNV-1a hash of a string. Used to seed node
 * positions so the same topology always lays out identically (no
 * Math.random, which is banned and non-deterministic).
 */
const hashString: (value: string) => number = (value: string): number => {
  let hash: number = 2166136261 >>> 0; // FNV offset basis.
  for (let i: number = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0; // FNV prime.
  }
  return hash >>> 0;
};

/**
 * Deterministic pseudo-random unit value in [0, 1) derived from an
 * integer seed via an xorshift step.
 */
const seededUnit: (seed: number) => number = (seed: number): number => {
  let x: number = seed >>> 0;
  if (x === 0) {
    x = 0x9e3779b9; // Avoid the fixed point at zero.
  }
  x ^= x << 13;
  x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5;
  x >>>= 0;
  return (x >>> 0) / 4294967296;
};

const clamp: (value: number, min: number, max: number) => number = (
  value: number,
  min: number,
  max: number,
): number => {
  if (!Number.isFinite(value)) {
    return (min + max) / 2;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

interface MutablePoint {
  x: number;
  y: number;
}

/**
 * Compute a deterministic force-directed layout for a network topology.
 *
 * Pure and side-effect free: given the same inputs it always returns the
 * same coordinates. Initial positions are seeded from a hash of each node
 * id, then refined with a fixed number of Fruchterman-Reingold style
 * iterations (all-pairs repulsion + per-edge spring attraction + a gentle
 * pull toward centre). Every returned coordinate is finite and clamped
 * within [margin, width - margin] x [margin, height - margin].
 */
export const computeTopologyLayout: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
  height: number,
  iterations?: number,
) => Map<string, TopologyPoint> = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
  height: number,
  iterations: number = DEFAULT_ITERATIONS,
): Map<string, TopologyPoint> => {
  const result: Map<string, TopologyPoint> = new Map();

  if (!nodes || nodes.length === 0) {
    return result;
  }

  const margin: number = LAYOUT_MARGIN;
  const minX: number = margin;
  const maxX: number = Math.max(margin + 1, width - margin);
  const minY: number = margin;
  const maxY: number = Math.max(margin + 1, height - margin);
  const centerX: number = (minX + maxX) / 2;
  const centerY: number = (minY + maxY) / 2;

  const positions: Map<string, MutablePoint> = new Map();

  /*
   * Seed deterministic initial positions from a hash of each node id.
   * The node index nudges the hash so two ids that collide (or a single
   * node) still get distinct, spread-out starting points.
   */
  nodes.forEach((node: NetworkTopologyNode, index: number): void => {
    const baseHash: number =
      hashString(node.id) ^ Math.imul(index + 1, 0x85ebca6b);
    const ux: number = seededUnit(baseHash >>> 0);
    const uy: number = seededUnit((baseHash ^ 0x9e3779b9) >>> 0);
    positions.set(node.id, {
      x: minX + ux * (maxX - minX),
      y: minY + uy * (maxY - minY),
    });
  });

  const nodeCount: number = nodes.length;
  const area: number = Math.max(1, (maxX - minX) * (maxY - minY));
  // Ideal edge length (Fruchterman-Reingold constant k).
  const k: number = Math.sqrt(area / nodeCount);
  const epsilon: number = 0.01;

  // Only consider edges whose endpoints both exist as nodes.
  const validEdges: Array<NetworkTopologyEdge> = edges
    ? edges.filter((edge: NetworkTopologyEdge): boolean => {
        return positions.has(edge.fromNodeId) && positions.has(edge.toNodeId);
      })
    : [];

  let temperature: number = (maxX - minX) * 0.1;
  const cooling: number = temperature / (iterations + 1);

  const nodeIds: Array<string> = nodes.map((n: NetworkTopologyNode) => {
    return n.id;
  });

  for (let iter: number = 0; iter < iterations; iter++) {
    const disp: Map<string, MutablePoint> = new Map();
    for (const id of nodeIds) {
      disp.set(id, { x: 0, y: 0 });
    }

    // Repulsion between every pair of nodes.
    for (let i: number = 0; i < nodeIds.length; i++) {
      const idI: string = nodeIds[i]!;
      const pI: MutablePoint = positions.get(idI)!;
      const dI: MutablePoint = disp.get(idI)!;
      for (let j: number = i + 1; j < nodeIds.length; j++) {
        const idJ: string = nodeIds[j]!;
        const pJ: MutablePoint = positions.get(idJ)!;
        let dx: number = pI.x - pJ.x;
        let dy: number = pI.y - pJ.y;
        let dist: number = Math.sqrt(dx * dx + dy * dy);
        if (dist < epsilon) {
          // Deterministically separate coincident nodes.
          dx = (seededUnit(hashString(idI + idJ)) - 0.5) * epsilon;
          dy = (seededUnit(hashString(idJ + idI)) - 0.5) * epsilon;
          dist = epsilon;
        }
        const force: number = (k * k) / dist;
        const fx: number = (dx / dist) * force;
        const fy: number = (dy / dist) * force;
        dI.x += fx;
        dI.y += fy;
        const dJ: MutablePoint = disp.get(idJ)!;
        dJ.x -= fx;
        dJ.y -= fy;
      }
    }

    // Attraction along edges (springs).
    for (const edge of validEdges) {
      const pA: MutablePoint = positions.get(edge.fromNodeId)!;
      const pB: MutablePoint = positions.get(edge.toNodeId)!;
      const dx: number = pA.x - pB.x;
      const dy: number = pA.y - pB.y;
      const dist: number = Math.max(epsilon, Math.sqrt(dx * dx + dy * dy));
      const force: number = (dist * dist) / k;
      const fx: number = (dx / dist) * force;
      const fy: number = (dy / dist) * force;
      const dA: MutablePoint = disp.get(edge.fromNodeId)!;
      const dB: MutablePoint = disp.get(edge.toNodeId)!;
      dA.x -= fx;
      dA.y -= fy;
      dB.x += fx;
      dB.y += fy;
    }

    // Gentle centering so disconnected components do not drift away.
    for (const id of nodeIds) {
      const p: MutablePoint = positions.get(id)!;
      const d: MutablePoint = disp.get(id)!;
      d.x += (centerX - p.x) * 0.01;
      d.y += (centerY - p.y) * 0.01;
    }

    // Apply displacement, capped by the current temperature, then clamp.
    for (const id of nodeIds) {
      const p: MutablePoint = positions.get(id)!;
      const d: MutablePoint = disp.get(id)!;
      const len: number = Math.max(epsilon, Math.sqrt(d.x * d.x + d.y * d.y));
      const limited: number = Math.min(len, temperature);
      p.x = clamp(p.x + (d.x / len) * limited, minX, maxX);
      p.y = clamp(p.y + (d.y / len) * limited, minY, maxY);
    }

    temperature = Math.max(0, temperature - cooling);
  }

  for (const id of nodeIds) {
    const p: MutablePoint = positions.get(id)!;
    result.set(id, {
      x: clamp(p.x, minX, maxX),
      y: clamp(p.y, minY, maxY),
    });
  }

  return result;
};

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

const TopologyGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const nodes: Array<NetworkTopologyNode> = props.topology?.nodes || [];
  const edges: Array<NetworkTopologyEdge> = props.topology?.edges || [];

  const layout: Map<string, TopologyPoint> = useMemo(() => {
    return computeTopologyLayout(nodes, edges, VIEW_WIDTH, VIEW_HEIGHT);
  }, [props.topology]);

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
            Add network devices and enable interface monitoring — LLDP neighbors
            appear here as devices report them.
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
            {edges.map(
              (
                edge: NetworkTopologyEdge,
                index: number,
              ): ReactElement | null => {
                const from: TopologyPoint | undefined = layout.get(
                  edge.fromNodeId,
                );
                const to: TopologyPoint | undefined = layout.get(edge.toNodeId);
                if (!from || !to) {
                  return null;
                }
                const edgeTitle: string =
                  edge.fromPort || edge.toPort
                    ? `${edge.fromPort || "?"} ↔ ${edge.toPort || "?"}`
                    : "";
                return (
                  <line
                    key={`edge-${index}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke="#cbd5e1"
                    strokeWidth={1.5}
                  >
                    {edgeTitle ? <title>{edgeTitle}</title> : null}
                  </line>
                );
              },
            )}
          </g>

          {/* Nodes. */}
          <g>
            {nodes.map((node: NetworkTopologyNode): ReactElement | null => {
              const point: TopologyPoint | undefined = layout.get(node.id);
              if (!point) {
                return null;
              }
              const colors: StatusColors = getStatusColors(node.status);

              const hasInterfaceCounts: boolean =
                node.interfacesUp !== undefined ||
                node.interfacesDown !== undefined;
              const interfacesSummary: string = hasInterfaceCounts
                ? `${node.interfacesUp ?? 0} up / ${
                    node.interfacesDown ?? 0
                  } down`
                : "";
              const tooltip: string = `${node.name} (${node.status}${
                node.isManaged ? "" : ", unmanaged"
              })${interfacesSummary ? ` — ${interfacesSummary}` : ""}`;

              const isClickable: boolean = Boolean(
                node.isManaged && props.onManagedNodeClick,
              );

              return (
                <g
                  key={`node-${node.id}`}
                  style={isClickable ? { cursor: "pointer" } : undefined}
                  onClick={
                    isClickable
                      ? () => {
                          if (suppressClick.current) {
                            return;
                          }
                          props.onManagedNodeClick!(node);
                        }
                      : undefined
                  }
                >
                  <title>{tooltip}</title>
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={NODE_RADIUS}
                    fill={node.isManaged ? colors.fill : "#ffffff"}
                    fillOpacity={node.isManaged ? 0.85 : 1}
                    stroke={colors.stroke}
                    strokeWidth={node.isManaged ? 2 : 2}
                    strokeDasharray={node.isManaged ? undefined : "4 3"}
                  />
                  {hasInterfaceCounts ? (
                    <text
                      x={point.x}
                      y={point.y + 4}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={600}
                      fill={node.isManaged ? "#ffffff" : "#374151"}
                    >
                      {`${node.interfacesUp ?? 0}/${node.interfacesDown ?? 0}`}
                    </text>
                  ) : null}
                  <text
                    x={point.x}
                    y={point.y + NODE_RADIUS + 14}
                    textAnchor="middle"
                    fontSize={12}
                    fill="#374151"
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

export default TopologyGraph;
