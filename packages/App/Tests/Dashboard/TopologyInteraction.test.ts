import { describe, expect, test } from "@jest/globals";
import { NetworkTopologyEdge } from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  ElementBox,
  MAX_WORLD_COORDINATE,
  MAX_ZOOM,
  MIN_ZOOM,
  MOUSE_DRAG_THRESHOLD_PX,
  ScreenPoint,
  TOUCH_DRAG_THRESHOLD_PX,
  ViewBoxSize,
  ViewTransform,
  WorldPoint,
  screenToViewBox,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyViewport";
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
  isGestureSuppressingClick,
  neighborIdsOf,
  reduceGesture,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyInteraction";

/*
 * The gesture reducer is the fix for "I am not able to drag and drop
 * things": every pointerdown used to start a canvas pan, so grabbing a
 * device slid the whole map instead of moving the device. The four
 * headline contracts below are the ones that bug is made of.
 *
 * A SQUARE-FIT CONTEXT. box and viewBox have the same aspect ratio, so
 * the "meet" fit is exactly 1 with zero letterbox offsets, and with the
 * identity view one client pixel is one world unit. Anywhere the maths
 * is supposed to be exact, this context makes it visibly exact.
 */
const SNUG_BOX: ElementBox = { left: 0, top: 0, width: 1000, height: 700 };
const VIEW_BOX: ViewBoxSize = { width: 1000, height: 700 };
const IDENTITY: ViewTransform = { scale: 1, tx: 0, ty: 0 };

/*
 * The shape from the original bug report: a 16:9 panel showing a very
 * tall tiered graph, offset from the page origin, at a non-unit zoom.
 * The drawing is pillarboxed by hundreds of pixels, so nothing here
 * survives an implementation that assumes the SVG fills its element.
 */
const LETTERBOX_BOX: ElementBox = {
  left: 37,
  top: 19,
  width: 1200,
  height: 675,
};
const TALL_VIEW_BOX: ViewBoxSize = { width: 1000, height: 2100 };
const ZOOMED_VIEW: ViewTransform = { scale: 1.5, tx: -120, ty: 64 };

const TRACKED_POINTER: number = 7;
const SECOND_POINTER: number = 8;
const FOREIGN_POINTER: number = 99;

type MakePositionsFunction = () => Map<string, WorldPoint>;

/* Fresh every call: some tests mutate it to prove the reducer snapshots. */
const makePositions: MakePositionsFunction = (): Map<string, WorldPoint> => {
  return new Map<string, WorldPoint>([
    ["core", { x: 400, y: 60 }],
    ["sw-a", { x: 140, y: 220 }],
    ["ep-1", { x: 60, y: 480 }],
    ["ep-2", { x: 220, y: 480 }],
  ]);
};

interface ContextOptions {
  view?: ViewTransform;
  box?: ElementBox;
  viewBox?: ViewBoxSize;
  positions?: Map<string, WorldPoint>;
  movedWith?: Map<string, ReadonlyArray<string>>;
}

type MakeContextFunction = (options: ContextOptions) => GestureContext;

const makeContext: MakeContextFunction = (
  options: ContextOptions,
): GestureContext => {
  const positions: Map<string, WorldPoint> =
    options.positions || makePositions();
  const movedWith: Map<string, ReadonlyArray<string>> | undefined =
    options.movedWith;
  return {
    view: options.view || IDENTITY,
    box: options.box || SNUG_BOX,
    viewBox: options.viewBox || VIEW_BOX,
    positionOf: (nodeId: string): WorldPoint | undefined => {
      return positions.get(nodeId);
    },
    nodeIdsMovedWith: (nodeId: string): ReadonlyArray<string> => {
      if (!movedWith) {
        return [nodeId];
      }
      return movedWith.get(nodeId) || [nodeId];
    },
  };
};

const SNUG_CONTEXT: GestureContext = makeContext({});
const LETTERBOX_CONTEXT: GestureContext = makeContext({
  view: ZOOMED_VIEW,
  box: LETTERBOX_BOX,
  viewBox: TALL_VIEW_BOX,
});

type PointFunction = (x: number, y: number) => ScreenPoint;

const at: PointFunction = (x: number, y: number): ScreenPoint => {
  return { x: x, y: y };
};

type PointerDownFunction = (
  pointerId: number,
  client: ScreenPoint,
  hitNodeId: string | null,
  pointerType?: GesturePointerType,
) => GestureEvent;

const pointerDown: PointerDownFunction = (
  pointerId: number,
  client: ScreenPoint,
  hitNodeId: string | null,
  pointerType?: GesturePointerType,
): GestureEvent => {
  return {
    kind: "pointerDown",
    pointerId: pointerId,
    pointerType: pointerType || "mouse",
    isPrimaryButton: true,
    client: client,
    hitNodeId: hitNodeId,
  };
};

const secondaryPointerDown: PointerDownFunction = (
  pointerId: number,
  client: ScreenPoint,
  hitNodeId: string | null,
  pointerType?: GesturePointerType,
): GestureEvent => {
  return {
    kind: "pointerDown",
    pointerId: pointerId,
    pointerType: pointerType || "mouse",
    isPrimaryButton: false,
    client: client,
    hitNodeId: hitNodeId,
  };
};

type PointerMoveFunction = (
  pointerId: number,
  client: ScreenPoint,
) => GestureEvent;

const pointerMove: PointerMoveFunction = (
  pointerId: number,
  client: ScreenPoint,
): GestureEvent => {
  return { kind: "pointerMove", pointerId: pointerId, client: client };
};

const pointerUp: PointerMoveFunction = (
  pointerId: number,
  client: ScreenPoint,
): GestureEvent => {
  return { kind: "pointerUp", pointerId: pointerId, client: client };
};

type PointerCancelFunction = (pointerId: number) => GestureEvent;

const pointerCancel: PointerCancelFunction = (
  pointerId: number,
): GestureEvent => {
  return { kind: "pointerCancel", pointerId: pointerId };
};

type EscapeFunction = () => GestureEvent;

const escape: EscapeFunction = (): GestureEvent => {
  return { kind: "escape" };
};

interface RunOutcome {
  state: GestureState;
  effects: Array<GestureEffect>;
  lastEffects: ReadonlyArray<GestureEffect>;
}

type RunFunction = (
  events: ReadonlyArray<GestureEvent>,
  context: GestureContext,
) => RunOutcome;

/* Drive a sequence from idle, collecting every effect it emits. */
const run: RunFunction = (
  events: ReadonlyArray<GestureEvent>,
  context: GestureContext,
): RunOutcome => {
  let state: GestureState = initialGestureState;
  const all: Array<GestureEffect> = [];
  let last: ReadonlyArray<GestureEffect> = [];
  for (const event of events) {
    const result: GestureResult = reduceGesture(state, event, context);
    state = result.state;
    last = result.effects;
    for (const effect of result.effects) {
      all.push(effect);
    }
  }
  return { state: state, effects: all, lastEffects: last };
};

type CountKindFunction = (
  effects: ReadonlyArray<GestureEffect>,
  kind: GestureEffect["kind"],
) => number;

const countKind: CountKindFunction = (
  effects: ReadonlyArray<GestureEffect>,
  kind: GestureEffect["kind"],
): number => {
  return effects.filter((effect: GestureEffect): boolean => {
    return effect.kind === kind;
  }).length;
};

type KindsOfFunction = (effects: ReadonlyArray<GestureEffect>) => Array<string>;

const kindsOf: KindsOfFunction = (
  effects: ReadonlyArray<GestureEffect>,
): Array<string> => {
  return effects.map((effect: GestureEffect): string => {
    return effect.kind;
  });
};

type MovedOfFunction = (
  effect: GestureEffect | undefined,
) => ReadonlyArray<MovedNodePosition>;

