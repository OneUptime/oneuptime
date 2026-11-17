import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import NetworkTopology, {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  TopologyGroupBox,
  TopologyHierarchy,
  TopologyLayoutModel,
  TopologyLeafBlock,
} from "../NetworkDevice/TopologyLayout";
import { TopologyPoint } from "../NetworkDevice/TopologyGraphUtil";
import {
  TOPOLOGY_DRAWING_STYLE,
  TOPOLOGY_VIEW_HEIGHT,
  TOPOLOGY_VIEW_WIDTH,
  TopologyHullView,
  attentionHaloRadiusFor,
  buildTopologyHulls,
  combPathData,
  computeTopologyLayoutModel,
  glyphFillOpacityFor,
  glyphStrokeWidthFor,
  labelFontSizeFor,
  labelLineHeightFor,
} from "./NetworkTopologyDrawing";
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
  TopologyCombView,
  TopologyEdgeView,
  TopologyNodeKind,
  TopologyNodeView,
  TopologyViewModel,
  buildTopologyViewModel,
  kindOfNode,
  topologyStructuralSignature,
} from "./NetworkTopologyViewModel";
import {
  TopologyLegendEntry,
  buildTopologyLegend,
  edgeKeyForEdge,
  nodeMatchesSearch,
} from "./NetworkTopologyMeta";
import {
  BranchToggleNode,
  BranchToggleView,
  EMPTY_COLLAPSED_BRANCHES,
  ancestorIdsOf,
  branchNodeIdsOf,
  buildBranchToggles,
  canCollapseMore,
  canExpandMore,
  collapseAllBranches,
  collapsedBranchesSignature,
  expandAllBranches,
  hasBranch,
  revealNodes,
  searchPathNodeIdsFor,
  toggleCollapsedBranch,
} from "./TopologyBranches";
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
  fitViewToBoundsWithin,
  normalizeWheelDeltaPx,
  panBy,
  screenToViewBox,
  viewCenteredOn,
  viewKeepingPointFixed,
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
import NetworkTopologyEmptyState from "./NetworkTopologyEmptyState";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  /*
   * Hands the parent the layout this graph is drawing, every time it is
   * recomputed. The PDF export draws from exactly this model: the layout
   * is only recomputed when the graph's SHAPE changes (see the memo
   * below), so recomputing it for the export could place a device whose
   * role changed since somewhere the map on screen does not.
   */
  onLayoutModelChange?: ((model: TopologyLayoutModel) => void) | undefined;
  /*
   * Issue #6606: the branches the reader folded away. Only the parent-child
   * layout draws branches, so every other layout ignores the set. Owned by
   * the parent so it survives a remount and can be remembered and pruned.
   */
  collapsedNodeIds?: ReadonlySet<string> | undefined;
  onCollapsedNodeIdsChange?: ((next: ReadonlySet<string>) => void) | undefined;
  /*
   * Issue #6606: the device whose branch the map is narrowed to - the
   * device and everything below it - or null for the whole map. Parent-
   * child layout only. The device drawer sets it; the map's own path
   * control moves it up the tree or clears it.
   */
  focusedBranchNodeId?: string | null | undefined;
  onFocusedBranchChange?: ((nodeId: string | null) => void) | undefined;
  /*
   * Issue #6606: draw the layout as computed, without the reader's dragged
   * positions - which are kept, not discarded, and come back the moment
   * this is switched off. Devices cannot be dragged while it is on.
   */
  isShowingOriginalLayout?: boolean | undefined;
  onShowOriginalLayoutChange?: ((isShowing: boolean) => void) | undefined;
  /*
   * Issue #6606: goes up by one each time the reader asks for the next
   * search match from outside the map (Enter in the search box).
   */
  locateNextMatchRequest?: number | undefined;
}

/*
 * A fixed viewBox in every layout mode. The old component grew the
 * viewBox with the tiered layout up to a hard cap, which meant a tall
 * graph rendered at a third of its size between two wide empty bars and
 * anything past the cap was simply unreachable. The viewBox is now
 * constant and the VIEW zooms to fit whatever the layout produced. It is
 * also the frame every layout is computed for (NetworkTopologyDrawing).
 */
const VIEW_WIDTH: number = TOPOLOGY_VIEW_WIDTH;
const VIEW_HEIGHT: number = TOPOLOGY_VIEW_HEIGHT;
const VIEW_BOX: ViewBoxSize = { width: VIEW_WIDTH, height: VIEW_HEIGHT };

const ZOOM_BUTTON_FACTOR: number = 1.3;
const WHEEL_ZOOM_SENSITIVITY: number = 0.0015;
// Trackpad pinch arrives as a ctrl-modified wheel and needs a firmer ramp.
const WHEEL_PINCH_SENSITIVITY: number = 0.01;
const KEYBOARD_PAN_FRACTION: number = 0.2;
const DOT_GRID_SPACING: number = 16;
// Padding, in world units, left around the graph when fitting it.
const FIT_BOUNDS_PADDING: number = 40;
/*
 * Issue #6606: how long the search box rests before the map moves to what
 * it found - long enough that typing a name does not drag the camera
 * around letter by letter.
 */
const SEARCH_FRAME_DELAY_MS: number = 350;
// The closest a search frames its matches: a lone match is not blown up.
const SEARCH_FRAME_MAX_SCALE: number = 1.2;
// The zoom "next match" moves in to at least: where a name can be read.
const LOCATE_MIN_SCALE: number = 1;
/*
 * The fold control under a branch node, in screen pixels: it stays the
 * size of a control however far the map is zoomed.
 */
const BRANCH_TOGGLE_RADIUS_PX: number = 8;
const BRANCH_TOGGLE_GAP_PX: number = 5;
const BRANCH_TOGGLE_FONT_PX: number = 10.5;
// Mean digit advance at that size, for the folded count's pill.
const BRANCH_TOGGLE_CHAR_PX: number = 6.6;

/*
 * Unique per mount so two graphs on one page cannot share a <pattern> id.
 * A counter rather than Math.random, which is banned here.
 */
let graphInstanceCounter: number = 0;

const emptyOverrides: PositionOverrides = new Map<string, TopologyPoint>();

// The ring around the search match "next match" moved to (issue #6606).
const LOCATED_RING_COLOR: string = "#f59e0b";

/*
 * The plural sentences the map says about a search (issue #6606). Kept as
 * constants so the lookups below read as sentences.
 */
