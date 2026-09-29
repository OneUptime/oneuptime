import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import {
  FlowExtent,
  FlowPaneSize,
  FlowRect,
  FlowTransform,
  FlowViewportPosition,
  MIN_VISIBLE_NODE_PX,
  UNBOUNDED_FLOW_EXTENT,
  VIEWPORT_MOVE_TOLERANCE_PX,
  VIEWPORT_ZOOM_TOLERANCE,
  anyRectInView,
  drawingExtent,
  extentsMatch,
  hasViewportMoved,
  isDrawnRect,
  noticeOffsetInCanvas,
  panDeltaToReveal,
} from "../../FeatureSet/Dashboard/src/Components/Topology/FlowViewport";
import {
  ServiceMapEdge,
  ServiceMapLayout,
  layoutServiceMap,
} from "../../FeatureSet/Dashboard/src/Components/Topology/ServiceMapViewModel";

/*
 * Issue #4117: the Service Map went blank at random, and only a page refresh
 * brought it back. Part of that was the view itself. React Flow lets the
 * viewport go anywhere by default, and a large project fits as a narrow
 * column of cards in a wide canvas, so most of the canvas is empty: a drag
 * that ran long, or a zoom about an empty spot, carried every card off the
 * canvas, and nothing brought them back.
 *
 * FlowViewport.ts is the React-free maths the map keeps its view with: which
 * boxes count as drawn, the extent the view may move within (React Flow's
 * translateExtent), whether any card is on the canvas (the map's "out of
 * view" notice), whether a gesture really moved the view (only one that
 * did ends the automatic framing), how far to pan to show a card or
 * connection keyboard focus reached, and where on a canvas taller than the
 * window the notice can be read. Each helper is pinned first. Then the
 * guarantees are proved on a drawing shaped like the customer's, against
 * d3-zoom's own drag and constrain steps: with the extent, no view d3-zoom
 * allows leaves the drawing, and neither a press on the fitted map, which
 * d3-zoom hands back a rounding error away, nor the slip of a click is taken
 * for a move.
 */

/*
 * The Service Map's settings, mirrored because App's tests cannot import the
 * map (a React view). The last block checks the map still says the same.
 */
const NODE_WIDTH: number = 256; // TOPOLOGY_NODE_WIDTH
const NODE_HEIGHT: number = 128; // TOPOLOGY_NODE_HEIGHT, the tallest card
const COLUMN_GAP: number = NODE_WIDTH + 110;
const ROW_GAP: number = NODE_HEIGHT + 20;
const PAN_MARGIN: number = NODE_HEIGHT; // SERVICE_MAP_PAN_MARGIN
const MIN_ZOOM: number = 0.1;
const MAX_ZOOM: number = 1.5;
const FIT_PADDING: number = 0.18; // SERVICE_MAP_FIT_VIEW_OPTIONS
const FIT_MAX_ZOOM: number = 1;
const FOCUS_PADDING: number = 24; // FOCUS_REVEAL_PADDING_PX
const NOTICE_INSET: number = 16; // OUT_OF_VIEW_NOTICE_INSET_PX

/*
 * The canvas from a phone to a desktop: as wide as the page lets it be, and
 * as tall as the map makes it (460 to 880 px).
 */
const PHONE_CANVAS: FlowPaneSize = { width: 340, height: 460 };
const DESKTOP_CANVAS: FlowPaneSize = { width: 1566, height: 880 };
const CANVASES: Array<FlowPaneSize> = [
  PHONE_CANVAS,
  { width: 340, height: 880 },
  { width: 390, height: 880 },
  { width: 768, height: 880 },
  { width: 1024, height: 640 },
  { width: 1280, height: 880 },
  { width: 1566, height: 460 },
  DESKTOP_CANVAS,
];

/* A card of the map's size with its top-left corner at x, y. */
function cardAt(x: number, y: number): FlowRect {
  return { x: x, y: y, width: NODE_WIDTH, height: NODE_HEIGHT };
}

/* Deterministic pseudo-random numbers in [0, 1) (mulberry32). */
type NextRandomFunction = () => number;

function makeRandom(seed: number): NextRandomFunction {
  let state: number = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed: number = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * A pseudo-random number from `min` to `max` (both on the grid) in steps of
 * a 64th of a pixel. Sums, differences and halves of such numbers are
 * exact, so a property over them can be checked exactly, edges included.
 */
function onGrid(random: NextRandomFunction, min: number, max: number): number {
  return min + Math.round(random() * (max - min) * 64) / 64;
}

describe("isDrawnRect", () => {
  test("a box with a finite position and a real size is drawn", () => {
    expect(isDrawnRect(cardAt(0, 0))).toBe(true);
    // Left of and above the origin is still on the drawing.
    expect(isDrawnRect({ x: -732, y: -148.5, width: 256, height: 88 })).toBe(
      true,
    );
    expect(isDrawnRect({ x: 3, y: 4, width: 0.5, height: 0.5 })).toBe(true);
  });

  test("a box React Flow has not measured, or measured as nothing, is not drawn", () => {
    expect(isDrawnRect({ ...cardAt(0, 0), width: 0 })).toBe(false);
    expect(isDrawnRect({ ...cardAt(0, 0), height: 0 })).toBe(false);
    expect(isDrawnRect({ ...cardAt(0, 0), width: 0, height: 0 })).toBe(false);
    expect(isDrawnRect({ ...cardAt(0, 0), width: -256 })).toBe(false);
    expect(isDrawnRect({ ...cardAt(0, 0), height: -128 })).toBe(false);
  });

  test("a box with any coordinate that is not a finite number is not drawn", () => {
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(isDrawnRect({ ...cardAt(0, 0), x: bad })).toBe(false);
      expect(isDrawnRect({ ...cardAt(0, 0), y: bad })).toBe(false);
      expect(isDrawnRect({ ...cardAt(0, 0), width: bad })).toBe(false);
      expect(isDrawnRect({ ...cardAt(0, 0), height: bad })).toBe(false);
    }
  });

  test("no box at all is not drawn", () => {
    expect(isDrawnRect(null)).toBe(false);
    expect(isDrawnRect(undefined)).toBe(false);
  });
});