const movedOf: MovedOfFunction = (
  effect: GestureEffect | undefined,
): ReadonlyArray<MovedNodePosition> => {
  if (
    effect &&
    (effect.kind === "moveNodes" ||
      effect.kind === "commitNodePositions" ||
      effect.kind === "revertNodePositions")
  ) {
    return effect.moved;
  }
  throw new Error(`expected a node-position effect, got ${String(effect)}`);
};

type PointOfFunction = (
  moved: ReadonlyArray<MovedNodePosition>,
  nodeId: string,
) => WorldPoint;

const pointOf: PointOfFunction = (
  moved: ReadonlyArray<MovedNodePosition>,
  nodeId: string,
): WorldPoint => {
  const found: MovedNodePosition | undefined = moved.find(
    (candidate: MovedNodePosition): boolean => {
      return candidate.nodeId === nodeId;
    },
  );
  if (!found) {
    throw new Error(`no moved position for ${nodeId}`);
  }
  return found.point;
};

type ViewOfFunction = (effect: GestureEffect | undefined) => ViewTransform;

const viewOf: ViewOfFunction = (
  effect: GestureEffect | undefined,
): ViewTransform => {
  if (effect && effect.kind === "setView") {
    return effect.view;
  }
  throw new Error(`expected setView, got ${String(effect)}`);
};

interface NodeGestureSnapshot {
  nodeId: string;
  movedNodeIds: ReadonlyArray<string>;
  origin: ScreenPoint;
  startPoints: ReadonlyArray<MovedNodePosition>;
}

type NodeStateOfFunction = (state: GestureState) => NodeGestureSnapshot;

const nodeStateOf: NodeStateOfFunction = (
  state: GestureState,
): NodeGestureSnapshot => {
  if (state.kind !== "pressNode" && state.kind !== "dragNode") {
    throw new Error(`expected a node gesture, got ${state.kind}`);
  }
  return {
    nodeId: state.nodeId,
    movedNodeIds: state.movedNodeIds,
    origin: state.origin,
    startPoints: state.startPoints,
  };
};

interface PanGestureSnapshot {
  pointerId: number;
  origin: ScreenPoint;
  last: ScreenPoint;
}

type PanStateOfFunction = (state: GestureState) => PanGestureSnapshot;

const panStateOf: PanStateOfFunction = (
  state: GestureState,
): PanGestureSnapshot => {
  if (state.kind !== "pressBackground" && state.kind !== "pan") {
    throw new Error(`expected a background gesture, got ${state.kind}`);
  }
  return {
    pointerId: state.pointerId,
    origin: state.origin,
    last: state.last,
  };
};

interface PinchSnapshot {
  pointerA: number;
  pointerB: number;
  pointA: ScreenPoint;
  pointB: ScreenPoint;
  startDistancePx: number;
  startScale: number;
  anchorViewBox: ScreenPoint;
}

type PinchStateOfFunction = (state: GestureState) => PinchSnapshot;

const pinchStateOf: PinchStateOfFunction = (
  state: GestureState,
): PinchSnapshot => {
  if (state.kind !== "pinch") {
    throw new Error(`expected a pinch, got ${state.kind}`);
  }
  return {
    pointerA: state.pointerA,
    pointerB: state.pointerB,
    pointA: state.pointA,
    pointB: state.pointB,
    startDistancePx: state.startDistancePx,
    startScale: state.startScale,
    anchorViewBox: state.anchorViewBox,
  };
};

/* The world point currently sitting under a viewBox-space anchor. */
type WorldUnderAnchorFunction = (
  view: ViewTransform,
  anchor: ScreenPoint,
) => WorldPoint;

const worldUnderAnchor: WorldUnderAnchorFunction = (
  view: ViewTransform,
  anchor: ScreenPoint,
): WorldPoint => {
  return {
    x: (anchor.x - view.tx) / view.scale,
    y: (anchor.y - view.ty) / view.scale,
  };
};

/* Deterministic xorshift32 in [0, 1) — no Math.random anywhere in here. */
type NextRandomFunction = () => number;

const makeRandom: (seed: number) => NextRandomFunction = (
  seed: number,
): NextRandomFunction => {
  let state: number = seed | 0;
  return (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000003) / 1000003;
  };
};

interface GeneratedRun {
  effects: Array<GestureEffect>;
  stateKinds: Set<string>;
}

type GenerateRunFunction = (
  seed: number,
  hitNodeId: string | null,
  context: GestureContext,
) => GeneratedRun;

/*
 * A pseudo-random single-finger session. A pointerDown is only ever
 * generated from idle, so the corpus stays one-finger and never reaches
 * pinch — which legitimately zooms and so would not be a counterexample
 * to either headline property.
 */
const generateRun: GenerateRunFunction = (
  seed: number,
  hitNodeId: string | null,
  context: GestureContext,
): GeneratedRun => {
  const random: NextRandomFunction = makeRandom(seed);
  const effects: Array<GestureEffect> = [];
  const stateKinds: Set<string> = new Set<string>();
  let state: GestureState = initialGestureState;

  for (let step: number = 0; step < 40; step++) {
    const client: ScreenPoint = at(120 + random() * 900, 90 + random() * 500);
    let event: GestureEvent = escape();
    if (state.kind === "idle") {
      event = pointerDown(
        TRACKED_POINTER,
        client,
        hitNodeId,
        random() < 0.5 ? "mouse" : "touch",
      );
    } else {
      const roll: number = random();
      if (roll < 0.5) {
        event = pointerMove(TRACKED_POINTER, client);
      } else if (roll < 0.6) {
        event = pointerMove(FOREIGN_POINTER, client);
      } else if (roll < 0.78) {
        event = pointerUp(TRACKED_POINTER, client);
      } else if (roll < 0.84) {
        event = pointerUp(FOREIGN_POINTER, client);
      } else if (roll < 0.93) {
        event = pointerCancel(TRACKED_POINTER);
      }
    }
    const result: GestureResult = reduceGesture(state, event, context);
    state = result.state;
    stateKinds.add(state.kind);
    for (const effect of result.effects) {
      effects.push(effect);
    }
  }
  return { effects: effects, stateKinds: stateKinds };
};

const SEED_COUNT: number = 60;

describe("reduceGesture — a gesture that starts on a node never pans", () => {
  /*
   * THE HEADLINE REGRESSION. The reported symptom was that grabbing a
   * device slid the whole map, because pointerdown started a pan
   * regardless of what was under it. No sequence that begins on a node
   * may produce a setView, ever.
   */
  test("no one-finger sequence beginning on a node ever emits setView", () => {
    const seedsThatPanned: Array<number> = [];
    let moveNodesSeen: number = 0;
    let commitsSeen: number = 0;
    let revertsSeen: number = 0;
    let clicksSeen: number = 0;

    for (let seed: number = 1; seed <= SEED_COUNT; seed++) {
      const generated: GeneratedRun = generateRun(
        seed,
        "sw-a",
        LETTERBOX_CONTEXT,
      );
      if (countKind(generated.effects, "setView") > 0) {
        seedsThatPanned.push(seed);
      }
      moveNodesSeen += countKind(generated.effects, "moveNodes");
      commitsSeen += countKind(generated.effects, "commitNodePositions");
      revertsSeen += countKind(generated.effects, "revertNodePositions");
      clicksSeen += countKind(generated.effects, "emitNodeClick");
    }

    expect(seedsThatPanned).toEqual([]);
    /* ...and the corpus is not vacuous: it really did reach every exit. */
    expect(moveNodesSeen).toBeGreaterThan(0);
    expect(commitsSeen).toBeGreaterThan(0);
    expect(revertsSeen).toBeGreaterThan(0);
    expect(clicksSeen).toBeGreaterThan(0);
  });

  test("the reachable states of a one-finger node gesture are exactly idle, pressNode and dragNode", () => {
    const seen: Set<string> = new Set<string>();
    for (let seed: number = 1; seed <= SEED_COUNT; seed++) {
      for (const kind of generateRun(seed, "sw-a", LETTERBOX_CONTEXT)
        .stateKinds) {
        seen.add(kind);
      }
    }
    expect(Array.from(seen).sort()).toEqual(["dragNode", "idle", "pressNode"]);
  });

  test("every node effect names only nodes the context said travel together", () => {
    const context: GestureContext = makeContext({
      movedWith: new Map<string, ReadonlyArray<string>>([
        ["sw-a", ["sw-a", "ep-1", "ep-2"]],
      ]),
    });
    for (let seed: number = 1; seed <= 12; seed++) {
      for (const effect of generateRun(seed, "sw-a", context).effects) {
        if (
          effect.kind === "moveNodes" ||
          effect.kind === "commitNodePositions" ||
          effect.kind === "revertNodePositions"
        ) {
          expect(
            effect.moved.map((moved: MovedNodePosition): string => {
              return moved.nodeId;
            }),
          ).toEqual(["sw-a", "ep-1", "ep-2"]);
        }
      }
    }
  });
});

