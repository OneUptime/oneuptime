import { describe, expect, test } from "@jest/globals";
import {
  ElementBox,
  FIT_PADDING_FRACTION,
  FitMetrics,
  IDENTITY_VIEW,
  MAX_WORLD_COORDINATE,
  MAX_ZOOM,
  MIN_ZOOM,
  MOUSE_DRAG_THRESHOLD_PX,
  ScreenPoint,
  TOUCH_DRAG_THRESHOLD_PX,
  ViewBoxSize,
  ViewTransform,
  WHEEL_LINE_HEIGHT_PX,
  WorldBounds,
  WorldPoint,
  applyZoomAtPoint,
  clampWorldPoint,
  computeGraphBounds,
  dragThresholdExceeded,
  fitMetricsForBox,
  fitViewToBounds,
  normalizeWheelDeltaPx,
  panBy,
  screenDeltaToViewBoxDelta,
  screenDeltaToWorldDelta,
  screenToViewBox,
  screenToWorld,
  snapToGrid,
  viewsMatch,
  worldToScreen,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyViewport";

/*
 * The viewBox the topology SVG actually declares, and the box shape from
 * the bug report: a 16:9 panel showing a very tall tiered graph. The
 * drawing is pillarboxed by 439px on each side, so an implementation that
 * assumes the drawing fills the element is wrong by a third of the width.
 */
const TALL_VIEW_BOX: ViewBoxSize = { width: 1000, height: 2100 };
const PANEL_BOX: ElementBox = { left: 0, top: 0, width: 1200, height: 675 };

const STANDARD_VIEW_BOX: ViewBoxSize = { width: 1000, height: 700 };

type MakeBoxFunction = (
  left: number,
  top: number,
  width: number,
  height: number,
) => ElementBox;

const box: MakeBoxFunction = (
  left: number,
  top: number,
  width: number,
  height: number,
): ElementBox => {
  return { left: left, top: top, width: width, height: height };
};

type MakeViewFunction = (
  scale: number,
  tx: number,
  ty: number,
) => ViewTransform;

const view: MakeViewFunction = (
  scale: number,
  tx: number,
  ty: number,
): ViewTransform => {
  return { scale: scale, tx: tx, ty: ty };
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

/* The world point currently sitting under a viewBox-space anchor. */
type WorldUnderAnchorFunction = (
  transform: ViewTransform,
  anchor: ScreenPoint,
) => WorldPoint;

const worldUnderAnchor: WorldUnderAnchorFunction = (
  transform: ViewTransform,
  anchor: ScreenPoint,
): WorldPoint => {
  return {
    x: (anchor.x - transform.tx) / transform.scale,
    y: (anchor.y - transform.ty) / transform.scale,
  };
};

describe("fitMetricsForBox — resolving xMidYMid meet", () => {
  /*
   * THE HEADLINE CASE, lifted straight from the failure report. A 1200x675
   * panel showing a 1000x2100 viewBox: height binds, so the drawing is
   * only 321px wide and sits 439px in from the left edge. Every downstream
   * conversion is built on exactly these three numbers.
   */
  test("a tall graph in a wide panel scales by height and pillarboxes by 439px", () => {
    const fit: FitMetrics = fitMetricsForBox(PANEL_BOX, TALL_VIEW_BOX);
    expect(fit.scale).toBeCloseTo(0.3214286, 6);
    expect(fit.scale).toBeCloseTo(0.32142857142857145, 12);
    expect(fit.offsetX).toBeCloseTo(439.29, 1);
    expect(fit.offsetX).toBeCloseTo(439.2857142857143, 9);
    /* Height is the binding axis, so there is no vertical letterbox. */
    expect(fit.offsetY).toBe(0);
  });

  test("the scale is the smaller of the two axis ratios, never the larger", () => {
    const fit: FitMetrics = fitMetricsForBox(PANEL_BOX, TALL_VIEW_BOX);
    expect(fit.scale).toBeLessThan(PANEL_BOX.width / TALL_VIEW_BOX.width);
    expect(fit.scale).toBeCloseTo(PANEL_BOX.height / TALL_VIEW_BOX.height, 12);
  });

  test("a pillarboxed fit leaves equal bars on the left and right only", () => {
    const fit: FitMetrics = fitMetricsForBox(
      box(0, 0, 1600, 700),
      STANDARD_VIEW_BOX,
    );
    /* 1600/1000 = 1.6 against 700/700 = 1, so height binds at scale 1. */
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(300);
    expect(fit.offsetY).toBe(0);
    /* Drawn width plus both bars accounts for the whole element. */
    expect(fit.offsetX * 2 + STANDARD_VIEW_BOX.width * fit.scale).toBe(1600);
  });

  test("a letterboxed fit leaves equal bars on the top and bottom only", () => {
    const fit: FitMetrics = fitMetricsForBox(
      box(0, 0, 1200, 900),
      STANDARD_VIEW_BOX,
    );
    /* 1200/1000 = 1.2 against 900/700 = 1.2857, so width binds. */
    expect(fit.scale).toBeCloseTo(1.2, 12);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBeCloseTo(30, 12);
    expect(fit.offsetY * 2 + STANDARD_VIEW_BOX.height * fit.scale).toBeCloseTo(
      900,
      9,
    );
  });

  test("an exact-aspect box has no bars at all on either axis", () => {
    const fit: FitMetrics = fitMetricsForBox(
      box(0, 0, 2000, 1400),
      STANDARD_VIEW_BOX,
    );
    expect(fit.scale).toBe(2);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBe(0);
  });

  test("the drawing always fits inside the box and never overflows it", () => {
    const shapes: ReadonlyArray<ElementBox> = [
      box(0, 0, 1200, 675),
      box(0, 0, 320, 900),
      box(0, 0, 1000, 700),
      box(0, 0, 1, 4000),
      box(0, 0, 4000, 1),
    ];
    for (const shape of shapes) {
      const fit: FitMetrics = fitMetricsForBox(shape, TALL_VIEW_BOX);
      /*
       * A bar is never negative. The binding axis computes its bar as
       * (w - vw * (w / vw)) / 2, which can land a few ULP either side of
       * zero, so the floor carries a float tolerance rather than being 0.
       */
      expect(fit.offsetX).toBeGreaterThan(-1e-9);
      expect(fit.offsetY).toBeGreaterThan(-1e-9);
      expect(
        fit.offsetX * 2 + TALL_VIEW_BOX.width * fit.scale,
      ).toBeLessThanOrEqual(shape.width + 1e-9);
      expect(
        fit.offsetY * 2 + TALL_VIEW_BOX.height * fit.scale,
      ).toBeLessThanOrEqual(shape.height + 1e-9);
      /* At least one axis binds exactly — "meet" never under-scales. */
      expect(Math.min(fit.offsetX, fit.offsetY)).toBeCloseTo(0, 9);
    }
  });

  test("the element's page position never changes the fit", () => {
    const atOrigin: FitMetrics = fitMetricsForBox(
      box(0, 0, 1200, 675),
      TALL_VIEW_BOX,
    );
    const scrolledAway: FitMetrics = fitMetricsForBox(
      box(-317.5, 928.25, 1200, 675),
      TALL_VIEW_BOX,
    );
    expect(scrolledAway).toEqual(atOrigin);
  });

  test("a collapsed or hostile box falls back to a finite identity fit", () => {
    const degenerate: ReadonlyArray<ElementBox> = [
      box(0, 0, 0, 675),
      box(0, 0, 1200, 0),
      box(0, 0, -1200, 675),
      box(0, 0, Number.NaN, 675),
      box(0, 0, 1200, Number.POSITIVE_INFINITY),
      box(Number.NaN, 0, 1200, 675),
      box(0, Number.NaN, 1200, 675),
    ];
    for (const shape of degenerate) {
      expect(fitMetricsForBox(shape, TALL_VIEW_BOX)).toEqual({
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      });
    }
  });

  test("a collapsed or hostile viewBox falls back to a finite identity fit", () => {
    const degenerate: ReadonlyArray<ViewBoxSize> = [
      { width: 0, height: 700 },
      { width: 1000, height: 0 },
      { width: Number.NaN, height: 700 },
      { width: 1000, height: Number.POSITIVE_INFINITY },
      { width: -1000, height: -700 },
    ];
    for (const size of degenerate) {
      const fit: FitMetrics = fitMetricsForBox(PANEL_BOX, size);
      expect(fit).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
      expect(Number.isFinite(fit.scale)).toBe(true);
    }
  });
});

describe("screenToWorld — the letterbox correction", () => {
  /*
   * REGRESSION. The old conversion was (clientX - left) / width * viewBox
   * width, which pretends the drawing fills the element. On the reported
   * panel that put the left edge of the drawing at world x 366 instead of
   * 0 — the whole map panned at a third of pointer speed.
   */
  test("the drawing's left edge is world x 0, not a third of the way across", () => {
    const atLeftBar: WorldPoint = screenToWorld(
      { x: 439.29, y: 0 },
      PANEL_BOX,
      TALL_VIEW_BOX,
      IDENTITY_VIEW,
    );
    expect(atLeftBar.x).toBeCloseTo(0, 1);
    expect(atLeftBar.y).toBe(0);

    const naiveX: number =
      ((439.29 - PANEL_BOX.left) / PANEL_BOX.width) * TALL_VIEW_BOX.width;
    expect(naiveX).toBeCloseTo(366.075, 3);
    expect(Math.abs(naiveX - atLeftBar.x)).toBeGreaterThan(300);
  });

  test("the drawing's right edge is world x 1000 under the same panel", () => {
    const atRightBar: WorldPoint = screenToWorld(
      { x: 1200 - 439.29, y: 0 },
      PANEL_BOX,
      TALL_VIEW_BOX,
      IDENTITY_VIEW,
    );
    expect(atRightBar.x).toBeCloseTo(1000, 1);

    const naiveX: number =
      ((1200 - 439.29 - PANEL_BOX.left) / PANEL_BOX.width) *
      TALL_VIEW_BOX.width;
    expect(naiveX).toBeCloseTo(633.925, 3);
    expect(Math.abs(naiveX - atRightBar.x)).toBeGreaterThan(300);
  });

  test("the panel's own edges map outside the drawing, into the bars", () => {
    const atPanelLeft: WorldPoint = screenToWorld(
      { x: 0, y: 0 },
      PANEL_BOX,
      TALL_VIEW_BOX,
      IDENTITY_VIEW,
    );
    const atPanelRight: WorldPoint = screenToWorld(
      { x: 1200, y: 675 },
      PANEL_BOX,
      TALL_VIEW_BOX,
      IDENTITY_VIEW,
    );
    /* A click on the pillarbox is genuinely off-graph, and says so. */
    expect(atPanelLeft.x).toBeLessThan(0);
    expect(atPanelRight.x).toBeGreaterThan(TALL_VIEW_BOX.width);
    /* Height binds, so the panel's top and bottom are the graph's. */
    expect(atPanelLeft.y).toBe(0);
    expect(atPanelRight.y).toBeCloseTo(TALL_VIEW_BOX.height, 9);
  });

  test("the drawing's centre is the viewBox centre whatever the panel shape", () => {
    const shapes: ReadonlyArray<ElementBox> = [
      PANEL_BOX,
      box(0, 0, 1600, 700),
      box(0, 0, 1200, 900),
      box(0, 0, 2000, 1400),
    ];
    for (const shape of shapes) {
      const centre: WorldPoint = screenToWorld(
        {
          x: shape.left + shape.width / 2,
          y: shape.top + shape.height / 2,
        },
        shape,
        STANDARD_VIEW_BOX,
        IDENTITY_VIEW,
      );
      expect(centre.x).toBeCloseTo(STANDARD_VIEW_BOX.width / 2, 9);
      expect(centre.y).toBeCloseTo(STANDARD_VIEW_BOX.height / 2, 9);
    }
  });

  test("a scrolled element's origin is subtracted before anything else", () => {
    const scrolled: ElementBox = box(317.5, 928.25, 1200, 675);
    const world: WorldPoint = screenToWorld(
      { x: 317.5 + 439.2857142857143, y: 928.25 },
      scrolled,
      TALL_VIEW_BOX,
      IDENTITY_VIEW,
    );
    expect(world.x).toBeCloseTo(0, 9);
    expect(world.y).toBeCloseTo(0, 9);
  });

  test("screenToViewBox is the same conversion stopped one stage early", () => {
    const client: ScreenPoint = { x: 812.5, y: 233.75 };
    const inViewBox: ScreenPoint = screenToViewBox(
      client,
      PANEL_BOX,
      TALL_VIEW_BOX,
    );
    const identityWorld: WorldPoint = screenToWorld(
      client,
      PANEL_BOX,
      TALL_VIEW_BOX,
      IDENTITY_VIEW,
    );
    expect(inViewBox.x).toBeCloseTo(identityWorld.x, 9);
    expect(inViewBox.y).toBeCloseTo(identityWorld.y, 9);
  });

  test("a non-finite or zero view scale degrades to scale 1 rather than NaN", () => {
    const client: ScreenPoint = { x: 812.5, y: 233.75 };
    const reference: WorldPoint = screenToWorld(
      client,
      PANEL_BOX,
      TALL_VIEW_BOX,
      view(1, 40, -25),
    );
    for (const broken of [Number.NaN, 0, Number.POSITIVE_INFINITY]) {
      const result: WorldPoint = screenToWorld(
        client,
        PANEL_BOX,
        TALL_VIEW_BOX,
        view(broken, 40, -25),
      );
      expect(result.x).toBeCloseTo(reference.x, 9);
      expect(result.y).toBeCloseTo(reference.y, 9);
    }
  });
});

describe("screenToWorld and worldToScreen are exact inverses", () => {
  const boxes: ReadonlyArray<ElementBox> = [
    PANEL_BOX,
    box(0, 0, 1600, 700),
    box(0, 0, 1200, 900),
    box(0, 0, 1000, 700),
    box(-317.5, 928.25, 1200, 675),
  ];
  const transforms: ReadonlyArray<ViewTransform> = [
    view(MIN_ZOOM, 0, 0),
    view(0.5, -120.5, 37.25),
    view(1, 0, 0),
    view(2, 311.75, -88.5),
    view(MAX_ZOOM, -640, 512),
  ];
  const worldPoints: ReadonlyArray<WorldPoint> = [
    { x: 0, y: 0 },
    { x: 1000, y: 2100 },
    { x: -350.25, y: 977.5 },
    { x: 12345.5, y: -6789.25 },
    { x: 0.001, y: -0.001 },
  ];

  test("world to screen and back returns the original point to 1e-9", () => {
    for (const shape of boxes) {
      for (const transform of transforms) {
        for (const point of worldPoints) {
          const screen: ScreenPoint = worldToScreen(
            point,
            shape,
            TALL_VIEW_BOX,
            transform,
          );
          const back: WorldPoint = screenToWorld(
            screen,
            shape,
            TALL_VIEW_BOX,
            transform,
          );
          expect(Math.abs(back.x - point.x)).toBeLessThan(1e-9);
          expect(Math.abs(back.y - point.y)).toBeLessThan(1e-9);
        }
      }
    }
  });

  test("screen to world and back returns the original pixel to 1e-9", () => {
    for (const shape of boxes) {
      for (const transform of transforms) {
        const clientPoints: ReadonlyArray<ScreenPoint> = [
          { x: shape.left, y: shape.top },
          { x: shape.left + shape.width, y: shape.top + shape.height },
          { x: shape.left + shape.width / 3, y: shape.top + shape.height / 7 },
        ];
        for (const client of clientPoints) {
          const world: WorldPoint = screenToWorld(
            client,
            shape,
            TALL_VIEW_BOX,
            transform,
          );
          const back: ScreenPoint = worldToScreen(
            world,
            shape,
            TALL_VIEW_BOX,
            transform,
          );
          expect(Math.abs(back.x - client.x)).toBeLessThan(1e-9);
          expect(Math.abs(back.y - client.y)).toBeLessThan(1e-9);
        }
      }
    }
  });

  test("the round trip survives pseudo-random boxes, views and points", () => {
    const random: NextRandomFunction = makeRandom(0x5eed1234);
    for (let i: number = 0; i < 200; i++) {
      const shape: ElementBox = box(
        random() * 2000 - 1000,
        random() * 2000 - 1000,
        20 + random() * 2400,
        20 + random() * 1600,
      );
      const size: ViewBoxSize = {
        width: 200 + random() * 2000,
        height: 200 + random() * 2000,
      };
      const transform: ViewTransform = view(
        MIN_ZOOM + random() * (MAX_ZOOM - MIN_ZOOM),
        random() * 2000 - 1000,
        random() * 2000 - 1000,
      );
      const point: WorldPoint = {
        x: random() * 4000 - 2000,
        y: random() * 4000 - 2000,
      };
      const back: WorldPoint = screenToWorld(
        worldToScreen(point, shape, size, transform),
        shape,
        size,
        transform,
      );
      /*
       * Looser than the enumerated grid on purpose: the fuzz reaches fit
       * scales near 0.008, which multiplies the pixel-space ULP by more
       * than a hundred on the way back out.
       */
      expect(Math.abs(back.x - point.x)).toBeLessThan(1e-6);
      expect(Math.abs(back.y - point.y)).toBeLessThan(1e-6);
    }
  });

  test("worldToScreen places the graph origin at the drawing's origin", () => {
    const fit: FitMetrics = fitMetricsForBox(PANEL_BOX, TALL_VIEW_BOX);
    const screen: ScreenPoint = worldToScreen(
      { x: 0, y: 0 },
      PANEL_BOX,
      TALL_VIEW_BOX,
      IDENTITY_VIEW,
    );
    expect(screen.x).toBeCloseTo(PANEL_BOX.left + fit.offsetX, 9);
    expect(screen.y).toBeCloseTo(PANEL_BOX.top + fit.offsetY, 9);
  });
});

describe("pixel deltas — panning and dragging convert differently", () => {
  /*
   * This pair is the reason node dragging and canvas panning cannot share
   * one conversion. Panning adds to tx, which lives OUTSIDE the scale, so
   * it must not be divided. A node's world x lives INSIDE it, so it must.
   */
  const deltaPx: ScreenPoint = { x: 120, y: -48 };

  test("a viewBox delta ignores the view scale entirely", () => {
    const atOne: ScreenPoint = screenDeltaToViewBoxDelta(
      deltaPx,
      PANEL_BOX,
      TALL_VIEW_BOX,
    );
    const fit: FitMetrics = fitMetricsForBox(PANEL_BOX, TALL_VIEW_BOX);
    expect(atOne.x).toBeCloseTo(120 / fit.scale, 9);
    expect(atOne.y).toBeCloseTo(-48 / fit.scale, 9);
    /* The function does not even take a ViewTransform — pinned by shape. */
    expect(screenDeltaToViewBoxDelta.length).toBe(3);
  });

  test("a world delta is the viewBox delta divided by the view scale", () => {
    const viewBoxDelta: ScreenPoint = screenDeltaToViewBoxDelta(
      deltaPx,
      PANEL_BOX,
      TALL_VIEW_BOX,
    );
    for (const scale of [MIN_ZOOM, 0.5, 1, 2, MAX_ZOOM]) {
      const worldDelta: WorldPoint = screenDeltaToWorldDelta(
        deltaPx,
        PANEL_BOX,
        TALL_VIEW_BOX,
        view(scale, 999, -999),
      );
      expect(worldDelta.x * scale).toBeCloseTo(viewBoxDelta.x, 9);
      expect(worldDelta.y * scale).toBeCloseTo(viewBoxDelta.y, 9);
      /* The ratio between the two is exactly the scale, nothing else. */
      expect(viewBoxDelta.x / worldDelta.x).toBeCloseTo(scale, 9);
    }
  });

  test("zooming in shrinks the world delta but leaves the viewBox delta alone", () => {
    const zoomedOut: WorldPoint = screenDeltaToWorldDelta(
      deltaPx,
      PANEL_BOX,
      TALL_VIEW_BOX,
      view(1, 0, 0),
    );
    const zoomedIn: WorldPoint = screenDeltaToWorldDelta(
      deltaPx,
      PANEL_BOX,
      TALL_VIEW_BOX,
      view(4, 0, 0),
    );
    expect(zoomedIn.x).toBeCloseTo(zoomedOut.x / 4, 9);
    expect(Math.abs(zoomedIn.x)).toBeLessThan(Math.abs(zoomedOut.x));
  });

  test("a delta is translation invariant — the element's origin cannot matter", () => {
    const atOrigin: ScreenPoint = screenDeltaToViewBoxDelta(
      deltaPx,
      box(0, 0, 1200, 675),
      TALL_VIEW_BOX,
    );
    const scrolled: ScreenPoint = screenDeltaToViewBoxDelta(
      deltaPx,
      box(-988.5, 4021.25, 1200, 675),
      TALL_VIEW_BOX,
    );
    expect(scrolled).toEqual(atOrigin);
  });

  test("a world delta moves a node exactly as far as the pointer moved", () => {
    /*
     * The dragging contract: take the world point under the pointer, add
     * the world delta for the pointer's travel, and you land on the world
     * point under the pointer's new position.
     */
    const transform: ViewTransform = view(2.5, -140.25, 60.5);
    const start: ScreenPoint = { x: 600, y: 300 };
    const end: ScreenPoint = { x: start.x + 120, y: start.y - 48 };
    const worldStart: WorldPoint = screenToWorld(
      start,
      PANEL_BOX,
      TALL_VIEW_BOX,
      transform,
    );
    const worldEnd: WorldPoint = screenToWorld(
      end,
      PANEL_BOX,
      TALL_VIEW_BOX,
      transform,
    );
    const worldDelta: WorldPoint = screenDeltaToWorldDelta(
      deltaPx,
      PANEL_BOX,
      TALL_VIEW_BOX,
      transform,
    );
    expect(worldStart.x + worldDelta.x).toBeCloseTo(worldEnd.x, 9);
    expect(worldStart.y + worldDelta.y).toBeCloseTo(worldEnd.y, 9);
  });

  test("a viewBox delta pans the drawing one to one with the pointer", () => {
    /*
     * Panning by the converted delta must move a fixed world point on
     * screen by exactly the pixels the pointer travelled, at any zoom.
     */
    for (const scale of [MIN_ZOOM, 1, MAX_ZOOM]) {
      const before: ViewTransform = view(scale, 33.5, -77.25);
      const after: ViewTransform = panBy(
        before,
        screenDeltaToViewBoxDelta(deltaPx, PANEL_BOX, TALL_VIEW_BOX),
      );
      const anchor: WorldPoint = { x: 250, y: 900 };
      const screenBefore: ScreenPoint = worldToScreen(
        anchor,
        PANEL_BOX,
        TALL_VIEW_BOX,
        before,
      );
      const screenAfter: ScreenPoint = worldToScreen(
        anchor,
        PANEL_BOX,
        TALL_VIEW_BOX,
        after,
      );
      expect(screenAfter.x - screenBefore.x).toBeCloseTo(deltaPx.x, 9);
      expect(screenAfter.y - screenBefore.y).toBeCloseTo(deltaPx.y, 9);
    }
  });

  test("a collapsed box converts pixels one to one instead of returning NaN", () => {
    const delta: ScreenPoint = screenDeltaToViewBoxDelta(
      deltaPx,
      box(0, 0, 0, 0),
      TALL_VIEW_BOX,
    );
    expect(delta).toEqual({ x: 120, y: -48 });
  });

  test("a non-finite view scale leaves the world delta finite", () => {
    const delta: WorldPoint = screenDeltaToWorldDelta(
      deltaPx,
      PANEL_BOX,
      TALL_VIEW_BOX,
      view(Number.NaN, 0, 0),
    );
    expect(Number.isFinite(delta.x)).toBe(true);
    expect(Number.isFinite(delta.y)).toBe(true);
  });
});

describe("applyZoomAtPoint — the point under the cursor stays put", () => {
  const anchor: ScreenPoint = { x: 640, y: 1180 };

  test("the world point under the anchor is unchanged by the zoom", () => {
    const start: ViewTransform = view(1.25, -180.5, 240.75);
    for (const factor of [1.1, 1.5, 0.9, 0.5, 2]) {
      const zoomed: ViewTransform = applyZoomAtPoint(start, anchor, factor);
      const before: WorldPoint = worldUnderAnchor(start, anchor);
      const after: WorldPoint = worldUnderAnchor(zoomed, anchor);
      expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9);
      expect(Math.abs(after.y - before.y)).toBeLessThan(1e-9);
    }
  });

  test("the anchor holds even when the anchor is the graph origin", () => {
    const zoomed: ViewTransform = applyZoomAtPoint(
      view(1, 0, 0),
      { x: 0, y: 0 },
      2,
    );
    expect(zoomed.scale).toBe(2);
    expect(zoomed.tx).toBe(0);
    expect(zoomed.ty).toBe(0);
  });

  test("a zoom followed by its reciprocal returns the original transform", () => {
    const start: ViewTransform = view(1, -33.25, 91.5);
    const factor: number = 1.35;
    const zoomedIn: ViewTransform = applyZoomAtPoint(start, anchor, factor);
    const backOut: ViewTransform = applyZoomAtPoint(
      zoomedIn,
      anchor,
      1 / factor,
    );
    expect(Math.abs(backOut.scale - start.scale)).toBeLessThan(1e-9);
    expect(Math.abs(backOut.tx - start.tx)).toBeLessThan(1e-9);
    expect(Math.abs(backOut.ty - start.ty)).toBeLessThan(1e-9);
    expect(viewsMatch(backOut, start)).toBe(true);
  });

  test("a run of ticks up and the same run back down cancels out", () => {
    const start: ViewTransform = view(1, 120.5, -60.25);
    let current: ViewTransform = start;
    for (let i: number = 0; i < 6; i++) {
      current = applyZoomAtPoint(current, anchor, 1.2);
    }
    expect(current.scale).toBeGreaterThan(start.scale);
    for (let i: number = 0; i < 6; i++) {
      current = applyZoomAtPoint(current, anchor, 1 / 1.2);
    }
    expect(Math.abs(current.scale - start.scale)).toBeLessThan(1e-9);
    expect(Math.abs(current.tx - start.tx)).toBeLessThan(1e-9);
    expect(Math.abs(current.ty - start.ty)).toBeLessThan(1e-9);
  });

  /*
   * REGRESSION. The old code clamped only the scale and then still
   * recomputed tx and ty from it, so every wheel tick at maximum zoom
   * nudged the graph sideways towards the cursor. The whole transform must
   * come back untouched, by identity, not merely by value.
   */
  test("at maximum zoom a further zoom in returns the identical transform", () => {
    const atMax: ViewTransform = view(MAX_ZOOM, -1234.5, 678.25);
    const result: ViewTransform = applyZoomAtPoint(atMax, anchor, 1.2);
    expect(result).toBe(atMax);
  });

  test("at minimum zoom a further zoom out returns the identical transform", () => {
    const atMin: ViewTransform = view(MIN_ZOOM, 42.5, -17.25);
    const result: ViewTransform = applyZoomAtPoint(atMin, anchor, 0.8);
    expect(result).toBe(atMin);
  });

  test("twenty wheel ticks at maximum zoom do not creep by a single unit", () => {
    const atMax: ViewTransform = view(MAX_ZOOM, -1234.5, 678.25);
    let current: ViewTransform = atMax;
    for (let i: number = 0; i < 20; i++) {
      current = applyZoomAtPoint(current, { x: 640 + i, y: 1180 - i }, 1.2);
    }
    expect(current.tx).toBe(atMax.tx);
    expect(current.ty).toBe(atMax.ty);
    expect(current.scale).toBe(MAX_ZOOM);
  });

  test("a zoom that overshoots a bound lands exactly on the bound", () => {
    const nearMax: ViewTransform = applyZoomAtPoint(
      view(3.5, 10, 20),
      anchor,
      8,
    );
    expect(nearMax.scale).toBe(MAX_ZOOM);
    const nearMin: ViewTransform = applyZoomAtPoint(
      view(0.15, 10, 20),
      anchor,
      0.01,
    );
    expect(nearMin.scale).toBe(MIN_ZOOM);
  });

  test("the scale never escapes the zoom range under any factor", () => {
    const random: NextRandomFunction = makeRandom(0x13579bdf);
    let current: ViewTransform = view(1, 0, 0);
    for (let i: number = 0; i < 300; i++) {
      current = applyZoomAtPoint(
        current,
        { x: random() * 1000, y: random() * 2100 },
        0.25 + random() * 4,
      );
      expect(current.scale).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(current.scale).toBeLessThanOrEqual(MAX_ZOOM);
      expect(Number.isFinite(current.tx)).toBe(true);
      expect(Number.isFinite(current.ty)).toBe(true);
    }
  });

  test("a nonsensical factor is refused outright", () => {
    const start: ViewTransform = view(1.5, 12.25, -8.75);
    for (const factor of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(applyZoomAtPoint(start, anchor, factor)).toBe(start);
    }
  });

  test("a nonsensical anchor is refused outright", () => {
    const start: ViewTransform = view(1.5, 12.25, -8.75);
    expect(applyZoomAtPoint(start, { x: Number.NaN, y: 100 }, 1.2)).toBe(start);
    expect(
      applyZoomAtPoint(start, { x: 100, y: Number.POSITIVE_INFINITY }, 1.2),
    ).toBe(start);
  });

  test("a factor of exactly one is a no-op, not a rebuild of the transform", () => {
    const start: ViewTransform = view(1.5, 12.25, -8.75);
    expect(applyZoomAtPoint(start, anchor, 1)).toBe(start);
  });
});

describe("panBy — translation only", () => {
  test("panning never touches the scale", () => {
    for (const scale of [MIN_ZOOM, 0.5, 1, 2, MAX_ZOOM]) {
      const start: ViewTransform = view(scale, 10, 20);
      expect(panBy(start, { x: 137, y: -412 }).scale).toBe(scale);
    }
  });

  test("panning is exactly additive on both axes", () => {
    const start: ViewTransform = view(2, 100, -200);
    const panned: ViewTransform = panBy(start, { x: 25, y: 75 });
    expect(panned.tx).toBe(125);
    expect(panned.ty).toBe(-125);
  });

  test("two pans equal the one combined pan", () => {
    const start: ViewTransform = view(2, 100, -200);
    const twice: ViewTransform = panBy(panBy(start, { x: 25, y: 75 }), {
      x: -60,
      y: 10,
    });
    const once: ViewTransform = panBy(start, { x: -35, y: 85 });
    expect(twice).toEqual(once);
  });

  test("panning by zero leaves the transform where it was", () => {
    const start: ViewTransform = view(2, 100, -200);
    expect(panBy(start, { x: 0, y: 0 })).toEqual(start);
  });

  test("panning does not mutate the transform it was given", () => {
    const start: ViewTransform = view(2, 100, -200);
    panBy(start, { x: 25, y: 75 });
    expect(start).toEqual({ scale: 2, tx: 100, ty: -200 });
  });

  test("a non-finite delta is refused outright", () => {
    const start: ViewTransform = view(2, 100, -200);
    expect(panBy(start, { x: Number.NaN, y: 10 })).toBe(start);
    expect(panBy(start, { x: 10, y: Number.POSITIVE_INFINITY })).toBe(start);
  });
});

describe("computeGraphBounds", () => {
  test("an empty iterable has no bounds at all", () => {
    expect(computeGraphBounds([], 40)).toBeNull();
  });

  test("a set of only non-finite points has no bounds at all", () => {
    expect(
      computeGraphBounds(
        [
          { x: Number.NaN, y: 0 },
          { x: 0, y: Number.POSITIVE_INFINITY },
          { x: Number.NEGATIVE_INFINITY, y: Number.NaN },
        ],
        40,
      ),
    ).toBeNull();
  });

  /*
   * One NaN node — a dropped position, a half-loaded poll — used to blank
   * the whole map by turning the fitted transform into NaN. Bad points are
   * skipped, and the good ones still frame correctly.
   */
  test("a NaN point is skipped instead of poisoning the whole box", () => {
    const bounds: WorldBounds | null = computeGraphBounds(
      [
        { x: 10, y: 20 },
        { x: Number.NaN, y: Number.NaN },
        { x: 110, y: 220 },
        { x: 50, y: Number.POSITIVE_INFINITY },
      ],
      0,
    );
    expect(bounds).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 220 });
  });

  test("a null slipped into the point list is skipped, not dereferenced", () => {
    const hostile: Array<WorldPoint | null> = [
      null,
      { x: 5, y: 5 },
      null,
      { x: 15, y: 25 },
    ];
    expect(
      computeGraphBounds(hostile as unknown as Array<WorldPoint>, 0),
    ).toEqual({ minX: 5, minY: 5, maxX: 15, maxY: 25 });
  });

  test("padding is applied on all four sides, not just two", () => {
    const bounds: WorldBounds = computeGraphBounds(
      [
        { x: 0, y: 0 },
        { x: 100, y: 200 },
      ],
      40,
    )!;
    expect(bounds.minX).toBe(-40);
    expect(bounds.minY).toBe(-40);
    expect(bounds.maxX).toBe(140);
    expect(bounds.maxY).toBe(240);
    /* Padding grows each span by twice itself, never by once. */
    expect(bounds.maxX - bounds.minX).toBe(180);
    expect(bounds.maxY - bounds.minY).toBe(280);
  });

  test("a single point gives a zero span box grown only by the padding", () => {
    const bounds: WorldBounds = computeGraphBounds([{ x: 7, y: -3 }], 12)!;
    expect(bounds).toEqual({ minX: -5, minY: -15, maxX: 19, maxY: 9 });
  });

  test("negative or non-finite padding is treated as no padding", () => {
    const points: ReadonlyArray<WorldPoint> = [
      { x: 0, y: 0 },
      { x: 100, y: 200 },
    ];
    const unpadded: WorldBounds = {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 200,
    };
    expect(computeGraphBounds(points, -50)).toEqual(unpadded);
    expect(computeGraphBounds(points, Number.NaN)).toEqual(unpadded);
    expect(computeGraphBounds(points, Number.POSITIVE_INFINITY)).toEqual(
      unpadded,
    );
  });

  test("any iterable works, not just an array", () => {
    const points: Set<WorldPoint> = new Set<WorldPoint>([
      { x: -10, y: 30 },
      { x: 60, y: -5 },
    ]);
    expect(computeGraphBounds(points, 0)).toEqual({
      minX: -10,
      minY: -5,
      maxX: 60,
      maxY: 30,
    });
  });

  test("duplicate points do not widen the box", () => {
    const point: WorldPoint = { x: 4, y: 9 };
    expect(computeGraphBounds([point, point, point], 0)).toEqual({
      minX: 4,
      minY: 9,
      maxX: 4,
      maxY: 9,
    });
  });
});

