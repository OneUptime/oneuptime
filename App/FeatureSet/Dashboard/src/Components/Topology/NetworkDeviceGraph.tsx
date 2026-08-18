import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  TopologyComponentBox,
  TopologyGroupBox,
  TopologyLayoutModel,
  computeTieredTopologyLayoutModel,
} from "../NetworkDevice/TopologyLayout";
import { computeForceTopologyModel } from "../NetworkDevice/ForceTopologyLayout";
import { computeRadialTopologyModel } from "../NetworkDevice/RadialTopologyLayout";
import { computeStarTopologyModel } from "../NetworkDevice/StarTopologyLayout";
import { computeParentChildTopologyModel } from "../NetworkDevice/ParentChildTopologyLayout";
import { TopologyPoint } from "../NetworkDevice/TopologyGraphUtil";
import {
  HEALTH_STATE_COLORS,
  TopologyHealthFilterMode,
} from "./TopologyHealthFilter";
import {
  LABEL_VISIBILITY_MIN_SCALE,
  TopologyNodeFootprint,
} from "../NetworkDevice/TopologyFootprint";
import {
  ALL_NODE_KINDS,
  TopologyEdgeView,
  TopologyNodeKind,
  TopologyNodeView,
  TopologyViewModel,
  buildTopologyViewModel,
  topologyStructuralSignature,
} from "./NetworkTopologyViewModel";
import {
  TopologyLegendEntry,
  buildTopologyLegend,
  edgeKeyForEdge,
} from "./NetworkTopologyMeta";
import {
  TopologyShapeGeometry,
  cylinderBodyPathAt,
  cylinderCapPathAt,
  geometryForShape,
  polygonPointsAt,
} from "../NetworkDevice/TopologyNodeShape";
import {
  PositionOverrides,
  TopologyLayoutMode,
  mergePositionOverrides,
  withPositionOverrides,
} from "./TopologyPositionOverrides";
import {
  ElementBox,
  IDENTITY_VIEW,
  ScreenPoint,
  ViewBoxSize,
  ViewTransform,
  WorldPoint,
  applyZoomAtPoint,
  computeGraphBounds,
  fitViewToBounds,
  normalizeWheelDeltaPx,
  panBy,
  screenToViewBox,
  viewsMatch,
} from "./TopologyViewport";
import {
  GestureContext,
  GestureEffect,
  GestureEvent,
  GesturePointerType,
  GestureResult,
  GestureState,
  MovedNodePosition,
  buildAdjacencyIndex,
  cursorForGesture,
  focusSetFor,
  initialGestureState,
  reduceGesture,
} from "./TopologyInteraction";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * The live network topology graph: devices as nodes, LLDP/CDP links as
 * edges, endpoints as leaves.
 *
 * WHY THIS IS HAND-ROLLED SVG rather than React Flow, which every sibling
 * graph in this codebase uses. Two reasons, both deliberate. First,
 * testability: App/jest.config.json runs with `testEnvironment: "node"`
 * and no react on its module resolution path, so anything that lives
 * inside a React component here cannot be unit tested at all — and drag,
 * viewport maths, overlap and persistence are exactly the things that
 * must be. Everything of consequence therefore lives in pure modules
 * (TopologyViewport, TopologyInteraction, TopologyPositionOverrides,
 * NetworkTopologyViewModel, the layouts) and this file is a thin adapter
 * over them. Second, scale: the topology endpoint will return up to ten
 * thousand devices and two thousand endpoints, and React Flow mounts and
 * measures a DOM subtree per node.
 *
 * What we do take from the siblings is every visual and behavioural
 * convention: the dot-grid canvas, the grouped control cluster, real
 * fit-to-view, a legend, selection and hover states, and data-testid
 * discipline.
 */

export interface ComponentProps {
  topology: NetworkTopology;
  /** Nodes not matching this render dimmed. Empty string shows everything. */
  searchText?: string | undefined;
  /*
   * "force" (the default) is the organic project-wide map, "tiered" lays
   * routers over switches over endpoints for a single site, and "radial"
   * puts the core at the centre with everything hanging off it. "star"
   * also centres one hub, but ranks by hops from it rather than by role,
   * so a ring reads as blast radius; "parentChild" draws the same
   * hierarchy as a top-down tree, every node under its own parent.
   */
  layoutMode?: TopologyLayoutMode | undefined;
  /** Node kinds to draw. Absent means all of them. */
  visibleKinds?: ReadonlySet<TopologyNodeKind> | undefined;
  /*
   * Narrow the map to devices in a problem state. Absent means "all",
   * which is the no-op. Anything else removes healthy nodes, keeps each
   * match's directly-linked network neighbours as dimmed context, and
   * rings the matches so they are findable at a glance.
   */
  healthFilterMode?: TopologyHealthFilterMode | undefined;
  /*
   * Positions the user established by dragging. Owned by the parent so
   * they survive this component remounting and can be persisted and
   * pruned against the UNFILTERED node set.
   */
  positionOverrides?: PositionOverrides | undefined;
  onPositionOverridesChange?: ((next: PositionOverrides) => void) | undefined;
  onNodeClick?: ((node: NetworkTopologyNode) => void) | undefined;
  onEdgeClick?: ((edge: NetworkTopologyEdge) => void) | undefined;
  selectedNodeId?: string | null | undefined;
  selectedEdgeKey?: string | null | undefined;
  /**
   * Rendered under the empty-state text (e.g. a setup link). Injected by
   * the caller so this component stays free of router imports.
   */
  emptyStateFooter?: ReactElement | undefined;
}

/*
 * A fixed viewBox in every layout mode. The old component grew the
 * viewBox with the tiered layout up to a hard cap, which meant a tall
 * graph rendered at a third of its size between two wide empty bars and
 * anything past the cap was simply unreachable. The viewBox is now
 * constant and the VIEW zooms to fit whatever the layout produced.
 */
const VIEW_WIDTH: number = 1000;
const VIEW_HEIGHT: number = 700;
const VIEW_BOX: ViewBoxSize = { width: VIEW_WIDTH, height: VIEW_HEIGHT };

const ZOOM_BUTTON_FACTOR: number = 1.3;
const WHEEL_ZOOM_SENSITIVITY: number = 0.0015;
// Trackpad pinch arrives as a ctrl-modified wheel and needs a firmer ramp.
const WHEEL_PINCH_SENSITIVITY: number = 0.01;
const KEYBOARD_PAN_FRACTION: number = 0.2;
const DOT_GRID_SPACING: number = 16;
// Clearance between a hull and the ink of the nodes it encloses.
const HULL_PADDING: number = 22;
// Padding, in world units, left around the graph when fitting it.
const FIT_BOUNDS_PADDING: number = 40;

/*
 * Unique per mount so two graphs on one page cannot share a <pattern> id.
 * A counter rather than Math.random, which is banned here.
 */
let graphInstanceCounter: number = 0;

const emptyOverrides: PositionOverrides = new Map<string, TopologyPoint>();