describe("reduceGesture — a gesture that starts on the background never moves a node", () => {
  test("no one-finger background sequence ever emits a node-position effect", () => {
    const seedsThatMovedNodes: Array<number> = [];
    let setViewSeen: number = 0;
    let backgroundClicks: number = 0;

    for (let seed: number = 1; seed <= SEED_COUNT; seed++) {
      const generated: GeneratedRun = generateRun(
        seed,
        null,
        LETTERBOX_CONTEXT,
      );
      const nodeEffects: number =
        countKind(generated.effects, "moveNodes") +
        countKind(generated.effects, "commitNodePositions") +
        countKind(generated.effects, "revertNodePositions") +
        countKind(generated.effects, "emitNodeClick");
      if (nodeEffects > 0) {
        seedsThatMovedNodes.push(seed);
      }
      setViewSeen += countKind(generated.effects, "setView");
      backgroundClicks += countKind(generated.effects, "emitBackgroundClick");
    }

    expect(seedsThatMovedNodes).toEqual([]);
    expect(setViewSeen).toBeGreaterThan(0);
    expect(backgroundClicks).toBeGreaterThan(0);
  });

  test("the reachable states of a one-finger background gesture are exactly idle, pan and pressBackground", () => {
    const seen: Set<string> = new Set<string>();
    for (let seed: number = 1; seed <= SEED_COUNT; seed++) {
      for (const kind of generateRun(seed, null, LETTERBOX_CONTEXT)
        .stateKinds) {
        seen.add(kind);
      }
    }
    expect(Array.from(seen).sort()).toEqual(["idle", "pan", "pressBackground"]);
  });

  test("no view a background drag produces is ever non-finite", () => {
    for (let seed: number = 1; seed <= 20; seed++) {
      for (const effect of generateRun(seed, null, LETTERBOX_CONTEXT).effects) {
        if (effect.kind === "setView") {
          expect(Number.isFinite(effect.view.scale)).toBe(true);
          expect(Number.isFinite(effect.view.tx)).toBe(true);
          expect(Number.isFinite(effect.view.ty)).toBe(true);
        }
      }
    }
  });
});

describe("reduceGesture — grab anchoring", () => {
  /*
   * THE JUMP-TO-CURSOR REGRESSION. Positions are the press-time position
   * plus the world delta travelled, never "the node goes under the
   * cursor". So with the pointer back at the press origin the delta is
   * exactly zero and the node is exactly where it started — to the bit,
   * which is why these use toBe and not toBeCloseTo.
   */
  test("returning to the press origin restores the exact original position", () => {
    const press: ScreenPoint = at(300, 250);
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, press, "sw-a"),
        pointerMove(TRACKED_POINTER, at(520, 410)),
        pointerMove(TRACKED_POINTER, press),
      ],
      SNUG_CONTEXT,
    );
    const point: WorldPoint = pointOf(movedOf(outcome.lastEffects[0]), "sw-a");
    expect(point.x).toBe(140);
    expect(point.y).toBe(220);
  });

  test("grab anchoring holds exactly through a letterboxed, offset, zoomed view", () => {
    const press: ScreenPoint = at(613.5, 287.25);
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, press, "sw-a"),
        pointerMove(TRACKED_POINTER, at(200.75, 601.5)),
        pointerMove(TRACKED_POINTER, at(900, 120)),
        pointerMove(TRACKED_POINTER, press),
      ],
      LETTERBOX_CONTEXT,
    );
    const point: WorldPoint = pointOf(movedOf(outcome.lastEffects[0]), "sw-a");
    /* Exactly, not approximately: no accumulated drift, no snapping. */
    expect(point.x).toBe(140);
    expect(point.y).toBe(220);
  });

  test("a node follows the pointer one world unit per world unit", () => {
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
        pointerMove(TRACKED_POINTER, at(360, 290)),
      ],
      SNUG_CONTEXT,
    );
    const point: WorldPoint = pointOf(movedOf(outcome.lastEffects[0]), "sw-a");
    expect(point.x).toBe(200);
    expect(point.y).toBe(260);
  });

  test("a zoomed-in graph moves the node by less world than screen", () => {
    const context: GestureContext = makeContext({
      view: { scale: 2, tx: 0, ty: 0 },
    });
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
        pointerMove(TRACKED_POINTER, at(400, 250)),
      ],
      context,
    );
    const point: WorldPoint = pointOf(movedOf(outcome.lastEffects[0]), "sw-a");
    /* 100 screen px at scale 2 is 50 world units, or the node runs away. */
    expect(point.x).toBeCloseTo(190, 6);
    expect(point.y).toBeCloseTo(220, 6);
  });

  test("companion nodes travel by the same delta as the grabbed one", () => {
    const context: GestureContext = makeContext({
      movedWith: new Map<string, ReadonlyArray<string>>([
        ["sw-a", ["sw-a", "ep-1", "ep-2"]],
      ]),
    });
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
        pointerMove(TRACKED_POINTER, at(330, 280)),
      ],
      context,
    );
    const moved: ReadonlyArray<MovedNodePosition> = movedOf(
      outcome.lastEffects[0],
    );
    expect(moved.length).toBe(3);
    expect(pointOf(moved, "sw-a")).toEqual({ x: 170, y: 250 });
    expect(pointOf(moved, "ep-1")).toEqual({ x: 90, y: 510 });
    expect(pointOf(moved, "ep-2")).toEqual({ x: 250, y: 510 });
  });

  test("a drag past the world limit is clamped rather than allowed to escape", () => {
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
        pointerMove(TRACKED_POINTER, at(9e9, -9e9)),
      ],
      SNUG_CONTEXT,
    );
    const point: WorldPoint = pointOf(movedOf(outcome.lastEffects[0]), "sw-a");
    expect(point.x).toBe(MAX_WORLD_COORDINATE);
    expect(point.y).toBe(-MAX_WORLD_COORDINATE);
  });
});