describe("drawingExtent", () => {
  const CARDS: Array<FlowRect> = [
    cardAt(0, 0),
    cardAt(366, 148),
    { x: -100, y: 500, width: 50, height: 88 },
  ];

  test("is the drawing's bounding box grown by the margin on every side", () => {
    expect(drawingExtent(CARDS, 128)).toEqual([
      [-228, -128],
      [750, 716],
    ]);
  });

  test("with no margin it is the bounding box itself", () => {
    expect(drawingExtent(CARDS, 0)).toEqual([
      [-100, 0],
      [622, 588],
    ]);
  });

  test("a single card is that card plus the margin", () => {
    expect(drawingExtent([cardAt(732, 296)], 20)).toEqual([
      [712, 276],
      [1008, 444],
    ]);
  });

  test("boxes that are not drawn are skipped rather than allowed to poison the extent", () => {
    const withUndrawn: Array<FlowRect> = [
      { ...cardAt(0, 0), x: Number.NaN },
      cardAt(0, 0),
      // Not measured yet, and far from everything else.
      { x: -5000, y: -5000, width: 0, height: 0 },
      cardAt(366, 148),
      { ...cardAt(9000, 9000), height: Number.POSITIVE_INFINITY },
      { ...cardAt(20000, 0), width: -256 },
      { ...cardAt(0, 0), y: Number.NEGATIVE_INFINITY },
      { x: -100, y: 500, width: 50, height: 88 },
    ];
    expect(drawingExtent(withUndrawn, 128)).toEqual(drawingExtent(CARDS, 128));
  });

  test("a negative margin, or one that is not a number, adds no slack", () => {
    const bounds: FlowExtent = drawingExtent(CARDS, 0);
    for (const margin of [-1, -128, Number.NEGATIVE_INFINITY, Number.NaN]) {
      expect(drawingExtent(CARDS, margin)).toEqual(bounds);
    }
  });

  test("with nothing drawn there is nothing to keep in view, so the view is unbounded", () => {
    expect(drawingExtent([], 128)).toEqual(UNBOUNDED_FLOW_EXTENT);
    expect(
      drawingExtent(
        [
          { ...cardAt(0, 0), width: 0, height: 0 },
          { ...cardAt(0, 0), x: Number.NaN },
        ],
        128,
      ),
    ).toEqual(UNBOUNDED_FLOW_EXTENT);
  });

  test("unbounded is React Flow's own default: the view may go anywhere", () => {
    expect(UNBOUNDED_FLOW_EXTENT).toEqual([
      [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
      [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    ]);
  });

  test("the order of the boxes does not matter", () => {
    expect(drawingExtent([...CARDS].reverse(), 128)).toEqual(
      drawingExtent(CARDS, 128),
    );
  });

  test("reads any iterable in one pass, such as a generator over React Flow's nodes", () => {
    function* measured(): Generator<FlowRect> {
      for (const card of CARDS) {
        yield card;
      }
    }
    expect(drawingExtent(measured(), 128)).toEqual(drawingExtent(CARDS, 128));
    const byId: Map<string, FlowRect> = new Map<string, FlowRect>([
      ["web", CARDS[0]!],
      ["api", CARDS[1]!],
      ["postgres", CARDS[2]!],
    ]);
    expect(drawingExtent(byId.values(), 128)).toEqual(
      drawingExtent(CARDS, 128),
    );
  });
});

describe("extentsMatch", () => {
  const EXTENT: FlowExtent = [
    [-228, -128],
    [750, 716],
  ];

  test("an extent matches itself, an identical copy and the same drawing measured again", () => {
    expect(extentsMatch(EXTENT, EXTENT)).toBe(true);
    expect(
      extentsMatch(EXTENT, [
        [-228, -128],
        [750, 716],
      ]),
    ).toBe(true);
    const cards: Array<FlowRect> = [cardAt(0, 0), cardAt(366, 148)];
    expect(
      extentsMatch(
        drawingExtent(cards, 128),
        drawingExtent([...cards].reverse(), 128),
      ),
    ).toBe(true);
  });

  test("rounding noise under a millionth of a flow unit still matches", () => {
    const noisy: FlowExtent = [
      [-228 + 1e-9, -128 - 1e-9],
      [750 + 4e-7, 716 - 4e-7],
    ];
    expect(extentsMatch(EXTENT, noisy)).toBe(true);
    expect(extentsMatch(noisy, EXTENT)).toBe(true);
  });

  test("moving any one edge by a real amount is a different extent", () => {
    const moved: Array<[string, FlowExtent]> = [
      [
        "left",
        [
          [-228.001, -128],
          [750, 716],
        ],
      ],
      [
        "top",
        [
          [-228, -127.999],
          [750, 716],
        ],
      ],
      [
        "right",
        [
          [-228, -128],
          [750.001, 716],
        ],
      ],
      [
        "bottom",
        [
          [-228, -128],
          [750, 715.999],
        ],
      ],
    ];
    const stillMatching: Array<string> = [];
    for (const [edge, extent] of moved) {
      if (extentsMatch(EXTENT, extent) || extentsMatch(extent, EXTENT)) {
        stillMatching.push(edge);
      }
    }
    expect(stillMatching).toEqual([]);
  });

  test("the unbounded extent matches only another unbounded extent", () => {
    expect(
      extentsMatch(UNBOUNDED_FLOW_EXTENT, [
        [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
        [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
      ]),
    ).toBe(true);
    expect(extentsMatch(UNBOUNDED_FLOW_EXTENT, EXTENT)).toBe(false);
    expect(extentsMatch(EXTENT, UNBOUNDED_FLOW_EXTENT)).toBe(false);
    // Bounded on one side only is not unbounded.
    expect(
      extentsMatch(UNBOUNDED_FLOW_EXTENT, [
        [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
        [Number.POSITIVE_INFINITY, 716],
      ]),
    ).toBe(false);
  });
});

describe("anyRectInView", () => {
  const PANE: FlowPaneSize = { width: 800, height: 600 };
  const IDENTITY: FlowTransform = [0, 0, 1];

  function inView(
    rects: Iterable<FlowRect>,
    transform: FlowTransform = IDENTITY,
  ): boolean {
    return anyRectInView(rects, transform, PANE);
  }

  test("a card on the canvas is in view, flush against its corners too", () => {
    expect(inView([cardAt(272, 236)])).toBe(true);
    expect(inView([cardAt(0, 0)])).toBe(true);
    expect(inView([cardAt(800 - 256, 600 - 128)])).toBe(true);
  });

  test("a card wholly past any edge of the canvas, or just touching it, is not in view", () => {
    const outside: Array<[string, FlowRect]> = [
      ["touching the left edge", cardAt(-256, 236)],
      ["touching the right edge", cardAt(800, 236)],
      ["touching the top edge", cardAt(272, -128)],
      ["touching the bottom edge", cardAt(272, 600)],
      ["far to the left", cardAt(-5000, 236)],
      ["far to the right", cardAt(5000, 236)],
      ["far above", cardAt(272, -5000)],
      ["far below", cardAt(272, 5000)],
      ["off a corner", cardAt(-300, -200)],
    ];
    const counted: Array<string> = [];
    for (const [where, card] of outside) {
      if (inView([card])) {
        counted.push(where);
      }
    }
    expect(counted).toEqual([]);
  });

  test("a sliver at an edge counts only from MIN_VISIBLE_NODE_PX of the card on", () => {
    const sliver: number = MIN_VISIBLE_NODE_PX;
    const atEdge: Array<[string, (shown: number) => FlowRect]> = [
      [
        "left",
        (shown: number): FlowRect => {
          return cardAt(-256 + shown, 236);
        },
      ],
      [
        "right",
        (shown: number): FlowRect => {
          return cardAt(800 - shown, 236);
        },
      ],
      [
        "top",
        (shown: number): FlowRect => {
          return cardAt(272, -128 + shown);
        },
      ],
      [
        "bottom",
        (shown: number): FlowRect => {
          return cardAt(272, 600 - shown);
        },
      ],
    ];
    for (const [, cardShowing] of atEdge) {
      expect(inView([cardShowing(1)])).toBe(false);
      expect(inView([cardShowing(sliver - 0.5)])).toBe(false);
      expect(inView([cardShowing(sliver)])).toBe(true);
      expect(inView([cardShowing(sliver + 30)])).toBe(true);
    }
  });

  test("a card must show on both axes: all the way across but a sliver down is not in view", () => {
    expect(inView([cardAt(272, -128 + 3)])).toBe(false);
    expect(inView([cardAt(-256 + 3, 236)])).toBe(false);
    // In the corner, a sliver on both axes.
    expect(inView([cardAt(-256 + 3, -128 + 3)])).toBe(false);
  });

  test("a card smaller on screen than the threshold counts when all of it is on the canvas", () => {
    /*
     * At 1/64x a card is 4 x 2 px, under MIN_VISIBLE_NODE_PX both ways. (A
     * power of two keeps the screen sizes here exact.)
     */
    const zoomedFarOut: FlowTransform = [0, 0, 1 / 64];
    expect(NODE_WIDTH / 64).toBeLessThan(MIN_VISIBLE_NODE_PX);
    expect(inView([cardAt(1024, 1024)], zoomedFarOut)).toBe(true);
    // Cut by an edge it does not count: part of a speck is not a map.
    expect(inView([cardAt(-128, 1024)], zoomedFarOut)).toBe(false);
    expect(inView([cardAt(1024, -64)], zoomedFarOut)).toBe(false);
  });

  test("a node smaller than the threshold counts when all of it shows, even where its size on screen rounds an ulp low", () => {
    /*
     * The helper puts a box's far edge at near + size * zoom, and
     * (near + size * zoom) - near can come out a floating-point ulp under
     * size * zoom: all of the node is on the canvas, yet what shows of it
     * measures a hair less than the node. A node smaller on screen than the
     * threshold counts only when all of it shows, so a comparison without
     * slack would take such a node for one cut by an edge. Search positions,
     * zooms and translations for those cases on each axis (a 33.5-unit node
     * is under MIN_VISIBLE_NODE_PX up to about 0.239x), with the other axis
     * a card's size, far over the threshold, and require every node to count.
     */
    const size: number = 33.5;
    // None, and one like a fitted view's.
    const translations: Array<number> = [0, 67.1186440677966];
    const axes: Array<"x" | "y"> = ["x", "y"];
    const roundedLow: Record<"x" | "y", number> = { x: 0, y: 0 };
    const failures: Array<string> = [];
    for (const axis of axes) {
      const paneSize: number = axis === "x" ? PANE.width : PANE.height;
      for (const translation of translations) {
        for (let i: number = 0; i < 100; i++) {
          for (let j: number = 0; j < 47; j++) {
            const position: number = i * 0.1 + 0.03;
            const zoom: number = 0.1 + j * 0.003;
            const near: number = translation + position * zoom;
            const far: number = near + size * zoom;
            if (
              size * zoom >= MIN_VISIBLE_NODE_PX ||
              near < 0 ||
              far > paneSize
            ) {
              failures.push(
                `not a wholly visible speck: ${axis} ${position} at ${zoom}x`,
              );
              continue;
            }
            if (far - near < size * zoom) {
              roundedLow[axis]++;
            }
            const node: FlowRect =
              axis === "x"
                ? { x: position, y: 10, width: size, height: NODE_HEIGHT }
                : { x: 10, y: position, width: NODE_WIDTH, height: size };
            if (
              !anyRectInView([node], [translation, translation, zoom], PANE)
            ) {
              failures.push(
                `${axis} ${position} at ${zoom}x, translated ${translation}`,
              );
            }
          }
        }
      }
    }
    // The search found nodes whose size on screen rounds low, on each axis...
    expect(roundedLow.x).toBeGreaterThan(0);
    expect(roundedLow.y).toBeGreaterThan(0);
    // ...and every wholly visible node counted, those included.
    expect({
      failures: failures.length,
      first: failures.slice(0, 5),
    }).toEqual({ failures: 0, first: [] });
  });

  test("the rounding slack is no more than that: a millionth of a pixel short of what a node needs does not count", () => {
    const short: number = MIN_VISIBLE_NODE_PX - 1e-6;
    // A card at each edge showing a millionth of a pixel under the threshold.
    expect(inView([cardAt(-256 + short, 236)])).toBe(false);
    expect(inView([cardAt(800 - short, 236)])).toBe(false);
    expect(inView([cardAt(272, -128 + short)])).toBe(false);
    expect(inView([cardAt(272, 600 - short)])).toBe(false);
    expect(
      anyRectInView([cardAt(-256 + 50 - 1e-6, 236)], IDENTITY, PANE, 50),
    ).toBe(false);
    /*
     * A node smaller than the threshold (at 1/64x a card is 4 x 2 px) with a
     * millionth of a pixel of it cut off by each edge in turn...
     */
    const zoomedFarOut: FlowTransform = [0, 0, 1 / 64];
    const cut: number = 1e-6 * 64; // a millionth of a pixel, in flow units
    expect(inView([cardAt(-cut, 1024)], zoomedFarOut)).toBe(false);
    expect(inView([cardAt(796 * 64 + cut, 1024)], zoomedFarOut)).toBe(false);
    expect(inView([cardAt(1024, -cut)], zoomedFarOut)).toBe(false);
    expect(inView([cardAt(1024, 598 * 64 + cut)], zoomedFarOut)).toBe(false);
    // ...counts once none of it is cut, flush against the same edges.
    expect(inView([cardAt(0, 1024)], zoomedFarOut)).toBe(true);
    expect(inView([cardAt(796 * 64, 1024)], zoomedFarOut)).toBe(true);
    expect(inView([cardAt(1024, 0)], zoomedFarOut)).toBe(true);
    expect(inView([cardAt(1024, 598 * 64)], zoomedFarOut)).toBe(true);
  });

  test("the zoom scales a card's position and size, and the translation shifts it", () => {
    const card: FlowRect = cardAt(2000, 1000);
    // At 1x it sits at (2000, 1000), past the canvas.
    expect(inView([card])).toBe(false);
    // At 0.25x it is a 64 x 32 box at (500, 250).
    expect(inView([card], [0, 0, 0.25])).toBe(true);
    // Moved 564 px left, its right edge touches the canvas's left edge...
    expect(inView([card], [-564, 0, 0.25])).toBe(false);
    // ...and 8 px less shows a sliver of 8 px.
    expect(inView([card], [-556, 0, 0.25])).toBe(true);
    // The translation brings a far card onto the canvas at 1x...
    expect(inView([card], [-1800, -900, 1])).toBe(true);
    // ...and zooming in about the canvas's corner carries it off again.
    expect(inView([card], [-1800, -900, 2])).toBe(false);
  });

  test("one card in view is enough, wherever it is in the list", () => {
    const farAway: Array<FlowRect> = [];
    for (let index: number = 0; index < 50; index++) {
      farAway.push(cardAt(-5000 - index * 366, 236));
    }
    expect(inView(farAway)).toBe(false);
    expect(inView([cardAt(272, 236), ...farAway])).toBe(true);
    expect(inView([...farAway, cardAt(272, 236)])).toBe(true);
  });

  test("nothing drawn is nothing in view", () => {
    expect(inView([])).toBe(false);
  });

  test("cards still waiting to be measured are not in view", () => {
    const unmeasured: Array<FlowRect> = [
      { ...cardAt(272, 236), width: 0, height: 0 },
      { ...cardAt(272, 236), width: Number.NaN },
    ];
    expect(inView(unmeasured)).toBe(false);
    expect(inView([...unmeasured, cardAt(-5000, 236)])).toBe(false);
    expect(inView([...unmeasured, cardAt(100, 100)])).toBe(true);
  });

  test("a canvas that has not been measured cannot be judged, so the map counts as in view", () => {
    const unmeasured: Array<FlowPaneSize> = [
      { width: 0, height: 0 },
      { width: 0, height: 600 },
      { width: 800, height: 0 },
      { width: -800, height: 600 },
      { width: Number.NaN, height: 600 },
      { width: 800, height: Number.NaN },
    ];
    for (const pane of unmeasured) {
      expect(anyRectInView([cardAt(-5000, -5000)], IDENTITY, pane)).toBe(true);
      // Before its canvas has a size the map is not judged at all.
      expect(anyRectInView([], [Number.NaN, 0, 1], pane)).toBe(true);
    }
  });

  test("a transform that is not finite, or has no positive zoom, puts nothing on the canvas", () => {
    const broken: Array<FlowTransform> = [
      [Number.NaN, 0, 1],
      [0, Number.NaN, 1],
      [Number.POSITIVE_INFINITY, 0, 1],
      [0, Number.NEGATIVE_INFINITY, 1],
      [0, 0, 0],
      [0, 0, -1],
      [0, 0, Number.NaN],
      [0, 0, Number.POSITIVE_INFINITY],
    ];
    for (const transform of broken) {
      expect(inView([cardAt(0, 0)], transform)).toBe(false);
    }
  });

  test("a custom threshold asks for that much of a card on each axis", () => {
    function inViewNeeding(card: FlowRect, needed: number): boolean {
      return anyRectInView([card], IDENTITY, PANE, needed);
    }
    expect(inViewNeeding(cardAt(-256 + 49, 236), 50)).toBe(false);
    expect(inViewNeeding(cardAt(-256 + 50, 236), 50)).toBe(true);
    expect(inViewNeeding(cardAt(272, 600 - 49), 50)).toBe(false);
    expect(inViewNeeding(cardAt(272, 600 - 50), 50)).toBe(true);
    expect(inViewNeeding(cardAt(-256 + 1, 236), 1)).toBe(true);
    // A card smaller than the threshold (32 x 16 px) counts once all of it shows.
    expect(anyRectInView([cardAt(1024, 1024)], [0, 0, 1 / 8], PANE, 50)).toBe(
      true,
    );
    expect(anyRectInView([cardAt(-128, 1024)], [0, 0, 1 / 8], PANE, 50)).toBe(
      false,
    );
  });

  test("a threshold of zero, below zero or not a number counts any overlap at all", () => {
    for (const needed of [0, -8, Number.NaN]) {
      expect(
        anyRectInView([cardAt(-256 + 0.5, 236)], IDENTITY, PANE, needed),
      ).toBe(true);
      expect(
        anyRectInView([cardAt(272, 600 - 0.5)], IDENTITY, PANE, needed),
      ).toBe(true);
      // Touching the edge is still no overlap.
      expect(anyRectInView([cardAt(-256, 236)], IDENTITY, PANE, needed)).toBe(
        false,
      );
    }
  });

  test("reads any iterable in one pass, such as a generator over React Flow's nodes", () => {
    function* measured(): Generator<FlowRect> {
      yield cardAt(-5000, 236);
      yield cardAt(272, 236);
    }
    expect(inView(measured())).toBe(true);
  });
});

describe("hasViewportMoved", () => {
  const VIEW: FlowViewportPosition = { x: 100, y: -200, zoom: 0.5 };
  /*
   * Zooms from the map's farthest out (0.1x) to its closest in (1.5x), with
   * the zoom the report-shaped map is fitted at on a desktop canvas.
   */
  const ZOOMS: Array<number> = [MIN_ZOOM, 0.12640045963803503, 1, MAX_ZOOM];

  function describeViewport(viewport: FlowViewportPosition): string {
    return `${viewport.x}, ${viewport.y} at ${viewport.zoom}x`;
  }

  test("a view compared with itself, or with an identical copy of it, has not moved", () => {
    expect(hasViewportMoved(VIEW, VIEW)).toBe(false);
    expect(hasViewportMoved(VIEW, { ...VIEW })).toBe(false);
    expect(
      hasViewportMoved({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0, zoom: 1 }),
    ).toBe(false);
  });

  test("a float ulp or so of rounding noise, such as d3-zoom leaves on a pinned view, is not a move", () => {
    const fitted: FlowViewportPosition = {
      x: 697.4268888250504,
      y: 67.1186440677966,
      zoom: 0.12640045963803503,
    };
    const pressed: FlowViewportPosition = {
      x: 697.4268888250502,
      y: 67.11864406779664,
      zoom: 0.12640045963803506,
    };
    // Not the same numbers, so React Flow, comparing exactly, reports a move...
    expect(pressed.x).not.toBe(fitted.x);
    expect(pressed.y).not.toBe(fitted.y);
    expect(pressed.zoom).not.toBe(fitted.zoom);
    // ...but none of it is the view moving, whichever way it is compared.
    expect(hasViewportMoved(fitted, pressed)).toBe(false);
    expect(hasViewportMoved(pressed, fitted)).toBe(false);
  });

  test("a move of 4 px or less on each axis, a click's slip, is not a move; of 4.01 px on either axis, either way, at any zoom, it is", () => {
    // Exactly the slop, on one axis or on both.
    const atTheSlop: Array<[number, number]> = [
      [4, 0],
      [-4, 0],
      [0, 4],
      [0, -4],
      [4, -4],
      [-4, 4],
    ];
    // The slip of a click: a pixel or three, on one axis or on both.
    const withinTheSlop: Array<[number, number]> = [
      [1, 0],
      [0, -1],
      [0.5, -0.5],
      [-2, 3],
      [3.99, -3.99],
    ];
    const pastTheSlop: Array<[number, number]> = [
      [4.01, 0],
      [-4.01, 0],
      [0, 4.01],
      [0, -4.01],
      // Past it on one axis is enough, however little the other moved.
      [4.01, 1],
      [-0.5, -4.01],
    ];
    const wrong: Array<string> = [];
    for (const zoom of ZOOMS) {
      const from: FlowViewportPosition = { ...VIEW, zoom: zoom };
      for (const [dx, dy] of atTheSlop) {
        const to: FlowViewportPosition = {
          x: from.x + dx,
          y: from.y + dy,
          zoom: zoom,
        };
        // 100 ± 4 and -200 ± 4 are exact: 4 px, not a hair more.
        expect(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))).toBe(
          VIEWPORT_MOVE_TOLERANCE_PX,
        );
      }
      for (const [dx, dy] of [...atTheSlop, ...withinTheSlop]) {
        const to: FlowViewportPosition = {
          x: from.x + dx,
          y: from.y + dy,
          zoom: zoom,
        };
        if (hasViewportMoved(from, to) || hasViewportMoved(to, from)) {
          wrong.push(`counted ${dx}, ${dy} px at ${zoom}x`);
        }
      }
      for (const [dx, dy] of pastTheSlop) {
        const to: FlowViewportPosition = {
          x: from.x + dx,
          y: from.y + dy,
          zoom: zoom,
        };
        if (!hasViewportMoved(from, to) || !hasViewportMoved(to, from)) {
          wrong.push(`missed ${dx}, ${dy} px at ${zoom}x`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  test("a zoom by a factor of 1.0009 is not a move; by 1.0011 it is, zooming in or out, from any zoom", () => {
    const wrong: Array<string> = [];
    for (const zoom of ZOOMS) {
      const from: FlowViewportPosition = { ...VIEW, zoom: zoom };
      const noise: Array<FlowViewportPosition> = [
        { ...VIEW, zoom: zoom * 1.0009 },
        { ...VIEW, zoom: zoom / 1.0009 },
      ];
      const zoomed: Array<FlowViewportPosition> = [
        { ...VIEW, zoom: zoom * 1.0011 },
        { ...VIEW, zoom: zoom / 1.0011 },
      ];
      for (const to of noise) {
        if (hasViewportMoved(from, to) || hasViewportMoved(to, from)) {
          wrong.push(`counted ${zoom}x to ${to.zoom}x`);
        }
      }
      for (const to of zoomed) {
        if (!hasViewportMoved(from, to) || !hasViewportMoved(to, from)) {
          wrong.push(`missed ${zoom}x to ${to.zoom}x`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  test("the zoom is judged as a ratio: the same step is a move far out and noise close in", () => {
    expect(
      hasViewportMoved(
        { ...VIEW, zoom: MIN_ZOOM },
        { ...VIEW, zoom: MIN_ZOOM + 0.00015 },
      ),
    ).toBe(true);
    expect(
      hasViewportMoved(
        { ...VIEW, zoom: MAX_ZOOM },
        { ...VIEW, zoom: MAX_ZOOM + 0.00015 },
      ),
    ).toBe(false);
  });

  test("a view that is not finite, or has no positive zoom, on either side is always a move, even compared with itself", () => {
    const broken: Array<FlowViewportPosition> = [];
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      broken.push({ ...VIEW, x: bad });
      broken.push({ ...VIEW, y: bad });
      broken.push({ ...VIEW, zoom: bad });
    }
    for (const zoom of [0, -0.5, -1]) {
      broken.push({ ...VIEW, zoom: zoom });
    }
    const takenForNoise: Array<string> = [];
    for (const view of broken) {
      if (!hasViewportMoved(VIEW, view)) {
        takenForNoise.push(`to ${describeViewport(view)}`);
      }
      if (!hasViewportMoved(view, VIEW)) {
        takenForNoise.push(`from ${describeViewport(view)}`);
      }
      if (!hasViewportMoved(view, { ...view })) {
        takenForNoise.push(`${describeViewport(view)} to itself`);
      }
    }
    expect(takenForNoise).toEqual([]);
  });

  test("the tolerances are a click's slop of 4 screen pixels and one part in a thousand of the zoom", () => {
    expect(VIEWPORT_MOVE_TOLERANCE_PX).toBe(4);
    expect(VIEWPORT_ZOOM_TOLERANCE).toBe(1e-3);
  });
});

/* A box on one axis, and the pan expected to bring it into view. */
interface RevealCase {
  where: string;
  start: number;
  end: number;
  pan: number;
}

describe("panDeltaToReveal", () => {
  /*
   * A box that fits the canvas is brought wholly onto it, with as much of
   * the padding as the room it leaves allows: all of it while the box fits
   * the canvas inside the padding, then half the room left at each end, down
   * to none for a box exactly as long as the canvas. A longer box, such as a
   * connection across the drawing, only has to show in part: it is left
   * alone while at least the padding's worth of it (the padding capped at a
   * quarter of the canvas) is on the canvas, and otherwise brought in until
   * it fills the canvas up to the padding.
   *
   * One axis of a canvas 800 px across, as getBoundingClientRect reports
   * it, with the map's 24 px of padding: 24 to 776 is the canvas inside the
   * padding, 752 px of it.
   */
  const VIEW_START: number = 0;
  const VIEW_END: number = 800;
  const INNER_START: number = 24;
  const INNER_END: number = 776;
  // The map's tallest canvas, from 0 to 880 px: 832 px inside the padding.
  const TALLEST: number = DESKTOP_CANVAS.height;

  function reveal(
    start: number,
    end: number,
    padding: number = FOCUS_PADDING,
  ): number {
    return panDeltaToReveal(start, end, VIEW_START, VIEW_END, padding);
  }

  function mismatches(
    cases: Array<RevealCase>,
    padding: number = FOCUS_PADDING,
    viewStart: number = VIEW_START,
    viewEnd: number = VIEW_END,
  ): Array<string> {
    const wrong: Array<string> = [];
    for (const revealCase of cases) {
      const pan: number = panDeltaToReveal(
        revealCase.start,
        revealCase.end,
        viewStart,
        viewEnd,
        padding,
      );
      if (pan !== revealCase.pan) {
        wrong.push(
          `${revealCase.where} (${revealCase.start} to ${revealCase.end} on a canvas from ${viewStart} to ${viewEnd}, padded ${padding}): panned ${pan}, not ${revealCase.pan}`,
        );
      }
    }
    return wrong;
  }

  test("a box inside the canvas and clear of the padding needs no pan", () => {
    expect(reveal(272, 528)).toBe(0);
    expect(reveal(100, 101)).toBe(0);
    // A box with no length, such as a straight, level connection, too.
    expect(reveal(400, 400)).toBe(0);
  });

  test("a box flush against the padding, or filling the canvas inside it exactly, needs no pan", () => {
    expect(reveal(INNER_START, INNER_START + NODE_WIDTH)).toBe(0);
    expect(reveal(INNER_END - NODE_WIDTH, INNER_END)).toBe(0);
    expect(reveal(INNER_START, INNER_END)).toBe(0);
    expect(reveal(INNER_START, INNER_START)).toBe(0);
    expect(reveal(INNER_END, INNER_END)).toBe(0);
  });

  test("a box before the canvas (left of it, or above it) is brought in to the padding: a positive pan of exactly that far", () => {
    const cases: Array<RevealCase> = [
      { where: "far before the canvas", start: -5000, end: -4744, pan: 5024 },
      { where: "just before it", start: -256, end: 0, pan: 280 },
      { where: "half on it", start: -128, end: 128, pan: 152 },
      { where: "on it, in the padding", start: 10, end: 266, pan: 14 },
      {
        where: "half a pixel into the padding",
        start: 23.5,
        end: 279.5,
        pan: 0.5,
      },
      { where: "a point before it", start: -50, end: -50, pan: 74 },
    ];
    expect(mismatches(cases)).toEqual([]);
    // Each comes to rest flush with the padding: the least pan that shows it.
    for (const revealCase of cases) {
      expect(revealCase.start + revealCase.pan).toBe(INNER_START);
    }
  });

  test("a box past the canvas (right of it, or below it) is brought in to the padding: a negative pan of exactly that far", () => {
    const cases: Array<RevealCase> = [
      { where: "far past the canvas", start: 5000, end: 5256, pan: -4480 },
      { where: "just past it", start: 800, end: 1056, pan: -280 },
      { where: "half on it", start: 672, end: 928, pan: -152 },
      { where: "on it, in the padding", start: 534, end: 790, pan: -14 },
      {
        where: "half a pixel into the padding",
        start: 520.5,
        end: 776.5,
        pan: -0.5,
      },
      { where: "a point past it", start: 850, end: 850, pan: -74 },
    ];
    expect(mismatches(cases)).toEqual([]);
    for (const revealCase of cases) {
      expect(revealCase.end + revealCase.pan).toBe(INNER_END);
    }
  });

  test("the same on the other axis, and for a canvas anywhere on the page", () => {
    // A canvas 460 px tall, 120 px down the window: 144 to 556 inside the padding.
    expect(panDeltaToReveal(40, 168, 120, 580, FOCUS_PADDING)).toBe(104);
    expect(panDeltaToReveal(500, 628, 120, 580, FOCUS_PADDING)).toBe(-72);
    expect(panDeltaToReveal(200, 328, 120, 580, FOCUS_PADDING)).toBe(0);
    // A canvas 1024 px across, right of a 256 px sidebar: 280 to 1256.
    expect(panDeltaToReveal(200, 456, 256, 1280, FOCUS_PADDING)).toBe(80);
    expect(panDeltaToReveal(1100, 1356, 256, 1280, FOCUS_PADDING)).toBe(-100);
    expect(panDeltaToReveal(-4000, -3744, 256, 1280, FOCUS_PADDING)).toBe(4280);
    expect(panDeltaToReveal(600, 856, 256, 1280, FOCUS_PADDING)).toBe(0);
  });

  test("a box exactly as long as the canvas inside the padding still fits, and is brought wholly inside", () => {
    expect(reveal(0, 752)).toBe(24);
    expect(reveal(48, 800)).toBe(-24);
    expect(reveal(-1000, -248)).toBe(1024);
    expect(reveal(2000, 2752)).toBe(-1976);
  });

  test("a box that fits the canvas but not the canvas inside the padding is brought wholly onto it, the padding shrunk to the room it leaves: flush when exactly as long as the canvas", () => {
    /*
     * On the map's tallest canvas, a box from 833 to 880 px long leaves less
     * room than the padding at each end, and gets half of the room it leaves
     * at each. (Before, such a box counted as longer than the canvas and was
     * left where it was while any of it showed inside the padding: 100 px
     * of the first one here stayed off the canvas.)
     */
    const cases: Array<RevealCase> = [
      // 833 px leaves 47 px of room: 23.5 px at each end.
      {
        where: "833 px, starting 100 px before the canvas",
        start: -100,
        end: 733,
        pan: 123.5,
      },
      {
        where: "833 px, ending 100 px past it",
        start: 147,
        end: 980,
        pan: -123.5,
      },
      {
        where: "833 px, starting 10 px into it",
        start: 10,
        end: 843,
        pan: 13.5,
      },
      {
        where: "833 px, ending 10 px short of its end",
        start: 37,
        end: 870,
        pan: -13.5,
      },
      { where: "833 px, centred on it", start: 23.5, end: 856.5, pan: 0 },
      // 856 px: 12 px at each end.
      { where: "856 px, before it", start: -100, end: 756, pan: 112 },
      { where: "856 px, past it", start: 124, end: 980, pan: -112 },
      // 879 px: half a pixel at each end.
      { where: "879 px, before it", start: -100, end: 779, pan: 100.5 },
      { where: "879 px, past it", start: 101, end: 980, pan: -100.5 },
      // 880 px, the canvas's own length: flush with both of its edges.
      { where: "880 px, before it", start: -100, end: 780, pan: 100 },
      { where: "880 px, past it", start: 100, end: 980, pan: -100 },
      { where: "880 px, a pixel past it", start: 1, end: 881, pan: -1 },
      { where: "880 px, on it exactly", start: 0, end: 880, pan: 0 },
    ];
    expect(mismatches(cases, FOCUS_PADDING, 0, TALLEST)).toEqual([]);
    // Each ends wholly on the canvas, the room it leaves split evenly.
    for (const revealCase of cases) {
      const room: number = TALLEST - (revealCase.end - revealCase.start);
      expect(revealCase.start + revealCase.pan).toBe(room / 2);
      expect(TALLEST - (revealCase.end + revealCase.pan)).toBe(room / 2);
    }
  });

  test("as a box grows to the canvas's length the pan changes smoothly: nothing jumps where the padding starts to shrink, and every length ends wholly on the canvas", () => {
    /*
     * Lengths from 60 px short of the map's tallest canvas to its full
     * length, a 64th of a pixel apart, through 832 px, where the padding
     * starts to shrink. Before, a box 832 px long starting 100 px before the
     * canvas was brought 124 px in, and one a 64th of a pixel longer was not
     * moved at all.
     */
    const STEP: number = 1 / 64;
    const placements: Array<[string, (length: number) => number]> = [
      [
        "starting 100 px before the canvas",
        (): number => {
          return -100;
        },
      ],
      [
        "ending 100 px past it",
        (length: number): number => {
          return TALLEST + 100 - length;
        },
      ],
      [
        "starting 10 px into it",
        (): number => {
          return 10;
        },
      ],
      [
        "ending 10 px short of its end",
        (length: number): number => {
          return TALLEST - 10 - length;
        },
      ],
      [
        "centred on it",
        (length: number): number => {
          return (TALLEST - length) / 2;
        },
      ],
    ];
    const failures: Array<string> = [];
    let largestJump: number = 0;
    let swept: number = 0;
    for (const [where, startFor] of placements) {
      let previousPan: number | null = null;
      for (let step: number = 0; step <= 60 * 64; step++) {
        const length: number = TALLEST - 60 + step * STEP;
        const start: number = startFor(length);
        const pan: number = panDeltaToReveal(
          start,
          start + length,
          0,
          TALLEST,
          FOCUS_PADDING,
        );
        // The room left at each end of the box once panned.
        const roomBefore: number = start + pan;
        const roomAfter: number = TALLEST - (start + length + pan);
        const box: string = `${where}, ${length} px long: panned ${pan}`;
        if (roomBefore < 0 || roomAfter < 0) {
          failures.push(`not wholly on the canvas: ${box}`);
        }
        /*
         * The whole padding at each end while there is room for it, and
         * otherwise the room split evenly: nothing is left at one end that
         * the other end could have used.
         */
        if (
          Math.min(roomBefore, roomAfter) <
          Math.min(FOCUS_PADDING, (TALLEST - length) / 2)
        ) {
          failures.push(
            `${roomBefore} px before it, ${roomAfter} px after: ${box}`,
          );
        }
        if (previousPan !== null) {
          largestJump = Math.max(largestJump, Math.abs(pan - previousPan));
        }
        previousPan = pan;
        swept++;
      }
    }
    expect(swept).toBe(5 * (60 * 64 + 1));
    expect({
      failures: failures.length,
      first: failures.slice(0, 5),
    }).toEqual({ failures: 0, first: [] });
    // A box a step longer never moved the pan by more than that step...
    expect(largestJump).toBeGreaterThan(0);
    expect(largestJump).toBeLessThanOrEqual(STEP);
    // ...where the padding starts to shrink included.
    expect(panDeltaToReveal(-100, 732, 0, TALLEST, FOCUS_PADDING)).toBe(124);
    expect(panDeltaToReveal(-100, 732 + STEP, 0, TALLEST, FOCUS_PADDING)).toBe(
      124 - STEP / 2,
    );
  });

  test("the padding shrinks to the room a box leaves, and for a box longer than the canvas is at most a quarter of it", () => {
    /*
     * A canvas 100 px across and 40 px of padding. A 10 px box leaves 90 px
     * of room, 45 at each end: all 40 px of the padding fit.
     */
    expect(panDeltaToReveal(0, 10, 0, 100, 40)).toBe(40);
    expect(panDeltaToReveal(90, 100, 0, 100, 40)).toBe(-40);
    expect(panDeltaToReveal(40, 50, 0, 100, 40)).toBe(0);
    // A 50 px box leaves 50 px, 25 at each end: it ends centred.
    expect(panDeltaToReveal(0, 50, 0, 100, 40)).toBe(25);
    expect(panDeltaToReveal(-50, 0, 0, 100, 40)).toBe(75);
    expect(panDeltaToReveal(50, 100, 0, 100, 40)).toBe(-25);
    expect(panDeltaToReveal(25, 75, 0, 100, 40)).toBe(0);
    // However much is asked for, a box that fits goes no further than the middle.
    expect(panDeltaToReveal(0, 10, 0, 100, 1e6)).toBe(45);
    expect(panDeltaToReveal(0, 10, 0, 100, Number.MAX_VALUE)).toBe(45);
    expect(panDeltaToReveal(45, 55, 0, 100, 1e6)).toBe(0);
    // A box longer than the canvas: 40 px is capped at a quarter of it, 25 px...
    expect(panDeltaToReveal(-200, 10, 0, 100, 40)).toBe(65);
    expect(panDeltaToReveal(-200, 25, 0, 100, 40)).toBe(0);
    expect(panDeltaToReveal(90, 300, 0, 100, 40)).toBe(-65);
    expect(panDeltaToReveal(75, 300, 0, 100, 40)).toBe(0);
    // ...however much is asked for...
    expect(panDeltaToReveal(-200, 10, 0, 100, 1e6)).toBe(65);
    expect(panDeltaToReveal(-200, 10, 0, 100, Number.MAX_VALUE)).toBe(65);
    // ...and up to a quarter it is as given.
    expect(panDeltaToReveal(-200, 10, 0, 100, 25)).toBe(65);
    expect(panDeltaToReveal(-200, 10, 0, 100, 24)).toBe(66);
    /*
     * The map's own 24 px, on a canvas 60 px across: all of it for a 10 px
     * card, and 15 px for a connection longer than the canvas.
     */
    expect(panDeltaToReveal(-10, 0, 0, 60, FOCUS_PADDING)).toBe(34);
    expect(panDeltaToReveal(60, 70, 0, 60, FOCUS_PADDING)).toBe(-34);
    expect(panDeltaToReveal(-100, 0, 0, 60, FOCUS_PADDING)).toBe(45);
    expect(panDeltaToReveal(60, 160, 0, 60, FOCUS_PADDING)).toBe(-45);
  });

  test("a padding of zero, below zero or not a finite number brings a box flush with the canvas's edge", () => {
    const cases: Array<RevealCase> = [
      { where: "before the canvas", start: -100, end: 156, pan: 100 },
      { where: "past it", start: 700, end: 956, pan: -156 },
      { where: "flush with its start", start: 0, end: 256, pan: 0 },
      { where: "flush with its end", start: 544, end: 800, pan: 0 },
      {
        where: "where the map's padding would move it",
        start: 10,
        end: 266,
        pan: 0,
      },
      { where: "as long as the canvas", start: -30, end: 770, pan: 30 },
    ];
    const wrong: Array<string> = [];
    for (const padding of [
      0,
      -24,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      wrong.push(...mismatches(cases, padding));
    }
    expect(wrong).toEqual([]);
  });

  test("a box longer than the canvas, such as a connection across the drawing, is left alone while at least the padding's worth of it is on the canvas", () => {
    const cases: Array<RevealCase> = [
      { where: "across the whole canvas", start: -1000, end: 1000, pan: 0 },
      { where: "ending on the canvas", start: -1900, end: 100, pan: 0 },
      { where: "starting on the canvas", start: 700, end: 2700, pan: 0 },
      {
        where:
          "a pixel more than the padding's worth on the canvas, at its end",
        start: -1975,
        end: 25,
        pan: 0,
      },
      {
        where:
          "a pixel more than the padding's worth on the canvas, at its start",
        start: 775,
        end: 2775,
        pan: 0,
      },
      {
        where: "exactly the padding's worth on the canvas, at its end",
        start: -1976,
        end: 24,
        pan: 0,
      },
      {
        where: "exactly the padding's worth on the canvas, at its start",
        start: 776,
        end: 2776,
        pan: 0,
      },
      /*
       * A pixel longer than the canvas, it only has to show in part, though
       * 20 px of the canvas are bare at one end and 21 px of it run past the
       * other.
       */
      {
        where: "a pixel longer than the canvas",
        start: 20,
        end: 821,
        pan: 0,
      },
    ];
    expect(mismatches(cases)).toEqual([]);
    /*
     * A pixel shorter, the same box fits the canvas, and is brought wholly
     * onto it: flush, as it leaves no room for any padding.
     */
    expect(reveal(20, 820)).toBe(-20);
    // On a canvas 60 px across the padding's worth is a quarter of it, 15 px.
    expect(panDeltaToReveal(-85, 15, 0, 60, FOCUS_PADDING)).toBe(0);
    expect(panDeltaToReveal(45, 145, 0, 60, FOCUS_PADDING)).toBe(0);
  });

  test("a box longer than the canvas with less than the padding's worth of it on the canvas is brought in from its side until it fills the canvas up to the padding", () => {
    const before: Array<RevealCase> = [
      {
        where: "far before the canvas",
        start: -3000,
        end: -1000,
        pan: 1776,
      },
      {
        where: "ending where the canvas starts",
        start: -2000,
        end: 0,
        pan: 776,
      },
      {
        where: "ending on the canvas, in the padding",
        start: -1990,
        end: 10,
        pan: 766,
      },
      {
        where: "half a pixel short of the padding's worth on the canvas",
        start: -1976.5,
        end: 23.5,
        pan: 752.5,
      },
    ];
    const after: Array<RevealCase> = [
      { where: "far past the canvas", start: 1000, end: 3000, pan: -976 },
      {
        where: "starting where the canvas ends",
        start: 800,
        end: 2800,
        pan: -776,
      },
      {
        where: "starting on the canvas, in the padding",
        start: 790,
        end: 2790,
        pan: -766,
      },
      {
        where: "half a pixel short of the padding's worth on the canvas",
        start: 776.5,
        end: 2776.5,
        pan: -752.5,
      },
    ];
    expect(mismatches([...before, ...after])).toEqual([]);
    /*
     * Its end comes to the padding at the canvas's far end, or its start to
     * the padding at the near end, and it runs on past the canvas's other
     * edge: all of the canvas but that padding shows it.
     */
    for (const revealCase of before) {
      expect(revealCase.end + revealCase.pan).toBe(INNER_END);
      expect(revealCase.start + revealCase.pan).toBeLessThan(VIEW_START);
    }
    for (const revealCase of after) {
      expect(revealCase.start + revealCase.pan).toBe(INNER_START);
      expect(revealCase.end + revealCase.pan).toBeGreaterThan(VIEW_END);
    }
    /*
     * On a canvas 60 px across, a pixel short of the 15 px it needs, a box
     * is brought in until it reaches 15 px from the canvas's far edge.
     */
    expect(panDeltaToReveal(-86, 14, 0, 60, FOCUS_PADDING)).toBe(31);
    expect(panDeltaToReveal(46, 146, 0, 60, FOCUS_PADDING)).toBe(-31);
  });

  test("with nothing sensible to reveal it pans nowhere", () => {
    // A box the canvas would otherwise bring 524 px in...
    expect(panDeltaToReveal(-500, -244, 0, 800, FOCUS_PADDING)).toBe(524);
    // ...but not with any of this wrong.
    const broken: Array<[string, number, number, number, number]> = [
      ["a box that ends before it starts", -244, -500, 0, 800],
      ["an empty canvas", -500, -244, 400, 400],
      ["a canvas that ends before it starts", -500, -244, 800, 0],
    ];
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      broken.push([`a box starting at ${bad}`, bad, -244, 0, 800]);
      broken.push([`a box ending at ${bad}`, -500, bad, 0, 800]);
      broken.push([`a canvas starting at ${bad}`, -500, -244, bad, 800]);
      broken.push([`a canvas ending at ${bad}`, -500, -244, 0, bad]);
    }
    const wrong: Array<string> = [];
    for (const [what, start, end, viewStart, viewEnd] of broken) {
      const pan: number = panDeltaToReveal(
        start,
        end,
        viewStart,
        viewEnd,
        FOCUS_PADDING,
      );
      if (pan !== 0) {
        wrong.push(`${what}: panned ${pan}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("whatever the box and wherever the canvas, one pan shows the box, goes no further than it must, and leaves nothing for a second pan", () => {
    const random: NextRandomFunction = makeRandom(24);
    const failures: Array<string> = [];
    const seen: Record<string, number> = {
      "fits, inside": 0,
      "fits, before": 0,
      "fits, after": 0,
      "fits, flush with the padding": 0,
      "fits, padding shrunk to the room left": 0,
      "fits, as long as the canvas": 0,
      "longer, the padding's worth on the canvas": 0,
      "longer, exactly the padding's worth on the canvas": 0,
      "longer, before": 0,
      "longer, after": 0,
      "longer, padding capped at a quarter": 0,
      "no padding": 0,
    };
    for (let index: number = 0; index < 20000; index++) {
      const viewStart: number = onGrid(random, -2000, 2000);
      const viewLength: number = onGrid(random, 1, 2000);
      const viewEnd: number = viewStart + viewLength;
      // Now and then no padding at all.
      const padding: number = index % 8 === 7 ? 0 : onGrid(random, 0, 300);
      /*
       * Every tenth box exactly as long as the canvas, and every tenth as
       * long as the canvas inside the padding, where the padding starts to
       * shrink. Of the rest, half no longer than the canvas and half up to
       * three times as long.
       */
      let length: number;
      if (index % 10 === 0) {
        length = viewLength;
      } else if (index % 10 === 1) {
        length = Math.max(0, viewLength - 2 * padding);
      } else {
        length = onGrid(
          random,
          0,
          random() < 0.5 ? viewLength : 3 * viewLength,
        );
      }
      /*
       * Mostly anywhere from wholly before the canvas to wholly past it. Now
       * and then with one end exactly on an edge the rule turns on: the
       * canvas's own, the padding's, or a quarter of the way in (where a
       * long box's padding is capped); or centred, where a box that fits
       * rests once the padding has shrunk.
       */
      const edges: Array<number> = [
        viewStart,
        viewEnd,
        viewStart + padding,
        viewEnd - padding,
        viewStart + viewLength / 4,
        viewEnd - viewLength / 4,
      ];
      const placement: number = random();
      let start: number;
      if (placement < 0.15) {
        start = edges[Math.floor(random() * edges.length)]!;
      } else if (placement < 0.3) {
        start = edges[Math.floor(random() * edges.length)]! - length;
      } else if (placement < 0.35) {
        start = viewStart + (viewLength - length) / 2;
      } else {
        start = onGrid(
          random,
          viewStart - length - viewLength,
          viewEnd + viewLength,
        );
      }
      const end: number = start + length;
      const pan: number = panDeltaToReveal(
        start,
        end,
        viewStart,
        viewEnd,
        padding,
      );

      if (padding === 0) {
        seen["no padding"]!++;
      }
      // Where the box is once panned.
      const shownStart: number = start + pan;
      const shownEnd: number = end + pan;
      const box: string = `${start} to ${end} on a canvas from ${viewStart} to ${viewEnd}, padded ${padding}: panned ${pan}`;

      let where: string;
      let shown: boolean;
      if (length <= viewLength) {
        // The padding, shrunk to half the room the box leaves on the canvas.
        const pad: number = Math.min(padding, (viewLength - length) / 2);
        if (pad < padding) {
          seen["fits, padding shrunk to the room left"]!++;
        }
        if (length === viewLength) {
          seen["fits, as long as the canvas"]!++;
        }
        const inside: boolean =
          start >= viewStart + pad && end <= viewEnd - pad;
        if (inside && (start === viewStart + pad || end === viewEnd - pad)) {
          seen["fits, flush with the padding"]!++;
        }
        if (inside) {
          where = "fits, inside";
        } else if (start < viewStart + pad) {
          where = "fits, before";
        } else {
          where = "fits, after";
        }
        shown =
          // Left alone exactly when it was inside already...
          (pan === 0) === inside &&
          // ...and otherwise wholly on the canvas once panned, the padding clear...
          shownStart >= viewStart + pad &&
          shownEnd <= viewEnd - pad &&
          // ...centred where the padding had to shrink...
          (pad === padding || shownStart - viewStart === viewEnd - shownEnd) &&
          // ...and no further in than the padding on the side it came in by.
          (pan <= 0 || shownStart === viewStart + pad) &&
          (pan >= 0 || shownEnd === viewEnd - pad);
      } else {
        // The padding, capped at a quarter of the canvas.
        const pad: number = Math.min(padding, viewLength / 4);
        if (pad < padding) {
          seen["longer, padding capped at a quarter"]!++;
        }
        // How much of the box is on the canvas (below zero, how far off it).
        const onCanvas: number =
          Math.min(end, viewEnd) - Math.max(start, viewStart);
        const shownOnCanvas: number =
          Math.min(shownEnd, viewEnd) - Math.max(shownStart, viewStart);
        const enough: boolean = onCanvas >= pad;
        if (onCanvas === pad) {
          seen["longer, exactly the padding's worth on the canvas"]!++;
        }
        if (enough) {
          where = "longer, the padding's worth on the canvas";
        } else if (start < viewStart) {
          where = "longer, before";
        } else {
          where = "longer, after";
        }
        shown =
          // Left alone exactly when at least the padding's worth showed already...
          (pan === 0) === enough &&
          // ...and otherwise at least that much of it shows once panned...
          shownOnCanvas >= pad &&
          /*
           * ...brought in from its side until it covers the canvas up to the
           * padding at the far end, and no further.
           */
          (pan <= 0 ||
            (shownEnd === viewEnd - pad && shownStart < viewStart)) &&
          (pan >= 0 || (shownStart === viewStart + pad && shownEnd > viewEnd));
      }
      seen[where]!++;
      if (!shown) {
        failures.push(`${where}: ${box}`);
      }

      // A second pan finds nothing left to do.
      const again: number = panDeltaToReveal(
        shownStart,
        shownEnd,
        viewStart,
        viewEnd,
        padding,
      );
      if (again !== 0) {
        failures.push(`panned again by ${again}: ${box}`);
      }
      // Mirrored, it is the same pan the other way.
      const mirrored: number = panDeltaToReveal(
        -end,
        -start,
        -viewEnd,
        -viewStart,
        padding,
      );
      if (mirrored !== -pan) {
        failures.push(`mirrored, panned ${mirrored}: ${box}`);
      }
      // Only where the box is on the canvas matters, not where the canvas is.
      const shift: number = onGrid(random, -5000, 5000);
      const shifted: number = panDeltaToReveal(
        start + shift,
        end + shift,
        viewStart + shift,
        viewEnd + shift,
        padding,
      );
      if (shifted !== pan) {
        failures.push(
          `moved ${shift} with its canvas, panned ${shifted}: ${box}`,
        );
      }
    }
    expect({
      failures: failures.length,
      first: failures.slice(0, 5),
    }).toEqual({ failures: 0, first: [] });
    // Every kind of box came up, many times over.
    const rare: Array<string> = [];
    for (const [where, count] of Object.entries(seen)) {
      if (count < 100) {
        rare.push(`${where}: ${count}`);
      }
    }
    expect(rare).toEqual([]);
  });
});

describe("noticeOffsetInCanvas", () => {
  /*
   * A window 900 px tall, the map's tallest canvas (880 px) and a notice
   * 60 px tall, kept the map's 16 px inside the canvas.
   */
  const WINDOW: number = 900;
  const CANVAS: number = 880;
  const NOTICE: number = 60;

  /* The notice's offset in the 880 px canvas, with the canvas's top at `canvasTop` in the window. */
  function offsetAt(canvasTop: number, noticeHeight: number = NOTICE): number {
    return noticeOffsetInCanvas(
      canvasTop,
      CANVAS,
      WINDOW,
      noticeHeight,
      NOTICE_INSET,
    );
  }

  test("a canvas wholly on screen has the notice in its middle", () => {
    // 100 to 700 on screen: the notice's middle at 400, 300 px into the canvas.
    expect(noticeOffsetInCanvas(100, 600, WINDOW, NOTICE, NOTICE_INSET)).toBe(
      270,
    );
    expect(offsetAt(0)).toBe(410);
    expect(offsetAt(20)).toBe(410);
    // A canvas exactly as tall as the window.
    expect(noticeOffsetInCanvas(0, WINDOW, WINDOW, NOTICE, NOTICE_INSET)).toBe(
      420,
    );
  });

  test("a canvas running past the window's bottom has the notice in the middle of the part on screen", () => {
    // 500 to 900 on screen: the notice's middle at 700, 200 px into the canvas.
    expect(offsetAt(500)).toBe(170);
    expect(offsetAt(300)).toBe(270);
  });

  test("a canvas whose top the page has scrolled past has the notice in the middle of the part still on screen", () => {
    // 0 to 280 on screen: the notice's middle at 140, 740 px into the canvas.
    expect(offsetAt(-600)).toBe(710);
    expect(offsetAt(-300)).toBe(560);
  });

  test("a canvas taller than the window, over all of it, has the notice in the middle of the window", () => {
    expect(noticeOffsetInCanvas(-200, 1500, 800, NOTICE, NOTICE_INSET)).toBe(
      570,
    );
    expect(noticeOffsetInCanvas(-1000, 3000, 800, NOTICE, NOTICE_INSET)).toBe(
      1370,
    );
    // Either way the notice's middle is the window's: 400 px down it.
    expect(-200 + 570 + NOTICE / 2).toBe(400);
    expect(-1000 + 1370 + NOTICE / 2).toBe(400);
  });

  test("a canvas wholly above or below the window, or just touching its edge, has the notice the inset below its top", () => {
    const wrong: Array<string> = [];
    for (const canvasTop of [-5000, -1000, -CANVAS, WINDOW, 1000, 5000]) {
      const offset: number = offsetAt(canvasTop);
      if (offset !== NOTICE_INSET) {
        wrong.push(`canvas at ${canvasTop}: ${offset}`);
      }
    }
    expect(wrong).toEqual([]);
    // Whatever the inset.
    expect(noticeOffsetInCanvas(-1000, CANVAS, WINDOW, NOTICE, 24)).toBe(24);
  });

  test("near the canvas's top the notice stops the inset below it, however little of the canvas is on screen", () => {
    // 800 to 900 on screen: the notice's middle at 850, 50 px into the canvas.
    expect(offsetAt(800)).toBe(20);
    // From 808 down, it would rise past the inset, and stops there.
    expect(offsetAt(808)).toBe(NOTICE_INSET);
    expect(offsetAt(850)).toBe(NOTICE_INSET);
    expect(offsetAt(870)).toBe(NOTICE_INSET);
    // A taller notice stops sooner: from 568 down.
    expect(offsetAt(550, 300)).toBe(25);
    expect(offsetAt(568, 300)).toBe(NOTICE_INSET);
    expect(offsetAt(700, 300)).toBe(NOTICE_INSET);
  });

  test("near the canvas's bottom the notice stops the inset above it", () => {
    // 0 to 100 on screen: the notice's middle at 50, 830 px into the canvas.
    expect(offsetAt(-780)).toBe(800);
    // From -788 up, it would sink past the inset (at 804), and stops there.
    expect(offsetAt(-788)).toBe(804);
    expect(offsetAt(-850)).toBe(804);
    expect(offsetAt(-870)).toBe(804);
    expect(804 + NOTICE).toBe(CANVAS - NOTICE_INSET);
    // A taller notice stops sooner: at 564, from -548 up.
    expect(offsetAt(-400, 300)).toBe(490);
    expect(offsetAt(-548, 300)).toBe(564);
    expect(offsetAt(-780, 300)).toBe(564);
    expect(564 + 300).toBe(CANVAS - NOTICE_INSET);
  });

  test("a notice with no room to move in the canvas stays the inset below its top", () => {
    const wrong: Array<string> = [];
    for (const canvasTop of [-60, 0, 400, 850]) {
      // Taller than the canvas.
      const tooTall: number = noticeOffsetInCanvas(
        canvasTop,
        100,
        WINDOW,
        200,
        NOTICE_INSET,
      );
      // Exactly as tall as the canvas less an inset at each end.
      const exactFit: number = noticeOffsetInCanvas(
        canvasTop,
        100,
        WINDOW,
        100 - 2 * NOTICE_INSET,
        NOTICE_INSET,
      );
      if (tooTall !== NOTICE_INSET || exactFit !== NOTICE_INSET) {
        wrong.push(`canvas at ${canvasTop}: ${tooTall}, ${exactFit}`);
      }
    }
    expect(wrong).toEqual([]);
    // A pixel shorter, it has a pixel to move in.
    expect(noticeOffsetInCanvas(0, 100, WINDOW, 67, NOTICE_INSET)).toBe(16.5);
    expect(noticeOffsetInCanvas(-60, 100, WINDOW, 67, NOTICE_INSET)).toBe(17);
  });

  test("without an inset, or with one below zero or not a finite number, the notice may reach the canvas's ends", () => {
    const wrong: Array<string> = [];
    for (const inset of [
      0,
      -16,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      const offsets: Array<number> = [
        noticeOffsetInCanvas(870, CANVAS, WINDOW, NOTICE, inset),
        noticeOffsetInCanvas(-870, CANVAS, WINDOW, NOTICE, inset),
        noticeOffsetInCanvas(-1000, CANVAS, WINDOW, NOTICE, inset),
        noticeOffsetInCanvas(100, 600, WINDOW, NOTICE, inset),
      ];
      const expected: Array<number> = [0, CANVAS - NOTICE, 0, 270];
      if (offsets.join() !== expected.join()) {
        wrong.push(`inset ${inset}: ${offsets.join(", ")}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("a notice not measured yet, or measured as nothing, is placed as a point", () => {
    const wrong: Array<string> = [];
    for (const noticeHeight of [0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
      const offsets: Array<number> = [
        // The middle of the canvas, of the part on screen, or the inset.
        noticeOffsetInCanvas(100, 600, WINDOW, noticeHeight, NOTICE_INSET),
        offsetAt(-600, noticeHeight),
        offsetAt(-1000, noticeHeight),
      ];
      const expected: Array<number> = [300, 740, NOTICE_INSET];
      if (offsets.join() !== expected.join()) {
        wrong.push(`notice ${noticeHeight} px tall: ${offsets.join(", ")}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("a canvas or window that cannot be measured puts the notice the inset below the canvas's top", () => {
    // A canvas that would otherwise have the notice 270 px down it...
    expect(noticeOffsetInCanvas(100, 600, WINDOW, NOTICE, NOTICE_INSET)).toBe(
      270,
    );
    // ...but not with any of this wrong.
    const broken: Array<[string, number, number, number]> = [
      ["a canvas with no height", 100, 0, WINDOW],
      ["a canvas of negative height", 100, -600, WINDOW],
      ["a window with no height", 100, 600, 0],
      ["a window of negative height", 100, 600, -WINDOW],
    ];
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      broken.push([`a canvas at ${bad}`, bad, 600, WINDOW]);
      broken.push([`a canvas ${bad} px tall`, 100, bad, WINDOW]);
      broken.push([`a window ${bad} px tall`, 100, 600, bad]);
    }
    const wrong: Array<string> = [];
    for (const [what, canvasTop, canvasHeight, windowHeight] of broken) {
      const offset: number = noticeOffsetInCanvas(
        canvasTop,
        canvasHeight,
        windowHeight,
        NOTICE,
        NOTICE_INSET,
      );
      if (offset !== NOTICE_INSET) {
        wrong.push(`${what}: ${offset}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("a sliver of the canvas no taller than the inset shows none of the notice: it keeps inside the canvas first", () => {
    // 10 px of the canvas's top at the window's bottom: the notice is below the window...
    expect(890 + offsetAt(890)).toBeGreaterThanOrEqual(WINDOW);
    // ...and 10 px of its bottom at the window's top: above it.
    expect(-870 + offsetAt(-870) + NOTICE).toBeLessThanOrEqual(0);
    // Exactly the inset, and the notice's edge meets the window's.
    expect(884 + offsetAt(884)).toBe(WINDOW);
    expect(-864 + offsetAt(-864) + NOTICE).toBe(0);
    // Past the inset, some of it shows: here 4 px.
    expect(880 + offsetAt(880)).toBe(WINDOW - 4);
    expect(-860 + offsetAt(-860) + NOTICE).toBe(4);
  });

  test("wherever the page puts the canvas, a notice that fits stays inside it, shows once more of the canvas than the inset does, and is centred on the part on screen as far as the insets let it be", () => {
    const random: NextRandomFunction = makeRandom(880);
    const failures: Array<string> = [];
    const seen: Record<string, number> = {
      "canvas off screen": 0,
      "a sliver no taller than the inset on screen": 0,
      "room on screen for all of the notice": 0,
      "centred on the part on screen": 0,
      "stopped the inset below the canvas's top": 0,
      "stopped the inset above the canvas's bottom": 0,
    };
    for (let index: number = 0; index < 20000; index++) {
      const windowHeight: number = onGrid(random, 320, 1400);
      const canvasHeight: number = onGrid(random, 120, 2400);
      // The map's inset, and now and then another (none included).
      const inset: number =
        index % 4 === 0 ? onGrid(random, 0, 40) : NOTICE_INSET;
      // A notice that fits in the canvas with an inset at each end.
      const noticeHeight: number = onGrid(random, 1, canvasHeight - 2 * inset);
      const canvasTop: number = onGrid(
        random,
        -canvasHeight - 200,
        windowHeight + 200,
      );
      const offset: number = noticeOffsetInCanvas(
        canvasTop,
        canvasHeight,
        windowHeight,
        noticeHeight,
        inset,
      );

      // The notice and the part of the canvas on screen, down the window.
      const top: number = canvasTop + offset;
      const bottom: number = top + noticeHeight;
      const shownTop: number = Math.max(canvasTop, 0);
      const shownBottom: number = Math.min(
        canvasTop + canvasHeight,
        windowHeight,
      );
      const shown: number = shownBottom - shownTop;
      // The notice's offset when it rests the inset above the canvas's bottom.
      const lowest: number = canvasHeight - noticeHeight - inset;
      const notice: string = `a ${noticeHeight} px notice, a ${canvasHeight} px canvas at ${canvasTop} in a ${windowHeight} px window, inset ${inset}: offset ${offset}`;

      // Always inside the canvas, the inset clear of both its ends.
      if (offset < inset || offset > lowest) {
        failures.push(`outside the canvas: ${notice}`);
      }
      if (shown <= 0) {
        seen["canvas off screen"]!++;
        if (offset !== inset) {
          failures.push(`off screen, but not at the inset: ${notice}`);
        }
        continue;
      }
      if (shown <= inset) {
        seen["a sliver no taller than the inset on screen"]!++;
      } else if (!(top < shownBottom && bottom > shownTop)) {
        // More of the canvas on screen than the inset: some of the notice is.
        failures.push(`none of it on screen: ${notice}`);
      }
      // Room on screen for the notice and an inset each side: all of it is.
      if (shown >= noticeHeight + 2 * inset) {
        seen["room on screen for all of the notice"]!++;
        if (top < shownTop || bottom > shownBottom) {
          failures.push(`cut by the window: ${notice}`);
        }
      }
      // Centred on the part on screen, unless an inset stopped it on the way.
      const middle: number = (shownTop + shownBottom) / 2;
      const centre: number = top + noticeHeight / 2;
      if (offset > inset && offset < lowest) {
        seen["centred on the part on screen"]!++;
        if (centre !== middle) {
          failures.push(`off the middle (${middle}): ${notice}`);
        }
      } else if (offset === inset && offset < lowest) {
        seen["stopped the inset below the canvas's top"]!++;
        // It was on its way up.
        if (middle > centre) {
          failures.push(`stopped short going down: ${notice}`);
        }
      } else if (offset === lowest && offset > inset) {
        seen["stopped the inset above the canvas's bottom"]!++;
        // It was on its way down.
        if (middle < centre) {
          failures.push(`stopped short going up: ${notice}`);
        }
      }
    }
    expect({
      failures: failures.length,
      first: failures.slice(0, 5),
    }).toEqual({ failures: 0, first: [] });
    // Every case came up, many times over.
    const rare: Array<string> = [];
    for (const [where, count] of Object.entries(seen)) {
      if (count < 100) {
        rare.push(`${where}: ${count}`);
      }
    }
    expect(rare).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The pan extent, proved against d3-zoom.
 * ---------------------------------------------------------------------------
 */

/* A drawing's bounding box, computed here on its own rather than by drawingExtent. */
interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(rects: Array<FlowRect>): Bounds {
  const bounds: Bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const rect of rects) {
    bounds.minX = Math.min(bounds.minX, rect.x);
    bounds.minY = Math.min(bounds.minY, rect.y);
    bounds.maxX = Math.max(bounds.maxX, rect.x + rect.width);
    bounds.maxY = Math.max(bounds.maxY, rect.y + rect.height);
  }
  return bounds;
}

interface Drawing {
  name: string;
  rects: Array<FlowRect>;
  bounds: Bounds;
}

function serviceCall(from: string, to: string): ServiceMapEdge {
  return {
    id: `${from}->${to}`,
    from: from,
    to: to,
    relationship: {
      fromEntityKey: from,
      toEntityKey: to,
      relationshipType: EntityRelationshipType.DependsOn,
    },
    calls: 600,
    errors: 0,
    avgDurationMs: 12,
    health: "healthy",
  };
}

/* The cards the Service Map draws for these calls, laid out by the map's own layout. */
function drawServiceMap(name: string, calls: Array<[string, string]>): Drawing {
  const visibleKeys: Set<string> = new Set<string>();
  for (const [from, to] of calls) {
    visibleKeys.add(from);
    visibleKeys.add(to);
  }
  const layout: ServiceMapLayout = layoutServiceMap({
    visibleKeys: visibleKeys,
    edges: calls.map(([from, to]: [string, string]): ServiceMapEdge => {
      return serviceCall(from, to);
    }),
    columnGap: COLUMN_GAP,
    rowGap: ROW_GAP,
  });
  const rects: Array<FlowRect> = [];
  for (const position of layout.positions.values()) {
    rects.push(cardAt(position.x, position.y));
  }
  return { name: name, rects: rects, bounds: boundsOf(rects) };
}

function numbered(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(2, "0")}`;
}

/*
 * Shaped like the project in the report (73 cards, 77 connections): forty
 * services calling fifteen, the fifteen calling one shared hub, the hub
 * calling nineteen dependencies, and three calls from a callee straight to a
 * dependency. 75 cards in four columns, forty cards tall.
 */
function customerCalls(): Array<[string, string]> {
  const calls: Array<[string, string]> = [];
  for (let index: number = 0; index < 40; index++) {
    calls.push([numbered("caller", index), numbered("callee", index % 15)]);
  }
  for (let index: number = 0; index < 15; index++) {
    calls.push([numbered("callee", index), "hub"]);
  }
  for (let index: number = 0; index < 19; index++) {
    calls.push(["hub", numbered("dependency", index)]);
  }
  for (let index: number = 0; index < 3; index++) {
    calls.push([numbered("callee", index), numbered("dependency", index)]);
  }
  return calls;
}

/* The other way round: ten services in a row, wide and one card high. */
function chainCalls(): Array<[string, string]> {
  const calls: Array<[string, string]> = [];
  for (let index: number = 0; index < 9; index++) {
    calls.push([numbered("service", index), numbered("service", index + 1)]);
  }
  return calls;
}

const CUSTOMER_MAP: Drawing = drawServiceMap(
  "a project shaped like the report's",
  customerCalls(),
);
const DRAWINGS: Array<Drawing> = [
  CUSTOMER_MAP,
  drawServiceMap("a chain of ten services", chainCalls()),
  drawServiceMap("two services", [["web", "api"]]),
];

/*
 * d3-zoom's defaultConstrain (d3-zoom 3.0.0, src/zoom.js), line for line.
 * React Flow 11 hands its translateExtent to d3-zoom, which runs this on the
 * result of every drag, wheel and pinch step and of the Controls' zoom
 * buttons, over the pane's own box, [[0, 0], [width, height]]. d3's
 * transform {k, x, y} is React Flow's [x, y, zoom], and
 * transform.translate(dx, dy) moves it by k * dx, k * dy.
 */
function constrain(
  transform: FlowTransform,
  pane: FlowPaneSize,
  translateExtent: FlowExtent,
): FlowTransform {
  const [x, y, k] = transform;
  const invertX: (screenX: number) => number = (screenX: number): number => {
    return (screenX - x) / k;
  };
  const invertY: (screenY: number) => number = (screenY: number): number => {
    return (screenY - y) / k;
  };
  const dx0: number = invertX(0) - translateExtent[0][0];
  const dx1: number = invertX(pane.width) - translateExtent[1][0];
  const dy0: number = invertY(0) - translateExtent[0][1];
  const dy1: number = invertY(pane.height) - translateExtent[1][1];
  const moveX: number =
    dx1 > dx0 ? (dx0 + dx1) / 2 : Math.min(0, dx0) || Math.max(0, dx1);
  const moveY: number =
    dy1 > dy0 ? (dy0 + dy1) / 2 : Math.min(0, dy0) || Math.max(0, dy1);
  return [x + k * moveX, y + k * moveY, k];
}

/*
 * d3-zoom's drag step (d3-zoom 3.0.0, src/zoom.js), before its constrain.
 * At the press, mousedowned records the pointer and the flow point under it,
 * transform.invert(pointer); every pointer move then runs
 * translate(transform, pointer, that flow point), which puts the point back
 * under the pointer, and constrains the result. A drag does not change the
 * zoom, so where it ends depends only on where it was pressed and where the
 * pointer is now.
 */
function dragged(
  transform: FlowTransform,
  pressedAt: [number, number],
  pointerAt: [number, number],
): FlowTransform {
  const [x, y, k] = transform;
  const flowX: number = (pressedAt[0] - x) / k;
  const flowY: number = (pressedAt[1] - y) / k;
  return [pointerAt[0] - flowX * k, pointerAt[1] - flowY * k, k];
}

/* React Flow's Viewport for a transform, as onMoveStart and onMoveEnd report it. */
function asViewport(transform: FlowTransform): FlowViewportPosition {
  return { x: transform[0], y: transform[1], zoom: transform[2] };
}

/*
 * The view fitView frames a drawing with: getViewportForBounds from
 * @reactflow/core 11.11.3, with the map's fit options and minimum zoom.
 */
function fittedView(bounds: Bounds, pane: FlowPaneSize): FlowTransform {
  const width: number = bounds.maxX - bounds.minX;
  const height: number = bounds.maxY - bounds.minY;
  const xZoom: number = pane.width / (width * (1 + FIT_PADDING));
  const yZoom: number = pane.height / (height * (1 + FIT_PADDING));
  const zoom: number = Math.min(
    Math.max(Math.min(xZoom, yZoom), MIN_ZOOM),
    FIT_MAX_ZOOM,
  );
  return [
    pane.width / 2 - (bounds.minX + width / 2) * zoom,
    pane.height / 2 - (bounds.minY + height / 2) * zoom,
    zoom,
  ];
}

/* How far the canvas and the drawing's bounding box overlap on each axis, in flow units. */
interface Overlap {
  x: number;
  y: number;
}

function overlapWithDrawing(
  bounds: Bounds,
  transform: FlowTransform,
  pane: FlowPaneSize,
): Overlap {
  const [x, y, zoom] = transform;
  const left: number = -x / zoom;
  const top: number = -y / zoom;
  return {
    x:
      Math.min(left + pane.width / zoom, bounds.maxX) -
      Math.max(left, bounds.minX),
    y:
      Math.min(top + pane.height / zoom, bounds.maxY) -
      Math.max(top, bounds.minY),
  };
}

/*
 * A view at `zoom` whose canvas centre sits `offsetX`, `offsetY` from the
 * drawing's centre, in units of the offset at which the drawing leaves the
 * canvas on that axis: within ±1 some of the drawing's box is on the canvas,
 * from ±1 on none of it is.
 */
function viewNear(
  bounds: Bounds,
  pane: FlowPaneSize,
  zoom: number,
  offsetX: number,
  offsetY: number,
): FlowTransform {
  const reachX: number = (pane.width / zoom + (bounds.maxX - bounds.minX)) / 2;
  const reachY: number = (pane.height / zoom + (bounds.maxY - bounds.minY)) / 2;
  const centreX: number = (bounds.minX + bounds.maxX) / 2 + offsetX * reachX;
  const centreY: number = (bounds.minY + bounds.maxY) / 2 + offsetY * reachY;
  return [
    pane.width / 2 - centreX * zoom,
    pane.height / 2 - centreY * zoom,
    zoom,
  ];
}

interface ViewSample {
  pane: FlowPaneSize;
  transform: FlowTransform;
}

type ZoomRangeFunction = (
  drawing: Drawing,
  pane: FlowPaneSize,
) => [number, number];

const EVERY_ZOOM: ZoomRangeFunction = (): [number, number] => {
  return [MIN_ZOOM, MAX_ZOOM];
};

/* Zoomed out at least as far as fitView would frame the drawing. */
const UP_TO_THE_FIT: ZoomRangeFunction = (
  drawing: Drawing,
  pane: FlowPaneSize,
): [number, number] => {
  return [MIN_ZOOM, fittedView(drawing.bounds, pane)[2]];
};

/*
 * Views all around a drawing, out to twice the offset at which it leaves the
 * canvas, on canvases from a phone to a desktop: a grid through the extremes
 * of every canvas above, then `count` pseudo-random ones. Where a gesture
 * leaves a view does not matter to d3-zoom, only the view does, so these
 * stand for every drag, wheel and pinch there is.
 */
function sampleViews(
  drawing: Drawing,
  zoomRange: ZoomRangeFunction,
  seed: number,
  count: number,
): Array<ViewSample> {
  const samples: Array<ViewSample> = [];
  const offsets: Array<number> = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];
  for (const pane of CANVASES) {
    const [low, high] = zoomRange(drawing, pane);
    for (const zoom of [low, (low + high) / 2, high]) {
      for (const offsetX of offsets) {
        for (const offsetY of offsets) {
          samples.push({
            pane: pane,
            transform: viewNear(drawing.bounds, pane, zoom, offsetX, offsetY),
          });
        }
      }
    }
  }
  const random: NextRandomFunction = makeRandom(seed);
  for (let index: number = 0; index < count; index++) {
    const pane: FlowPaneSize = {
      width: Math.round(
        PHONE_CANVAS.width +
          random() * (DESKTOP_CANVAS.width - PHONE_CANVAS.width),
      ),
      height: Math.round(
        PHONE_CANVAS.height +
          random() * (DESKTOP_CANVAS.height - PHONE_CANVAS.height),
      ),
    };
    const [low, high] = zoomRange(drawing, pane);
    const zoom: number = low + random() * (high - low);
    samples.push({
      pane: pane,
      transform: viewNear(
        drawing.bounds,
        pane,
        zoom,
        random() * 4 - 2,
        random() * 4 - 2,
      ),
    });
  }
  return samples;
}

function isOffTheDrawing(overlap: Overlap): boolean {
  return overlap.x <= 0 || overlap.y <= 0;
}

function describeView(pane: FlowPaneSize, view: FlowTransform): string {
  return `${pane.width}x${pane.height} canvas at ${view[2].toFixed(3)}x, translated ${view[0].toFixed(1)}, ${view[1].toFixed(1)}`;
}

describe("a Service Map shaped like the report's (#4117)", () => {
  test("is a tall column of cards that fits as a narrow strip of a wide canvas", () => {
    expect(CUSTOMER_MAP.rects).toHaveLength(75);
    const bounds: Bounds = CUSTOMER_MAP.bounds;
    // Four columns of cards, forty cards tall.
    expect(bounds.maxX - bounds.minX).toBe(3 * COLUMN_GAP + NODE_WIDTH);
    expect(bounds.maxY - bounds.minY).toBe(39 * ROW_GAP + NODE_HEIGHT);
    // Fitted to a desktop canvas it is framed by its height, at a small zoom...
    const [, , zoom] = fittedView(bounds, DESKTOP_CANVAS);
    expect(zoom).toBeLessThan(0.15);
    // ...and covers about a tenth of the canvas's width: most of it is empty.
    expect(
      ((bounds.maxX - bounds.minX) * zoom) / DESKTOP_CANVAS.width,
    ).toBeLessThan(0.15);
  });

  test("without an extent, d3-zoom leaves a view wherever a gesture put it, often with no card in sight", () => {
    const samples: Array<ViewSample> = sampleViews(
      CUSTOMER_MAP,
      EVERY_ZOOM,
      4117,
      4000,
    );
    let moved: number = 0;
    let offTheDrawing: number = 0;
    let offButCounted: number = 0;
    for (const sample of samples) {
      const view: FlowTransform = constrain(
        sample.transform,
        sample.pane,
        UNBOUNDED_FLOW_EXTENT,
      );
      if (
        view[0] !== sample.transform[0] ||
        view[1] !== sample.transform[1] ||
        view[2] !== sample.transform[2]
      ) {
        moved++;
      }
      if (
        isOffTheDrawing(
          overlapWithDrawing(CUSTOMER_MAP.bounds, view, sample.pane),
        )
      ) {
        offTheDrawing++;
        if (anyRectInView(CUSTOMER_MAP.rects, view, sample.pane)) {
          offButCounted++;
        }
      }
    }
    // React Flow's default extent never moves a view back...
    expect(moved).toBe(0);
    // ...so a view put off the drawing stays off it, with no card to see.
    expect(offTheDrawing / samples.length).toBeGreaterThan(0.5);
    expect(offButCounted).toBe(0);
  });

  test("the margin must stay under what the canvas shows: a wider one would let a view rest on empty slack", () => {
    const pane: FlowPaneSize = PHONE_CANVAS;
    // At the closest zoom a phone-sized canvas shows 340 / 1.5 ≈ 227 flow units across.
    expect(PAN_MARGIN).toBeLessThan(
      Math.min(pane.width, pane.height) / MAX_ZOOM,
    );
    // A view dragged far to the left of the drawing, at the closest zoom.
    const dragged: FlowTransform = viewNear(
      CUSTOMER_MAP.bounds,
      pane,
      MAX_ZOOM,
      -2,
      0,
    );
    const tooWide: FlowTransform = constrain(
      dragged,
      pane,
      drawingExtent(CUSTOMER_MAP.rects, 400),
    );
    expect(
      overlapWithDrawing(CUSTOMER_MAP.bounds, tooWide, pane).x,
    ).toBeLessThanOrEqual(0);
    expect(anyRectInView(CUSTOMER_MAP.rects, tooWide, pane)).toBe(false);
    const withTheMapsMargin: FlowTransform = constrain(
      dragged,
      pane,
      drawingExtent(CUSTOMER_MAP.rects, PAN_MARGIN),
    );
    expect(
      overlapWithDrawing(CUSTOMER_MAP.bounds, withTheMapsMargin, pane).x,
    ).toBeGreaterThan(0);
    expect(anyRectInView(CUSTOMER_MAP.rects, withTheMapsMargin, pane)).toBe(
      true,
    );
  });
});

describe("the pan extent keeps every view on the drawing (#4117)", () => {
  for (const drawing of DRAWINGS) {
    test(`${drawing.name}: every view d3-zoom allows overlaps the drawing on both axes`, () => {
      const extent: FlowExtent = drawingExtent(drawing.rects, PAN_MARGIN);
      const samples: Array<ViewSample> = sampleViews(
        drawing,
        EVERY_ZOOM,
        4117,
        4000,
      );
      const failures: Array<string> = [];
      let broughtBack: number = 0;
      for (const sample of samples) {
        const view: FlowTransform = constrain(
          sample.transform,
          sample.pane,
          extent,
        );
        const overlap: Overlap = overlapWithDrawing(
          drawing.bounds,
          view,
          sample.pane,
        );
        /*
         * At worst d3-zoom rests the view against one end of the extent,
         * where all but PAN_MARGIN of what the canvas shows is over the
         * drawing (or all of the drawing is on the canvas).
         */
        const leastX: number = Math.min(
          sample.pane.width / view[2] - PAN_MARGIN,
          drawing.bounds.maxX - drawing.bounds.minX,
        );
        const leastY: number = Math.min(
          sample.pane.height / view[2] - PAN_MARGIN,
          drawing.bounds.maxY - drawing.bounds.minY,
        );
        if (
          !(
            overlap.x > 0 &&
            overlap.y > 0 &&
            overlap.x >= leastX - 1e-6 &&
            overlap.y >= leastY - 1e-6
          )
        ) {
          failures.push(describeView(sample.pane, view));
        }
        if (
          isOffTheDrawing(
            overlapWithDrawing(drawing.bounds, sample.transform, sample.pane),
          )
        ) {
          broughtBack++;
        }
      }
      expect({
        failures: failures.length,
        first: failures.slice(0, 5),
      }).toEqual({ failures: 0, first: [] });
      // Most of these views began wholly off the drawing.
      expect(broughtBack / samples.length).toBeGreaterThan(0.5);
    });

    test(`${drawing.name}: zoomed out as far as the fit, every view d3-zoom allows shows a card`, () => {
      const extent: FlowExtent = drawingExtent(drawing.rects, PAN_MARGIN);
      const samples: Array<ViewSample> = sampleViews(
        drawing,
        UP_TO_THE_FIT,
        1704,
        2000,
      );
      const failures: Array<string> = [];
      let lostWithoutTheExtent: number = 0;
      for (const sample of samples) {
        const view: FlowTransform = constrain(
          sample.transform,
          sample.pane,
          extent,
        );
        if (!anyRectInView(drawing.rects, view, sample.pane)) {
          failures.push(describeView(sample.pane, view));
        }
        if (!anyRectInView(drawing.rects, sample.transform, sample.pane)) {
          lostWithoutTheExtent++;
        }
      }
      expect({
        failures: failures.length,
        first: failures.slice(0, 5),
      }).toEqual({ failures: 0, first: [] });
      // The same views without the extent: most showed no card at all.
      expect(lostWithoutTheExtent / samples.length).toBeGreaterThan(0.5);
    });

    test(`${drawing.name}: the fitted view already lies inside the extent, so the first drag does not jump`, () => {
      const extent: FlowExtent = drawingExtent(drawing.rects, PAN_MARGIN);
      const random: NextRandomFunction = makeRandom(880);
      const panes: Array<FlowPaneSize> = [...CANVASES];
      for (let index: number = 0; index < 200; index++) {
        panes.push({
          width: Math.round(
            PHONE_CANVAS.width +
              random() * (DESKTOP_CANVAS.width - PHONE_CANVAS.width),
          ),
          height: Math.round(
            PHONE_CANVAS.height +
              random() * (DESKTOP_CANVAS.height - PHONE_CANVAS.height),
          ),
        });
      }
      const jumps: Array<string> = [];
      for (const pane of panes) {
        const fitted: FlowTransform = fittedView(drawing.bounds, pane);
        const firstDrag: FlowTransform = constrain(fitted, pane, extent);
        if (
          Math.abs(firstDrag[0] - fitted[0]) > 1e-6 ||
          Math.abs(firstDrag[1] - fitted[1]) > 1e-6 ||
          !anyRectInView(drawing.rects, fitted, pane)
        ) {
          jumps.push(describeView(pane, fitted));
        }
      }
      expect(jumps).toEqual([]);
    });
  }
});

/*
 * The map keeps its automatic framing (refitting on a resize) until the user
 * moves the view. React Flow (11.11, ZoomPane) reports the view at the start
 * and at the end of every gesture, and reports an end only when the two
 * differ — exactly, to the last bit. fitView sets its view without d3-zoom's
 * constrain step, so a gesture on a fitted map begins at the exact fit, and
 * the first pointer move re-applies the pan extent. Nor is a click whose
 * pointer slips a pixel or three before it is let go, which pans a map the
 * extent leaves room to move: a gesture has to move the view by more than a
 * click's slop to count. These drive d3-zoom's drag and constrain steps from
 * the views the map is in, so the judgement is made on the numbers a real
 * gesture would hand the map.
 */
describe("a press on the map, or a click that slips, is not the user taking the view (#4117)", () => {
  // Where the pointer goes down, as fractions of the canvas's width and height.
  const PRESSES: Array<[number, number]> = [
    [0.02, 0.03],
    [0.5, 0.5],
    [0.97, 0.25],
    [0.31, 0.88],
  ];
  /*
   * How far the pointer then moves before it is let go, in screen pixels.
   * None goes exactly the slop: d3-zoom's arithmetic can put a view moved
   * that far an ulp either side of it.
   */
  const DRAGS: Array<[number, number]> = [
    [0, 0],
    // The slip of a click, within the slop.
    [1, 0],
    [0, 1],
    [-1, -1],
    [3, -2],
    [-3.5, 2.5],
    // Drags, past it.
    [5, 0],
    [0, -4.5],
    [7, -3],
    [-40, 25],
    [250, 90],
    [-300, -300],
  ];

  function pointerAt(
    pane: FlowPaneSize,
    press: [number, number],
  ): [number, number] {
    return [press[0] * pane.width, press[1] * pane.height];
  }

  /* How far a drag went, on the axis it went further on. */
  function reach(drag: [number, number]): number {
    return Math.max(Math.abs(drag[0]), Math.abs(drag[1]));
  }

  test("the fitted view of a large map, which the pan extent pins, comes back from any drag a rounding error away: React Flow reports a move, hasViewportMoved does not", () => {
    const extent: FlowExtent = drawingExtent(CUSTOMER_MAP.rects, PAN_MARGIN);
    const pinnedCanvases: Array<FlowPaneSize> = [];
    let reportedAsMoves: number = 0;
    let largestShift: number = 0;
    const failures: Array<string> = [];
    for (const pane of CANVASES) {
      const fitted: FlowTransform = fittedView(CUSTOMER_MAP.bounds, pane);
      /*
       * The extent pins the view where the canvas shows all of it on both
       * axes: d3-zoom then centres the extent, which is where the fit put
       * the drawing.
       */
      if (
        pane.width / fitted[2] < extent[1][0] - extent[0][0] ||
        pane.height / fitted[2] < extent[1][1] - extent[0][1]
      ) {
        continue;
      }
      pinnedCanvases.push(pane);
      for (const press of PRESSES) {
        const pressedAt: [number, number] = pointerAt(pane, press);
        for (const [dx, dy] of DRAGS) {
          const view: FlowTransform = constrain(
            dragged(fitted, pressedAt, [pressedAt[0] + dx, pressedAt[1] + dy]),
            pane,
            extent,
          );
          if (
            view[0] !== fitted[0] ||
            view[1] !== fitted[1] ||
            view[2] !== fitted[2]
          ) {
            reportedAsMoves++;
          }
          largestShift = Math.max(
            largestShift,
            Math.abs(view[0] - fitted[0]),
            Math.abs(view[1] - fitted[1]),
          );
          if (hasViewportMoved(asViewport(fitted), asViewport(view))) {
            failures.push(
              `${describeView(pane, fitted)}: pressed at ${pressedAt.join(", ")}, dragged ${dx}, ${dy} px`,
            );
          }
        }
      }
    }
    // The fit pins the report's map on most canvases, a desktop's among them...
    expect(pinnedCanvases).toContainEqual(DESKTOP_CANVAS);
    // ...where no drag moves it by more than a rounding error...
    expect(largestShift).toBeLessThan(1e-9);
    // ...which React Flow, comparing exactly, still reports as a move...
    expect(reportedAsMoves).toBeGreaterThan(0);
    // ...and hasViewportMoved does not take for one.
    expect({
      failures: failures.length,
      first: failures.slice(0, 5),
    }).toEqual({ failures: 0, first: [] });
  });

  test("the slip of a click moves the view no further than the pointer slipped, fitted or zoomed in, and is not a move", () => {
    const failures: Array<string> = [];
    let slipsTried: number = 0;
    let slipsThatPanned: number = 0;
    for (const drawing of DRAWINGS) {
      const extent: FlowExtent = drawingExtent(drawing.rects, PAN_MARGIN);
      for (const pane of CANVASES) {
        /*
         * The fitted map, which the extent pins in place on most canvases
         * but leaves room to pan where a small drawing fills a narrow canvas,
         * or a large one overflows the canvas at the least zoom; and the map
         * zoomed in on its middle, where the extent leaves room on both axes.
         */
        const starts: Array<FlowTransform> = [
          fittedView(drawing.bounds, pane),
          viewNear(drawing.bounds, pane, 1, 0, 0),
          viewNear(drawing.bounds, pane, MAX_ZOOM, 0, 0),
        ];
        for (const start of starts) {
          for (const press of PRESSES) {
            const pressedAt: [number, number] = pointerAt(pane, press);
            for (const drag of DRAGS) {
              if (
                (drag[0] === 0 && drag[1] === 0) ||
                reach(drag) > VIEWPORT_MOVE_TOLERANCE_PX
              ) {
                continue;
              }
              slipsTried++;
              const view: FlowTransform = constrain(
                dragged(start, pressedAt, [
                  pressedAt[0] + drag[0],
                  pressedAt[1] + drag[1],
                ]),
                pane,
                extent,
              );
              const shift: number = Math.max(
                Math.abs(view[0] - start[0]),
                Math.abs(view[1] - start[1]),
              );
              if (shift >= 1 - 1e-9) {
                slipsThatPanned++;
              }
              // The extent can stop a slip short, never carry it further.
              if (
                shift > reach(drag) + 1e-9 ||
                hasViewportMoved(asViewport(start), asViewport(view))
              ) {
                failures.push(
                  `${drawing.name}, ${describeView(pane, start)}: slipped ${drag.join(", ")} px, moved ${shift} px`,
                );
              }
            }
          }
        }
      }
    }
    expect(slipsTried).toBeGreaterThan(0);
    // Where the extent leaves the view room, a slip pans the map a pixel or more...
    expect(slipsThatPanned).toBeGreaterThan(0);
    // ...and still, like every other slip, is not the user taking the view.
    expect({
      failures: failures.length,
      first: failures.slice(0, 5),
    }).toEqual({ failures: 0, first: [] });
  });

  test("a drag the pan extent lets through moves the view by more than 4 px, and is a move", () => {
    const extent: FlowExtent = drawingExtent(CUSTOMER_MAP.rects, PAN_MARGIN);
    const failures: Array<string> = [];
    let dragsTried: number = 0;
    let stoppedShort: number = 0;
    for (const pane of CANVASES) {
      for (const zoom of [1, MAX_ZOOM]) {
        /*
         * Zoomed in on the middle of the drawing, where the extent leaves the
         * view room on both axes.
         */
        const start: FlowTransform = viewNear(
          CUSTOMER_MAP.bounds,
          pane,
          zoom,
          0,
          0,
        );
        for (const press of PRESSES) {
          const pressedAt: [number, number] = pointerAt(pane, press);
          for (const drag of DRAGS) {
            if (reach(drag) <= VIEWPORT_MOVE_TOLERANCE_PX) {
              continue;
            }
            dragsTried++;
            const unbounded: FlowTransform = dragged(start, pressedAt, [
              pressedAt[0] + drag[0],
              pressedAt[1] + drag[1],
            ]);
            const view: FlowTransform = constrain(unbounded, pane, extent);
            if (
              Math.abs(view[0] - unbounded[0]) > 1e-6 ||
              Math.abs(view[1] - unbounded[1]) > 1e-6
            ) {
              stoppedShort++;
            }
            // The extent may stop a long drag short, but not within the slop.
            const shift: number = Math.max(
              Math.abs(view[0] - start[0]),
              Math.abs(view[1] - start[1]),
            );
            if (
              shift <= VIEWPORT_MOVE_TOLERANCE_PX ||
              !hasViewportMoved(asViewport(start), asViewport(view))
            ) {
              failures.push(
                `${describeView(pane, start)}: dragged ${drag.join(", ")} px, moved ${shift} px`,
              );
            }
          }
        }
      }
    }
    expect(dragsTried).toBeGreaterThan(0);
    // The extent stopped some of these drags short...
    expect(stoppedShort).toBeGreaterThan(0);
    // ...yet every one moved the view past the slop, and was a move.
    expect({
      failures: failures.length,
      first: failures.slice(0, 5),
    }).toEqual({ failures: 0, first: [] });
  });
});

/*
 * The numbers the properties above assume are the Service Map's own, and so
 * is the use it makes of the helpers. If the map changes one of them, change
 * it above as well and see that the properties still hold.
 */
describe("the Service Map these properties describe", () => {
  const TOPOLOGY_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "Topology",
  );

  /* Comments are stripped: the map's prose quotes some of these numbers. */
  function readCode(fileName: string): string {
    return fs
      .readFileSync(path.join(TOPOLOGY_DIR, fileName), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ");
  }

  test("draws 256 x 128 cards, with the gaps the layout above uses", () => {
    const card: string = readCode("TopologyNodeCard.tsx");
    expect(card).toMatch(/TOPOLOGY_NODE_WIDTH: number = 256;/);
    expect(card).toMatch(/TOPOLOGY_NODE_HEIGHT: number = 128;/);
    const map: string = readCode("ServiceMapGraph.tsx");
    expect(map).toMatch(/COLUMN_GAP: number = TOPOLOGY_NODE_WIDTH \+ 110;/);
    expect(map).toMatch(/ROW_GAP: number = TOPOLOGY_NODE_HEIGHT \+ 20;/);
  });

  test("zooms between 0.1x and 1.5x, fits as above and pans within the drawing plus a card's height", () => {
    const map: string = readCode("ServiceMapGraph.tsx");
    expect(map).toMatch(/minZoom=\{0\.1\}/);
    expect(map).toMatch(/maxZoom=\{1\.5\}/);
    expect(map).toMatch(
      /SERVICE_MAP_FIT_VIEW_OPTIONS: FitViewOptions = \{\s*padding: 0\.18,\s*maxZoom: 1,?\s*\}/,
    );
    expect(map).toMatch(
      /SERVICE_MAP_PAN_MARGIN: number = TOPOLOGY_NODE_HEIGHT;/,
    );
    expect(map).toMatch(/panMargin=\{SERVICE_MAP_PAN_MARGIN\}/);
    expect(map).toMatch(/translateExtent=\{panExtent\}/);
  });

  test("ends the automatic framing only for a gesture hasViewportMoved counts as a move, from the view the gesture began at", () => {
    const map: string = readCode("ServiceMapGraph.tsx");
    expect(map).toMatch(/onMoveStart=\{/);
    expect(map).toMatch(/gestureStart\.current = viewport;/);
    expect(map).toMatch(/hasViewportMoved\(start, viewport\)/);
  });

  test("follows keyboard focus 24 px inside the canvas, from the focused box to the canvas's on each axis, through React Flow's panBy", () => {
    const guard: string = readCode("FlowViewportGuard.tsx");
    expect(guard).toMatch(/FOCUS_REVEAL_PADDING_PX: number = 24;/);
    expect(guard).toMatch(
      /panDeltaToReveal\(\s*box\.left,\s*box\.right,\s*view\.left,\s*view\.right,\s*FOCUS_REVEAL_PADDING_PX,?\s*\)/,
    );
    expect(guard).toMatch(
      /panDeltaToReveal\(\s*box\.top,\s*box\.bottom,\s*view\.top,\s*view\.bottom,\s*FOCUS_REVEAL_PADDING_PX,?\s*\)/,
    );
    /*
     * React Flow's panBy runs d3-zoom's constrain on the pan, as a drag
     * does, so what is proved above for the extent holds for these pans.
     */
    expect(guard).toMatch(/store\.getState\(\)\.panBy\(\{ x, y \}\)/);
  });

  test("keeps the out-of-view notice 16 px inside the canvas, placed from the canvas's box and the window's height", () => {
    const map: string = readCode("ServiceMapGraph.tsx");
    expect(map).toMatch(/OUT_OF_VIEW_NOTICE_INSET_PX: number = 16;/);
    expect(map).toMatch(
      /noticeOffsetInCanvas\(\s*box\.top,\s*box\.height,\s*window\.innerHeight,[^)]*OUT_OF_VIEW_NOTICE_INSET_PX,?\s*\)/,
    );
  });
});