/*
 * The node glyph, drawn as whatever silhouette its role earned it. The
 * geometry is NOT recomputed here — it rides in on the footprint, which
 * is the same object the layout used to reserve space, so a shape can
 * never be painted larger than the room made for it.
 */
const renderNodeSilhouette: (nodeView: TopologyNodeView) => ReactElement = (
  nodeView: TopologyNodeView,
): ReactElement => {
  const geometry: TopologyShapeGeometry = nodeView.footprint.shape;
  const isEndpoint: boolean = nodeView.kind === "endpoint";
  const fillOpacity: number = isEndpoint
    ? 0.85
    : nodeView.kind === "device"
      ? 0.9
      : 1;
  const strokeWidth: number = isEndpoint ? 1.5 : 2;
  const paint: {
    fill: string;
    fillOpacity: number;
    stroke: string;
    strokeWidth: number;
    strokeDasharray: string | undefined;
  } = {
    fill: nodeView.fill,
    fillOpacity: fillOpacity,
    stroke: nodeView.stroke,
    strokeWidth: strokeWidth,
    strokeDasharray: nodeView.strokeDashArray,
  };

  if (geometry.points.length > 0) {
    return (
      <polygon
        data-topology-node-shape={geometry.shape}
        points={polygonPointsAt(geometry, nodeView.x, nodeView.y)}
        strokeLinejoin="round"
        {...paint}
      />
    );
  }

  if (geometry.shape === "cylinder") {
    /*
     * Two paths: the silhouette, then the front rim of the top cap over
     * it. Without the rim the outline reads as a lozenge, not a drum.
     */
    return (
      <g data-topology-node-shape={geometry.shape}>
        <path
          d={cylinderBodyPathAt(geometry, nodeView.x, nodeView.y)}
          {...paint}
        />
        <path
          d={cylinderCapPathAt(geometry, nodeView.x, nodeView.y)}
          fill="none"
          stroke={nodeView.stroke}
          strokeWidth={strokeWidth}
          pointerEvents="none"
        />
      </g>
    );
  }

  if (geometry.shape === "circle") {
    return (
      <circle
        data-topology-node-shape={geometry.shape}
        cx={nodeView.x}
        cy={nodeView.y}
        r={geometry.halfWidth}
        {...paint}
      />
    );
  }

  // Everything left is a rect: the switch box, the server tower, the leaf.
  return (
    <rect
      data-topology-node-shape={geometry.shape}
      x={nodeView.x - geometry.halfWidth}
      y={nodeView.y - geometry.halfHeight}
      width={geometry.halfWidth * 2}
      height={geometry.halfHeight * 2}
      rx={geometry.cornerRadius}
      {...paint}
    />
  );
};

/*
 * One legend swatch. Drawn in a 16 × 10 box, so the node silhouettes are
 * re-derived at a base radius that fits it rather than scaled down from
 * the canvas geometry.
 */
const LEGEND_SWATCH_WIDTH: number = 16;
const LEGEND_SWATCH_HEIGHT: number = 10;
const LEGEND_SHAPE_BASE_RADIUS: number = 4.2;

const renderLegendSwatch: (entry: TopologyLegendEntry) => ReactElement = (
  entry: TopologyLegendEntry,
): ReactElement => {
  const cx: number = LEGEND_SWATCH_WIDTH / 2;
  const cy: number = LEGEND_SWATCH_HEIGHT / 2;

  if (entry.swatch === "line" || entry.swatch === "dashed-line") {
    return (
      <line
        x1={0}
        y1={cy}
        x2={LEGEND_SWATCH_WIDTH}
        y2={cy}
        stroke={entry.color}
        strokeWidth={2}
        strokeDasharray={entry.swatch === "dashed-line" ? "3 2" : undefined}
      />
    );
  }

  if (entry.swatch === "square") {
    return <rect x={3} y={2} width={10} height={7} rx={2} fill={entry.color} />;
  }

  if (entry.swatch === "shape" && entry.shape) {
    const geometry: TopologyShapeGeometry = geometryForShape(
      entry.shape,
      LEGEND_SHAPE_BASE_RADIUS,
    );
    if (geometry.points.length > 0) {
      return (
        <polygon
          points={polygonPointsAt(geometry, cx, cy)}
          fill="none"
          stroke={entry.color}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      );
    }
    if (geometry.shape === "cylinder") {
      return (
        <path
          d={cylinderBodyPathAt(geometry, cx, cy)}
          fill="none"
          stroke={entry.color}
          strokeWidth={1.5}
        />
      );
    }
    if (geometry.shape === "circle") {
      return (
        <circle
          cx={cx}
          cy={cy}
          r={geometry.halfWidth}
          fill="none"
          stroke={entry.color}
          strokeWidth={1.5}
        />
      );
    }
    return (
      <rect
        x={cx - geometry.halfWidth}
        y={cy - geometry.halfHeight}
        width={geometry.halfWidth * 2}
        height={geometry.halfHeight * 2}
        rx={geometry.cornerRadius}
        fill="none"
        stroke={entry.color}
        strokeWidth={1.5}
      />
    );
  }

  return (
    <circle
      cx={8}
      cy={cy}
      r={4}
      fill={entry.swatch === "hollow-dot" ? "none" : entry.color}
      stroke={entry.color}
      strokeWidth={entry.swatch === "hollow-dot" ? 1.5 : 0}
      strokeDasharray={entry.swatch === "hollow-dot" ? "2 1.5" : undefined}
    />
  );
};

const NetworkDeviceGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const nodes: Array<NetworkTopologyNode> = props.topology?.nodes || [];
  const edges: Array<NetworkTopologyEdge> = props.topology?.edges || [];
  const layoutMode: TopologyLayoutMode = props.layoutMode || "force";
  const overrides: PositionOverrides =
    props.positionOverrides || emptyOverrides;

  const instanceIdRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  if (instanceIdRef.current === null) {
    graphInstanceCounter += 1;
    instanceIdRef.current = graphInstanceCounter;
  }
  const dotPatternId: string = `network-topology-dots-${instanceIdRef.current}`;

  const containerRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const svgRef: React.MutableRefObject<SVGSVGElement | null> =
    useRef<SVGSVGElement | null>(null);

  const [view, setView] = useState<ViewTransform>(IDENTITY_VIEW);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  /*
   * Positions being dragged right now. Kept local so a drag re-renders
   * this component only, and is handed to the parent once on pointer-up.
   */
  const [dragPositions, setDragPositions] = useState<PositionOverrides | null>(
    null,
  );
  const [gestureCursor, setGestureCursor] = useState<string>("default");
  // Once the user frames the map themselves, auto-fit stops interfering.
  const hasUserAdjustedView: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  /*
   * The link a background press landed on, if any. Read when the gesture
   * turns out to have been a click rather than a pan.
   */
  const pressedEdgeKey: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  /*
   * The layout depends only on the graph's SHAPE, so a poll that changes
   * an interface counter or a device's status does not recompute it. The
   * user's own positions are layered on afterwards rather than fed in, so
   * a drag is instant however large the graph is.
   */
  const structuralSignature: string = useMemo(() => {
    return topologyStructuralSignature(nodes, edges);
  }, [nodes, edges]);

  const baseModel: TopologyLayoutModel = useMemo(() => {
    if (layoutMode === "tiered") {
      return computeTieredTopologyLayoutModel(
        nodes,
        edges,
        VIEW_WIDTH,
        VIEW_HEIGHT,
      );
    }
    if (layoutMode === "radial") {
      return computeRadialTopologyModel(nodes, edges, VIEW_WIDTH, VIEW_HEIGHT);
    }
    if (layoutMode === "star") {
      return computeStarTopologyModel(nodes, edges, VIEW_WIDTH, VIEW_HEIGHT);
    }
    if (layoutMode === "parentChild") {
      return computeParentChildTopologyModel(
        nodes,
        edges,
        VIEW_WIDTH,
        VIEW_HEIGHT,
      );
    }
    return computeForceTopologyModel(nodes, edges, VIEW_WIDTH, VIEW_HEIGHT);
    /*
     * `nodes`/`edges` are intentionally not dependencies: the signature
     * already captures every property of them the layout reads, and
     * depending on the arrays themselves would recompute on every poll.
     */
  }, [structuralSignature, layoutMode]);

  const positions: Map<string, TopologyPoint> = useMemo(() => {
    const withUserPositions: Map<string, TopologyPoint> =
      mergePositionOverrides(baseModel.positions, overrides);
    if (!dragPositions) {
      return withUserPositions;
    }
    return mergePositionOverrides(withUserPositions, dragPositions);
  }, [baseModel, overrides, dragPositions]);

  const adjacency: Map<string, Set<string>> = useMemo(() => {
    return buildAdjacencyIndex(edges);
  }, [edges]);

  const nodeById: Map<string, NetworkTopologyNode> = useMemo(() => {
    const map: Map<string, NetworkTopologyNode> = new Map<
      string,
      NetworkTopologyNode
    >();
    for (const node of nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [nodes]);

  /*
   * Hovering a device raises it and its neighbours and dims the rest.
   * "What is this switch connected to" is the question a network map
   * exists to answer, and until now the only way to ask it was to trace
   * lines by eye.
   */
  const focusNodeIds: ReadonlySet<string> = useMemo(() => {
    /*
     * Hover only, not selection. Dimming on selection would leave the map
     * washed out for as long as a detail panel is open, which is most of
     * the time an operator is actually reading it.
     *
     * The membership check is not belt-and-braces: React never delivers a
     * pointerleave to an unmounting element, so a device that ages out of
     * the topology while the cursor rests on it leaves its id behind here
     * for ever. Focusing on a node that is no longer drawn dims every
     * node that IS drawn — the whole map goes grey and stays grey.
     */
    if (!hoveredNodeId || !nodeById.has(hoveredNodeId)) {
      return new Set<string>();
    }
    return focusSetFor(adjacency, new Set<string>([hoveredNodeId]), true);
  }, [adjacency, hoveredNodeId, nodeById]);

  const pinnedNodeIds: ReadonlySet<string> = useMemo(() => {
    return new Set<string>(overrides.keys());
  }, [overrides]);

  const viewModel: TopologyViewModel = useMemo(() => {
    return buildTopologyViewModel({
      nodes: nodes,
      edges: edges,
      positions: positions,
      searchText: props.searchText || "",
      visibleKinds: props.visibleKinds || ALL_NODE_KINDS,
      healthFilterMode: props.healthFilterMode || "all",
      focusNodeIds: focusNodeIds,
      selectedNodeId: props.selectedNodeId || null,
      selectedEdgeKey: props.selectedEdgeKey || null,
      pinnedNodeIds: pinnedNodeIds,
    });
  }, [
    nodes,
    edges,
    positions,
    props.searchText,
    props.visibleKinds,
    props.healthFilterMode,
    focusNodeIds,
    props.selectedNodeId,
    props.selectedEdgeKey,
    pinnedNodeIds,
  ]);

  /*
   * Built from the UNFILTERED node set on purpose: the key should explain
   * the silhouettes this network contains, not flicker an entry away the
   * moment a kind filter hides the last switch.
   */
  const legend: Array<TopologyLegendEntry> = useMemo(() => {
    return buildTopologyLegend(nodes);
  }, [nodes]);

  /*
   * The soft hulls behind the graph: one per island, one per endpoint
   * group, one for the unlinked strip.
   *
   * Re-derived from where the member nodes are ACTUALLY drawn rather than
   * taken from the layout as-is. The layout's boxes are computed once per
   * graph shape, so they know nothing about a device the user has since
   * dragged out of its island, or about a node kind the user has switched
   * off — either of which would otherwise leave a labelled rectangle
   * outlining empty canvas.
   */
  const hulls: Array<{
    key: string;
    x: number;
    y: number;
    width: number;
    height: number;
    caption: string | null;
    isDashed: boolean;
  }> = useMemo(() => {
    const drawn: Map<string, TopologyNodeView> = new Map<
      string,
      TopologyNodeView
    >();
    for (const nodeView of viewModel.nodes) {
      drawn.set(nodeView.id, nodeView);
    }

    type HullSource = {
      key: string;
      nodeIds: Array<string>;
      caption: string | null;
      isDashed: boolean;
    };
    const sources: Array<HullSource> = [
      ...baseModel.groups.map((box: TopologyGroupBox): HullSource => {
        return {
          key: `group-${box.anchorNodeId || "unattached"}`,
          nodeIds: box.nodeIds,
          caption: null,
          isDashed: box.anchorNodeId === null,
        };
      }),
      ...baseModel.componentBoxes.map(
        (box: TopologyComponentBox): HullSource => {
          return {
            key: `component-${box.key}`,
            nodeIds: box.nodeIds,
            caption: box.isUnlinked ? "Not linked to anything" : null,
            isDashed: box.isUnlinked,
          };
        },
      ),
    ];

    const result: Array<{
      key: string;
      x: number;
      y: number;
      width: number;
      height: number;
      caption: string | null;
      isDashed: boolean;
    }> = [];

    for (const source of sources) {
      let minX: number = Infinity;
      let minY: number = Infinity;
      let maxX: number = -Infinity;
      let maxY: number = -Infinity;
      let members: number = 0;
      for (const nodeId of source.nodeIds) {
        const nodeView: TopologyNodeView | undefined = drawn.get(nodeId);
        if (!nodeView) {
          continue;
        }
        const footprint: TopologyNodeFootprint = nodeView.footprint;
        minX = Math.min(minX, nodeView.x - footprint.inkHalfWidth);
        maxX = Math.max(maxX, nodeView.x + footprint.inkHalfWidth);
        minY = Math.min(minY, nodeView.y - footprint.halfHeight);
        maxY = Math.max(maxY, nodeView.y + footprint.labelBottom);
        members++;
      }
      // A hull with nothing left inside it is not a hull, it is a ghost.
      if (members === 0) {
        continue;
      }
      result.push({
        key: source.key,
        x: minX - HULL_PADDING,
        y: minY - HULL_PADDING,
        width: maxX - minX + 2 * HULL_PADDING,
        height: maxY - minY + 2 * HULL_PADDING,
        caption: source.caption ? `${source.caption} (${members})` : null,
        isDashed: source.isDashed,
      });
    }
    return result;
  }, [baseModel, viewModel]);

  /*
   * Keyed by edgeKeyForEdge — the undirected sorted pair — because that
   * is the identity the view model, the DOM attribute and the parent's
   * selection state all use.
   */
  const edgeByPairKey: Map<string, NetworkTopologyEdge> = useMemo(() => {
    const map: Map<string, NetworkTopologyEdge> = new Map<
      string,
      NetworkTopologyEdge
    >();
    for (const edge of edges) {
      map.set(edgeKeyForEdge(edge), edge);
    }
    return map;
  }, [edges]);

  /*
   * ------------------------------------------------------------------
   * Viewport
   * ------------------------------------------------------------------
   */

  const measureBox: () => ElementBox = useCallback((): ElementBox => {
    const element: SVGSVGElement | null = svgRef.current;
    if (!element) {
      return { left: 0, top: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT };
    }
    const rect: DOMRect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, []);

  const fitToGraph: () => void = useCallback((): void => {
    const points: Array<WorldPoint> = viewModel.nodes.map(
      (nodeView: TopologyNodeView): WorldPoint => {
        return { x: nodeView.x, y: nodeView.y };
      },
    );
    setView(
      fitViewToBounds(computeGraphBounds(points, FIT_BOUNDS_PADDING), VIEW_BOX),
    );
  }, [viewModel]);

  /*
   * A new layout mode is a new coordinate system — every mode centres its
   * own content independently, and a tree is a different shape from a
   * ring — so the viewport the user framed in the old one means nothing in
   * the new one. Without this, panning down a tall tiered graph and then
   * switching to radial leaves the camera pointing at empty canvas with no
   * way back except Fit to view.
   */
  useEffect(() => {
    hasUserAdjustedView.current = false;
  }, [layoutMode]);

  /*
   * A health filter is a question — "show me what needs me" — and an
   * answer that lands outside the frame the reader happened to be looking
   * at is not an answer. The coordinates do not move (that is the point:
   * toggling the filter never reshuffles the map), so the only thing that
   * has to move is the camera, and it has to move even when the reader
   * had framed the map themselves.
   */
  useEffect(() => {
    hasUserAdjustedView.current = false;
  }, [props.healthFilterMode]);

  /*
   * Fit on first paint and whenever the node set changes — but never once
   * the user has framed the map themselves. Yanking the viewport out from
   * under somebody mid-investigation is worse than a slightly stale
   * frame.
   */
  useEffect(() => {
    if (hasUserAdjustedView.current || viewModel.nodes.length === 0) {
      return;
    }
    fitToGraph();
    /*
     * `fitToGraph` is deliberately not a dependency: it closes over the
     * view model, which changes on every hover, and re-fitting the
     * viewport when somebody hovers a device would be maddening.
     */
    /*
     * The mode is a dependency in its own right, not just through the
     * node count: switching between two filters that happen to leave the
     * same number of devices drawn is still a different set of devices.
     */
  }, [
    structuralSignature,
    layoutMode,
    props.healthFilterMode,
    viewModel.nodes.length,
  ]);

  const applyView: (next: ViewTransform) => void = useCallback(
    (next: ViewTransform): void => {
      setView((current: ViewTransform): ViewTransform => {
        if (viewsMatch(current, next)) {
          return current;
        }
        return next;
      });
    },
    [],
  );

  const zoomBy: (factor: number) => void = useCallback(
    (factor: number): void => {
      hasUserAdjustedView.current = true;
      setView((current: ViewTransform): ViewTransform => {
        return applyZoomAtPoint(
          current,
          { x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2 },
          factor,
        );
      });
    },
    [],
  );

  /*
   * Wheel zoom needs a NATIVE non-passive listener: React's synthetic
   * wheel handler cannot preventDefault, so the page would scroll behind
   * the map. The dependency list matters — the old effect ran once with
   * an early return when the ref was still null, so a graph that first
   * rendered empty (a project with no devices yet) and later gained nodes
   * never got a wheel listener at all.
   */
  useEffect(() => {
    const element: SVGSVGElement | null = svgRef.current;
    if (!element) {
      return undefined;
    }
    const onWheel: (event: WheelEvent) => void = (event: WheelEvent): void => {
      event.preventDefault();
      hasUserAdjustedView.current = true;
      const box: ElementBox = measureBox();
      const anchor: ScreenPoint = screenToViewBox(
        { x: event.clientX, y: event.clientY },
        box,
        VIEW_BOX,
      );
      const deltaPx: number = normalizeWheelDeltaPx(
        event.deltaY,
        event.deltaMode,
        box.height,
      );
      const sensitivity: number = event.ctrlKey
        ? WHEEL_PINCH_SENSITIVITY
        : WHEEL_ZOOM_SENSITIVITY;
      setView((current: ViewTransform): ViewTransform => {
        return applyZoomAtPoint(
          current,
          anchor,
          Math.exp(-deltaPx * sensitivity),
        );
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, [measureBox, viewModel.nodes.length]);

  /*
   * ------------------------------------------------------------------
   * Gestures
   * ------------------------------------------------------------------
   */

  const gestureRef: React.MutableRefObject<GestureState> =
    useRef<GestureState>(initialGestureState);
  const viewRef: React.MutableRefObject<ViewTransform> =
    useRef<ViewTransform>(view);
  viewRef.current = view;
  const positionsRef: React.MutableRefObject<Map<string, TopologyPoint>> =
    useRef<Map<string, TopologyPoint>>(positions);
  positionsRef.current = positions;

  /*
   * Which nodes travel with a grabbed one. In tiered mode a switch brings
   * its block of endpoints, because dragging a switch out of a group and
   * leaving its devices behind would take the arrangement apart faster
   * than the user can build it.
   */
  const nodeIdsMovedWith: (nodeId: string) => ReadonlyArray<string> = (
    nodeId: string,
  ): ReadonlyArray<string> => {
    if (layoutMode !== "tiered") {
      return [nodeId];
    }
    const group: TopologyGroupBox | undefined = baseModel.groups.find(
      (candidate: TopologyGroupBox): boolean => {
        return candidate.anchorNodeId === nodeId;
      },
    );
    if (!group) {
      return [nodeId];
    }
    const members: Array<string> = [nodeId];
    /*
     * Hit-test against the COMPUTED positions, not the current ones. The
     * group box comes from the computed layout and never moves, so once a
     * switch has been dragged once its endpoints sit outside their own
     * box — and a second drag would pick up only the stragglers still
     * overlapping it, plus any unrelated node that had wandered in.
     */
    for (const [candidateId, point] of baseModel.positions) {
      if (
        candidateId !== nodeId &&
        point.x >= group.x &&
        point.x <= group.x + group.width &&
        point.y >= group.y &&
        point.y <= group.y + group.height
      ) {
        members.push(candidateId);
      }
    }
    return members;
  };

  /*
   * The gesture chain below is deliberately NOT memoized. Every link in
   * it closes over `overrides` and over the parent's callbacks, and a
   * useCallback that captured a stale `overrides` would silently discard
   * the user's earlier drags on the next commit. These functions are
   * rebuilt per render, which costs nothing and cannot go stale.
   */
  const gestureContext: () => GestureContext = (): GestureContext => {
    return {
      view: viewRef.current,
      box: measureBox(),
      viewBox: VIEW_BOX,
      positionOf: (nodeId: string): WorldPoint | undefined => {
        return positionsRef.current.get(nodeId);
      },
      nodeIdsMovedWith: nodeIdsMovedWith,
    };
  };

  const commitMovedNodes: (moved: ReadonlyArray<MovedNodePosition>) => void = (
    moved: ReadonlyArray<MovedNodePosition>,
  ): void => {
    setDragPositions(null);
    if (!props.onPositionOverridesChange || moved.length === 0) {
      return;
    }
    props.onPositionOverridesChange(withPositionOverrides(overrides, moved));
  };

  const applyGestureEffect: (
    effect: GestureEffect,
    target: Element | null,
  ) => void = (effect: GestureEffect, target: Element | null): void => {
    if (effect.kind === "capturePointer") {
      const element: Element | null =
        effect.target === "node" ? target : svgRef.current;
      try {
        (
          element as unknown as {
            setPointerCapture?: (pointerId: number) => void;
          }
        )?.setPointerCapture?.(effect.pointerId);
      } catch {
        /*
         * setPointerCapture throws InvalidPointerId when the pointer is
         * already up — a real race on a fast tap, and not a reason to
         * break the gesture.
         */
      }
      return;
    }
    if (effect.kind === "setView") {
      hasUserAdjustedView.current = true;
      applyView(effect.view);
      return;
    }
    if (effect.kind === "moveNodes") {
      const next: Map<string, TopologyPoint> = new Map<string, TopologyPoint>();
      for (const entry of effect.moved) {
        next.set(entry.nodeId, entry.point);
      }
      setDragPositions(next);
      return;
    }
    if (effect.kind === "commitNodePositions") {
      commitMovedNodes(effect.moved);
      return;
    }
    if (effect.kind === "revertNodePositions") {
      setDragPositions(null);
      return;
    }
    if (effect.kind === "emitNodeClick") {
      const node: NetworkTopologyNode | undefined = nodeById.get(effect.nodeId);
      if (node && props.onNodeClick) {
        props.onNodeClick(node);
      }
      return;
    }
    /*
     * A background press that never crossed the drag threshold. If it
     * landed on a link, that is a link click. Routing it through the
     * reducer rather than a DOM onClick is what makes it work at all —
     * pointer capture retargets the click to the capturing element, so an
     * onClick on the edge group never fires — and it also means a pan
     * that happens to end over a link can never be mistaken for one,
     * because this effect is only emitted below the threshold.
     */
    if (effect.kind === "emitBackgroundClick" && pressedEdgeKey.current) {
      const edge: NetworkTopologyEdge | undefined = edgeByPairKey.get(
        pressedEdgeKey.current,
      );
      if (edge && props.onEdgeClick) {
        props.onEdgeClick(edge);
      }
    }
  };

  const dispatchGesture: (
    event: GestureEvent,
    target: Element | null,
  ) => void = (event: GestureEvent, target: Element | null): void => {
    const result: GestureResult = reduceGesture(
      gestureRef.current,
      event,
      gestureContext(),
    );
    gestureRef.current = result.state;

    for (const effect of result.effects) {
      applyGestureEffect(effect, target);
    }

    const nextCursor: string = cursorForGesture(
      result.state,
      hoveredNodeId !== null,
    );
    setGestureCursor((current: string): string => {
      return current === nextCursor ? current : nextCursor;
    });
  };

  const pointerTypeOf: (value: string) => GesturePointerType = (
    value: string,
  ): GesturePointerType => {
    if (value === "touch" || value === "pen") {
      return value;
    }
    return "mouse";
  };

  const onPointerDownCapture: (
    event: React.PointerEvent<Element>,
    hitNodeId: string | null,
  ) => void = (
    event: React.PointerEvent<Element>,
    hitNodeId: string | null,
  ): void => {
    /*
     * A press on a node must not also reach the svg, or the canvas would
     * start panning underneath the node being dragged. This is the whole
     * of the reported "I can't drag things" bug: every handler used to
     * live on the svg and a node press bubbled straight into it.
     */
    if (hitNodeId !== null) {
      event.stopPropagation();
    } else {
      /*
       * Remember which link, if any, this press landed on. Pointer
       * capture retargets the eventual `click` to the capturing element,
       * so an onClick on the edge group would never fire — the same
       * retargeting that made the previous implementation defer capture
       * until after the drag threshold. Edge activation therefore goes
       * through the gesture machine like node activation does, which also
       * means a pan that happens to end over a link cannot open it.
       */
      pressedEdgeKey.current =
        (event.target as Element | null)
          ?.closest?.("[data-topology-edge-key]")
          ?.getAttribute("data-topology-edge-key") || null;
    }
    event.preventDefault();
    /*
     * preventDefault above suppresses the compatibility mousedown, and
     * with it the focus that a mouse press would normally give the svg —
     * which would leave every keyboard shortcut the aria-label advertises
     * unreachable unless the user had tabbed to the map first.
     */
    svgRef.current?.focus?.({ preventScroll: true });
    dispatchGesture(
      {
        kind: "pointerDown",
        pointerId: event.pointerId,
        pointerType: pointerTypeOf(event.pointerType),
        isPrimaryButton: event.button === 0,
        client: { x: event.clientX, y: event.clientY },
        hitNodeId: hitNodeId,
      },
      event.currentTarget,
    );
  };

  /*
   * `fromNode` matters: a node captures the pointer, so its move and up
   * events also bubble to the svg. Without stopping them the reducer
   * would see every event twice.
   */
  const onPointerMove: (
    event: React.PointerEvent<Element>,
    fromNode?: boolean,
  ) => void = (
    event: React.PointerEvent<Element>,
    fromNode?: boolean,
  ): void => {
    if (fromNode) {
      event.stopPropagation();
    }
    dispatchGesture(
      {
        kind: "pointerMove",
        pointerId: event.pointerId,
        client: { x: event.clientX, y: event.clientY },
      },
      event.currentTarget,
    );
  };

  const onPointerUp: (
    event: React.PointerEvent<Element>,
    fromNode?: boolean,
  ) => void = (
    event: React.PointerEvent<Element>,
    fromNode?: boolean,
  ): void => {
    if (fromNode) {
      event.stopPropagation();
    }
    dispatchGesture(
      {
        kind: "pointerUp",
        pointerId: event.pointerId,
        client: { x: event.clientX, y: event.clientY },
      },
      event.currentTarget,
    );
  };

  const onPointerCancel: (
    event: React.PointerEvent<Element>,
    fromNode?: boolean,
  ) => void = (
    event: React.PointerEvent<Element>,
    fromNode?: boolean,
  ): void => {
    if (fromNode) {
      event.stopPropagation();
    }
    dispatchGesture(
      { kind: "pointerCancel", pointerId: event.pointerId },
      event.currentTarget,
    );
  };

  /*
   * ------------------------------------------------------------------
   * Keyboard
   * ------------------------------------------------------------------
   */

  const onKeyDown: (event: React.KeyboardEvent<SVGSVGElement>) => void = (
    event: React.KeyboardEvent<SVGSVGElement>,
  ): void => {
    const panStep: number = VIEW_WIDTH * KEYBOARD_PAN_FRACTION;
    switch (event.key) {
      case "ArrowLeft":
        hasUserAdjustedView.current = true;
        setView((current: ViewTransform): ViewTransform => {
          return panBy(current, { x: panStep, y: 0 });
        });
        break;
      case "ArrowRight":
        hasUserAdjustedView.current = true;
        setView((current: ViewTransform): ViewTransform => {
          return panBy(current, { x: -panStep, y: 0 });
        });
        break;
      case "ArrowUp":
        hasUserAdjustedView.current = true;
        setView((current: ViewTransform): ViewTransform => {
          return panBy(current, { x: 0, y: panStep });
        });
        break;
      case "ArrowDown":
        hasUserAdjustedView.current = true;
        setView((current: ViewTransform): ViewTransform => {
          return panBy(current, { x: 0, y: -panStep });
        });
        break;
      case "+":
      case "=":
        zoomBy(ZOOM_BUTTON_FACTOR);
        break;
      case "-":
      case "_":
        zoomBy(1 / ZOOM_BUTTON_FACTOR);
        break;
      case "0":
        hasUserAdjustedView.current = false;
        fitToGraph();
        break;
      case "Escape":
        dispatchGesture({ kind: "escape" }, null);
        break;
      default:
        // Every other key belongs to the page, not to the map.
        return;
    }
    event.preventDefault();
  };

  /*
   * ------------------------------------------------------------------
   * Fullscreen
   * ------------------------------------------------------------------
   */

  useEffect(() => {
    const onFullscreenChange: () => void = (): void => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  const toggleFullscreen: () => void = (): void => {
    const element: HTMLDivElement | null = containerRef.current;
    if (!element) {
      return;
    }
    if (document.fullscreenElement === element) {
      document.exitFullscreen().catch(() => {
        // Denied or already exited — nothing useful to tell the user.
      });
      return;
    }
    element.requestFullscreen().catch(() => {
      // Some browsers refuse without a user gesture chain; ignore.
    });
  };

  /*
   * ------------------------------------------------------------------
   * Render
   * ------------------------------------------------------------------
   */

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

  const showLabels: boolean = view.scale >= LABEL_VISIBILITY_MIN_SCALE;
  // Strokes that must stay a constant thickness on screen as the map zooms.
  const hairline: number = 1 / Math.max(view.scale, 0.01);

  const controls: Array<{
    label: string;
    icon: IconProp;
    testId: string;
    disabled: boolean;
    onClick: () => void;
  }> = [
    {
      label: "Zoom in",
      icon: IconProp.MagnifyingGlassPlus,
      testId: "network-topology-zoom-in",
      disabled: false,
      onClick: () => {
        zoomBy(ZOOM_BUTTON_FACTOR);
      },
    },
    {
      label: "Zoom out",
      icon: IconProp.MagnifyingGlassMinus,
      testId: "network-topology-zoom-out",
      disabled: false,
      onClick: () => {
        zoomBy(1 / ZOOM_BUTTON_FACTOR);
      },
    },
    {
      label: "Fit to view",
      icon: IconProp.ViewfinderCircle,
      testId: "network-topology-fit-view",
      disabled: false,
      onClick: () => {
        hasUserAdjustedView.current = false;
        fitToGraph();
      },
    },
    {
      label: "Reset layout",
      icon: IconProp.Refresh,
      testId: "network-topology-reset-layout",
      // Never advertise a control that would do nothing.
      disabled: overrides.size === 0,
      onClick: () => {
        if (props.onPositionOverridesChange) {
          props.onPositionOverridesChange(new Map<string, TopologyPoint>());
        }
        setDragPositions(null);
        hasUserAdjustedView.current = false;
      },
    },
    {
      label: isFullscreen ? "Exit fullscreen" : "Fullscreen",
      icon: IconProp.Expand,
      testId: "network-topology-fullscreen",
      disabled: false,
      onClick: toggleFullscreen,
    },
  ];

  return (
    /*
     * The fullscreen element is the OUTER div, not the canvas. Only what
     * is inside the fullscreen element reaches the top layer, and the
     * legend — the only key to reading the graph — is a sibling of the
     * canvas, so making the canvas fullscreen would leave it behind.
     */
    <div
      ref={containerRef}
      data-testid="network-topology-graph"
      className={
        isFullscreen
          ? "flex h-screen w-screen flex-col bg-white p-2"
          : undefined
      }
    >
      <div
        className="relative w-full overflow-hidden rounded-lg border border-gray-200 bg-white"
        style={{
          height: isFullscreen ? "auto" : "min(72vh, 760px)",
          flex: isFullscreen ? "1 1 auto" : undefined,
          minHeight: "380px",
          touchAction: "none",
        }}
      >
        <div className="absolute right-2 top-2 z-20 flex flex-col rounded-lg border border-gray-200 bg-white/95 p-0.5 shadow-sm backdrop-blur">
          {controls.map(
            (control: {
              label: string;
              icon: IconProp;
              testId: string;
              disabled: boolean;
              onClick: () => void;
            }): ReactElement => {
              return (
                <button
                  key={control.testId}
                  type="button"
                  title={control.label}
                  aria-label={control.label}
                  data-testid={control.testId}
                  disabled={control.disabled}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-default disabled:text-gray-300 disabled:hover:bg-transparent"
                  onClick={control.onClick}
                >
                  <Icon className="h-4 w-4" icon={control.icon} />
                </button>
              );
            },
          )}
        </div>

        {overrides.size > 0 ? (
          <div
            className="pointer-events-none absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700"
            data-testid="network-topology-custom-layout-chip"
          >
            {`Custom layout · ${overrides.size} moved`}
          </div>
        ) : (
          <></>
        )}

        {/*
         * Two different empty states, because two different controls can
         * cause them and each needs its own instruction. A kind or VLAN
         * filter REMOVES nodes and empties the canvas; a search only DIMS,
         * so a search that matches nothing leaves a full map of uniformly
         * greyed nodes — which reads as a broken graph unless it says so.
         */}
        {viewModel.isFilteredEmpty ? (
          <div
            role="status"
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/80 px-6 text-center"
            data-testid="network-topology-filtered-empty"
          >
            {/*
             * An empty canvas because everything is HEALTHY is good news,
             * and reporting good news as "no devices match your filters"
             * over an instruction to go and clear something reads as a
             * fault. The two states share a container and share nothing
             * else.
             */}
            {viewModel.isHealthFilterActive &&
            viewModel.kindFilteredNodeCount > 0 ? (
              <div>
                <div className="flex items-center justify-center gap-2 text-sm font-medium text-gray-900">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100">
                    <Icon
                      className="h-3 w-3 text-green-600"
                      icon={IconProp.CheckCircle}
                    />
                  </span>
                  Nothing needs attention right now
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Every device on this map answered its last poll with all
                  interfaces and links up. Switch back to All to see the whole
                  network.
                </p>
              </div>
            ) : (
              <div>
                <div className="text-sm font-medium text-gray-900">
                  No devices match your filters
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Clear the VLAN filter or re-enable a node type to see the map
                  again.
                </p>
              </div>
            )}
          </div>
        ) : (
          <></>
        )}

        {!viewModel.isFilteredEmpty &&
        props.searchText &&
        viewModel.searchMatchCount === 0 ? (
          <div
            role="status"
            className="pointer-events-none absolute inset-x-0 top-2 z-10 mx-auto w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800"
            data-testid="network-topology-no-search-matches"
          >
            {`Nothing matches "${props.searchText}" — the whole map is dimmed`}
          </div>
        ) : (
          <></>
        )}

        {showLabels ? (
          <></>
        ) : (
          <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-gray-900/80 px-3 py-1 text-xs text-white">
            Zoom in to see device names
          </div>
        )}

        <svg
          ref={svgRef}
          data-testid="network-topology-svg"
          role="application"
          tabIndex={0}
          aria-label="Network topology map. Drag a device to move it. Drag the background to pan. Arrow keys pan, plus and minus zoom, zero fits the graph to the view, Escape cancels."
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          style={{ cursor: gestureCursor }}
          onKeyDown={onKeyDown}
          onPointerDown={(event: React.PointerEvent<SVGSVGElement>) => {
            onPointerDownCapture(event, null);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onPointerCancel}
        >
          <defs>
            {/*
             * The dot grid moves with the content, which is what tells a
             * user the canvas is pannable at all — nothing in the old
             * graph signalled that.
             */}
            <pattern
              id={dotPatternId}
              width={DOT_GRID_SPACING}
              height={DOT_GRID_SPACING}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}
            >
              <circle
                cx={1}
                cy={1}
                r={1}
                fill="var(--ou-chart-grid, #e2e8f0)"
              />
            </pattern>
          </defs>
          <rect
            width={VIEW_WIDTH}
            height={VIEW_HEIGHT}
            fill={`url(#${dotPatternId})`}
            aria-hidden={true}
          />

          <g
            transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}
          >
            {/* Islands and endpoint groups, painted behind everything. */}
            <g aria-hidden={true}>
              {hulls.map(
                (hull: {
                  key: string;
                  x: number;
                  y: number;
                  width: number;
                  height: number;
                  caption: string | null;
                  isDashed: boolean;
                }): ReactElement => {
                  return (
                    <g key={hull.key}>
                      <rect
                        x={hull.x}
                        y={hull.y}
                        width={hull.width}
                        height={hull.height}
                        rx={14}
                        fill="var(--ou-surface-secondary, #f9fafb)"
                        fillOpacity={hull.isDashed ? 0.65 : 0.4}
                        stroke="var(--ou-border-subtle, #e5e7eb)"
                        strokeWidth={1}
                        strokeDasharray={hull.isDashed ? "5 4" : undefined}
                      />
                      {hull.caption ? (
                        <text
                          x={hull.x + 6}
                          y={hull.y - 6}
                          fontSize={12}
                          fontWeight={600}
                          fill="var(--ou-text-muted, #6b7280)"
                        >
                          {hull.caption}
                        </text>
                      ) : (
                        <></>
                      )}
                    </g>
                  );
                },
              )}
            </g>

            {/* Edges below nodes so a node is never covered by a line. */}
            <g>
              {viewModel.edges.map(
                (edgeView: TopologyEdgeView): ReactElement => {
                  const edge: NetworkTopologyEdge | undefined =
                    edgeByPairKey.get(edgeView.key);
                  const isClickable: boolean = Boolean(
                    props.onEdgeClick && edge,
                  );
                  return (
                    <g
                      key={edgeView.key}
                      /*
                       * The gesture machine reads this attribute on
                       * pointerdown; there is deliberately no onClick,
                       * because pointer capture retargets the click away
                       * from this element and it would never fire.
                       */
                      data-topology-edge-key={edgeView.key}
                      data-testid={edgeView.testId}
                      role={isClickable ? "button" : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      aria-label={edgeView.ariaLabel}
                      opacity={edgeView.isDimmed ? 0.15 : 1}
                      style={isClickable ? { cursor: "pointer" } : undefined}
                      onKeyDown={
                        isClickable
                          ? (event: React.KeyboardEvent<SVGGElement>) => {
                              if (event.key !== "Enter" && event.key !== " ") {
                                return;
                              }
                              event.preventDefault();
                              event.stopPropagation();
                              props.onEdgeClick!(edge!);
                            }
                          : undefined
                      }
                    >
                      {/* Wide invisible line so thin edges stay clickable. */}
                      <line
                        x1={edgeView.x1}
                        y1={edgeView.y1}
                        x2={edgeView.x2}
                        y2={edgeView.y2}
                        stroke="transparent"
                        strokeWidth={12 * hairline}
                      />
                      <line
                        x1={edgeView.x1}
                        y1={edgeView.y1}
                        x2={edgeView.x2}
                        y2={edgeView.y2}
                        stroke={edgeView.color}
                        strokeWidth={
                          edgeView.isSelected
                            ? edgeView.strokeWidth + 2
                            : edgeView.strokeWidth
                        }
                        strokeDasharray={edgeView.strokeDashArray}
                        strokeLinecap="round"
                      />
                    </g>
                  );
                },
              )}
            </g>

            {/* Nodes. */}
            <g>
              {viewModel.nodes.map(
                (nodeView: TopologyNodeView): ReactElement => {
                  const footprint: TopologyNodeFootprint = nodeView.footprint;
                  const isEndpoint: boolean = nodeView.kind === "endpoint";
                  return (
                    <g
                      key={nodeView.id}
                      data-testid={nodeView.testId}
                      data-topology-node-id={nodeView.id}
                      data-x={Math.round(nodeView.x)}
                      data-y={Math.round(nodeView.y)}
                      role="button"
                      tabIndex={0}
                      aria-label={nodeView.ariaLabel}
                      opacity={nodeView.isDimmed ? 0.2 : 1}
                      style={{ cursor: "grab" }}
                      onPointerDown={(
                        event: React.PointerEvent<SVGGElement>,
                      ) => {
                        onPointerDownCapture(event, nodeView.id);
                      }}
                      onPointerMove={(
                        event: React.PointerEvent<SVGGElement>,
                      ) => {
                        onPointerMove(event, true);
                      }}
                      onPointerUp={(event: React.PointerEvent<SVGGElement>) => {
                        onPointerUp(event, true);
                      }}
                      onPointerCancel={(
                        event: React.PointerEvent<SVGGElement>,
                      ) => {
                        onPointerCancel(event, true);
                      }}
                      onLostPointerCapture={(
                        event: React.PointerEvent<SVGGElement>,
                      ) => {
                        onPointerCancel(event, true);
                      }}
                      onPointerEnter={() => {
                        setHoveredNodeId(nodeView.id);
                      }}
                      onPointerLeave={() => {
                        setHoveredNodeId(
                          (current: string | null): string | null => {
                            return current === nodeView.id ? null : current;
                          },
                        );
                      }}
                      onKeyDown={(event: React.KeyboardEvent<SVGGElement>) => {
                        if (event.key !== "Enter" && event.key !== " ") {
                          return;
                        }
                        event.preventDefault();
                        const node: NetworkTopologyNode | undefined =
                          nodeById.get(nodeView.id);
                        if (node && props.onNodeClick) {
                          props.onNodeClick(node);
                        }
                      }}
                    >
                      <title>{nodeView.tooltip}</title>

                      {/*
                       * The attention halo. Only ever drawn while a health
                       * filter is on: a permanent ring around every
                       * unhealthy device would be a second status
                       * encoding competing with the fill colour, and the
                       * whole point of the filter is that the map stops
                       * needing to be scanned. Under a filter it is the
                       * opposite — the survivors include dimmed context
                       * neighbours, and without a ring the matches are
                       * indistinguishable from them at a glance.
                       */}
                      {viewModel.isHealthFilterActive &&
                      nodeView.isHealthMatch ? (
                        <circle
                          cx={nodeView.x}
                          cy={nodeView.y}
                          r={
                            Math.max(
                              footprint.halfWidth,
                              footprint.halfHeight,
                            ) + 5
                          }
                          fill={HEALTH_STATE_COLORS[nodeView.health]}
                          fillOpacity={0.16}
                          stroke={HEALTH_STATE_COLORS[nodeView.health]}
                          strokeOpacity={0.55}
                          strokeWidth={1.5 * hairline}
                          pointerEvents="none"
                          data-testid={`network-topology-attention-halo-${nodeView.id}`}
                        />
                      ) : (
                        <></>
                      )}

                      {nodeView.isSelected ? (
                        <circle
                          cx={nodeView.x}
                          cy={nodeView.y}
                          r={
                            Math.max(
                              footprint.halfWidth,
                              footprint.halfHeight,
                            ) + 6
                          }
                          fill="none"
                          stroke="var(--ou-link, #4f46e5)"
                          strokeWidth={2 * hairline}
                          pointerEvents="none"
                        />
                      ) : (
                        <></>
                      )}
                      {nodeView.isPinned ? (
                        <circle
                          cx={nodeView.x}
                          cy={nodeView.y}
                          r={
                            Math.max(
                              footprint.halfWidth,
                              footprint.halfHeight,
                            ) + 3
                          }
                          fill="none"
                          stroke="var(--ou-link, #4f46e5)"
                          strokeOpacity={0.45}
                          strokeWidth={1.5}
                          strokeDasharray="2 2"
                          pointerEvents="none"
                        />
                      ) : (
                        <></>
                      )}

                      {renderNodeSilhouette(nodeView)}

                      {nodeView.badge && showLabels ? (
                        <text
                          x={nodeView.x}
                          y={nodeView.y + footprint.shape.badgeBaselineOffset}
                          textAnchor="middle"
                          fontSize={9}
                          fontWeight={600}
                          fill={
                            nodeView.kind === "device"
                              ? "#ffffff"
                              : "var(--ou-text-secondary, #374151)"
                          }
                          pointerEvents="none"
                        >
                          {nodeView.badge}
                        </text>
                      ) : (
                        <></>
                      )}

                      {showLabels ? (
                        <text
                          x={nodeView.x}
                          /*
                           * From the footprint, not from a constant: a
                           * diamond stands taller than the circle these
                           * offsets were written for, and the layout has
                           * already reserved room at exactly this baseline.
                           */
                          y={nodeView.y + footprint.labelBaselineOffset}
                          textAnchor="middle"
                          fontSize={isEndpoint ? 10 : 12}
                          fill="var(--ou-text-secondary, #374151)"
                          /*
                           * A halo drawn behind the glyphs (paint-order
                           * puts the stroke first) is what keeps a label
                           * readable where it crosses a link. Dividing by
                           * the view scale holds it at a constant three
                           * screen pixels at any zoom.
                           */
                          stroke="var(--ou-surface-primary, #ffffff)"
                          strokeWidth={3 * hairline}
                          strokeLinejoin="round"
                          paintOrder="stroke"
                          pointerEvents="none"
                        >
                          {nodeView.labelLines.map(
                            (line: string, lineIndex: number): ReactElement => {
                              return (
                                <tspan
                                  key={`${nodeView.id}-label-${lineIndex}`}
                                  x={nodeView.x}
                                  dy={
                                    lineIndex === 0 ? 0 : isEndpoint ? 11 : 13
                                  }
                                >
                                  {line}
                                </tspan>
                              );
                            },
                          )}
                        </text>
                      ) : (
                        <></>
                      )}
                    </g>
                  );
                },
              )}
            </g>
          </g>
        </svg>
      </div>

      {/*
       * A real legend, not prose in the card description — Card renders
       * its description `hidden md:block`, so on a phone the only key to
       * reading the graph did not exist at all.
       */}
      <ul
        role="list"
        aria-label="Topology key"
        data-testid="network-topology-legend"
        className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-gray-100 px-3 py-2.5 text-xs text-gray-600"
      >
        {legend.map((entry: TopologyLegendEntry): ReactElement => {
          return (
            <li
              key={`${entry.group}-${entry.label}`}
              className="flex items-center gap-1.5"
            >
              <svg
                width={LEGEND_SWATCH_WIDTH}
                height={LEGEND_SWATCH_HEIGHT}
                aria-hidden={true}
              >
                {renderLegendSwatch(entry)}
              </svg>
              <span>
                <span className="text-gray-400">{`${entry.group}: `}</span>
                {entry.label}
              </span>
            </li>
          );
        })}
      </ul>
      {/*
       * Outside the legend list — it is a live count, not a key, and as a
       * list item it was announced as "item 12 of Topology key". role
       * status also means a screen reader hears it change when a filter
       * removes devices.
       */}
      <p
        role="status"
        data-testid="network-topology-visible-count"
        className="mt-1 px-3 text-xs text-gray-400"
      >
        {`Showing ${viewModel.visibleNodeCount} of ${viewModel.totalNodeCount} devices`}
      </p>
    </div>
  );
};

export default NetworkDeviceGraph;