describe("reduceGesture — the click/drag threshold", () => {
  /*
   * What lets a click still work on a pannable canvas: below the
   * threshold NOTHING is emitted, and the pointerUp turns into exactly
   * one click.
   */
  test("a sub-threshold press on a node emits nothing until the pointerUp", () => {
    const press: ScreenPoint = at(300, 250);
    let state: GestureState = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, press, "sw-a"),
      SNUG_CONTEXT,
    ).state;

    const moved: GestureResult = reduceGesture(
      state,
      pointerMove(TRACKED_POINTER, at(303, 251)),
      SNUG_CONTEXT,
    );
    expect(moved.effects).toEqual([]);
    expect(moved.state.kind).toBe("pressNode");
    expect(nodeStateOf(moved.state).origin).toEqual(press);
    state = moved.state;

    const lifted: GestureResult = reduceGesture(
      state,
      pointerUp(TRACKED_POINTER, at(303, 251)),
      SNUG_CONTEXT,
    );
    expect(lifted.effects.length).toBe(1);
    expect(lifted.effects[0]).toEqual({
      kind: "emitNodeClick",
      nodeId: "sw-a",
    });
    expect(lifted.state.kind).toBe("idle");
  });

  test("a sub-threshold press on the background emits exactly one background click", () => {
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerMove(TRACKED_POINTER, at(302, 252)),
        pointerUp(TRACKED_POINTER, at(302, 252)),
      ],
      SNUG_CONTEXT,
    );
    expect(kindsOf(outcome.effects)).toEqual([
      "capturePointer",
      "emitBackgroundClick",
    ]);
    expect(outcome.state.kind).toBe("idle");
  });

  test("a sub-threshold background move still tracks the pointer without emitting", () => {
    const press: ScreenPoint = at(300, 250);
    const pressed: GestureResult = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, press, null),
      SNUG_CONTEXT,
    );
    const moved: GestureResult = reduceGesture(
      pressed.state,
      pointerMove(TRACKED_POINTER, at(302, 251)),
      SNUG_CONTEXT,
    );
    expect(moved.effects).toEqual([]);
    expect(moved.state.kind).toBe("pressBackground");
    /* The origin is what the threshold is measured from; it must not drift. */
    expect(panStateOf(moved.state).origin).toEqual(press);
    expect(panStateOf(moved.state).last).toEqual(at(302, 251));
  });

  test("the mouse threshold is exclusive: exactly 4px is still a click", () => {
    const onThreshold: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a", "mouse"),
        pointerMove(TRACKED_POINTER, at(300 + MOUSE_DRAG_THRESHOLD_PX, 250)),
        pointerUp(TRACKED_POINTER, at(300 + MOUSE_DRAG_THRESHOLD_PX, 250)),
      ],
      SNUG_CONTEXT,
    );
    expect(kindsOf(onThreshold.effects)).toEqual([
      "capturePointer",
      "emitNodeClick",
    ]);

    const pastThreshold: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a", "mouse"),
        pointerMove(
          TRACKED_POINTER,
          at(300 + MOUSE_DRAG_THRESHOLD_PX + 1, 250),
        ),
        pointerUp(TRACKED_POINTER, at(300 + MOUSE_DRAG_THRESHOLD_PX + 1, 250)),
      ],
      SNUG_CONTEXT,
    );
    expect(kindsOf(pastThreshold.effects)).toEqual([
      "capturePointer",
      "moveNodes",
      "commitNodePositions",
    ]);
  });

  test("touch gets a larger threshold than the mouse, because fingers wobble", () => {
    expect(TOUCH_DRAG_THRESHOLD_PX).toBeGreaterThan(MOUSE_DRAG_THRESHOLD_PX);
    const wobble: ScreenPoint = at(300 + MOUSE_DRAG_THRESHOLD_PX + 2, 250);
    const byTouch: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a", "touch"),
        pointerMove(TRACKED_POINTER, wobble),
        pointerUp(TRACKED_POINTER, wobble),
      ],
      SNUG_CONTEXT,
    );
    /* The same travel that drags with a mouse is still a tap on glass. */
    expect(kindsOf(byTouch.effects)).toEqual([
      "capturePointer",
      "emitNodeClick",
    ]);

    const byMouse: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a", "mouse"),
        pointerMove(TRACKED_POINTER, wobble),
        pointerUp(TRACKED_POINTER, wobble),
      ],
      SNUG_CONTEXT,
    );
    expect(kindsOf(byMouse.effects)).toContain("moveNodes");
  });

  test("once the node drag threshold is crossed the click never comes back", () => {
    const press: ScreenPoint = at(300, 250);
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, press, "sw-a"),
        pointerMove(TRACKED_POINTER, at(500, 250)),
        /* Back well inside the threshold radius — still a drag. */
        pointerMove(TRACKED_POINTER, at(301, 250)),
        pointerUp(TRACKED_POINTER, at(301, 250)),
      ],
      SNUG_CONTEXT,
    );
    expect(kindsOf(outcome.effects)).toEqual([
      "capturePointer",
      "moveNodes",
      "moveNodes",
      "commitNodePositions",
    ]);
    expect(countKind(outcome.effects, "emitNodeClick")).toBe(0);
  });

  test("once the pan threshold is crossed the background click never comes back", () => {
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerMove(TRACKED_POINTER, at(500, 250)),
        pointerMove(TRACKED_POINTER, at(301, 250)),
        pointerUp(TRACKED_POINTER, at(301, 250)),
      ],
      SNUG_CONTEXT,
    );
    expect(kindsOf(outcome.effects)).toEqual([
      "capturePointer",
      "setView",
      "setView",
    ]);
    expect(countKind(outcome.effects, "emitBackgroundClick")).toBe(0);
    expect(outcome.state.kind).toBe("idle");
  });

  test("a pan applies the full travel since the previous frame", () => {
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerMove(TRACKED_POINTER, at(400, 300)),
      ],
      SNUG_CONTEXT,
    );
    expect(viewOf(outcome.lastEffects[0])).toEqual({
      scale: 1,
      tx: 100,
      ty: 50,
    });
  });

  test("a pan never changes the zoom level", () => {
    const context: GestureContext = makeContext({
      view: { scale: 2.5, tx: 10, ty: -20 },
    });
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerMove(TRACKED_POINTER, at(500, 400)),
        pointerMove(TRACKED_POINTER, at(150, 90)),
      ],
      context,
    );
    for (const effect of outcome.effects) {
      if (effect.kind === "setView") {
        expect(effect.view.scale).toBe(2.5);
      }
    }
  });
});

describe("reduceGesture — purity", () => {
  type StateCaseFunction = () => Array<[string, GestureState]>;

  const allStates: StateCaseFunction = (): Array<[string, GestureState]> => {
    const pressBackground: GestureState = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), null),
      SNUG_CONTEXT,
    ).state;
    const pan: GestureState = reduceGesture(
      pressBackground,
      pointerMove(TRACKED_POINTER, at(500, 400)),
      SNUG_CONTEXT,
    ).state;
    const pressNode: GestureState = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
      SNUG_CONTEXT,
    ).state;
    const dragNode: GestureState = reduceGesture(
      pressNode,
      pointerMove(TRACKED_POINTER, at(500, 400)),
      SNUG_CONTEXT,
    ).state;
    const pinch: GestureState = reduceGesture(
      pressBackground,
      pointerDown(SECOND_POINTER, at(600, 500), null),
      SNUG_CONTEXT,
    ).state;
    return [
      ["idle", initialGestureState],
      ["pressBackground", pressBackground],
      ["pan", pan],
      ["pressNode", pressNode],
      ["dragNode", dragNode],
      ["pinch", pinch],
    ];
  };

  type EventCaseFunction = () => Array<[string, GestureEvent]>;

  const allEvents: EventCaseFunction = (): Array<[string, GestureEvent]> => {
    return [
      ["downOnNode", pointerDown(SECOND_POINTER, at(410, 330), "ep-1")],
      ["downOnBackground", pointerDown(SECOND_POINTER, at(410, 330), null)],
      [
        "downSecondary",
        secondaryPointerDown(SECOND_POINTER, at(410, 330), "ep-1"),
      ],
      ["moveTracked", pointerMove(TRACKED_POINTER, at(455, 372))],
      ["moveForeign", pointerMove(FOREIGN_POINTER, at(455, 372))],
      ["upTracked", pointerUp(TRACKED_POINTER, at(455, 372))],
      ["upForeign", pointerUp(FOREIGN_POINTER, at(455, 372))],
      ["cancelTracked", pointerCancel(TRACKED_POINTER)],
      ["cancelForeign", pointerCancel(FOREIGN_POINTER)],
      ["escape", escape()],
    ];
  };

  test("no (state, event) pair mutates the state object it was handed", () => {
    const mutated: Array<string> = [];
    for (const [stateName, state] of allStates()) {
      for (const [eventName, event] of allEvents()) {
        const before: string = JSON.stringify(state);
        reduceGesture(state, event, SNUG_CONTEXT);
        if (JSON.stringify(state) !== before) {
          mutated.push(`${stateName}/${eventName}`);
        }
      }
    }
    expect(mutated).toEqual([]);
  });

  test("the same state, event and context always give a deep-equal result", () => {
    const differed: Array<string> = [];
    for (const [stateName, state] of allStates()) {
      for (const [eventName, event] of allEvents()) {
        const first: GestureResult = reduceGesture(state, event, SNUG_CONTEXT);
        const second: GestureResult = reduceGesture(state, event, SNUG_CONTEXT);
        if (JSON.stringify(first) !== JSON.stringify(second)) {
          differed.push(`${stateName}/${eventName}`);
        }
      }
    }
    expect(differed).toEqual([]);
  });

  test("every reachable state serialises — no functions or cycles leak in", () => {
    for (const [, state] of allStates()) {
      expect(typeof JSON.stringify(state)).toBe("string");
    }
  });

  test("a start point is a copy, not a live reference into the position map", () => {
    const positions: Map<string, WorldPoint> = makePositions();
    const context: GestureContext = makeContext({ positions: positions });
    const pressed: GestureResult = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
      context,
    );
    /* Simulate the layout recomputing under the user's finger. */
    positions.get("sw-a")!.x = 9999;
    positions.get("sw-a")!.y = -9999;

    const reverted: GestureResult = reduceGesture(
      pressed.state,
      escape(),
      context,
    );
    expect(pointOf(movedOf(reverted.effects[0]), "sw-a")).toEqual({
      x: 140,
      y: 220,
    });
  });
});

