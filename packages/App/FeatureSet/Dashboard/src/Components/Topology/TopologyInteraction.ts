import { NetworkTopologyEdge } from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  ElementBox,
  MAX_ZOOM,
  MIN_ZOOM,
  ScreenPoint,
  ViewBoxSize,
  ViewTransform,
  WorldPoint,
  applyZoomAtPoint,
  clampWorldPoint,
  dragThresholdExceeded,
  panBy,
  screenDeltaToViewBoxDelta,
  screenToViewBox,
  screenToWorld,
} from "./TopologyViewport";
import { clamp } from "../NetworkDevice/TopologyGraphUtil";

/*
 * The pointer gesture machine for the topology graph, as a pure reducer.
 *
 * WHY THIS IS A REDUCER AND NOT HANDLERS. The graph has to tell four
 * gestures apart on the same surface — click a device, drag a device, pan
 * the canvas, pinch to zoom — and getting that wrong is exactly what the
 * user reported: every pointerdown, including one on a node, started a
 * canvas pan, so grabbing a device slid the whole map instead of moving
 * the device. Rules like "a drag must not also fire a click" and "a node
 * drag must never move the viewport" are statements about a state
 * machine, and a state machine can be tested exhaustively. React handlers
 * cannot be: App/Tests runs under `testEnvironment: "node"` with no react
 * on its resolution path. So all the logic lives here, and the component
 * is a thin adapter that turns DOM events into GestureEvents and applies
 * the effects that come back.
 */

export type GesturePointerType = "mouse" | "touch" | "pen";

export interface MovedNodePosition {
  nodeId: string;
  point: WorldPoint;
}

interface NodeGestureFields {
  pointerId: number;
  pointerType: GesturePointerType;
  nodeId: string;
  movedNodeIds: ReadonlyArray<string>;
  origin: ScreenPoint;
  originWorld: WorldPoint;
  /*
   * Where the pointer got to. The pan states have always carried this;
   * the node states did not, so a second finger landing mid-drag had to
   * fall back to `origin` and committed a zero-length drag — see the
   * pinch branch of the reducer.
   */
  last: ScreenPoint;
  startPoints: ReadonlyArray<MovedNodePosition>;
}

export type GestureState =
  | { kind: "idle" }
  | {
      kind: "pressBackground";
      pointerId: number;
      pointerType: GesturePointerType;
      origin: ScreenPoint;
      last: ScreenPoint;
    }
  | {
      kind: "pan";
      pointerId: number;
      pointerType: GesturePointerType;
      origin: ScreenPoint;
      last: ScreenPoint;
    }
  | ({ kind: "pressNode" } & NodeGestureFields)
  | ({ kind: "dragNode" } & NodeGestureFields)
  | {
      kind: "pinch";
      pointerA: number;
      pointerB: number;
      pointA: ScreenPoint;
      pointB: ScreenPoint;
      startDistancePx: number;
      startScale: number;
      anchorViewBox: ScreenPoint;
    };

export type GestureEvent =
  | {
      kind: "pointerDown";
      pointerId: number;
      pointerType: GesturePointerType;
      isPrimaryButton: boolean;
      client: ScreenPoint;
      hitNodeId: string | null;
    }
  | { kind: "pointerMove"; pointerId: number; client: ScreenPoint }
  | { kind: "pointerUp"; pointerId: number; client: ScreenPoint }
  | { kind: "pointerCancel"; pointerId: number }
  | { kind: "escape" };

export type GestureEffect =
  | { kind: "capturePointer"; target: "svg" | "node"; pointerId: number }
  | { kind: "setView"; view: ViewTransform }
  | { kind: "moveNodes"; moved: ReadonlyArray<MovedNodePosition> }
  | { kind: "commitNodePositions"; moved: ReadonlyArray<MovedNodePosition> }
  | { kind: "revertNodePositions"; moved: ReadonlyArray<MovedNodePosition> }
  | { kind: "emitNodeClick"; nodeId: string }
  | { kind: "emitBackgroundClick" };

export interface GestureContext {
  view: ViewTransform;
  box: ElementBox;
  viewBox: ViewBoxSize;
  positionOf: (nodeId: string) => WorldPoint | undefined;
  /*
   * Nodes that travel with the grabbed one. Dragging a switch in tiered
   * mode should bring its block of endpoints along, or the arrangement
   * the user is building falls apart as they build it.
   */
  nodeIdsMovedWith: (nodeId: string) => ReadonlyArray<string>;
}

export interface GestureResult {
  state: GestureState;
  effects: ReadonlyArray<GestureEffect>;
}

export const initialGestureState: GestureState = { kind: "idle" };

const NO_EFFECTS: ReadonlyArray<GestureEffect> = [];