const MATCH_COUNT: { one: string; other: string } = {
  one: "{{count}} match",
  other: "{{count}} matches",
};

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
  // Shared with the PDF export, which paints the same glyphs.
  const fillOpacity: number = glyphFillOpacityFor(nodeView.kind);
  const strokeWidth: number = glyphStrokeWidthFor(nodeView.kind);
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
  const translator: Translator = useTranslator();
  const nodes: Array<NetworkTopologyNode> = props.topology?.nodes || [];
  const edges: Array<NetworkTopologyEdge> = props.topology?.edges || [];
  const layoutMode: TopologyLayoutMode = props.layoutMode || "force";
  const overrides: PositionOverrides =
    props.positionOverrides || emptyOverrides;
  const isParentChild: boolean = layoutMode === "parentChild";
  /*
   * Issue #6606: the original layout is the map as computed. The reader's
   * dragged positions are kept - they are the parent's - just not applied,
   * so switching back puts every device where it was left.
   */
  const isShowingOriginalLayout: boolean = Boolean(
    props.isShowingOriginalLayout && overrides.size > 0,
  );
  const drawnOverrides: PositionOverrides = isShowingOriginalLayout
    ? emptyOverrides
    : overrides;
  // Folded branches mean something only where branches are drawn.
  const collapsedNodeIds: ReadonlySet<string> = isParentChild
    ? props.collapsedNodeIds || EMPTY_COLLAPSED_BRANCHES
    : EMPTY_COLLAPSED_BRANCHES;
  const collapsedSignature: string =
    collapsedBranchesSignature(collapsedNodeIds);
  const searchText: string = (props.searchText || "").trim();
  const visibleKinds: ReadonlySet<TopologyNodeKind> =
    props.visibleKinds || ALL_NODE_KINDS;

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
    return computeTopologyLayoutModel(layoutMode, nodes, edges, {
      collapsedNodeIds: collapsedNodeIds,
    });
    /*
     * `nodes`/`edges` are intentionally not dependencies: the signature
     * already captures every property of them the layout reads, and
     * depending on the arrays themselves would recompute on every poll.
     * The folded branches are keyed by their signature for the same
     * reason: a new set naming the same branches is the same layout.
     */
  }, [structuralSignature, layoutMode, collapsedSignature]);

  /*
   * Report the model to the parent, which exports exactly what is drawn
   * here. Through a ref, so a parent that hands over a fresh callback on
   * every render does not re-run this for a model that has not changed.
   */
  const onLayoutModelChangeRef: React.MutableRefObject<
    ((model: TopologyLayoutModel) => void) | undefined
  > = useRef<((model: TopologyLayoutModel) => void) | undefined>(
    props.onLayoutModelChange,
  );
  onLayoutModelChangeRef.current = props.onLayoutModelChange;
  useEffect(() => {
    onLayoutModelChangeRef.current?.(baseModel);
  }, [baseModel]);

  const positions: Map<string, TopologyPoint> = useMemo(() => {
    const withUserPositions: Map<string, TopologyPoint> =
      mergePositionOverrides(baseModel.positions, drawnOverrides);
    if (!dragPositions) {
      return withUserPositions;
    }
    return mergePositionOverrides(withUserPositions, dragPositions);
  }, [baseModel, drawnOverrides, dragPositions]);

  // The hierarchy the parent-child layout drew; undefined in every other one.
  const hierarchy: TopologyHierarchy | undefined = isParentChild
    ? baseModel.hierarchy
    : undefined;

  /*
   * Issue #6606: one branch on its own. The device and everything below it
   * are drawn where the whole map puts them, and nothing else is - so the
   * branch is the same picture as on the whole map, dragged positions and
   * all, and the camera frames it. A device that has left the network, or
   * that a folded branch above it hides, narrows nothing.
   */
  const focusedBranchNodeId: string | null =
    props.focusedBranchNodeId &&
    hasBranch(hierarchy, props.focusedBranchNodeId) &&
    positions.has(props.focusedBranchNodeId)
      ? props.focusedBranchNodeId
      : null;

  const focusedBranchIds: ReadonlySet<string> | null = useMemo(() => {
    if (!hierarchy || !focusedBranchNodeId) {
      return null;
    }
    return branchNodeIdsOf(hierarchy, focusedBranchNodeId);
  }, [hierarchy, focusedBranchNodeId]);

  const drawnPositions: Map<string, TopologyPoint> = useMemo(() => {
    if (!focusedBranchIds) {
      return positions;
    }
    const inBranch: Map<string, TopologyPoint> = new Map<
      string,
      TopologyPoint
    >();
    for (const [nodeId, point] of positions) {
      if (focusedBranchIds.has(nodeId)) {
        inBranch.set(nodeId, point);
      }
    }
    return inBranch;
  }, [positions, focusedBranchIds]);

  /*
   * Issue #6606: every node the search matches, drawn or not. The drawn ones
   * the view model counts; this list is for what the map cannot show - a
   * match inside a folded branch, or outside the branch in focus - and for
   * lighting the path down to each match.
   */
  const allSearchMatchIds: Array<string> = useMemo(() => {
    if (!searchText) {
      return [];
    }
    const matchIds: Array<string> = [];
    for (const node of nodes) {
      if (
        node &&
        typeof node.id === "string" &&
        visibleKinds.has(kindOfNode(node)) &&
        nodeMatchesSearch(node, searchText)
      ) {
        matchIds.push(node.id);
      }
    }
    return matchIds;
  }, [nodes, searchText, visibleKinds]);

  /*
   * In the parent-child layout a search keeps the path from the top of the
   * tree down to each match bright: "where is it" is answered by where it
   * hangs. A folded branch that holds a match is on that path, so it stays
   * bright too.
   */
  const searchContextNodeIds: ReadonlySet<string> | undefined = useMemo(() => {
    if (!hierarchy || allSearchMatchIds.length === 0) {
      return undefined;
    }
    return searchPathNodeIdsFor(hierarchy, allSearchMatchIds);
  }, [hierarchy, allSearchMatchIds]);

  const hiddenSearchMatchIds: Array<string> = useMemo(() => {
    if (!hierarchy) {
      return [];
    }
    return allSearchMatchIds.filter((nodeId: string): boolean => {
      return !drawnPositions.has(nodeId) && hierarchy.childrenById.has(nodeId);
    });
  }, [hierarchy, allSearchMatchIds, drawnPositions]);

  // The search match "next match" last moved to, if any (issue #6606).
  const [locatedMatchId, setLocatedMatchId] = useState<string | null>(null);
  /*
   * The fold control that has the keyboard's focus, if it got there from the
   * keyboard: an SVG element draws no focus ring of its own, so the map
   * draws one (issue #6606).
   */
  const [keyboardFocusedToggleId, setKeyboardFocusedToggleId] = useState<
    string | null
  >(null);

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
    return new Set<string>(drawnOverrides.keys());
  }, [drawnOverrides]);

  const viewModel: TopologyViewModel = useMemo(() => {
    return buildTopologyViewModel({
      nodes: nodes,
      edges: edges,
      positions: drawnPositions,
      searchText: props.searchText || "",
      visibleKinds: visibleKinds,
      healthFilterMode: props.healthFilterMode || "all",
      focusNodeIds: focusNodeIds,
      selectedNodeId: props.selectedNodeId || null,
      selectedEdgeKey: props.selectedEdgeKey || null,
      pinnedNodeIds: pinnedNodeIds,
      searchContextNodeIds: searchContextNodeIds,
      locatedNodeId: locatedMatchId,
      leafBlocks: baseModel.leafBlocks,
      layoutPositions: baseModel.positions,
    });
  }, [
    nodes,
    edges,
    drawnPositions,
    props.searchText,
    visibleKinds,
    props.healthFilterMode,
    focusNodeIds,
    props.selectedNodeId,
    props.selectedEdgeKey,
    pinnedNodeIds,
    searchContextNodeIds,
    locatedMatchId,
    baseModel,
  ]);

  /*
   * Issue #6606: the fold control under each branch node, counting what a
   * folded one holds among the node types the reader has on.
   */
  const branchToggles: Array<BranchToggleView> = useMemo(() => {
    if (!hierarchy) {
      return [];
    }
    return buildBranchToggles({
      hierarchy: hierarchy,
      drawnNodes: viewModel.nodes.map(
        (nodeView: TopologyNodeView): BranchToggleNode => {
          return {
            id: nodeView.id,
            x: nodeView.x,
            y: nodeView.y,
            labelBottom: nodeView.footprint.labelBottom,
            isDimmed: nodeView.isDimmed,
          };
        },
      ),
      nameOf: (nodeId: string): string => {
        return nodeById.get(nodeId)?.name || nodeId;
      },
      isCounted: (nodeId: string): boolean => {
        const node: NetworkTopologyNode | undefined = nodeById.get(nodeId);
        return Boolean(node) && visibleKinds.has(kindOfNode(node!));
      },
    });
  }, [hierarchy, viewModel, nodeById, visibleKinds]);

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
   * group, one for the unlinked strip — re-derived from where the member
   * nodes are actually drawn (see buildTopologyHulls, which the PDF export
   * draws from too).
   */
  const hulls: Array<TopologyHullView> = useMemo(() => {
    return buildTopologyHulls(baseModel, viewModel.nodes);
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
   * Issue #6606: narrowing the map to one branch - or widening it again - is
   * the same kind of question, and the answer is framed the same way.
   */
  useEffect(() => {
    hasUserAdjustedView.current = false;
  }, [focusedBranchNodeId]);

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
    focusedBranchNodeId,
    viewModel.nodes.length,
  ]);

  /*
   * ------------------------------------------------------------------
   * Finding a device (issue #6606)
   * ------------------------------------------------------------------
   *
   * Search used to dim everything else and leave the camera where it was,
   * so on a large map the one bright device could be off screen, or a dot
   * too small to see. Now the camera goes to what the search found: once
   * the reader stops typing it frames every match, and "next match" - the
   * arrows on the map, or Enter in the search box - centres each one in
   * turn at a size its name can be read, ringed so the eye lands on it.
   */

  // The latest of everything a timer or a callback reads, never stale.
  const viewModelRef: React.MutableRefObject<TopologyViewModel> =
    useRef<TopologyViewModel>(viewModel);
  viewModelRef.current = viewModel;
  const fitToGraphRef: React.MutableRefObject<() => void> =
    useRef<() => void>(fitToGraph);
  fitToGraphRef.current = fitToGraph;
  const locatedMatchIdRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(locatedMatchId);
  locatedMatchIdRef.current = locatedMatchId;

  // True while the camera is where a search put it.
  const isFramedBySearch: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const searchFrameTimer: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Frame the matches once the map has redrawn (after "Show N more").
  const isSearchFramePending: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const frameSearchMatches: () => boolean = (): boolean => {
    const current: TopologyViewModel = viewModelRef.current;
    const matchIds: Set<string> = new Set<string>(current.searchMatchNodeIds);
    if (matchIds.size === 0) {
      return false;
    }
    const points: Array<WorldPoint> = [];
    for (const nodeView of current.nodes) {
      if (matchIds.has(nodeView.id)) {
        points.push({ x: nodeView.x, y: nodeView.y });
      }
    }
    hasUserAdjustedView.current = true;
    isFramedBySearch.current = true;
    applyView(
      fitViewToBoundsWithin(
        computeGraphBounds(points, FIT_BOUNDS_PADDING * 2),
        VIEW_BOX,
        SEARCH_FRAME_MAX_SCALE,
      ),
    );
    return true;
  };

  useEffect(() => {
    setLocatedMatchId(null);
    if (searchFrameTimer.current) {
      clearTimeout(searchFrameTimer.current);
    }
    searchFrameTimer.current = setTimeout(() => {
      searchFrameTimer.current = null;
      if (searchText) {
        frameSearchMatches();
        return;
      }
      /*
       * The search was cleared: back to the whole map, if a search is what
       * moved the camera. A reader who framed it themselves keeps theirs.
       */
      if (isFramedBySearch.current) {
        isFramedBySearch.current = false;
        hasUserAdjustedView.current = false;
        fitToGraphRef.current();
      }
    }, SEARCH_FRAME_DELAY_MS);
    return () => {
      if (searchFrameTimer.current) {
        clearTimeout(searchFrameTimer.current);
        searchFrameTimer.current = null;
      }
    };
    // Only the text decides when to look: the matches are read when it fires.
  }, [searchText]);

  useEffect(() => {
    if (!isSearchFramePending.current) {
      return;
    }
    isSearchFramePending.current = false;
    frameSearchMatches();
  }, [viewModel]);

  const locateMatch: (direction: 1 | -1) => void = (
    direction: 1 | -1,
  ): void => {
    const current: TopologyViewModel = viewModelRef.current;
    const matchIds: Array<string> = current.searchMatchNodeIds;
    if (matchIds.length === 0) {
      return;
    }
    // A pending "frame them all" would undo the step the reader just took.
    if (searchFrameTimer.current) {
      clearTimeout(searchFrameTimer.current);
      searchFrameTimer.current = null;
    }
    const currentIndex: number = locatedMatchIdRef.current
      ? matchIds.indexOf(locatedMatchIdRef.current)
      : -1;
    const nextIndex: number =
      currentIndex < 0
        ? direction > 0
          ? 0
          : matchIds.length - 1
        : (currentIndex + direction + matchIds.length) % matchIds.length;
    const nextId: string = matchIds[nextIndex]!;
    const nodeView: TopologyNodeView | undefined = current.nodes.find(
      (candidate: TopologyNodeView): boolean => {
        return candidate.id === nextId;
      },
    );
    if (!nodeView) {
      return;
    }
    locatedMatchIdRef.current = nextId;
    setLocatedMatchId(nextId);
    hasUserAdjustedView.current = true;
    isFramedBySearch.current = true;
    setView((view: ViewTransform): ViewTransform => {
      return viewCenteredOn(
        { x: nodeView.x, y: nodeView.y },
        Math.max(view.scale, LOCATE_MIN_SCALE),
        VIEW_BOX,
      );
    });
  };

  // Enter in the search box, from outside the map.
  const lastLocateRequest: React.MutableRefObject<number | undefined> = useRef<
    number | undefined
  >(props.locateNextMatchRequest);
  useEffect(() => {
    if (
      props.locateNextMatchRequest === undefined ||
      props.locateNextMatchRequest === lastLocateRequest.current
    ) {
      return;
    }
    lastLocateRequest.current = props.locateNextMatchRequest;
    locateMatch(1);
  }, [props.locateNextMatchRequest]);

  /*
   * "Show N more": open the folded branches the hidden matches are in, and
   * widen the map to all of it when they are outside the branch in focus -
   * then frame the matches once the map has redrawn with them on it.
   */
  const revealHiddenMatches: () => void = (): void => {
    if (!hierarchy || hiddenSearchMatchIds.length === 0) {
      return;
    }
    const nextCollapsed: ReadonlySet<string> = revealNodes(
      collapsedNodeIds,
      hierarchy,
      hiddenSearchMatchIds,
    );
    if (nextCollapsed !== collapsedNodeIds) {
      props.onCollapsedNodeIdsChange?.(nextCollapsed);
    }
    if (
      focusedBranchIds &&
      hiddenSearchMatchIds.some((nodeId: string): boolean => {
        return !focusedBranchIds.has(nodeId);
      })
    ) {
      props.onFocusedBranchChange?.(null);
    }
    isSearchFramePending.current = true;
  };

  /*
   * ------------------------------------------------------------------
   * Folding branches (issue #6606)
   * ------------------------------------------------------------------
   */

  /*
   * Folding a branch gives its room back to its neighbours, so the tree
   * re-flows - and the device the reader just pressed would slide away
   * under the cursor. Its position before the fold is kept here, and once
   * the map has redrawn the camera moves by however far it went, so it
   * stays exactly where it was on screen. Only when the reader framed the
   * map themselves: a map still fitted to the screen simply fits again.
   */
  const foldAnchor: React.MutableRefObject<{
    nodeId: string;
    before: WorldPoint;
  } | null> = useRef<{ nodeId: string; before: WorldPoint } | null>(null);

  useLayoutEffect(() => {
    const anchor: { nodeId: string; before: WorldPoint } | null =
      foldAnchor.current;
    if (!anchor) {
      return;
    }
    foldAnchor.current = null;
    const after: TopologyPoint | undefined = drawnPositions.get(anchor.nodeId);
    if (!after) {
      return;
    }
    setView((view: ViewTransform): ViewTransform => {
      return viewKeepingPointFixed(view, anchor.before, after);
    });
  }, [drawnPositions]);

  const toggleBranch: (nodeId: string) => void = (nodeId: string): void => {
    if (!props.onCollapsedNodeIdsChange) {
      return;
    }
    const before: TopologyPoint | undefined = drawnPositions.get(nodeId);
    foldAnchor.current =
      before && hasUserAdjustedView.current
        ? { nodeId: nodeId, before: { x: before.x, y: before.y } }
        : null;
    props.onCollapsedNodeIdsChange(
      toggleCollapsedBranch(collapsedNodeIds, nodeId),
    );
  };

  /*
   * Collapse all folds every branch below the top of each tree, so the map
   * becomes the network's outline, each branch with a count of what it
   * holds; Expand all opens them again. Narrowed to one branch, both work
   * inside that branch only - folding the branch in focus would leave a
   * single device on the screen, and a fold outside it changes nothing
   * anybody can see (TopologyBranches).
   */
  const collapseAll: () => void = (): void => {
    if (!hierarchy || !props.onCollapsedNodeIdsChange) {
      return;
    }
    foldAnchor.current = null;
    hasUserAdjustedView.current = false;
    props.onCollapsedNodeIdsChange(
      collapseAllBranches(hierarchy, collapsedNodeIds, focusedBranchNodeId),
    );
  };

  const expandAll: () => void = (): void => {
    if (!hierarchy || !props.onCollapsedNodeIdsChange) {
      return;
    }
    foldAnchor.current = null;
    hasUserAdjustedView.current = false;
    props.onCollapsedNodeIdsChange(
      expandAllBranches(hierarchy, collapsedNodeIds, focusedBranchNodeId),
    );
  };

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
    useRef<Map<string, TopologyPoint>>(drawnPositions);
  positionsRef.current = drawnPositions;

  /*
   * Which nodes travel with a grabbed one. In tiered mode a switch brings
   * its block of endpoints, because dragging a switch out of a group and
   * leaving its devices behind would take the arrangement apart faster
   * than the user can build it.
   */
  const nodeIdsMovedWith: (nodeId: string) => ReadonlyArray<string> = (
    nodeId: string,
  ): ReadonlyArray<string> => {
    /*
     * The original layout is for looking (issue #6606): it shows the map as
     * computed while the reader's own arrangement waits, and a drag here
     * would have to either change an arrangement nobody can see or throw
     * it away. Nothing moves until the reader's layout is back.
     */
    if (isShowingOriginalLayout) {
      return [];
    }
    /*
     * In the parent-child layout a node brings its leaf block (issue #6606),
     * for the same reason a switch brings its endpoints in tiered mode: the
     * grid is that node's devices, and the comb that wires them to it stays
     * drawn only while they keep their place beside it.
     */
    if (layoutMode === "parentChild") {
      const block: TopologyLeafBlock | undefined = (
        baseModel.leafBlocks || []
      ).find((candidate: TopologyLeafBlock): boolean => {
        return candidate.parentId === nodeId;
      });
      if (!block) {
        return [nodeId];
      }
      return [
        nodeId,
        ...block.memberIds.filter((memberId: string): boolean => {
          return positionsRef.current.has(memberId);
        }),
      ];
    }
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
    return <NetworkTopologyEmptyState footer={props.emptyStateFooter} />;
  }

  const showLabels: boolean = view.scale >= LABEL_VISIBILITY_MIN_SCALE;
  // Strokes that must stay a constant thickness on screen as the map zooms.
  const hairline: number = 1 / Math.max(view.scale, 0.01);

  /*
   * One fold control (issue #6606), hung under its node's name on the line
   * down to its children - where an org chart puts it. Sized in screen
   * pixels, so it stays a control at any zoom: an open branch is a small
   * "−", a folded one a pill with how many devices it holds.
   */
  const renderBranchToggle: (toggle: BranchToggleView) => ReactElement = (
    toggle: BranchToggleView,
  ): ReactElement => {
    const radius: number = BRANCH_TOGGLE_RADIUS_PX * hairline;
    const centreY: number =
      toggle.labelBottomY +
      (BRANCH_TOGGLE_GAP_PX + BRANCH_TOGGLE_RADIUS_PX) * hairline;
    // A sign and a count, in the reader's digits: nothing in it to word.
    const countText: string = toggle.isCollapsed
      ? `+${translator.formatNumber(toggle.hiddenCount)}`
      : "";
    const pillHalfWidth: number = toggle.isCollapsed
      ? Math.max(
          radius,
          ((countText.length * BRANCH_TOGGLE_CHAR_PX) / 2 + 7) * hairline,
        )
      : radius;
    const label: string = toggle.isCollapsed
      ? translator.translatePlural(
          {
            one: "Expand {{name}}: {{count}} device below it",
            other: "Expand {{name}}: {{count}} devices below it",
          },
          toggle.hiddenCount,
          { name: toggle.name },
        )
      : translator.translateTemplate("Collapse {{name}}", {
          name: toggle.name,
        });

    return (
      <g
        key={toggle.nodeId}
        role="button"
        tabIndex={0}
        aria-expanded={!toggle.isCollapsed}
        aria-label={label}
        data-testid={`network-topology-branch-toggle-${toggle.nodeId}`}
        data-collapsed={toggle.isCollapsed ? "true" : "false"}
        opacity={toggle.isDimmed ? TOPOLOGY_DRAWING_STYLE.dimmedNodeOpacity : 1}
        style={{ cursor: "pointer" }}
        /*
         * Kept from the canvas: a press here is a click on the control,
         * never the start of a pan or of a drag of the node above it.
         */
        onPointerDown={(event: React.PointerEvent<SVGGElement>) => {
          event.stopPropagation();
        }}
        onClick={(event: React.MouseEvent<SVGGElement>) => {
          event.stopPropagation();
          toggleBranch(toggle.nodeId);
        }}
        onKeyDown={(event: React.KeyboardEvent<SVGGElement>) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          toggleBranch(toggle.nodeId);
        }}
        onFocus={(event: React.FocusEvent<SVGGElement>) => {
          /*
           * Only focus the keyboard brought here: a click focuses the
           * control too, and a ring left behind by every click would read
           * as a selection.
           */
          let isKeyboardFocus: boolean = false;
          try {
            isKeyboardFocus = event.currentTarget.matches(":focus-visible");
          } catch {
            // A browser that cannot answer draws no ring.
          }
          if (isKeyboardFocus) {
            setKeyboardFocusedToggleId(toggle.nodeId);
          }
        }}
        onBlur={() => {
          setKeyboardFocusedToggleId(
            (current: string | null): string | null => {
              return current === toggle.nodeId ? null : current;
            },
          );
        }}
      >
        <title>{label}</title>
        {keyboardFocusedToggleId === toggle.nodeId ? (
          <rect
            data-testid={`network-topology-branch-toggle-focus-${toggle.nodeId}`}
            x={toggle.x - pillHalfWidth - 3 * hairline}
            y={centreY - radius - 3 * hairline}
            width={2 * pillHalfWidth + 6 * hairline}
            height={2 * radius + 6 * hairline}
            rx={radius + 3 * hairline}
            fill="none"
            stroke="var(--ou-link, #4f46e5)"
            strokeWidth={2 * hairline}
            pointerEvents="none"
          />
        ) : (
          <></>
        )}
        {toggle.isCollapsed ? (
          <>
            <rect
              x={toggle.x - pillHalfWidth}
              y={centreY - radius}
              width={2 * pillHalfWidth}
              height={2 * radius}
              rx={radius}
              fill="var(--ou-link, #4f46e5)"
            />
            <text
              x={toggle.x}
              y={centreY}
              dy="0.35em"
              textAnchor="middle"
              direction="ltr"
              fontSize={BRANCH_TOGGLE_FONT_PX * hairline}
              fontWeight={600}
              fill="#ffffff"
              pointerEvents="none"
            >
              {countText}
            </text>
          </>
        ) : (
          <>
            <circle
              cx={toggle.x}
              cy={centreY}
              r={radius}
              fill="var(--ou-surface-primary, #ffffff)"
              stroke="var(--ou-border-strong, #9ca3af)"
              strokeWidth={1.25 * hairline}
            />
            <line
              x1={toggle.x - 3.5 * hairline}
              y1={centreY}
              x2={toggle.x + 3.5 * hairline}
              y2={centreY}
              stroke="var(--ou-text-secondary, #4b5563)"
              strokeWidth={1.5 * hairline}
              strokeLinecap="round"
              pointerEvents="none"
            />
          </>
        )}
      </g>
    );
  };

  /*
   * The branch the map is narrowed to (issue #6606): the path from the top
   * of its tree down to it - each step a way to widen the view to that
   * device's branch - and the way back to the whole map.
   */
  const renderFocusedBranchChip: () => ReactElement = (): ReactElement => {
    if (!hierarchy || !focusedBranchNodeId) {
      return <></>;
    }
    const nameOf: (nodeId: string) => string = (nodeId: string): string => {
      return nodeById.get(nodeId)?.name || nodeId;
    };
    return (
      <nav
        aria-label={translator.translateText("Branch shown on the map")}
        data-testid="network-topology-focus-chip"
        className="pointer-events-auto inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 rounded-2xl border border-indigo-200 bg-white/95 py-1 pl-2.5 pr-1 text-xs text-gray-600 shadow-sm backdrop-blur"
      >
        <Icon
          className="h-3.5 w-3.5 flex-none text-indigo-500"
          icon={IconProp.Funnel}
        />
        <ol className="flex min-w-0 flex-wrap items-center gap-x-1">
          {ancestorIdsOf(hierarchy, focusedBranchNodeId).map(
            (ancestorId: string): ReactElement => {
              return (
                <li key={ancestorId} className="flex items-center gap-x-1">
                  <button
                    type="button"
                    data-testid={`network-topology-focus-ancestor-${ancestorId}`}
                    title={translator.translateTemplate(
                      "Show the branch under {{name}}",
                      { name: nameOf(ancestorId) },
                    )}
                    className="max-w-[10rem] truncate rounded font-medium text-indigo-600 hover:text-indigo-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
                    onClick={() => {
                      props.onFocusedBranchChange?.(ancestorId);
                    }}
                  >
                    <bdi>{nameOf(ancestorId)}</bdi>
                  </button>
                  <span aria-hidden="true" className="text-gray-400">
                    ›
                  </span>
                </li>
              );
            },
          )}
          <li
            aria-current="location"
            className="max-w-[12rem] truncate font-semibold text-gray-900"
          >
            <bdi>{nameOf(focusedBranchNodeId)}</bdi>
          </li>
        </ol>
        <button
          type="button"
          data-testid="network-topology-focus-clear"
          className="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700 hover:bg-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
          onClick={() => {
            props.onFocusedBranchChange?.(null);
          }}
        >
          {translator.translateText("Show whole map")}
        </button>
      </nav>
    );
  };

  /*
   * Whose positions the map is drawn with, once the reader has dragged
   * anything (issue #6606). Their custom layout is kept per layout on this
   * browser; the original layout is the map as OneUptime lays it out, a
   * click away and back, without throwing the custom one away - which is
   * what Reset layout is for.
   */
  const renderLayoutChoiceChip: () => ReactElement = (): ReactElement => {
    if (overrides.size === 0) {
      return <></>;
    }
    const customText: string = translator.translateTemplate(
      "Custom layout · {{count}} moved",
      { count: translator.formatNumber(overrides.size) },
    );
    if (!props.onShowOriginalLayoutChange) {
      return (
        <Pill
          text={customText}
          isUserContent={true}
          tone={PillTone.Info}
          isDotHidden={true}
          dataTestId="network-topology-custom-layout-chip"
        />
      );
    }
    const segmentClassName: (isActive: boolean) => string = (
      isActive: boolean,
    ): string => {
      return `rounded-xl px-2.5 py-0.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${
        isActive
          ? "bg-white text-indigo-700 shadow-sm"
          : "text-indigo-600 hover:text-indigo-800"
      }`;
    };
    return (
      <div
        role="group"
        aria-label={translator.translateText("Device positions")}
        className="pointer-events-auto inline-flex max-w-full items-stretch gap-0.5 rounded-2xl border border-indigo-200 bg-indigo-50/95 p-0.5 text-xs font-medium shadow-sm backdrop-blur"
        data-testid="network-topology-custom-layout-chip"
      >
        <button
          type="button"
          aria-pressed={!isShowingOriginalLayout}
          data-testid="network-topology-show-custom-layout"
          title={translator.translateText(
            "Devices where you dragged them, saved on this browser.",
          )}
          className={segmentClassName(!isShowingOriginalLayout)}
          onClick={() => {
            props.onShowOriginalLayoutChange?.(false);
          }}
        >
          {customText}
        </button>
        <button
          type="button"
          aria-pressed={isShowingOriginalLayout}
          data-testid="network-topology-show-original-layout"
          title={translator.translateText(
            "The map as OneUptime lays it out. Your custom layout is kept.",
          )}
          className={segmentClassName(isShowingOriginalLayout)}
          onClick={() => {
            props.onShowOriginalLayoutChange?.(true);
          }}
        >
          {translator.translateText("Original layout")}
        </button>
      </div>
    );
  };

  /*
   * What the search found (issue #6606): how many matches, the way to step
   * through them, and the matches a folded branch - or the branch in
   * focus - keeps off the map, with the way to bring them on.
   */
  const renderSearchChip: () => ReactElement = (): ReactElement => {
    if (!searchText || viewModel.isFilteredEmpty) {
      return <></>;
    }
    const matchIds: Array<string> = viewModel.searchMatchNodeIds;
    const hiddenCount: number = hiddenSearchMatchIds.length;

    if (matchIds.length > 0) {
      const locatedIndex: number = locatedMatchId
        ? matchIds.indexOf(locatedMatchId)
        : -1;
      const stepClassName: string =
        "flex h-5 w-5 items-center justify-center rounded-full text-amber-800 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500";
      return (
        <div
          role="group"
          aria-label={translator.translateText("Search results on the map")}
          data-testid="network-topology-search-matches"
          className="pointer-events-auto inline-flex max-w-full flex-wrap items-center gap-1 rounded-2xl border border-amber-200 bg-amber-50/95 py-0.5 pl-2.5 pr-1 text-xs font-medium text-amber-900 shadow-sm backdrop-blur"
        >
          <span
            role="status"
            aria-live="polite"
            data-testid="network-topology-search-count"
          >
            {locatedIndex >= 0
              ? translator.translateTemplate("{{position}} of {{count}}", {
                  position: translator.formatNumber(locatedIndex + 1),
                  count: translator.formatNumber(matchIds.length),
                })
              : translator.translatePlural(MATCH_COUNT, matchIds.length)}
          </span>
          <button
            type="button"
            data-testid="network-topology-previous-match"
            aria-label={translator.translateText("Previous match")}
            title={translator.translateText("Previous match")}
            className={stepClassName}
            onClick={() => {
              locateMatch(-1);
            }}
          >
            <Icon className="h-3.5 w-3.5" icon={IconProp.ChevronLeft} />
          </button>
          <button
            type="button"
            data-testid="network-topology-next-match"
            aria-label={translator.translateText("Next match")}
            title={translator.translateText("Next match")}
            className={stepClassName}
            onClick={() => {
              locateMatch(1);
            }}
          >
            <Icon className="h-3.5 w-3.5" icon={IconProp.ChevronRight} />
          </button>
          {hiddenCount > 0 ? (
            <button
              type="button"
              data-testid="network-topology-show-hidden-matches"
              title={translator.translateText(
                "Opens the branches they are in.",
              )}
              className="rounded-full px-1.5 py-0.5 text-amber-800 underline hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
              onClick={revealHiddenMatches}
            >
              {translator.translatePlural(
                { one: "Show {{count}} more", other: "Show {{count}} more" },
                hiddenCount,
              )}
            </button>
          ) : (
            <></>
          )}
        </div>
      );
    }

    if (hiddenCount > 0) {
      return (
        <div
          role="status"
          data-testid="network-topology-hidden-search-matches"
          className="pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/95 py-0.5 pl-3 pr-1 text-xs font-medium text-amber-900 shadow-sm backdrop-blur"
        >
          <span>
            {translator.translatePlural(
              {
                one: "{{count}} match isn't shown",
                other: "{{count}} matches aren't shown",
              },
              hiddenCount,
            )}
          </span>
          <button
            type="button"
            data-testid="network-topology-show-hidden-matches"
            title={translator.translateText("Opens the branches they are in.")}
            className="flex-none rounded-xl bg-white px-2 py-0.5 text-amber-800 shadow-sm hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
            onClick={revealHiddenMatches}
          >
            {translator.translateText("Show on map")}
          </button>
        </div>
      );
    }

    if (viewModel.searchMatchCount > 0) {
      return <></>;
    }

    return (
      <div
        role="status"
        className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800"
        data-testid="network-topology-no-search-matches"
      >
        {translator.translateTemplate(
          'Nothing matches "{{search}}" — the whole map is dimmed',
          { search: props.searchText || "" },
        )}
      </div>
    );
  };

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
    /*
     * Issue #6606: fold the whole tree to its outline, or open it all again.
     * Offered only where branches are drawn, and only to a map whose folds
     * the parent keeps.
     */
    ...(hierarchy && props.onCollapsedNodeIdsChange
      ? [
          {
            label: "Collapse all branches",
            icon: IconProp.MinusCircle,
            testId: "network-topology-collapse-all",
            disabled: !canCollapseMore(
              hierarchy,
              hierarchy.collapsedNodeIds,
              focusedBranchNodeId,
            ),
            onClick: collapseAll,
          },
          {
            label: "Expand all branches",
            icon: IconProp.PlusCircle,
            testId: "network-topology-expand-all",
            disabled: !canExpandMore(
              hierarchy,
              hierarchy.collapsedNodeIds,
              focusedBranchNodeId,
            ),
            onClick: expandAll,
          },
        ]
      : []),
    {
      label: "Reset layout",
      icon: IconProp.Refresh,
      testId: "network-topology-reset-layout",
      /*
       * Never advertise a control that would do nothing - and while the
       * original layout is shown, the arrangement it would throw away is not
       * even on screen.
       */
      disabled: overrides.size === 0 || isShowingOriginalLayout,
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
      {/*
       * `isolate` is load-bearing (issue #3373). This box floats the zoom
       * toolbar at z-20 and four more overlays at z-10, while the app shell
       * sticks its header at z-10 (Common/UI/Components/MasterPage). A
       * `relative` box whose z-index is auto creates no stacking context, so
       * those numbers were resolved against the header's in the ROOT context
       * — and beat it, ties included, because <main> comes after the header
       * in tree order. Scrolling the map's top edge under the header then
       * painted the toolbar on top of the navbar, reading as a control
       * floating over unrelated content.
       *
       * Isolating collapses the whole map to one z-index:0 entry in the root
       * context. The overlays keep their order relative to each other, and
       * the map now slides behind the header like any other page content.
       */}
      <div
        className="relative isolate w-full overflow-hidden rounded-lg border border-gray-200 bg-white"
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
                  title={translator.translateText(control.label)}
                  aria-label={translator.translateText(control.label)}
                  data-testid={control.testId}
                  disabled={control.disabled}
                  className={`flex h-7 w-7 items-center justify-center rounded-md text-gray-600 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${getHandDrawnButtonStateClassName(
                    {
                      isLocked: control.disabled,
                      hoverClassName: "hover:bg-gray-100 hover:text-gray-900",
                    },
                  )}`}
                  onClick={control.onClick}
                >
                  <Icon className="h-4 w-4" icon={control.icon} />
                </button>
              );
            },
          )}
        </div>

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
                  {translator.translateText(
                    "Nothing needs attention right now",
                  )}
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {translator.translateText(
                    "Every device on this map answered its last poll with all interfaces and links up. Switch back to All to see the whole network.",
                  )}
                </p>
              </div>
            ) : (
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {translator.translateText("No devices match your filters")}
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {translator.translateText(
                    "Clear the VLAN filter or re-enable a node type to see the map again.",
                  )}
                </p>
              </div>
            )}
          </div>
        ) : (
          <></>
        )}

        {/*
         * What the map is showing, stacked at its top corner (issue #6606):
         * the branch it is narrowed to, whose positions it is drawn with,
         * and what the search found. One stack rather than a pill each in a
         * place of its own, so on a narrow map they wrap rather than land
         * on top of each other. Mounted after the filtered-empty scrim, so
         * the way out of a narrowed branch stays on top of it.
         */}
        <div
          className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-3.5rem)] flex-col items-start gap-1.5"
          data-testid="network-topology-status-stack"
        >
          {renderFocusedBranchChip()}
          {renderLayoutChoiceChip()}
          {renderSearchChip()}
        </div>

        {showLabels ? (
          <></>
        ) : (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 mx-auto w-fit rounded-full bg-gray-900/80 px-3 py-1 text-xs text-white">
            {translator.translateText("Zoom in to see device names")}
          </div>
        )}

        <svg
          ref={svgRef}
          data-testid="network-topology-svg"
          role="application"
          tabIndex={0}
          aria-label={translator.translateText(
            "Network topology map. Drag a device to move it. Drag the background to pan. Arrow keys pan, plus and minus zoom, zero fits the graph to the view, Escape cancels.",
          )}
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
              {hulls.map((hull: TopologyHullView): ReactElement => {
                return (
                  <g key={hull.key}>
                    <rect
                      x={hull.x}
                      y={hull.y}
                      width={hull.width}
                      height={hull.height}
                      rx={TOPOLOGY_DRAWING_STYLE.hullCornerRadius}
                      fill={TOPOLOGY_DRAWING_STYLE.hullFill}
                      fillOpacity={
                        hull.isDashed
                          ? TOPOLOGY_DRAWING_STYLE.dashedHullFillOpacity
                          : TOPOLOGY_DRAWING_STYLE.hullFillOpacity
                      }
                      stroke={TOPOLOGY_DRAWING_STYLE.hullStroke}
                      strokeWidth={TOPOLOGY_DRAWING_STYLE.hullStrokeWidth}
                      strokeDasharray={
                        hull.isDashed
                          ? TOPOLOGY_DRAWING_STYLE.hullDash
                          : undefined
                      }
                    />
                    {hull.caption ? (
                      <text
                        x={hull.x + TOPOLOGY_DRAWING_STYLE.hullCaptionOffset}
                        y={hull.y - TOPOLOGY_DRAWING_STYLE.hullCaptionOffset}
                        fontSize={TOPOLOGY_DRAWING_STYLE.hullCaptionFontSize}
                        fontWeight={600}
                        fill={TOPOLOGY_DRAWING_STYLE.hullCaptionColor}
                      >
                        {hull.caption}
                      </text>
                    ) : (
                      <></>
                    )}
                  </g>
                );
              })}
            </g>

            {/*
             * Leaf-block combs (issue #6606): the shared wiring a grid of
             * leaves hangs from, under the links' own stubs.
             */}
            {viewModel.combs.length > 0 ? (
              <g aria-hidden={true} data-testid="network-topology-combs">
                {viewModel.combs.map((comb: TopologyCombView): ReactElement => {
                  return (
                    <path
                      key={comb.key}
                      data-testid={`network-topology-comb-${comb.parentId}`}
                      d={combPathData(comb.segments)}
                      fill="none"
                      stroke={comb.color}
                      strokeWidth={TOPOLOGY_DRAWING_STYLE.combStrokeWidth}
                      strokeDasharray={comb.strokeDashArray}
                      strokeLinecap={comb.strokeDashArray ? "butt" : "square"}
                      opacity={
                        comb.isDimmed
                          ? TOPOLOGY_DRAWING_STYLE.dimmedEdgeOpacity
                          : 1
                      }
                    />
                  );
                })}
              </g>
            ) : (
              <></>
            )}

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
                      opacity={
                        edgeView.isDimmed
                          ? TOPOLOGY_DRAWING_STYLE.dimmedEdgeOpacity
                          : 1
                      }
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
                  /*
                   * A device whose bound monitor nothing checks says why,
                   * in the reader's language (issue #7346): on a line of
                   * its own in the tooltip, and after the node's name for
                   * a screen reader - without opening the drawer.
                   */
                  const statusNote: string | undefined = nodeView.statusNote
                    ? translator.translateText(nodeView.statusNote) ||
                      nodeView.statusNote
                    : undefined;
                  return (
                    <g
                      key={nodeView.id}
                      data-testid={nodeView.testId}
                      data-topology-node-id={nodeView.id}
                      data-x={Math.round(nodeView.x)}
                      data-y={Math.round(nodeView.y)}
                      role="button"
                      tabIndex={0}
                      aria-label={
                        statusNote
                          ? [nodeView.ariaLabel, statusNote].join(". ")
                          : nodeView.ariaLabel
                      }
                      opacity={
                        nodeView.isDimmed
                          ? TOPOLOGY_DRAWING_STYLE.dimmedNodeOpacity
                          : 1
                      }
                      style={{
                        cursor: isShowingOriginalLayout ? "pointer" : "grab",
                      }}
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
                      <title>
                        {statusNote
                          ? [nodeView.tooltip, statusNote].join("\n")
                          : nodeView.tooltip}
                      </title>

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
                          r={attentionHaloRadiusFor(footprint)}
                          fill={HEALTH_STATE_COLORS[nodeView.health]}
                          fillOpacity={
                            TOPOLOGY_DRAWING_STYLE.attentionHaloFillOpacity
                          }
                          stroke={HEALTH_STATE_COLORS[nodeView.health]}
                          strokeOpacity={
                            TOPOLOGY_DRAWING_STYLE.attentionHaloStrokeOpacity
                          }
                          strokeWidth={1.5 * hairline}
                          pointerEvents="none"
                          data-testid={`network-topology-attention-halo-${nodeView.id}`}
                        />
                      ) : (
                        <></>
                      )}

                      {/*
                       * The search match "next match" moved to (issue
                       * #6606): a warm ring a step wider than the selection
                       * ring, so the two can be told apart when they meet.
                       */}
                      {nodeView.isLocated ? (
                        <circle
                          data-testid={`network-topology-located-${nodeView.id}`}
                          cx={nodeView.x}
                          cy={nodeView.y}
                          r={
                            Math.max(
                              footprint.halfWidth,
                              footprint.halfHeight,
                            ) + 10
                          }
                          fill={LOCATED_RING_COLOR}
                          fillOpacity={0.12}
                          stroke={LOCATED_RING_COLOR}
                          strokeWidth={2.5 * hairline}
                          pointerEvents="none"
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
                          fontSize={TOPOLOGY_DRAWING_STYLE.badgeFontSize}
                          fontWeight={600}
                          fill={
                            nodeView.kind === "device"
                              ? TOPOLOGY_DRAWING_STYLE.deviceBadgeColor
                              : TOPOLOGY_DRAWING_STYLE.labelColor
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
                          fontSize={labelFontSizeFor(nodeView.kind)}
                          fill={TOPOLOGY_DRAWING_STYLE.labelColor}
                          /*
                           * A halo drawn behind the glyphs (paint-order
                           * puts the stroke first) is what keeps a label
                           * readable where it crosses a link. Dividing by
                           * the view scale holds it at a constant three
                           * screen pixels at any zoom.
                           */
                          stroke={TOPOLOGY_DRAWING_STYLE.labelHaloColor}
                          strokeWidth={
                            TOPOLOGY_DRAWING_STYLE.labelHaloWidth * hairline
                          }
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
                                    lineIndex === 0
                                      ? 0
                                      : labelLineHeightFor(nodeView.kind)
                                  }
                                  {...(nodeView.hasSecondaryLabelLine &&
                                  lineIndex === nodeView.labelLines.length - 1
                                    ? {
                                        fill: TOPOLOGY_DRAWING_STYLE.labelSecondaryColor,
                                        "data-label-line": "secondary",
                                      }
                                    : {})}
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

            {/*
             * The fold controls (issue #6606), last so nothing paints over
             * them. Only while names are drawn: below that zoom a control
             * per branch would be clutter nobody can aim at.
             */}
            {showLabels && branchToggles.length > 0 ? (
              <g data-testid="network-topology-branch-toggles">
                {branchToggles.map(renderBranchToggle)}
              </g>
            ) : (
              <></>
            )}
          </g>
        </svg>
      </div>

      {/*
       * A real legend, not prose in the card description — Card renders
       * its description `max-md:hidden md:block`, so on a phone the only key to
       * reading the graph did not exist at all.
       */}
      <ul
        role="list"
        aria-label={translator.translateText("Topology key")}
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
                <span className="text-gray-500">
                  {translator.translateTemplate("{{group}}:", {
                    group: translatableTerm(entry.group),
                  })}{" "}
                </span>
                {entry.labelTemplate
                  ? translator.translateTemplate(
                      entry.labelTemplate.template,
                      entry.labelTemplate.values,
                    )
                  : translator.translateText(entry.label)}
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
        className="mt-1 px-3 text-xs text-gray-500"
      >
        {translator.translatePlural(
          {
            one: "Showing {{visible}} of {{count}} device",
            other: "Showing {{visible}} of {{count}} devices",
          },
          viewModel.totalNodeCount,
          { visible: translator.formatNumber(viewModel.visibleNodeCount) },
        )}
      </p>
    </div>
  );
};

export default NetworkDeviceGraph;