describe("reduceGesture — presses the machine must ignore", () => {
  test("a non-primary pointerDown from idle is a total no-op", () => {
    const result: GestureResult = reduceGesture(
      initialGestureState,
      secondaryPointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
      SNUG_CONTEXT,
    );
    expect(result.state).toBe(initialGestureState);
    expect(result.effects).toEqual([]);
  });

  test("a non-primary pointerDown never disturbs a gesture in flight", () => {
    const pressed: GestureState = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
      SNUG_CONTEXT,
    ).state;
    const result: GestureResult = reduceGesture(
      pressed,
      secondaryPointerDown(SECOND_POINTER, at(600, 500), null),
      SNUG_CONTEXT,
    );
    /* Right-click must not start a pinch, and must not stamp any flag. */
    expect(result.state).toBe(pressed);
    expect(result.effects).toEqual([]);
  });

  test("moves, ups and cancels from a pointer we do not own change nothing", () => {
    const pressBackground: GestureState = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), null),
      SNUG_CONTEXT,
    ).state;
    const pan: GestureState = reduceGesture(
      pressBackground,
      pointerMove(TRACKED_POINTER, at(500, 400)),
      SNUG_CONTEXT,
    ).state;
    const pressNode: GestureState = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
      SNUG_CONTEXT,
    ).state;
    const dragNode: GestureState = reduceGesture(
      pressNode,
      pointerMove(TRACKED_POINTER, at(500, 400)),
      SNUG_CONTEXT,
    ).state;

    for (const state of [pressBackground, pan, pressNode, dragNode]) {
      for (const event of [
        pointerMove(FOREIGN_POINTER, at(700, 600)),
        pointerUp(FOREIGN_POINTER, at(700, 600)),
        pointerCancel(FOREIGN_POINTER),
      ]) {
        const result: GestureResult = reduceGesture(state, event, SNUG_CONTEXT);
        expect(result.state).toBe(state);
        expect(result.effects).toEqual([]);
      }
    }
  });

  test("moves, ups, cancels and escape from idle do nothing", () => {
    for (const event of [
      pointerMove(TRACKED_POINTER, at(400, 300)),
      pointerUp(TRACKED_POINTER, at(400, 300)),
      pointerCancel(TRACKED_POINTER),
      escape(),
    ]) {
      const result: GestureResult = reduceGesture(
        initialGestureState,
        event,
        SNUG_CONTEXT,
      );
      expect(result.state).toBe(initialGestureState);
      expect(result.effects).toEqual([]);
    }
  });
});

describe("reduceGesture — cancel and escape", () => {
  type PressNodeFunction = () => GestureState;

  const pressNode: PressNodeFunction = (): GestureState => {
    return reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
      SNUG_CONTEXT,
    ).state;
  };

  test("escape during a node drag puts the node back where it was pressed", () => {
    const dragged: GestureState = reduceGesture(
      pressNode(),
      pointerMove(TRACKED_POINTER, at(700, 600)),
      SNUG_CONTEXT,
    ).state;
    const result: GestureResult = reduceGesture(
      dragged,
      escape(),
      SNUG_CONTEXT,
    );
    expect(result.state.kind).toBe("idle");
    expect(result.effects.length).toBe(1);
    expect(result.effects[0]!.kind).toBe("revertNodePositions");
    /* The recorded start points, NOT the dragged ones. */
    expect(pointOf(movedOf(result.effects[0]), "sw-a")).toEqual({
      x: 140,
      y: 220,
    });
  });

  test("escape before the drag threshold still reverts, harmlessly", () => {
    const result: GestureResult = reduceGesture(
      pressNode(),
      escape(),
      SNUG_CONTEXT,
    );
    expect(result.state.kind).toBe("idle");
    expect(kindsOf(result.effects)).toEqual(["revertNodePositions"]);
  });

  test("pointerCancel during a node drag reverts to the recorded start points", () => {
    const context: GestureContext = makeContext({
      movedWith: new Map<string, ReadonlyArray<string>>([
        ["sw-a", ["sw-a", "ep-1"]],
      ]),
    });
    const pressed: GestureState = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
      context,
    ).state;
    const dragged: GestureState = reduceGesture(
      pressed,
      pointerMove(TRACKED_POINTER, at(700, 600)),
      context,
    ).state;
    const result: GestureResult = reduceGesture(
      dragged,
      pointerCancel(TRACKED_POINTER),
      context,
    );
    expect(kindsOf(result.effects)).toEqual(["revertNodePositions"]);
    const moved: ReadonlyArray<MovedNodePosition> = movedOf(result.effects[0]);
    expect(pointOf(moved, "sw-a")).toEqual({ x: 140, y: 220 });
    expect(pointOf(moved, "ep-1")).toEqual({ x: 60, y: 480 });
    expect(nodeStateOf(dragged).startPoints.length).toBe(2);
  });

  /*
   * Escape stops what is happening; it does not rewind the viewport. A
   * map that jumps back to where the pan started is disorienting, so a
   * pan exit deliberately emits nothing at all.
   */
  test("escape during a pan returns to idle and leaves the view alone", () => {
    const panned: GestureState = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerMove(TRACKED_POINTER, at(600, 500)),
      ],
      SNUG_CONTEXT,
    ).state;
    const result: GestureResult = reduceGesture(panned, escape(), SNUG_CONTEXT);
    expect(result.state.kind).toBe("idle");
    expect(result.effects).toEqual([]);
  });

  test("pointerCancel during a pan returns to idle and leaves the view alone", () => {
    const panned: GestureState = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerMove(TRACKED_POINTER, at(600, 500)),
      ],
      SNUG_CONTEXT,
    ).state;
    const result: GestureResult = reduceGesture(
      panned,
      pointerCancel(TRACKED_POINTER),
      SNUG_CONTEXT,
    );
    expect(result.state.kind).toBe("idle");
    expect(result.effects).toEqual([]);
  });

  test("escape during a sub-threshold background press cancels the click", () => {
    const pressed: GestureState = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), null),
      SNUG_CONTEXT,
    ).state;
    const result: GestureResult = reduceGesture(
      pressed,
      escape(),
      SNUG_CONTEXT,
    );
    expect(result.state.kind).toBe("idle");
    expect(result.effects).toEqual([]);
  });
});

