import { describe, expect, jest, test } from "@jest/globals";

/*
 * Security Events → Correlate: the pure helpers CorrelateGraph exports.
 *
 * getNextWiderTimeRange picks the preset the "no results" state offers to
 * widen to (1h → 6h → 24h → 7d → 30d, then nothing). getCanvasHeight sizes
 * the canvas from the laid-out drawing so a small graph doesn't float in a
 * tall empty box and a big one doesn't push the page off screen: 85% of the
 * drawing's vertical extent plus 60px, clamped to 420..680 and rounded.
 * Given a positive narrow canvas width (phones) it instead follows the
 * drawing's aspect ratio at that width, clamped to 280..520 and rounded.
 * normalizeCorrelationFilter turns a filter with at most one condition into
 * an "and" filter, so trimming an OR filter to one chip brings back the
 * AND-only pivots.
 *
 * Importing CorrelateGraph pulls in React Flow, the analytics API, project
 * and navigation utilities and i18n, so those are stubbed exactly as the
 * component test does.
 */

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getQueryStringByName: () => {
        return null;
      },
      setQueryString: () => {
        return undefined;
      },
      navigate: () => {
        return undefined;
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("reactflow", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
    Background: () => {
      return null;
    },
    Controls: () => {
      return null;
    },
    Handle: () => {
      return null;
    },
    Position: {
      Top: "top",
      Bottom: "bottom",
      Left: "left",
      Right: "right",
    },
    BackgroundVariant: { Dots: "dots" },
    MarkerType: { ArrowClosed: "arrowclosed" },
  };
});