const unchanged: (state: GestureState) => GestureResult = (
  state: GestureState,
): GestureResult => {
  return { state: state, effects: NO_EFFECTS };
};

const isNodeGesture: (
  state: GestureState,
) => state is { kind: "pressNode" | "dragNode" } & NodeGestureFields = (
  state: GestureState,
): state is { kind: "pressNode" | "dragNode" } & NodeGestureFields => {
  return state.kind === "pressNode" || state.kind === "dragNode";
};

const distanceBetween: (a: ScreenPoint, b: ScreenPoint) => number = (
  a: ScreenPoint,
  b: ScreenPoint,
): number => {
  return Math.hypot(a.x - b.x, a.y - b.y);
};

/*
 * Where the dragged nodes go for a pointer at `client`.
 *
 * Every node moves by the world-space delta between the press origin and
 * the pointer now, applied to where it was when the press started. Doing
 * it that way rather than "put the node under the cursor" is what makes a
 * drag feel attached rather than snapping: with the pointer back at the
 * press origin the delta is exactly zero, so the node is exactly where it
 * started, to the bit.
 */
const movedPositionsFor: (
  state: NodeGestureFields,
  client: ScreenPoint,
  context: GestureContext,
) => Array<MovedNodePosition> = (
  state: NodeGestureFields,
  client: ScreenPoint,
  context: GestureContext,
): Array<MovedNodePosition> => {
  const currentWorld: WorldPoint = screenToWorld(
    client,
    context.box,
    context.viewBox,
    context.view,
  );
  const deltaX: number = currentWorld.x - state.originWorld.x;
  const deltaY: number = currentWorld.y - state.originWorld.y;

  return state.startPoints.map(
    (start: MovedNodePosition): MovedNodePosition => {
      return {
        nodeId: start.nodeId,
        point: clampWorldPoint({
          x: start.point.x + deltaX,
          y: start.point.y + deltaY,
        }),
      };
    },
  );
};

/**
 * Advance the gesture machine.
 *
 * Pure: `state` is never mutated, and the same (state, event, context)
 * always yields the same result.
 */