describe("reduceGesture — pinch", () => {
  type StartPinchFunction = (
    firstHit: string | null,
    events: ReadonlyArray<GestureEvent>,
  ) => RunOutcome;

  const startPinch: StartPinchFunction = (
    firstHit: string | null,
    events: ReadonlyArray<GestureEvent>,
  ): RunOutcome => {
    return run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), firstHit),
        ...events,
        pointerDown(SECOND_POINTER, at(500, 350), null),
      ],
      SNUG_CONTEXT,
    );
  };

  test("a second finger during a node press enters pinch and moves nothing", () => {
    const outcome: RunOutcome = startPinch("sw-a", []);
    expect(outcome.lastEffects).toEqual([]);
    const pinch: PinchSnapshot = pinchStateOf(outcome.state);
    expect(pinch.pointerA).toBe(TRACKED_POINTER);
    expect(pinch.pointerB).toBe(SECOND_POINTER);
    expect(pinch.pointA).toEqual(at(300, 250));
    expect(pinch.pointB).toEqual(at(500, 350));
    expect(pinch.startScale).toBe(1);
    expect(pinch.startDistancePx).toBeCloseTo(Math.hypot(200, 100), 6);
    expect(pinch.anchorViewBox).toEqual(
      screenToViewBox(at(400, 300), SNUG_BOX, VIEW_BOX),
    );
  });

  test("a second finger during a node DRAG commits where the drag stands", () => {
    /*
     * REGRESSION. The node states carried no `last`, so this branch fell
     * back to the press origin and committed a zero-length delta —
     * silently discarding the drag the user had just performed, which is
     * the opposite of what the comment above it promises.
     */
    const outcome: RunOutcome = startPinch("sw-a", [
      pointerMove(TRACKED_POINTER, at(360, 290)),
    ]);
    expect(kindsOf(outcome.lastEffects)).toEqual(["commitNodePositions"]);
    expect(pointOf(movedOf(outcome.lastEffects[0]), "sw-a")).toEqual({
      x: 200,
      y: 260,
    });
    expect(outcome.state.kind).toBe("pinch");
  });

  test("a second finger during a background press enters pinch silently", () => {
    const outcome: RunOutcome = startPinch(null, []);
    expect(outcome.lastEffects).toEqual([]);
    expect(outcome.state.kind).toBe("pinch");
  });

  test("a pinch starting from a pan anchors on the current finger, not the press", () => {
    const outcome: RunOutcome = startPinch(null, [
      pointerMove(TRACKED_POINTER, at(700, 250)),
    ]);
    expect(pinchStateOf(outcome.state).pointA).toEqual(at(700, 250));
  });

  test("spreading the fingers to twice the span doubles the zoom", () => {
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerDown(SECOND_POINTER, at(500, 350), null),
        pointerMove(SECOND_POINTER, at(700, 450)),
      ],
      SNUG_CONTEXT,
    );
    expect(viewOf(outcome.lastEffects[0]).scale).toBeCloseTo(2, 6);
  });

  test("the pinch anchor holds the same world point under the fingers", () => {
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerDown(SECOND_POINTER, at(500, 350), null),
        pointerMove(SECOND_POINTER, at(700, 450)),
      ],
      SNUG_CONTEXT,
    );
    const anchor: ScreenPoint = screenToViewBox(
      at(400, 300),
      SNUG_BOX,
      VIEW_BOX,
    );
    const before: WorldPoint = worldUnderAnchor(IDENTITY, anchor);
    const after: WorldPoint = worldUnderAnchor(
      viewOf(outcome.lastEffects[0]),
      anchor,
    );
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  test("a pinch can never zoom past the declared limits", () => {
    const spread: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerDown(SECOND_POINTER, at(320, 250), null),
        pointerMove(SECOND_POINTER, at(9000, 250)),
      ],
      SNUG_CONTEXT,
    );
    expect(viewOf(spread.lastEffects[0]).scale).toBe(MAX_ZOOM);

    const squeeze: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerDown(SECOND_POINTER, at(900, 250), null),
        pointerMove(SECOND_POINTER, at(300, 250)),
      ],
      SNUG_CONTEXT,
    );
    expect(viewOf(squeeze.lastEffects[0]).scale).toBe(MIN_ZOOM);
  });

  test("a zero-span pinch is floored rather than producing an infinite scale", () => {
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerDown(SECOND_POINTER, at(300, 250), null),
        pointerMove(SECOND_POINTER, at(340, 250)),
      ],
      SNUG_CONTEXT,
    );
    expect(
      pinchStateOf(
        run(
          [
            pointerDown(TRACKED_POINTER, at(300, 250), null),
            pointerDown(SECOND_POINTER, at(300, 250), null),
          ],
          SNUG_CONTEXT,
        ).state,
      ).startDistancePx,
    ).toBe(1);
    expect(Number.isFinite(viewOf(outcome.lastEffects[0]).scale)).toBe(true);
    expect(viewOf(outcome.lastEffects[0]).scale).toBe(MAX_ZOOM);
  });

  test("a third finger is ignored rather than allowed to corrupt the pinch", () => {
    const pinch: GestureState = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerDown(SECOND_POINTER, at(500, 350), null),
      ],
      SNUG_CONTEXT,
    ).state;
    const result: GestureResult = reduceGesture(
      pinch,
      pointerDown(FOREIGN_POINTER, at(800, 600), "sw-a"),
      SNUG_CONTEXT,
    );
    expect(result.state).toBe(pinch);
    expect(result.effects).toEqual([]);
  });

  test("a move from a finger that is not in the pinch changes nothing", () => {
    const pinch: GestureState = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerDown(SECOND_POINTER, at(500, 350), null),
      ],
      SNUG_CONTEXT,
    ).state;
    const result: GestureResult = reduceGesture(
      pinch,
      pointerMove(FOREIGN_POINTER, at(900, 700)),
      SNUG_CONTEXT,
    );
    expect(result.state).toBe(pinch);
    expect(result.effects).toEqual([]);
  });

  test("lifting either finger ends the pinch instead of degrading to a pan", () => {
    const pinch: GestureState = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerDown(SECOND_POINTER, at(500, 350), null),
      ],
      SNUG_CONTEXT,
    ).state;
    for (const pointerId of [TRACKED_POINTER, SECOND_POINTER]) {
      const result: GestureResult = reduceGesture(
        pinch,
        pointerUp(pointerId, at(500, 350)),
        SNUG_CONTEXT,
      );
      expect(result.state.kind).toBe("idle");
      expect(result.effects).toEqual([]);
    }
  });

  test("lifting a foreign finger leaves the pinch running", () => {
    const pinch: GestureState = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerDown(SECOND_POINTER, at(500, 350), null),
      ],
      SNUG_CONTEXT,
    ).state;
    const result: GestureResult = reduceGesture(
      pinch,
      pointerUp(FOREIGN_POINTER, at(500, 350)),
      SNUG_CONTEXT,
    );
    expect(result.state).toBe(pinch);
    expect(result.effects).toEqual([]);
  });

  test("cancel and escape end a pinch without touching the view", () => {
    const pinch: GestureState = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerDown(SECOND_POINTER, at(500, 350), null),
      ],
      SNUG_CONTEXT,
    ).state;
    for (const event of [pointerCancel(SECOND_POINTER), escape()]) {
      const result: GestureResult = reduceGesture(pinch, event, SNUG_CONTEXT);
      expect(result.state.kind).toBe("idle");
      expect(result.effects).toEqual([]);
    }
    const foreign: GestureResult = reduceGesture(
      pinch,
      pointerCancel(FOREIGN_POINTER),
      SNUG_CONTEXT,
    );
    expect(foreign.state).toBe(pinch);
  });
});