import { LayoutPoint } from "../../../../App/FeatureSet/Dashboard/src/Utils/LayeredGraphLayout";
import {
  CorrelationGraphNode,
  CorrelationGraphNodeKind,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/CorrelationGraph";
import { CORRELATE_NODE_SIZES } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateNodeCard";
import {
  CorrelationCondition,
  CorrelationFieldKey,
  CorrelationFilter,
  CorrelationOperator,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SecurityEventCorrelation";
import {
  getCanvasHeight,
  getNextWiderTimeRange,
  normalizeCorrelationFilter,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateGraph";

const MIN_CANVAS_HEIGHT: number = 420;
const MAX_CANVAS_HEIGHT: number = 680;
const MIN_NARROW_CANVAS_HEIGHT: number = 280;
const MAX_NARROW_CANVAS_HEIGHT: number = 520;

interface PlacedNode {
  id: string;
  kind: CorrelationGraphNodeKind;
  // Omit to leave the node out of the positions map.
  y?: number | undefined;
  x?: number | undefined;
}

interface Drawing {
  nodes: Array<CorrelationGraphNode>;
  positions: Map<string, LayoutPoint>;
}

function buildDrawing(placed: Array<PlacedNode>): Drawing {
  const nodes: Array<CorrelationGraphNode> = [];
  const positions: Map<string, LayoutPoint> = new Map<string, LayoutPoint>();
  for (const item of placed) {
    nodes.push({ id: item.id, label: item.id, kind: item.kind });
    if (item.y !== undefined) {
      positions.set(item.id, { x: item.x ?? 0, y: item.y });
    }
  }
  return { nodes, positions };
}

function heightOf(placed: Array<PlacedNode>): number {
  const drawing: Drawing = buildDrawing(placed);
  return getCanvasHeight(drawing.nodes, drawing.positions);
}

// Vertical extent of the positioned nodes, from each card's own height.
function drawingHeightOf(placed: Array<PlacedNode>): number {
  let minY: number = Infinity;
  let maxY: number = -Infinity;
  for (const item of placed) {
    if (item.y === undefined) {
      continue;
    }
    const halfHeight: number = CORRELATE_NODE_SIZES[item.kind].height / 2;
    minY = Math.min(minY, item.y - halfHeight);
    maxY = Math.max(maxY, item.y + halfHeight);
  }
  return Number.isFinite(minY) ? maxY - minY : 0;
}

/*
 * Two class cards whose combined vertical extent is exactly `height`:
 * the top card's upper edge sits at -half and the bottom card's lower edge
 * at (height - half).
 */
function twoClassCardsSpanning(height: number): Array<PlacedNode> {
  return [
    { id: "class:top", kind: "class", y: 0 },
    {
      id: "class:bottom",
      kind: "class",
      y: height - CORRELATE_NODE_SIZES.class.height,
    },
  ];
}

function narrowHeightOf(
  placed: Array<PlacedNode>,
  canvasWidth: number | undefined,
): number {
  const drawing: Drawing = buildDrawing(placed);
  return getCanvasHeight(drawing.nodes, drawing.positions, canvasWidth);
}

// Horizontal extent of the positioned nodes, from each card's own width.
function drawingWidthOf(placed: Array<PlacedNode>): number {
  let minX: number = Infinity;
  let maxX: number = -Infinity;
  for (const item of placed) {
    if (item.y === undefined) {
      continue;
    }
    const x: number = item.x ?? 0;
    const halfWidth: number = CORRELATE_NODE_SIZES[item.kind].width / 2;
    minX = Math.min(minX, x - halfWidth);
    maxX = Math.max(maxX, x + halfWidth);
  }
  return Number.isFinite(minX) ? maxX - minX : 0;
}

// The narrow-canvas formula, written out independently of the product code.
function expectedNarrowHeight(
  placed: Array<PlacedNode>,
  canvasWidth: number,
): number {
  return Math.round(
    Math.min(
      MAX_NARROW_CANVAS_HEIGHT,
      Math.max(
        MIN_NARROW_CANVAS_HEIGHT,
        (canvasWidth * drawingHeightOf(placed)) / drawingWidthOf(placed),
      ),
    ),
  );
}

/*
 * Two class cards at opposite corners whose combined bounding box is
 * exactly `width` × `height` (needs width >= a class card's width and
 * height >= its height). `offsetX` / `offsetY` move the whole drawing.
 */
function classCardsInBox(
  width: number,
  height: number,
  offsetX: number = 0,
  offsetY: number = 0,
): Array<PlacedNode> {
  return [
    { id: "class:top-left", kind: "class", x: offsetX, y: offsetY },
    {
      id: "class:bottom-right",
      kind: "class",
      x: offsetX + width - CORRELATE_NODE_SIZES.class.width,
      y: offsetY + height - CORRELATE_NODE_SIZES.class.height,
    },
  ];
}

function makeCondition(
  field: CorrelationFieldKey,
  operator: CorrelationOperator,
  value: string,
): CorrelationCondition {
  return { field, operator, value };
}

const OBSERVABLE_IS_ALICE: CorrelationCondition = makeCondition(
  CorrelationFieldKey.Observable,
  CorrelationOperator.Equals,
  "alice",
);
const MESSAGE_CONTAINS_DENIED: CorrelationCondition = makeCondition(
  CorrelationFieldKey.Message,
  CorrelationOperator.Contains,
  "denied",
);
const CLASS_IS_AUTHENTICATION: CorrelationCondition = makeCondition(
  CorrelationFieldKey.EventClass,
  CorrelationOperator.Equals,
  "Authentication",
);

// A fresh deep copy, so tests never share (and never leak) filter objects.
function cloneFilter(filter: CorrelationFilter): CorrelationFilter {
  return {
    connector: filter.connector,
    conditions: filter.conditions.map(
      (condition: CorrelationCondition): CorrelationCondition => {
        return { ...condition };
      },
    ),
  };
}

/*
 * Freezes the filter, its conditions array and every condition, so any
 * in-place write inside the helper throws (test modules run in strict mode).
 */
function deepFreezeFilter(filter: CorrelationFilter): CorrelationFilter {
  for (const condition of filter.conditions) {
    Object.freeze(condition);
  }
  Object.freeze(filter.conditions);
  return Object.freeze(filter);
}

describe("getNextWiderTimeRange", () => {
  test.each([
    [1, 6],
    [6, 24],
    [24, 168],
    [168, 720],
  ])("widens the %p hour preset to %p hours", (hours: number, next: number) => {
    expect(getNextWiderTimeRange(hours)).toBe(next);
  });

  test("returns null at the longest preset (30 days)", () => {
    expect(getNextWiderTimeRange(720)).toBeNull();
  });

  test.each([
    [0, 1],
    [0.5, 1],
    [2, 6],
    [5.99, 6],
    [23, 24],
    [100, 168],
    [169, 720],
    [719, 720],
  ])(
    "picks the next longer preset for the off-preset value %p (→ %p)",
    (hours: number, next: number) => {
      expect(getNextWiderTimeRange(hours)).toBe(next);
    },
  );

  test.each([[721], [1000], [8760], [Number.POSITIVE_INFINITY]])(
    "returns null for %p hours, which is already past every preset",
    (hours: number) => {
      expect(getNextWiderTimeRange(hours)).toBeNull();
    },
  );

  test.each([[-1], [-24], [-1000], [Number.NEGATIVE_INFINITY]])(
    "offers the shortest preset for the negative value %p",
    (hours: number) => {
      expect(getNextWiderTimeRange(hours)).toBe(1);
    },
  );

  test("returns null for NaN rather than guessing a preset", () => {
    expect(getNextWiderTimeRange(Number.NaN)).toBeNull();
  });

  test("walking from the shortest preset visits every preset once, in order, then stops", () => {
    const visited: Array<number> = [];
    let current: number | null = 1;
    while (current !== null) {
      visited.push(current);
      current = getNextWiderTimeRange(current);
      // A guard so a regression can't hang the suite.
      if (visited.length > 10) {
        break;
      }
    }
    expect(visited).toEqual([1, 6, 24, 168, 720]);
  });

  test("always returns something strictly wider than the input", () => {
    for (const hours of [-5, 0, 1, 3, 6, 12, 24, 100, 168, 500, 720]) {
      const next: number | null = getNextWiderTimeRange(hours);
      if (next !== null) {
        expect(next).toBeGreaterThan(hours);
      }
    }
  });
});

describe("getCanvasHeight", () => {
  test("an empty graph gets the minimum height", () => {
    expect(getCanvasHeight([], new Map<string, LayoutPoint>())).toBe(
      MIN_CANVAS_HEIGHT,
    );
  });

  test("nodes with no positions at all get the minimum height", () => {
    expect(
      heightOf([
        { id: "center", kind: "center" },
        { id: "class:Authentication", kind: "class" },
        { id: "observable:alice", kind: "observable" },
      ]),
    ).toBe(MIN_CANVAS_HEIGHT);
  });

  test("a single card clamps up to the minimum height", () => {
    expect(heightOf([{ id: "center", kind: "center", y: 0 }])).toBe(
      MIN_CANVAS_HEIGHT,
    );
    expect(heightOf([{ id: "observable:a", kind: "observable", y: 250 }])).toBe(
      MIN_CANVAS_HEIGHT,
    );
  });

  test("a small drawing clamps up to the minimum height", () => {
    // 300px drawing → 300 * 0.85 + 60 = 315, below the floor.
    expect(heightOf(twoClassCardsSpanning(300))).toBe(MIN_CANVAS_HEIGHT);
  });

  test("a large drawing clamps down to the maximum height", () => {
    expect(heightOf(twoClassCardsSpanning(2000))).toBe(MAX_CANVAS_HEIGHT);
    expect(
      heightOf([
        { id: "center", kind: "center", y: -5000 },
        { id: "observable:far", kind: "observable", y: 5000 },
      ]),
    ).toBe(MAX_CANVAS_HEIGHT);
  });

  test("a mid-size drawing returns round(drawingHeight * 0.85 + 60)", () => {
    // 500px drawing → 500 * 0.85 + 60 = 485.
    expect(heightOf(twoClassCardsSpanning(500))).toBe(485);
    // 600px drawing → 600 * 0.85 + 60 = 570.
    expect(heightOf(twoClassCardsSpanning(600))).toBe(570);
  });

  test("rounds a fractional result to the nearest pixel", () => {
    // 501 * 0.85 + 60 = 485.85 → 486.
    expect(heightOf(twoClassCardsSpanning(501))).toBe(486);
    // 503 * 0.85 + 60 = 487.55 → 488.
    expect(heightOf(twoClassCardsSpanning(503))).toBe(488);
    // 502 * 0.85 + 60 = 486.7 → 487.
    expect(heightOf(twoClassCardsSpanning(502))).toBe(487);
  });

  test("sits right at the floor just below the 420px crossover and grows past it", () => {
    // 424 * 0.85 + 60 = 420.4 → 420; 425 * 0.85 + 60 = 421.25 → 421.
    expect(heightOf(twoClassCardsSpanning(424))).toBe(420);
    expect(heightOf(twoClassCardsSpanning(425))).toBe(421);
  });

  test("approaches the ceiling without overshooting it", () => {
    // 728 * 0.85 + 60 = 678.8 → 679.
    expect(heightOf(twoClassCardsSpanning(728))).toBe(679);
    // 729 * 0.85 + 60 = 679.65 → 680.
    expect(heightOf(twoClassCardsSpanning(729))).toBe(680);
    // 730 * 0.85 + 60 = 680.5, clamped to 680.
    expect(heightOf(twoClassCardsSpanning(730))).toBe(680);
  });

  test("measures from each card's own height, not its centre", () => {
    /*
     * Centre card on top (56px tall) and an observable pill below (32px):
     * the extent runs from 0 - 28 to 450 + 16, i.e. 494px, and
     * 494 * 0.85 + 60 = 479.9 → 480.
     */
    const placed: Array<PlacedNode> = [
      { id: "center", kind: "center", y: 0 },
      { id: "observable:alice", kind: "observable", y: 450 },
    ];
    expect(drawingHeightOf(placed)).toBe(
      450 +
        CORRELATE_NODE_SIZES.center.height / 2 +
        CORRELATE_NODE_SIZES.observable.height / 2,
    );
    expect(heightOf(placed)).toBe(
      Math.round(drawingHeightOf(placed) * 0.85 + 60),
    );
    expect(heightOf(placed)).toBe(480);
  });

  test("uses the node sizes CorrelateNodeCard draws with", () => {
    const placed: Array<PlacedNode> = [
      { id: "observable:top", kind: "observable", y: -200 },
      { id: "center", kind: "center", y: 0 },
      { id: "class:Process Activity", kind: "class", y: 180 },
      { id: "class:Authentication", kind: "class", y: 320 },
      { id: "observable:bottom", kind: "observable", y: 330 },
    ];
    /*
     * Top edge: the observable at -200 - 16 = -216. Bottom edge: the class
     * at 320 + 28 = 348 beats the observable at 330 + 16 = 346.
     */
    expect(drawingHeightOf(placed)).toBe(
      320 +
        CORRELATE_NODE_SIZES.class.height / 2 -
        (-200 - CORRELATE_NODE_SIZES.observable.height / 2),
    );
    expect(heightOf(placed)).toBe(
      Math.round(drawingHeightOf(placed) * 0.85 + 60),
    );
  });

  test("ignores nodes that are missing from positions", () => {
    const positioned: Array<PlacedNode> = twoClassCardsSpanning(500);
    expect(heightOf(positioned)).toBe(485);

    // An unpositioned node would stretch the drawing if it were counted.
    expect(
      heightOf([
        ...positioned,
        { id: "observable:not-laid-out", kind: "observable" },
        { id: "center", kind: "center" },
      ]),
    ).toBe(485);
  });

  test("ignores positions for nodes that aren't in the node list", () => {
    const drawing: Drawing = buildDrawing(twoClassCardsSpanning(500));
    drawing.positions.set("observable:stale", { x: 0, y: 5000 });
    drawing.positions.set("class:stale", { x: 0, y: -5000 });

    expect(getCanvasHeight(drawing.nodes, drawing.positions)).toBe(485);
  });

  test("a single positioned node among unpositioned ones still clamps to the minimum", () => {
    expect(
      heightOf([
        { id: "center", kind: "center", y: 0 },
        { id: "class:a", kind: "class" },
        { id: "class:b", kind: "class" },
      ]),
    ).toBe(MIN_CANVAS_HEIGHT);
  });

  test("horizontal spread does not affect the height", () => {
    // Centres this far apart give a 500px drawing once the cards are added.
    const centreGap: number = 500 - CORRELATE_NODE_SIZES.class.height;
    const narrow: number = heightOf([
      { id: "class:a", kind: "class", x: 0, y: 0 },
      { id: "class:b", kind: "class", x: 0, y: centreGap },
    ]);
    const wide: number = heightOf([
      { id: "class:a", kind: "class", x: -3000, y: 0 },
      { id: "class:b", kind: "class", x: 3000, y: centreGap },
    ]);
    expect(wide).toBe(narrow);
    expect(wide).toBe(485);
  });

  test("works the same for a drawing centred on zero (negative y)", () => {
    const halfGap: number = (500 - CORRELATE_NODE_SIZES.class.height) / 2;
    const shifted: number = heightOf([
      { id: "class:a", kind: "class", y: -halfGap },
      { id: "class:b", kind: "class", y: halfGap },
    ]);
    expect(shifted).toBe(heightOf(twoClassCardsSpanning(500)));
    expect(shifted).toBe(485);
  });

  test("does not depend on node order", () => {
    const placed: Array<PlacedNode> = [
      { id: "center", kind: "center", y: 10 },
      { id: "class:a", kind: "class", y: -150 },
      { id: "observable:x", kind: "observable", y: 400 },
      { id: "class:b", kind: "class", y: 90 },
    ];
    expect(heightOf([...placed].reverse())).toBe(heightOf(placed));
  });

  test("cards stacked at the same y count only their own height", () => {
    expect(
      heightOf([
        { id: "center", kind: "center", y: 100 },
        { id: "class:a", kind: "class", y: 100 },
        { id: "observable:x", kind: "observable", y: 100 },
      ]),
    ).toBe(MIN_CANVAS_HEIGHT);
  });

  test("always returns an integer within the 420..680 range", () => {
    for (let span: number = 0; span <= 1200; span += 7) {
      const placed: Array<PlacedNode> = [
        { id: "center", kind: "center", y: 0 },
        { id: "observable:x", kind: "observable", y: span },
      ];
      const height: number = heightOf(placed);
      expect(Number.isInteger(height)).toBe(true);
      expect(height).toBeGreaterThanOrEqual(MIN_CANVAS_HEIGHT);
      expect(height).toBeLessThanOrEqual(MAX_CANVAS_HEIGHT);
      expect(height).toBe(
        Math.round(
          Math.min(
            MAX_CANVAS_HEIGHT,
            Math.max(MIN_CANVAS_HEIGHT, drawingHeightOf(placed) * 0.85 + 60),
          ),
        ),
      );
    }
  });

  test("never shrinks as the drawing grows", () => {
    let previous: number = 0;
    for (let span: number = 0; span <= 1200; span += 11) {
      const height: number = heightOf(twoClassCardsSpanning(span + 56));
      expect(height).toBeGreaterThanOrEqual(previous);
      previous = height;
    }
  });
});

describe("getCanvasHeight with a narrow canvas width", () => {
  test.each([[280], [300], [360], [375], [414], [500], [520]])(
    "a square drawing is exactly as tall as the %p px canvas is wide",
    (canvasWidth: number) => {
      const placed: Array<PlacedNode> = classCardsInBox(400, 400);
      expect(drawingWidthOf(placed)).toBe(400);
      expect(drawingHeightOf(placed)).toBe(400);
      expect(narrowHeightOf(placed, canvasWidth)).toBe(canvasWidth);
    },
  );

  test("a tall drawing is taller than the canvas is wide", () => {
    // 360 * 500 / 400 = 450.
    expect(narrowHeightOf(classCardsInBox(400, 500), 360)).toBe(450);
    // 320 * 450 / 300 = 480.
    expect(narrowHeightOf(classCardsInBox(300, 450), 320)).toBe(480);
  });

  test("a wide drawing is shorter than the canvas is wide", () => {
    // 500 * 450 / 600 = 375.
    expect(narrowHeightOf(classCardsInBox(600, 450), 500)).toBe(375);
    // 400 * 700 / 800 = 350.
    expect(narrowHeightOf(classCardsInBox(800, 700), 400)).toBe(350);
  });

  test("clamps a very wide drawing up to 280", () => {
    // 375 * 200 / 2000 = 37.5.
    expect(narrowHeightOf(classCardsInBox(2000, 200), 375)).toBe(
      MIN_NARROW_CANVAS_HEIGHT,
    );
    // 375 * 300 / 1000 = 112.5.
    expect(narrowHeightOf(classCardsInBox(1000, 300), 375)).toBe(
      MIN_NARROW_CANVAS_HEIGHT,
    );
    // A single observable pill: 375 * 32 / 164 ≈ 73.2.
    expect(
      narrowHeightOf([{ id: "observable:a", kind: "observable", y: 0 }], 375),
    ).toBe(MIN_NARROW_CANVAS_HEIGHT);
  });

  test("clamps a very tall drawing down to 520", () => {
    // 375 * 2000 / 200 = 3750.
    expect(narrowHeightOf(classCardsInBox(200, 2000), 375)).toBe(
      MAX_NARROW_CANVAS_HEIGHT,
    );
    // 375 * 800 / 400 = 750.
    expect(narrowHeightOf(classCardsInBox(400, 800), 375)).toBe(
      MAX_NARROW_CANVAS_HEIGHT,
    );
  });

  test("both bounds are inclusive and clamp just outside them", () => {
    // With a 400px-wide drawing on a 400px canvas, height maps 1:1.
    expect(narrowHeightOf(classCardsInBox(400, 279), 400)).toBe(280);
    expect(narrowHeightOf(classCardsInBox(400, 280), 400)).toBe(280);
    expect(narrowHeightOf(classCardsInBox(400, 281), 400)).toBe(281);
    expect(narrowHeightOf(classCardsInBox(400, 519), 400)).toBe(519);
    expect(narrowHeightOf(classCardsInBox(400, 520), 400)).toBe(520);
    expect(narrowHeightOf(classCardsInBox(400, 521), 400)).toBe(520);
  });

  test("rounds a fractional result to the nearest pixel", () => {
    // 300 * 402 / 400 = 301.5 → 302.
    expect(narrowHeightOf(classCardsInBox(400, 402), 300)).toBe(302);
    // 300 * 401 / 400 = 300.75 → 301.
    expect(narrowHeightOf(classCardsInBox(400, 401), 300)).toBe(301);
    // 300 * 399 / 400 = 299.25 → 299.
    expect(narrowHeightOf(classCardsInBox(400, 399), 300)).toBe(299);
    // 375 * 500 / 400 = 468.75 → 469.
    expect(narrowHeightOf(classCardsInBox(400, 500), 375)).toBe(469);
    // 301 * 450 / 400 = 338.625 → 339.
    expect(narrowHeightOf(classCardsInBox(400, 450), 301)).toBe(339);
  });

  test.each([[undefined], [0], [-0], [-1], [-375], [Number.NaN]])(
    "ignores the canvas width %p and uses the desktop sizing",
    (canvasWidth: number | undefined) => {
      // 500 * 0.85 + 60 = 485 (desktop); 375-wide would give 469.
      const placed: Array<PlacedNode> = classCardsInBox(400, 500);
      expect(narrowHeightOf(placed, canvasWidth)).toBe(485);
      expect(narrowHeightOf(placed, canvasWidth)).toBe(heightOf(placed));
    },
  );

  test("ignored widths keep the desktop clamps (420..680)", () => {
    // 300 * 0.85 + 60 = 315 → 420; 900 * 0.85 + 60 = 825 → 680.
    expect(narrowHeightOf(classCardsInBox(400, 300), 0)).toBe(
      MIN_CANVAS_HEIGHT,
    );
    expect(narrowHeightOf(classCardsInBox(400, 900), -10)).toBe(
      MAX_CANVAS_HEIGHT,
    );
  });

  test("a narrow width replaces the desktop sizing and its clamps", () => {
    // Mid-size: desktop 485, narrow 360 * 500 / 400 = 450.
    expect(heightOf(classCardsInBox(400, 500))).toBe(485);
    expect(narrowHeightOf(classCardsInBox(400, 500), 360)).toBe(450);

    // Below the desktop floor: desktop 420, narrow 375 * 300 / 400 = 281.25.
    expect(heightOf(classCardsInBox(400, 300))).toBe(MIN_CANVAS_HEIGHT);
    expect(narrowHeightOf(classCardsInBox(400, 300), 375)).toBe(281);

    // Big drawing: desktop 680, narrow 375 * 900 / 400 = 843.75 → 520.
    expect(heightOf(classCardsInBox(400, 900))).toBe(MAX_CANVAS_HEIGHT);
    expect(narrowHeightOf(classCardsInBox(400, 900), 375)).toBe(
      MAX_NARROW_CANVAS_HEIGHT,
    );
  });

  test("falls back to the desktop sizing when the drawing has no width", () => {
    // Nothing laid out means no drawing width; the narrow floor (280) is not used.
    expect(getCanvasHeight([], new Map<string, LayoutPoint>(), 375)).toBe(
      MIN_CANVAS_HEIGHT,
    );
    expect(
      narrowHeightOf(
        [
          { id: "center", kind: "center" },
          { id: "class:Authentication", kind: "class" },
          { id: "observable:alice", kind: "observable" },
        ],
        375,
      ),
    ).toBe(MIN_CANVAS_HEIGHT);
  });

  test("ignores nodes that are missing from positions", () => {
    const positioned: Array<PlacedNode> = classCardsInBox(400, 500);
    // 375 * 500 / 400 = 468.75 → 469.
    expect(narrowHeightOf(positioned, 375)).toBe(469);
    expect(
      narrowHeightOf(
        [
          ...positioned,
          { id: "observable:not-laid-out", kind: "observable" },
          { id: "center", kind: "center", x: 5000 },
        ],
        375,
      ),
    ).toBe(469);
  });

  test("ignores positions for nodes that aren't in the node list", () => {
    const drawing: Drawing = buildDrawing(classCardsInBox(400, 500));
    drawing.positions.set("observable:stale", { x: 9000, y: 9000 });
    drawing.positions.set("class:stale", { x: -9000, y: -9000 });

    expect(getCanvasHeight(drawing.nodes, drawing.positions, 375)).toBe(469);
  });

  test.each([
    // 1500 * 56 / 220 = 381.8 → 382.
    ["center" as CorrelationGraphNodeKind, 382],
    // 1500 * 56 / 196 = 428.6 → 429.
    ["class" as CorrelationGraphNodeKind, 429],
    // 1500 * 32 / 164 = 292.7 → 293.
    ["observable" as CorrelationGraphNodeKind, 293],
  ])(
    "a lone %p card is sized from its CORRELATE_NODE_SIZES width and height",
    (kind: CorrelationGraphNodeKind, expected: number) => {
      const placed: Array<PlacedNode> = [
        { id: `${kind}:only`, kind, x: 37, y: -12 },
      ];
      expect(drawingWidthOf(placed)).toBe(CORRELATE_NODE_SIZES[kind].width);
      expect(drawingHeightOf(placed)).toBe(CORRELATE_NODE_SIZES[kind].height);
      expect(narrowHeightOf(placed, 1500)).toBe(
        Math.round(
          (1500 * CORRELATE_NODE_SIZES[kind].height) /
            CORRELATE_NODE_SIZES[kind].width,
        ),
      );
      expect(narrowHeightOf(placed, 1500)).toBe(expected);
    },
  );

  test("measures a mixed drawing from each card's own width and height", () => {
    /*
     * Centre card at the origin and an observable pill down and to the
     * right: x runs from -110 to 208 + 82 = 290 and y from -28 to
     * 356 + 16 = 372, a 400 × 400 drawing.
     */
    const square: Array<PlacedNode> = [
      { id: "center", kind: "center", x: 0, y: 0 },
      { id: "observable:alice", kind: "observable", x: 208, y: 356 },
    ];
    expect(drawingWidthOf(square)).toBe(
      208 +
        CORRELATE_NODE_SIZES.center.width / 2 +
        CORRELATE_NODE_SIZES.observable.width / 2,
    );
    expect(drawingWidthOf(square)).toBe(400);
    expect(drawingHeightOf(square)).toBe(400);
    expect(narrowHeightOf(square, 360)).toBe(360);

    /*
     * Different kinds set each edge: the class card is leftmost (-398) and
     * lowest (178), the observable rightmost (332) and highest (-136), so
     * the drawing is 730 × 314 and 1000 * 314 / 730 ≈ 430.1 → 430.
     */
    const mixed: Array<PlacedNode> = [
      { id: "center", kind: "center", x: 0, y: 0 },
      { id: "class:Authentication", kind: "class", x: -300, y: 150 },
      { id: "observable:bob", kind: "observable", x: 250, y: -120 },
    ];
    expect(drawingWidthOf(mixed)).toBe(
      250 +
        CORRELATE_NODE_SIZES.observable.width / 2 -
        (-300 - CORRELATE_NODE_SIZES.class.width / 2),
    );
    expect(drawingWidthOf(mixed)).toBe(730);
    expect(drawingHeightOf(mixed)).toBe(
      150 +
        CORRELATE_NODE_SIZES.class.height / 2 -
        (-120 - CORRELATE_NODE_SIZES.observable.height / 2),
    );
    expect(drawingHeightOf(mixed)).toBe(314);
    expect(narrowHeightOf(mixed, 1000)).toBe(expectedNarrowHeight(mixed, 1000));
    expect(narrowHeightOf(mixed, 1000)).toBe(430);
  });

  test("horizontal spread matters: a wider drawing gets a shorter canvas", () => {
    // 375 * 1000 / 800 = 468.75 → 469; / 1000 = 375; / 1200 = 312.5 → 313.
    expect(narrowHeightOf(classCardsInBox(800, 1000), 375)).toBe(469);
    expect(narrowHeightOf(classCardsInBox(1000, 1000), 375)).toBe(375);
    expect(narrowHeightOf(classCardsInBox(1200, 1000), 375)).toBe(313);

    let previous: number = Infinity;
    for (let width: number = 200; width <= 3000; width += 50) {
      const height: number = narrowHeightOf(classCardsInBox(width, 1000), 375);
      expect(height).toBeLessThanOrEqual(previous);
      previous = height;
    }
  });

  test("only the aspect ratio counts, not the drawing's size or position", () => {
    const base: number = narrowHeightOf(classCardsInBox(400, 500), 360);
    expect(base).toBe(450);
    expect(narrowHeightOf(classCardsInBox(800, 1000), 360)).toBe(base);
    expect(narrowHeightOf(classCardsInBox(1200, 1500), 360)).toBe(base);
    expect(narrowHeightOf(classCardsInBox(400, 500, -1000, 750), 360)).toBe(
      base,
    );
  });

  test("does not depend on node order", () => {
    const placed: Array<PlacedNode> = [
      { id: "center", kind: "center", x: 0, y: 10 },
      { id: "class:a", kind: "class", x: -240, y: -150 },
      { id: "observable:x", kind: "observable", x: 120, y: 400 },
      { id: "class:b", kind: "class", x: 260, y: 90 },
    ];
    expect(narrowHeightOf([...placed].reverse(), 375)).toBe(
      narrowHeightOf(placed, 375),
    );
    expect(narrowHeightOf(placed, 375)).toBe(expectedNarrowHeight(placed, 375));
  });

  test("never shrinks as the canvas widens", () => {
    const placed: Array<PlacedNode> = classCardsInBox(400, 500);
    let previous: number = 0;
    for (let canvasWidth: number = 1; canvasWidth <= 1000; canvasWidth += 13) {
      const height: number = narrowHeightOf(placed, canvasWidth);
      expect(height).toBeGreaterThanOrEqual(previous);
      previous = height;
    }
  });

  test("always returns an integer within 280..520 that matches the formula", () => {
    for (let width: number = 196; width <= 1600; width += 97) {
      for (let height: number = 56; height <= 1600; height += 89) {
        const placed: Array<PlacedNode> = classCardsInBox(width, height);
        for (const canvasWidth of [1, 120, 320, 375, 390, 414, 767]) {
          const result: number = narrowHeightOf(placed, canvasWidth);
          expect(Number.isInteger(result)).toBe(true);
          expect(result).toBeGreaterThanOrEqual(MIN_NARROW_CANVAS_HEIGHT);
          expect(result).toBeLessThanOrEqual(MAX_NARROW_CANVAS_HEIGHT);
          expect(result).toBe(expectedNarrowHeight(placed, canvasWidth));
        }
      }
    }
  });
});

describe("normalizeCorrelationFilter", () => {
  test("returns null for no filter", () => {
    expect(normalizeCorrelationFilter(null)).toBeNull();
  });

  test("an empty OR filter becomes an empty AND filter", () => {
    const input: CorrelationFilter = deepFreezeFilter({
      conditions: [],
      connector: "or",
    });
    const result: CorrelationFilter | null = normalizeCorrelationFilter(input);
    expect(result).toEqual({ conditions: [], connector: "and" });
    expect(result).not.toBe(input);
    expect(input).toEqual({ conditions: [], connector: "or" });
  });

  test("an empty AND filter is left as it is", () => {
    const input: CorrelationFilter = deepFreezeFilter({
      conditions: [],
      connector: "and",
    });
    expect(normalizeCorrelationFilter(input)).toEqual({
      conditions: [],
      connector: "and",
    });
    expect(input).toEqual({ conditions: [], connector: "and" });
  });

  test("a one-condition OR filter becomes an AND filter with the same condition", () => {
    const input: CorrelationFilter = deepFreezeFilter(
      cloneFilter({ conditions: [OBSERVABLE_IS_ALICE], connector: "or" }),
    );
    const result: CorrelationFilter | null = normalizeCorrelationFilter(input);
    expect(result).toEqual({
      conditions: [
        {
          field: CorrelationFieldKey.Observable,
          operator: CorrelationOperator.Equals,
          value: "alice",
        },
      ],
      connector: "and",
    });
    expect(result).not.toBe(input);
    expect(input.connector).toBe("or");
    expect(input.conditions).toEqual([OBSERVABLE_IS_ALICE]);
  });

  test.each([
    [OBSERVABLE_IS_ALICE],
    [MESSAGE_CONTAINS_DENIED],
    [CLASS_IS_AUTHENTICATION],
    [
      makeCondition(
        CorrelationFieldKey.PrincipalIp,
        CorrelationOperator.NotEquals,
        "10.0.0.1",
      ),
    ],
    [
      makeCondition(
        CorrelationFieldKey.Severity,
        CorrelationOperator.Equals,
        "High",
      ),
    ],
    [
      makeCondition(
        CorrelationFieldKey.RuleName,
        CorrelationOperator.StartsWith,
        "",
      ),
    ],
  ])(
    "switches a lone %p condition from OR to AND without touching it",
    (condition: CorrelationCondition) => {
      const input: CorrelationFilter = deepFreezeFilter(
        cloneFilter({ conditions: [condition], connector: "or" }),
      );
      const result: CorrelationFilter | null =
        normalizeCorrelationFilter(input);
      expect(result).not.toBeNull();
      expect(result!.connector).toBe("and");
      expect(result!.conditions).toEqual([condition]);
      expect(input.connector).toBe("or");
    },
  );

  test("a one-condition AND filter is returned unchanged", () => {
    const input: CorrelationFilter = deepFreezeFilter(
      cloneFilter({ conditions: [MESSAGE_CONTAINS_DENIED], connector: "and" }),
    );
    const before: CorrelationFilter = cloneFilter(input);
    const result: CorrelationFilter | null = normalizeCorrelationFilter(input);
    // Returning the same object or an equal copy are both fine.
    expect(result).toEqual(before);
    expect(input).toEqual(before);
  });

  test.each([
    [[OBSERVABLE_IS_ALICE, MESSAGE_CONTAINS_DENIED]],
    [[OBSERVABLE_IS_ALICE, CLASS_IS_AUTHENTICATION, MESSAGE_CONTAINS_DENIED]],
    [[OBSERVABLE_IS_ALICE, OBSERVABLE_IS_ALICE]],
  ])(
    "an OR filter with several conditions keeps OR (%p)",
    (conditions: Array<CorrelationCondition>) => {
      const input: CorrelationFilter = deepFreezeFilter(
        cloneFilter({ conditions, connector: "or" }),
      );
      const before: CorrelationFilter = cloneFilter(input);
      const result: CorrelationFilter | null =
        normalizeCorrelationFilter(input);
      expect(result).toEqual({ conditions, connector: "or" });
      expect(input).toEqual(before);
    },
  );

  test("an AND filter with several conditions keeps AND", () => {
    const input: CorrelationFilter = deepFreezeFilter(
      cloneFilter({
        conditions: [CLASS_IS_AUTHENTICATION, MESSAGE_CONTAINS_DENIED],
        connector: "and",
      }),
    );
    expect(normalizeCorrelationFilter(input)).toEqual({
      conditions: [CLASS_IS_AUTHENTICATION, MESSAGE_CONTAINS_DENIED],
      connector: "and",
    });
  });

  test("keeps the conditions' order and contents", () => {
    const conditions: Array<CorrelationCondition> = [
      MESSAGE_CONTAINS_DENIED,
      OBSERVABLE_IS_ALICE,
      CLASS_IS_AUTHENTICATION,
    ];
    for (const connector of ["and", "or"] as const) {
      const result: CorrelationFilter | null = normalizeCorrelationFilter(
        cloneFilter({ conditions, connector }),
      );
      expect(result!.conditions).toEqual(conditions);
    }
  });

  test("does not mutate any filter it is given", () => {
    const filters: Array<CorrelationFilter> = [
      { conditions: [], connector: "or" },
      { conditions: [], connector: "and" },
      { conditions: [OBSERVABLE_IS_ALICE], connector: "or" },
      { conditions: [CLASS_IS_AUTHENTICATION], connector: "and" },
      {
        conditions: [OBSERVABLE_IS_ALICE, MESSAGE_CONTAINS_DENIED],
        connector: "or",
      },
      {
        conditions: [OBSERVABLE_IS_ALICE, MESSAGE_CONTAINS_DENIED],
        connector: "and",
      },
    ];
    for (const filter of filters) {
      // Unfrozen, so a mutation would go through silently and be caught below.
      const input: CorrelationFilter = cloneFilter(filter);
      const conditionsRef: Array<CorrelationCondition> = input.conditions;
      const snapshot: string = JSON.stringify(input);

      normalizeCorrelationFilter(input);

      expect(JSON.stringify(input)).toBe(snapshot);
      expect(input.conditions).toBe(conditionsRef);
      expect(input).toEqual(filter);

      // Frozen, so an in-place write would throw.
      expect(() => {
        normalizeCorrelationFilter(deepFreezeFilter(cloneFilter(filter)));
      }).not.toThrow();
    }
  });

  test("is idempotent", () => {
    const filters: Array<CorrelationFilter | null> = [
      null,
      { conditions: [], connector: "or" },
      { conditions: [OBSERVABLE_IS_ALICE], connector: "or" },
      { conditions: [OBSERVABLE_IS_ALICE], connector: "and" },
      {
        conditions: [OBSERVABLE_IS_ALICE, CLASS_IS_AUTHENTICATION],
        connector: "or",
      },
    ];
    for (const filter of filters) {
      const once: CorrelationFilter | null = normalizeCorrelationFilter(filter);
      expect(normalizeCorrelationFilter(once)).toEqual(once);
    }
  });

  test("never leaves an OR connector on a filter with fewer than two conditions", () => {
    const pool: Array<CorrelationCondition> = [
      OBSERVABLE_IS_ALICE,
      MESSAGE_CONTAINS_DENIED,
      CLASS_IS_AUTHENTICATION,
    ];
    for (let count: number = 0; count <= pool.length; count++) {
      for (const connector of ["and", "or"] as const) {
        const conditions: Array<CorrelationCondition> = pool.slice(0, count);
        const result: CorrelationFilter | null = normalizeCorrelationFilter({
          conditions,
          connector,
        });
        expect(result!.conditions).toEqual(conditions);
        expect(result!.connector).toBe(count <= 1 ? "and" : connector);
      }
    }
  });
});