export const reduceGesture: (
  state: GestureState,
  event: GestureEvent,
  context: GestureContext,
) => GestureResult = (
  state: GestureState,
  event: GestureEvent,
  context: GestureContext,
): GestureResult => {
  if (event.kind === "escape") {
    if (isNodeGesture(state)) {
      /*
       * Abandoning a half-finished node drag puts the node back. Escape
       * during a PAN deliberately does not restore the viewport — people
       * expect Escape to stop what is happening, not to rewind it, and a
       * viewport that jumps back is disorienting.
       */
      return {
        state: initialGestureState,
        effects: [{ kind: "revertNodePositions", moved: state.startPoints }],
      };
    }
    return state.kind === "idle"
      ? unchanged(state)
      : { state: initialGestureState, effects: NO_EFFECTS };
  }

  if (event.kind === "pointerDown") {
    if (!event.isPrimaryButton) {
      /*
       * Right and middle buttons are not gestures here. Note the old code
       * bailed out AFTER stamping its click-suppression flag, leaving it
       * set for whatever happened next.
       */
      return unchanged(state);
    }

    // A second finger during any single-pointer gesture becomes a pinch.
    if (state.kind !== "idle" && state.kind !== "pinch") {
      /*
       * Every single-pointer state records where its pointer got to, so
       * the pinch starts from the CURRENT finger position whatever the
       * gesture was. Reading `origin` for the node states — as this used
       * to — made the commit below a no-op delta, which threw away the
       * drag the user had just performed.
       */
      const existingPointerId: number = state.pointerId;
      const existingPoint: ScreenPoint = state.last;
      const midpoint: ScreenPoint = {
        x: (existingPoint.x + event.client.x) / 2,
        y: (existingPoint.y + event.client.y) / 2,
      };
      const pinchState: GestureState = {
        kind: "pinch",
        pointerA: existingPointerId,
        pointerB: event.pointerId,
        pointA: existingPoint,
        pointB: event.client,
        startDistancePx: Math.max(
          1,
          distanceBetween(existingPoint, event.client),
        ),
        startScale: context.view.scale,
        anchorViewBox: screenToViewBox(midpoint, context.box, context.viewBox),
      };
      /*
       * An in-flight node drag is committed where it stands rather than
       * reverted: the user did move it, they have just also started
       * zooming.
       */
      if (state.kind === "dragNode") {
        return {
          state: pinchState,
          effects: [
            {
              kind: "commitNodePositions",
              moved: movedPositionsFor(state, existingPoint, context),
            },
          ],
        };
      }
      return { state: pinchState, effects: NO_EFFECTS };
    }

    if (state.kind === "pinch") {
      // Three fingers: ignore the third rather than corrupt the pinch.
      return unchanged(state);
    }

    if (event.hitNodeId === null) {
      return {
        state: {
          kind: "pressBackground",
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          origin: event.client,
          last: event.client,
        },
        effects: [
          { kind: "capturePointer", target: "svg", pointerId: event.pointerId },
        ],
      };
    }

    const movedNodeIds: ReadonlyArray<string> = context.nodeIdsMovedWith(
      event.hitNodeId,
    );
    const startPoints: Array<MovedNodePosition> = [];
    for (const nodeId of movedNodeIds) {
      const point: WorldPoint | undefined = context.positionOf(nodeId);
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        startPoints.push({ nodeId: nodeId, point: { ...point } });
      }
    }

    return {
      state: {
        kind: "pressNode",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        nodeId: event.hitNodeId,
        movedNodeIds: movedNodeIds,
        origin: event.client,
        last: event.client,
        originWorld: screenToWorld(
          event.client,
          context.box,
          context.viewBox,
          context.view,
        ),
        startPoints: startPoints,
      },
      /*
       * Capture on the NODE, immediately. The old code captured on the
       * svg and only after the pointer had already moved, because
       * capturing on the svg retargets the eventual click to the svg and
       * nodes would never see it. Capturing on the node itself has no
       * such problem — every engine retargets to the capture element or
       * to a common ancestor, and the real target is a child of the node
       * group either way — so the drag can be tracked from the first
       * pixel and never loses the pointer when it leaves the canvas.
       */
      effects: [
        { kind: "capturePointer", target: "node", pointerId: event.pointerId },
      ],
    };
  }

  if (event.kind === "pointerMove") {
    if (state.kind === "pinch") {
      const isA: boolean = event.pointerId === state.pointerA;
      const isB: boolean = event.pointerId === state.pointerB;
      if (!isA && !isB) {
        return unchanged(state);
      }
      const pointA: ScreenPoint = isA ? event.client : state.pointA;
      const pointB: ScreenPoint = isB ? event.client : state.pointB;
      const distance: number = Math.max(1, distanceBetween(pointA, pointB));
      const targetScale: number = clamp(
        (state.startScale * distance) / state.startDistancePx,
        MIN_ZOOM,
        MAX_ZOOM,
      );
      const factor: number =
        context.view.scale > 0 ? targetScale / context.view.scale : 1;
      return {
        state: { ...state, pointA: pointA, pointB: pointB },
        effects: [
          {
            kind: "setView",
            view: applyZoomAtPoint(context.view, state.anchorViewBox, factor),
          },
        ],
      };
    }

    if (state.kind === "idle") {
      return unchanged(state);
    }
    if (event.pointerId !== state.pointerId) {
      // A pointer we are not tracking. Ignore it completely.
      return unchanged(state);
    }

    if (state.kind === "pressBackground" || state.kind === "pan") {
      const crossed: boolean =
        state.kind === "pan" ||
        dragThresholdExceeded(state.origin, event.client, state.pointerType);
      if (!crossed) {
        /*
         * Still a click. Nothing moves, nothing is emitted — this is what
         * makes clicking a device on a pannable canvas work at all.
         */
        return unchanged({ ...state, last: event.client });
      }
      const deltaPx: ScreenPoint = {
        x: event.client.x - state.last.x,
        y: event.client.y - state.last.y,
      };
      return {
        state: {
          kind: "pan",
          pointerId: state.pointerId,
          pointerType: state.pointerType,
          origin: state.origin,
          last: event.client,
        },
        effects: [
          {
            kind: "setView",
            view: panBy(
              context.view,
              screenDeltaToViewBoxDelta(deltaPx, context.box, context.viewBox),
            ),
          },
        ],
      };
    }

    // pressNode / dragNode.
    const crossed: boolean =
      state.kind === "dragNode" ||
      dragThresholdExceeded(state.origin, event.client, state.pointerType);
    if (!crossed) {
      return unchanged({ ...state, last: event.client });
    }
    return {
      state: { ...state, kind: "dragNode", last: event.client },
      /*
       * Note what is NOT here: setView. A node drag can never pan the
       * canvas, because this branch has no transition that produces one.
       */
      effects: [
        {
          kind: "moveNodes",
          moved: movedPositionsFor(state, event.client, context),
        },
      ],
    };
  }

  if (event.kind === "pointerUp") {
    if (state.kind === "pinch") {
      if (
        event.pointerId !== state.pointerA &&
        event.pointerId !== state.pointerB
      ) {
        return unchanged(state);
      }
      // Lifting either finger ends the pinch rather than degrading to a pan.
      return { state: initialGestureState, effects: NO_EFFECTS };
    }
    if (state.kind === "idle" || event.pointerId !== state.pointerId) {
      return unchanged(state);
    }
    if (state.kind === "pressBackground") {
      return {
        state: initialGestureState,
        effects: [{ kind: "emitBackgroundClick" }],
      };
    }
    if (state.kind === "pan") {
      return { state: initialGestureState, effects: NO_EFFECTS };
    }
    if (state.kind === "pressNode") {
      return {
        state: initialGestureState,
        effects: [{ kind: "emitNodeClick", nodeId: state.nodeId }],
      };
    }
    return {
      state: initialGestureState,
      effects: [
        {
          kind: "commitNodePositions",
          moved: movedPositionsFor(state, event.client, context),
        },
      ],
    };
  }

  // pointerCancel.
  if (state.kind === "idle") {
    return unchanged(state);
  }
  if (state.kind === "pinch") {
    return event.pointerId === state.pointerA ||
      event.pointerId === state.pointerB
      ? { state: initialGestureState, effects: NO_EFFECTS }
      : unchanged(state);
  }
  if (event.pointerId !== state.pointerId) {
    return unchanged(state);
  }
  if (isNodeGesture(state)) {
    return {
      state: initialGestureState,
      effects: [{ kind: "revertNodePositions", moved: state.startPoints }],
    };
  }
  return { state: initialGestureState, effects: NO_EFFECTS };
};