describe("reduceGesture — pointer capture", () => {
  /*
   * REGRESSION. The old code captured on the SVG for a node press, which
   * retargets the eventual click to the SVG so nodes never saw it, and it
   * only captured after the pointer had already moved, so the first
   * pixels of a drag were lost.
   */
  test("a node press captures on the node, immediately", () => {
    const result: GestureResult = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
      SNUG_CONTEXT,
    );
    expect(result.effects).toEqual([
      { kind: "capturePointer", target: "node", pointerId: TRACKED_POINTER },
    ]);
  });

  test("a background press captures on the svg, immediately", () => {
    const result: GestureResult = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), null),
      SNUG_CONTEXT,
    );
    expect(result.effects).toEqual([
      { kind: "capturePointer", target: "svg", pointerId: TRACKED_POINTER },
    ]);
  });

  test("capture happens exactly once per gesture, on the press", () => {
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
        pointerMove(TRACKED_POINTER, at(400, 350)),
        pointerMove(TRACKED_POINTER, at(500, 450)),
        pointerUp(TRACKED_POINTER, at(500, 450)),
      ],
      SNUG_CONTEXT,
    );
    expect(countKind(outcome.effects, "capturePointer")).toBe(1);
    expect(outcome.effects[0]!.kind).toBe("capturePointer");
  });
});

describe("reduceGesture — degenerate and hostile input", () => {
  test("pressing a node the context has no position for still tracks the gesture", () => {
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "ghost"),
        pointerMove(TRACKED_POINTER, at(500, 450)),
      ],
      SNUG_CONTEXT,
    );
    expect(kindsOf(outcome.lastEffects)).toEqual(["moveNodes"]);
    expect(movedOf(outcome.lastEffects[0])).toEqual([]);
    expect(nodeStateOf(outcome.state).nodeId).toBe("ghost");
  });

  test("a node with a non-finite position is dropped from the drag, not propagated", () => {
    const positions: Map<string, WorldPoint> = makePositions();
    positions.set("broken", { x: Number.NaN, y: 10 });
    positions.set("infinite", { x: 10, y: Number.POSITIVE_INFINITY });
    const context: GestureContext = makeContext({
      positions: positions,
      movedWith: new Map<string, ReadonlyArray<string>>([
        ["sw-a", ["sw-a", "broken", "infinite"]],
      ]),
    });
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
        pointerMove(TRACKED_POINTER, at(400, 350)),
      ],
      context,
    );
    const moved: ReadonlyArray<MovedNodePosition> = movedOf(
      outcome.lastEffects[0],
    );
    expect(
      moved.map((position: MovedNodePosition): string => {
        return position.nodeId;
      }),
    ).toEqual(["sw-a"]);
    /* The state still remembers that they were meant to travel along. */
    expect(nodeStateOf(outcome.state).movedNodeIds.length).toBe(3);
  });

  test("an empty travel-with set produces an empty move rather than throwing", () => {
    const context: GestureContext = makeContext({
      movedWith: new Map<string, ReadonlyArray<string>>([["sw-a", []]]),
    });
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
        pointerMove(TRACKED_POINTER, at(400, 350)),
        pointerUp(TRACKED_POINTER, at(400, 350)),
      ],
      context,
    );
    expect(kindsOf(outcome.effects)).toEqual([
      "capturePointer",
      "moveNodes",
      "commitNodePositions",
    ]);
    expect(movedOf(outcome.effects[2])).toEqual([]);
  });

  test("a non-finite pointer position can never latch a press into a drag", () => {
    const pressed: GestureState = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
      SNUG_CONTEXT,
    ).state;
    const result: GestureResult = reduceGesture(
      pressed,
      pointerMove(TRACKED_POINTER, at(Number.NaN, Number.NaN)),
      SNUG_CONTEXT,
    );
    expect(result.state.kind).toBe("pressNode");
    expect(result.effects).toEqual([]);
  });

  test("a non-finite pointer position never writes a NaN into the view", () => {
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerMove(TRACKED_POINTER, at(600, 500)),
        pointerMove(TRACKED_POINTER, at(Number.NaN, 500)),
      ],
      SNUG_CONTEXT,
    );
    const view: ViewTransform = viewOf(outcome.lastEffects[0]);
    expect(Number.isFinite(view.tx)).toBe(true);
    expect(Number.isFinite(view.ty)).toBe(true);
    expect(Number.isFinite(view.scale)).toBe(true);
  });

  test("a zero-sized element box degrades to a no-op transform instead of NaN", () => {
    const context: GestureContext = makeContext({
      box: { left: 0, top: 0, width: 0, height: 0 },
    });
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
        pointerMove(TRACKED_POINTER, at(600, 500)),
      ],
      context,
    );
    const point: WorldPoint = pointOf(movedOf(outcome.lastEffects[0]), "sw-a");
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });

  test("a node press and release on the same pixel is a click, not a zero-length drag", () => {
    const outcome: RunOutcome = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
        pointerUp(TRACKED_POINTER, at(300, 250)),
      ],
      SNUG_CONTEXT,
    );
    expect(kindsOf(outcome.effects)).toEqual([
      "capturePointer",
      "emitNodeClick",
    ]);
  });

  test("initialGestureState is idle", () => {
    expect(initialGestureState.kind).toBe("idle");
  });
});

type MakeEdgeFunction = (from: string, to: string) => NetworkTopologyEdge;

const makeEdge: MakeEdgeFunction = (
  from: string,
  to: string,
): NetworkTopologyEdge => {
  return { fromNodeId: from, toNodeId: to };
};

type SortedFunction = (values: Iterable<string>) => Array<string>;

const sorted: SortedFunction = (values: Iterable<string>): Array<string> => {
  return Array.from(values).sort();
};

describe("buildAdjacencyIndex", () => {
  test("adjacency is symmetric — both ends learn about the link", () => {
    const adjacency: Map<string, Set<string>> = buildAdjacencyIndex([
      makeEdge("a", "b"),
    ]);
    expect(sorted(adjacency.get("a")!)).toEqual(["b"]);
    expect(sorted(adjacency.get("b")!)).toEqual(["a"]);
    expect(adjacency.size).toBe(2);
  });

  test("a self-loop is not a neighbour relationship", () => {
    const adjacency: Map<string, Set<string>> = buildAdjacencyIndex([
      makeEdge("a", "a"),
    ]);
    expect(adjacency.size).toBe(0);
    expect(adjacency.has("a")).toBe(false);
  });

  test("duplicate and flipped edges collapse into one neighbour", () => {
    const adjacency: Map<string, Set<string>> = buildAdjacencyIndex([
      makeEdge("a", "b"),
      makeEdge("a", "b"),
      makeEdge("b", "a"),
    ]);
    expect(sorted(adjacency.get("a")!)).toEqual(["b"]);
    expect(sorted(adjacency.get("b")!)).toEqual(["a"]);
  });

  test("a node keeps every distinct neighbour", () => {
    const adjacency: Map<string, Set<string>> = buildAdjacencyIndex([
      makeEdge("hub", "a"),
      makeEdge("b", "hub"),
      makeEdge("hub", "c"),
    ]);
    expect(sorted(adjacency.get("hub")!)).toEqual(["a", "b", "c"]);
    expect(sorted(adjacency.get("b")!)).toEqual(["hub"]);
  });

  test("an edge naming a node that is not in the view is still indexed", () => {
    /*
     * The index sees edges only, so it cannot know a node was filtered
     * out. It must not drop the surviving end's entry over it.
     */
    const adjacency: Map<string, Set<string>> = buildAdjacencyIndex([
      makeEdge("sw-a", "gone"),
    ]);
    expect(sorted(adjacency.get("sw-a")!)).toEqual(["gone"]);
  });

  test("empty, missing and malformed edge lists produce an empty index", () => {
    expect(buildAdjacencyIndex([]).size).toBe(0);
    expect(
      buildAdjacencyIndex(
        undefined as unknown as ReadonlyArray<NetworkTopologyEdge>,
      ).size,
    ).toBe(0);
    const hostile: ReadonlyArray<NetworkTopologyEdge> = [
      null,
      undefined,
      { fromNodeId: "", toNodeId: "b" },
      { fromNodeId: "a", toNodeId: "" },
    ] as unknown as ReadonlyArray<NetworkTopologyEdge>;
    expect(buildAdjacencyIndex(hostile).size).toBe(0);
  });

  test("a malformed edge does not stop the good ones being indexed", () => {
    const mixed: ReadonlyArray<NetworkTopologyEdge> = [
      null,
      makeEdge("a", "b"),
      { fromNodeId: "c" },
      makeEdge("b", "c"),
    ] as unknown as ReadonlyArray<NetworkTopologyEdge>;
    const adjacency: Map<string, Set<string>> = buildAdjacencyIndex(mixed);
    expect(sorted(adjacency.get("b")!)).toEqual(["a", "c"]);
    expect(adjacency.size).toBe(3);
  });

  test("the index is order independent", () => {
    const edges: Array<NetworkTopologyEdge> = [
      makeEdge("a", "b"),
      makeEdge("b", "c"),
      makeEdge("c", "a"),
    ];
    const forward: Map<string, Set<string>> = buildAdjacencyIndex(edges);
    const backward: Map<string, Set<string>> = buildAdjacencyIndex(
      [...edges].reverse(),
    );
    for (const id of ["a", "b", "c"]) {
      expect(sorted(backward.get(id)!)).toEqual(sorted(forward.get(id)!));
    }
  });
});