describe("fitViewToBounds", () => {
  test("the graph is centred on both axes at once", () => {
    const bounds: WorldBounds = {
      minX: -400,
      minY: 120,
      maxX: 400,
      maxY: 520,
    };
    const fitted: ViewTransform = fitViewToBounds(bounds, STANDARD_VIEW_BOX);
    const centreX: number =
      fitted.tx + fitted.scale * ((bounds.minX + bounds.maxX) / 2);
    const centreY: number =
      fitted.ty + fitted.scale * ((bounds.minY + bounds.maxY) / 2);
    expect(centreX).toBeCloseTo(STANDARD_VIEW_BOX.width / 2, 9);
    expect(centreY).toBeCloseTo(STANDARD_VIEW_BOX.height / 2, 9);
  });

  test("the binding axis fills the usable width and nothing overflows", () => {
    const bounds: WorldBounds = { minX: 0, minY: 0, maxX: 800, maxY: 400 };
    const fitted: ViewTransform = fitViewToBounds(bounds, STANDARD_VIEW_BOX);
    /* 880 usable pixels of width against an 800 unit span. */
    expect(fitted.scale).toBeCloseTo(1.1, 9);
    const left: number = fitted.tx + fitted.scale * bounds.minX;
    const right: number = fitted.tx + fitted.scale * bounds.maxX;
    const top: number = fitted.ty + fitted.scale * bounds.minY;
    const bottom: number = fitted.ty + fitted.scale * bounds.maxY;
    expect(left).toBeCloseTo(STANDARD_VIEW_BOX.width * FIT_PADDING_FRACTION, 9);
    expect(right).toBeCloseTo(
      STANDARD_VIEW_BOX.width * (1 - FIT_PADDING_FRACTION),
      9,
    );
    expect(top).toBeGreaterThan(
      STANDARD_VIEW_BOX.height * FIT_PADDING_FRACTION,
    );
    expect(bottom).toBeLessThan(
      STANDARD_VIEW_BOX.height * (1 - FIT_PADDING_FRACTION),
    );
  });

  test("the scale is uniform — a wide graph is framed, never stretched", () => {
    const wide: WorldBounds = { minX: 0, minY: 0, maxX: 2000, maxY: 100 };
    const fitted: ViewTransform = fitViewToBounds(wide, STANDARD_VIEW_BOX);
    const drawnWidth: number = (wide.maxX - wide.minX) * fitted.scale;
    const drawnHeight: number = (wide.maxY - wide.minY) * fitted.scale;
    /* Aspect ratio is preserved exactly by a single scalar. */
    expect(drawnWidth / drawnHeight).toBeCloseTo(2000 / 100, 9);
    expect(drawnWidth).toBeLessThanOrEqual(
      STANDARD_VIEW_BOX.width * (1 - 2 * FIT_PADDING_FRACTION) + 1e-9,
    );
  });

  /*
   * A one-node graph has zero span on both axes, which divides to Infinity.
   * The result must still be a usable finite view inside the zoom range.
   * Note the module comment claims scale 1 here; the clamp's non-finite
   * fallback actually lands on the midpoint of the zoom range instead.
   */
  test("a zero span bounds fits at a finite in-range scale, not at Infinity", () => {
    const point: WorldBounds = { minX: 250, minY: 900, maxX: 250, maxY: 900 };
    const fitted: ViewTransform = fitViewToBounds(point, STANDARD_VIEW_BOX);
    expect(Number.isFinite(fitted.scale)).toBe(true);
    expect(fitted.scale).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(fitted.scale).toBeLessThanOrEqual(MAX_ZOOM);
    expect(Number.isFinite(fitted.tx)).toBe(true);
    expect(Number.isFinite(fitted.ty)).toBe(true);
    /* The lone node still lands dead centre. */
    expect(fitted.tx + fitted.scale * 250).toBeCloseTo(
      STANDARD_VIEW_BOX.width / 2,
      9,
    );
    expect(fitted.ty + fitted.scale * 900).toBeCloseTo(
      STANDARD_VIEW_BOX.height / 2,
      9,
    );
  });

  test("a bounds with zero span on one axis only still fits by the other", () => {
    const flat: WorldBounds = { minX: 0, minY: 50, maxX: 800, maxY: 50 };
    const fitted: ViewTransform = fitViewToBounds(flat, STANDARD_VIEW_BOX);
    expect(fitted.scale).toBeCloseTo(1.1, 9);
    expect(fitted.ty + fitted.scale * 50).toBeCloseTo(
      STANDARD_VIEW_BOX.height / 2,
      9,
    );
  });

  test("a graph far larger than the view clamps to the minimum zoom", () => {
    const huge: WorldBounds = {
      minX: -500000,
      minY: -500000,
      maxX: 500000,
      maxY: 500000,
    };
    const fitted: ViewTransform = fitViewToBounds(huge, STANDARD_VIEW_BOX);
    expect(fitted.scale).toBe(MIN_ZOOM);
    /* Clamped or not, the centre of the graph is the centre of the view. */
    expect(fitted.tx).toBeCloseTo(STANDARD_VIEW_BOX.width / 2, 9);
    expect(fitted.ty).toBeCloseTo(STANDARD_VIEW_BOX.height / 2, 9);
  });

  test("a graph far smaller than the view clamps to the maximum zoom", () => {
    const tiny: WorldBounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const fitted: ViewTransform = fitViewToBounds(tiny, STANDARD_VIEW_BOX);
    expect(fitted.scale).toBe(MAX_ZOOM);
    expect(fitted.tx + fitted.scale * 5).toBeCloseTo(
      STANDARD_VIEW_BOX.width / 2,
      9,
    );
  });

  test("no bounds at all means the identity view", () => {
    const fitted: ViewTransform = fitViewToBounds(null, STANDARD_VIEW_BOX);
    expect(fitted).toBe(IDENTITY_VIEW);
    expect(fitted).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  test("a collapsed viewBox means the identity view", () => {
    const bounds: WorldBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(fitViewToBounds(bounds, { width: 0, height: 700 })).toBe(
      IDENTITY_VIEW,
    );
    expect(fitViewToBounds(bounds, { width: 1000, height: -1 })).toBe(
      IDENTITY_VIEW,
    );
    expect(fitViewToBounds(bounds, { width: Number.NaN, height: 700 })).toBe(
      IDENTITY_VIEW,
    );
  });

  test("fitting bounds from real points frames every one of them", () => {
    const points: ReadonlyArray<WorldPoint> = [
      { x: 120, y: 40 },
      { x: 640, y: 300 },
      { x: 300, y: 560 },
      { x: 880, y: 120 },
    ];
    const bounds: WorldBounds = computeGraphBounds(points, 30)!;
    const fitted: ViewTransform = fitViewToBounds(bounds, STANDARD_VIEW_BOX);
    for (const point of points) {
      const x: number = fitted.tx + fitted.scale * point.x;
      const y: number = fitted.ty + fitted.scale * point.y;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(STANDARD_VIEW_BOX.width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(STANDARD_VIEW_BOX.height);
    }
  });
});

describe("dragThresholdExceeded — a click must survive a shaky hand", () => {
  const origin: ScreenPoint = { x: 400, y: 300 };

  test("movement of exactly the mouse threshold is still a click", () => {
    expect(
      dragThresholdExceeded(
        origin,
        { x: origin.x + MOUSE_DRAG_THRESHOLD_PX, y: origin.y },
        "mouse",
      ),
    ).toBe(false);
    expect(
      dragThresholdExceeded(
        origin,
        { x: origin.x, y: origin.y + MOUSE_DRAG_THRESHOLD_PX },
        "mouse",
      ),
    ).toBe(false);
  });

  test("one pixel past the mouse threshold is a drag", () => {
    expect(
      dragThresholdExceeded(
        origin,
        { x: origin.x + MOUSE_DRAG_THRESHOLD_PX + 1, y: origin.y },
        "mouse",
      ),
    ).toBe(true);
  });

  test("the threshold is symmetric in every direction", () => {
    const signs: ReadonlyArray<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [sx, sy] of signs) {
      expect(
        dragThresholdExceeded(
          origin,
          { x: origin.x + sx * 5, y: origin.y + sy * 5 },
          "mouse",
        ),
      ).toBe(true);
      expect(
        dragThresholdExceeded(
          origin,
          { x: origin.x + sx * 3, y: origin.y + sy * 3 },
          "mouse",
        ),
      ).toBe(false);
    }
  });

  test("the threshold is a radius, not a per-axis budget", () => {
    /* 3,3 is 4.24px away — past a 4px radius even though each axis is under. */
    expect(
      dragThresholdExceeded(
        origin,
        { x: origin.x + 3, y: origin.y + 3 },
        "mouse",
      ),
    ).toBe(true);
    /* 2,2 is 2.83px away — inside. */
    expect(
      dragThresholdExceeded(
        origin,
        { x: origin.x + 2, y: origin.y + 2 },
        "mouse",
      ),
    ).toBe(false);
  });

  test("touch is strictly harder to turn into a drag than mouse", () => {
    expect(TOUCH_DRAG_THRESHOLD_PX).toBeGreaterThan(MOUSE_DRAG_THRESHOLD_PX);
    const wobble: ScreenPoint = { x: origin.x + 7, y: origin.y };
    expect(dragThresholdExceeded(origin, wobble, "mouse")).toBe(true);
    expect(dragThresholdExceeded(origin, wobble, "touch")).toBe(false);
  });

  test("movement of exactly the touch threshold is still a tap", () => {
    expect(
      dragThresholdExceeded(
        origin,
        { x: origin.x + TOUCH_DRAG_THRESHOLD_PX, y: origin.y },
        "touch",
      ),
    ).toBe(false);
    expect(
      dragThresholdExceeded(
        origin,
        { x: origin.x + TOUCH_DRAG_THRESHOLD_PX + 1, y: origin.y },
        "touch",
      ),
    ).toBe(true);
  });

  test("a pen is treated with the mouse threshold, not the touch one", () => {
    const wobble: ScreenPoint = { x: origin.x + 7, y: origin.y };
    expect(dragThresholdExceeded(origin, wobble, "pen")).toBe(true);
  });

  test("no movement at all is never a drag", () => {
    expect(dragThresholdExceeded(origin, { ...origin }, "mouse")).toBe(false);
    expect(dragThresholdExceeded(origin, { ...origin }, "touch")).toBe(false);
  });

  test("a non-finite pointer position never latches a drag", () => {
    expect(
      dragThresholdExceeded(origin, { x: Number.NaN, y: origin.y }, "mouse"),
    ).toBe(false);
    expect(
      dragThresholdExceeded(
        origin,
        { x: origin.x, y: Number.POSITIVE_INFINITY },
        "mouse",
      ),
    ).toBe(false);
  });

  /*
   * REGRESSION. The old code summed each frame's movement, so a dozen
   * frames of one-pixel jitter latched a drag with the pointer still on the
   * node. Distance is measured from the ORIGIN, so jitter never accumulates.
   */
  test("jitter around the press point never accumulates into a drag", () => {
    const random: NextRandomFunction = makeRandom(0x2468ace0);
    for (let i: number = 0; i < 100; i++) {
      const jittered: ScreenPoint = {
        x: origin.x + (random() * 2 - 1),
        y: origin.y + (random() * 2 - 1),
      };
      expect(dragThresholdExceeded(origin, jittered, "mouse")).toBe(false);
    }
  });
});

describe("normalizeWheelDeltaPx — one wheel notch means one wheel notch", () => {
  test("deltaMode 0 is already pixels and is passed through untouched", () => {
    expect(normalizeWheelDeltaPx(100, 0, 800)).toBe(100);
    expect(normalizeWheelDeltaPx(-53.5, 0, 800)).toBe(-53.5);
  });

  /*
   * REGRESSION. Firefox reports about 3 LINES per notch where Chrome
   * reports about 100 pixels. Treating deltaY as pixels everywhere made
   * wheel zoom roughly thirty times slower in Firefox.
   */
  test("deltaMode 1 is lines and is multiplied by the line height", () => {
    expect(normalizeWheelDeltaPx(3, 1, 800)).toBe(3 * WHEEL_LINE_HEIGHT_PX);
    expect(normalizeWheelDeltaPx(3, 1, 800)).toBe(48);
    /* The uncorrected value was 3px against Chrome's 100px per notch. */
    expect(normalizeWheelDeltaPx(3, 1, 800) / 3).toBe(WHEEL_LINE_HEIGHT_PX);
    /* Firefox now lands within a small factor of Chrome, not 1/33rd of it. */
    const firefoxVersusChrome: number =
      normalizeWheelDeltaPx(3, 1, 800) / normalizeWheelDeltaPx(100, 0, 800);
    expect(firefoxVersusChrome).toBeGreaterThan(0.4);
    expect(firefoxVersusChrome).toBeLessThan(2);
  });

  test("deltaMode 2 is pages and is multiplied by the viewport height", () => {
    expect(normalizeWheelDeltaPx(1, 2, 675)).toBe(675);
    expect(normalizeWheelDeltaPx(-2, 2, 1080)).toBe(-2160);
  });

  test("deltaMode 2 with an unusable viewport height uses a sane default", () => {
    expect(normalizeWheelDeltaPx(1, 2, 0)).toBe(800);
    expect(normalizeWheelDeltaPx(1, 2, Number.NaN)).toBe(800);
    expect(normalizeWheelDeltaPx(1, 2, -500)).toBe(800);
  });

  test("an unknown deltaMode is treated as pixels rather than dropped", () => {
    expect(normalizeWheelDeltaPx(120, 3, 800)).toBe(120);
    expect(normalizeWheelDeltaPx(120, -1, 800)).toBe(120);
  });

  test("a non-finite deltaY produces no zoom at all", () => {
    expect(normalizeWheelDeltaPx(Number.NaN, 0, 800)).toBe(0);
    expect(normalizeWheelDeltaPx(Number.POSITIVE_INFINITY, 1, 800)).toBe(0);
  });

  test("the sign of the scroll is preserved by every mode", () => {
    for (const mode of [0, 1, 2]) {
      expect(normalizeWheelDeltaPx(-5, mode, 800)).toBeLessThan(0);
      expect(normalizeWheelDeltaPx(5, mode, 800)).toBeGreaterThan(0);
    }
  });
});

describe("viewsMatch — equality within rounding noise", () => {
  const base: ViewTransform = view(1.5, 120.25, -33.75);

  test("a transform matches itself", () => {
    expect(viewsMatch(base, base)).toBe(true);
    expect(viewsMatch(base, { ...base })).toBe(true);
  });

  test("a difference below the epsilon on any axis still matches", () => {
    expect(viewsMatch(base, view(1.5 + 9e-5, 120.25, -33.75))).toBe(true);
    expect(viewsMatch(base, view(1.5, 120.25 - 9e-5, -33.75))).toBe(true);
    expect(viewsMatch(base, view(1.5, 120.25, -33.75 + 9e-5))).toBe(true);
  });

  test("a difference of exactly the epsilon does not match", () => {
    /*
     * Built from zero so the gap is exactly 1e-4 in binary. Adding 1e-4 to
     * 1.5 rounds to a gap a hair UNDER the epsilon, which does match — the
     * comparison is a strict `<`, and the boundary is only reachable when
     * the operands do not lose the low bits to a larger exponent.
     */
    const zero: ViewTransform = view(0, 0, 0);
    expect(viewsMatch(zero, view(1e-4, 0, 0))).toBe(false);
    expect(viewsMatch(zero, view(0, 1e-4, 0))).toBe(false);
    expect(viewsMatch(zero, view(0, 0, 1e-4))).toBe(false);
    expect(viewsMatch(zero, view(9.9e-5, 0, 0))).toBe(true);
  });

  test("a visible difference on any single axis does not match", () => {
    expect(viewsMatch(base, view(1.5 + 1e-3, 120.25, -33.75))).toBe(false);
    expect(viewsMatch(base, view(1.5, 120.25 + 1e-3, -33.75))).toBe(false);
    expect(viewsMatch(base, view(1.5, 120.25, -33.75 - 1e-3))).toBe(false);
  });

  test("an obviously different view does not match", () => {
    expect(viewsMatch(base, IDENTITY_VIEW)).toBe(false);
  });

  test("a NaN component never matches anything, including itself", () => {
    const broken: ViewTransform = view(Number.NaN, 120.25, -33.75);
    expect(viewsMatch(base, broken)).toBe(false);
    expect(viewsMatch(broken, broken)).toBe(false);
  });

  test("comparison is symmetric", () => {
    const other: ViewTransform = view(1.5 + 5e-5, 120.25, -33.75);
    expect(viewsMatch(base, other)).toBe(viewsMatch(other, base));
  });
});

describe("clampWorldPoint — nothing hostile reaches an SVG attribute", () => {
  test("an ordinary coordinate is left exactly alone", () => {
    expect(clampWorldPoint({ x: 250.5, y: -900.25 })).toEqual({
      x: 250.5,
      y: -900.25,
    });
  });

  test("a runaway coordinate is pinned to the world limit on both signs", () => {
    expect(clampWorldPoint({ x: 1e9, y: -1e9 })).toEqual({
      x: MAX_WORLD_COORDINATE,
      y: -MAX_WORLD_COORDINATE,
    });
  });

  test("the limit itself is inside the allowed range", () => {
    expect(
      clampWorldPoint({ x: MAX_WORLD_COORDINATE, y: -MAX_WORLD_COORDINATE }),
    ).toEqual({ x: MAX_WORLD_COORDINATE, y: -MAX_WORLD_COORDINATE });
  });

  /*
   * A NaN or Infinity is not clamped to a limit — the shared clamp returns
   * the midpoint of the range for anything non-finite, which for a
   * symmetric range is the origin. The contract that matters is that the
   * result is always finite and always drawable.
   */
  test("a non-finite coordinate becomes a finite one", () => {
    const fromNaN: WorldPoint = clampWorldPoint({
      x: Number.NaN,
      y: Number.NaN,
    });
    expect(Number.isFinite(fromNaN.x)).toBe(true);
    expect(Number.isFinite(fromNaN.y)).toBe(true);
    expect(fromNaN).toEqual({ x: 0, y: 0 });

    const fromInfinity: WorldPoint = clampWorldPoint({
      x: Number.POSITIVE_INFINITY,
      y: Number.NEGATIVE_INFINITY,
    });
    expect(Number.isFinite(fromInfinity.x)).toBe(true);
    expect(Number.isFinite(fromInfinity.y)).toBe(true);
  });

  test("clamping is idempotent", () => {
    const once: WorldPoint = clampWorldPoint({ x: 1e9, y: Number.NaN });
    expect(clampWorldPoint(once)).toEqual(once);
  });
});

describe("snapToGrid", () => {
  test("a point snaps to its nearest grid intersection", () => {
    expect(snapToGrid({ x: 124, y: 276 }, 50)).toEqual({ x: 100, y: 300 });
    expect(snapToGrid({ x: 24, y: 26 }, 50)).toEqual({ x: 0, y: 50 });
  });

  test("an exact half lands on the higher multiple", () => {
    expect(snapToGrid({ x: 25, y: 75 }, 50)).toEqual({ x: 50, y: 100 });
  });

  test("negative coordinates snap the same way", () => {
    expect(snapToGrid({ x: -126, y: -74 }, 50)).toEqual({ x: -150, y: -50 });
  });

  test("a point already on the grid does not move", () => {
    expect(snapToGrid({ x: 200, y: -350 }, 50)).toEqual({ x: 200, y: -350 });
  });

  test("snapping twice changes nothing the second time", () => {
    const once: WorldPoint = snapToGrid({ x: 137.5, y: -412.25 }, 25);
    expect(snapToGrid(once, 25)).toEqual(once);
  });

  test("a grid size of zero disables snapping instead of dividing by zero", () => {
    const point: WorldPoint = { x: 137.5, y: -412.25 };
    expect(snapToGrid(point, 0)).toBe(point);
  });

  test("a negative or non-finite grid size disables snapping", () => {
    const point: WorldPoint = { x: 137.5, y: -412.25 };
    expect(snapToGrid(point, -50)).toBe(point);
    expect(snapToGrid(point, Number.NaN)).toBe(point);
    expect(snapToGrid(point, Number.POSITIVE_INFINITY)).toBe(point);
  });

  test("every snapped coordinate is a whole multiple of the grid size", () => {
    const random: NextRandomFunction = makeRandom(0x0bade1f5);
    for (let i: number = 0; i < 100; i++) {
      const snapped: WorldPoint = snapToGrid(
        { x: random() * 4000 - 2000, y: random() * 4000 - 2000 },
        20,
      );
      expect(Math.abs(snapped.x % 20)).toBeCloseTo(0, 9);
      expect(Math.abs(snapped.y % 20)).toBeCloseTo(0, 9);
    }
  });
});

/*
 * A known hole rather than a contract. fitMetricsForBox defends itself
 * against a non-finite element origin by returning an identity fit, but
 * screenToViewBox and worldToScreen still subtract the raw box.left and
 * box.top, so a NaN origin flows straight through to the caller. A real
 * DOMRect never carries NaN, which is why this is documented here instead
 * of guarded — if it ever does, this test is where the fix belongs.
 */
describe("known gap — a non-finite element origin is not neutralised", () => {
  test("a NaN box origin still yields a NaN world coordinate", () => {
    const result: WorldPoint = screenToWorld(
      { x: 600, y: 300 },
      box(Number.NaN, 0, 1200, 675),
      TALL_VIEW_BOX,
      IDENTITY_VIEW,
    );
    expect(Number.isNaN(result.x)).toBe(true);
    /* The y axis, whose origin is fine, is unaffected. */
    expect(Number.isFinite(result.y)).toBe(true);
  });
});