/** True while a gesture has moved far enough that a click must not fire. */
export const isGestureSuppressingClick: (state: GestureState) => boolean = (
  state: GestureState,
): boolean => {
  return (
    state.kind === "pan" || state.kind === "dragNode" || state.kind === "pinch"
  );
};

/** The CSS cursor that matches what the pointer is currently doing. */
export const cursorForGesture: (
  state: GestureState,
  isOverNode: boolean,
) => string = (state: GestureState, isOverNode: boolean): string => {
  if (state.kind === "dragNode" || state.kind === "pressNode") {
    return "grabbing";
  }
  if (state.kind === "pan") {
    return "grabbing";
  }
  if (isOverNode) {
    return "grab";
  }
  return "default";
};

/*
 * Adjacency for hover highlighting and focus. Separate from the layout's
 * own adjacency because this one is rebuilt whenever the FILTERED edge
 * set changes, which is much more often than the layout is recomputed.
 */
export const buildAdjacencyIndex: (
  edges: ReadonlyArray<NetworkTopologyEdge>,
) => Map<string, Set<string>> = (
  edges: ReadonlyArray<NetworkTopologyEdge>,
): Map<string, Set<string>> => {
  const adjacency: Map<string, Set<string>> = new Map<string, Set<string>>();
  for (const edge of edges || []) {
    if (!edge || !edge.fromNodeId || !edge.toNodeId) {
      continue;
    }
    if (edge.fromNodeId === edge.toNodeId) {
      // A self-loop is not a neighbour relationship.
      continue;
    }
    const from: Set<string> =
      adjacency.get(edge.fromNodeId) || new Set<string>();
    from.add(edge.toNodeId);
    adjacency.set(edge.fromNodeId, from);
    const to: Set<string> = adjacency.get(edge.toNodeId) || new Set<string>();
    to.add(edge.fromNodeId);
    adjacency.set(edge.toNodeId, to);
  }
  return adjacency;
};

const EMPTY_NEIGHBORS: ReadonlySet<string> = new Set<string>();

export const neighborIdsOf: (
  adjacency: ReadonlyMap<string, Set<string>>,
  nodeId: string,
) => ReadonlySet<string> = (
  adjacency: ReadonlyMap<string, Set<string>>,
  nodeId: string,
): ReadonlySet<string> => {
  return adjacency.get(nodeId) || EMPTY_NEIGHBORS;
};

/**
 * The set of nodes to show at full strength while everything else dims.
 *
 * An empty selection returns an empty set, which the caller must read as
 * "dim nothing" rather than "dim everything" — the distinction matters,
 * because the second reading blanks the map the moment nothing is
 * selected.
 */
export const focusSetFor: (
  adjacency: ReadonlyMap<string, Set<string>>,
  selectedNodeIds: ReadonlySet<string>,
  includeNeighbors: boolean,
) => ReadonlySet<string> = (
  adjacency: ReadonlyMap<string, Set<string>>,
  selectedNodeIds: ReadonlySet<string>,
  includeNeighbors: boolean,
): ReadonlySet<string> => {
  if (selectedNodeIds.size === 0) {
    return EMPTY_NEIGHBORS;
  }
  const focus: Set<string> = new Set<string>(selectedNodeIds);
  if (includeNeighbors) {
    for (const nodeId of selectedNodeIds) {
      for (const neighborId of neighborIdsOf(adjacency, nodeId)) {
        focus.add(neighborId);
      }
    }
  }
  return focus;
};