describe("neighborIdsOf", () => {
  const adjacency: Map<string, Set<string>> = buildAdjacencyIndex([
    makeEdge("a", "b"),
    makeEdge("a", "a"),
    makeEdge("b", "c"),
  ]);

  test("a node is never its own neighbour, even given a self-loop", () => {
    expect(neighborIdsOf(adjacency, "a").has("a")).toBe(false);
    expect(sorted(neighborIdsOf(adjacency, "a"))).toEqual(["b"]);
  });

  test("an unknown id yields an empty set, not undefined", () => {
    const neighbors: ReadonlySet<string> = neighborIdsOf(adjacency, "nope");
    expect(neighbors.size).toBe(0);
    expect(neighbors.has("a")).toBe(false);
  });

  test("neighbours are one hop only", () => {
    expect(sorted(neighborIdsOf(adjacency, "a"))).toEqual(["b"]);
    expect(sorted(neighborIdsOf(adjacency, "b"))).toEqual(["a", "c"]);
  });
});

describe("focusSetFor", () => {
  const adjacency: Map<string, Set<string>> = buildAdjacencyIndex([
    makeEdge("a", "b"),
    makeEdge("b", "c"),
    makeEdge("c", "d"),
  ]);

  /*
   * THE CONTRACT THAT MATTERS MOST HERE. An empty selection returns an
   * EMPTY set, which the caller must read as "dim nothing". Reading it as
   * "dim everything" blanks the whole map the moment nothing is selected.
   */
  test("an empty selection returns an empty set meaning dim nothing", () => {
    expect(focusSetFor(adjacency, new Set<string>(), false).size).toBe(0);
    expect(focusSetFor(adjacency, new Set<string>(), true).size).toBe(0);
  });

  test("without neighbours the focus set is exactly the selection", () => {
    const focus: ReadonlySet<string> = focusSetFor(
      adjacency,
      new Set<string>(["a", "d"]),
      false,
    );
    expect(sorted(focus)).toEqual(["a", "d"]);
  });

  test("including neighbours adds exactly one hop, never two", () => {
    const focus: ReadonlySet<string> = focusSetFor(
      adjacency,
      new Set<string>(["a"]),
      true,
    );
    expect(sorted(focus)).toEqual(["a", "b"]);
    /* "c" is two hops from "a" and must stay dimmed. */
    expect(focus.has("c")).toBe(false);
  });

  test("neighbours of several selected nodes are unioned without duplicates", () => {
    const focus: ReadonlySet<string> = focusSetFor(
      adjacency,
      new Set<string>(["a", "c"]),
      true,
    );
    expect(sorted(focus)).toEqual(["a", "b", "c", "d"]);
    expect(focus.size).toBe(4);
  });

  test("a selected node with no edges focuses only itself", () => {
    const focus: ReadonlySet<string> = focusSetFor(
      adjacency,
      new Set<string>(["lonely"]),
      true,
    );
    expect(sorted(focus)).toEqual(["lonely"]);
  });

  test("the caller's selection set is never mutated or handed back", () => {
    const selection: Set<string> = new Set<string>(["a"]);
    const focus: ReadonlySet<string> = focusSetFor(adjacency, selection, true);
    expect(focus).not.toBe(selection);
    expect(sorted(selection)).toEqual(["a"]);
    expect(selection.size).toBe(1);
  });
});

describe("isGestureSuppressingClick", () => {
  test("a press that has not yet moved still permits a click", () => {
    const pressNode: GestureState = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
      SNUG_CONTEXT,
    ).state;
    const pressBackground: GestureState = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), null),
      SNUG_CONTEXT,
    ).state;
    expect(isGestureSuppressingClick(initialGestureState)).toBe(false);
    expect(isGestureSuppressingClick(pressNode)).toBe(false);
    expect(isGestureSuppressingClick(pressBackground)).toBe(false);
  });

  test("anything that has actually moved suppresses the click", () => {
    const pan: GestureState = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerMove(TRACKED_POINTER, at(600, 500)),
      ],
      SNUG_CONTEXT,
    ).state;
    const dragNode: GestureState = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
        pointerMove(TRACKED_POINTER, at(600, 500)),
      ],
      SNUG_CONTEXT,
    ).state;
    const pinch: GestureState = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerDown(SECOND_POINTER, at(500, 350), null),
      ],
      SNUG_CONTEXT,
    ).state;
    expect(isGestureSuppressingClick(pan)).toBe(true);
    expect(isGestureSuppressingClick(dragNode)).toBe(true);
    expect(isGestureSuppressingClick(pinch)).toBe(true);
  });
});

describe("cursorForGesture", () => {
  test("hovering a node offers a grab, empty canvas offers nothing", () => {
    expect(cursorForGesture(initialGestureState, true)).toBe("grab");
    expect(cursorForGesture(initialGestureState, false)).toBe("default");
  });

  test("holding or dragging anything shows a closed hand", () => {
    const pressNode: GestureState = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
      SNUG_CONTEXT,
    ).state;
    const dragNode: GestureState = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), "sw-a"),
        pointerMove(TRACKED_POINTER, at(600, 500)),
      ],
      SNUG_CONTEXT,
    ).state;
    const pan: GestureState = run(
      [
        pointerDown(TRACKED_POINTER, at(300, 250), null),
        pointerMove(TRACKED_POINTER, at(600, 500)),
      ],
      SNUG_CONTEXT,
    ).state;
    expect(cursorForGesture(pressNode, false)).toBe("grabbing");
    expect(cursorForGesture(dragNode, false)).toBe("grabbing");
    expect(cursorForGesture(pan, false)).toBe("grabbing");
    /* A node gesture wins over the hover state, not the other way round. */
    expect(cursorForGesture(dragNode, true)).toBe("grabbing");
  });

  test("a background press that has not become a pan still shows the hover cursor", () => {
    const pressBackground: GestureState = reduceGesture(
      initialGestureState,
      pointerDown(TRACKED_POINTER, at(300, 250), null),
      SNUG_CONTEXT,
    ).state;
    expect(cursorForGesture(pressBackground, true)).toBe("grab");
    expect(cursorForGesture(pressBackground, false)).toBe("default");
  });
});
