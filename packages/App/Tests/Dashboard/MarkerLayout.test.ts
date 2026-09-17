import { describe, expect, test } from "@jest/globals";
import {
  CollidableMarker,
  MARKER_CLEARANCE,
  MAX_LAID_OUT_MARKERS,
  MAX_MARKER_DISPLACEMENT,
  MIN_VISIBLE_DISPLACEMENT,
  MarkerPlacement,
  resolveMarkerCollisions,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/MarkerLayout";
import { projectRobinson } from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoProjection";
import {
  FIT_MAX_ZOOM,
  MAX_ZOOM,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoViewport";

/*
 * The Network Map draws one marker per thing, wherever that thing is — and a
 * real estate puts several of them in the same place. Two stores in one
 * retail park, a market whose centroid is its parent's, six regions whose
 * derived positions all average out over the same city: every one of those
 * used to draw N markers on one spot and show ONE. The rest were not merely
 * cramped, they were GONE — no hover, no name, no click, and nothing on
 * screen admitting they existed.
 *
 * This module is the fix, so this is where the promise has to be pinned:
 *
 *   - markers never cover each other, whatever the data does;
 *   - a marker with room around it does not move AT ALL, so the map keeps
 *     telling the truth about where things are;
 *   - one that has to move never goes further than a leader line can
 *     honestly explain, and reports that it moved;
 *   - the same markers always lay out the same way, whatever order they
 *     arrive in — a map that reshuffled itself on the 60-second poll would
 *     be worse than one that overlaps.
 */

const DEFAULT_RADIUS: number = 7;

function marker(
  key: string,
  x: number,
  y: number,
  radius: number = DEFAULT_RADIUS,
): CollidableMarker {
  return { key, x, y, radius };
}

// Markers all sitting on exactly the same point — the case that broke.
function pileOf(
  count: number,
  radius: number = DEFAULT_RADIUS,
): Array<CollidableMarker> {
  const markers: Array<CollidableMarker> = [];
  for (let index: number = 0; index < count; index++) {
    markers.push(marker(`site-${index}`, 480, 250, radius));
  }
  return markers;
}

function byKey(
  placements: Array<MarkerPlacement>,
): Map<string, MarkerPlacement> {
  const map: Map<string, MarkerPlacement> = new Map<string, MarkerPlacement>();
  for (const placement of placements) {
    map.set(placement.key, placement);
  }
  return map;
}

/*
 * Overlap is a SCREEN question — that is the whole reason marker radii are
 * screen units — so distances are compared there, at the zoom being drawn.
 */
function screenDistance(
  a: MarkerPlacement,
  b: MarkerPlacement,
  zoom: number,
): number {
  return Math.hypot(a.x - b.x, a.y - b.y) * zoom;
}

function displacement(placement: MarkerPlacement, zoom: number): number {
  return (
    Math.hypot(
      placement.x - placement.anchorX,
      placement.y - placement.anchorY,
    ) * zoom
  );
}

/*
 * Whether the layout had to move this marker at all — a different question
 * from needsLeaderLine, which is about whether the move is worth EXPLAINING.
 * A marker nudged by less than its own radius is still sitting on its own
 * coordinates, and a line to a point underneath it would be invisible ink.
 */
function wasMoved(placement: MarkerPlacement): boolean {
  return placement.x !== placement.anchorX || placement.y !== placement.anchorY;
}

function requiredDistance(a: CollidableMarker, b: CollidableMarker): number {
  return a.radius + b.radius + MARKER_CLEARANCE;
}

/*
 * The headline promise, checked over every pair rather than over a sample.
 * The tolerance absorbs the hair of residual movement the relaxation stops
 * at; it is far below one screen pixel.
 *
 * Every one of these helpers collects its complaints and asserts ONCE.
 * These tests run over piles of hundreds of markers, and an expect() per
 * marker turns a millisecond of layout into seconds of test harness.
 */
function overlappingPairs(
  markers: Array<CollidableMarker>,
  placements: Array<MarkerPlacement>,
  zoom: number,
): Array<string> {
  const problems: Array<string> = [];
  for (let i: number = 0; i < markers.length; i++) {
    for (let j: number = i + 1; j < markers.length; j++) {
      const distance: number = screenDistance(
        placements[i]!,
        placements[j]!,
        zoom,
      );
      const required: number = requiredDistance(markers[i]!, markers[j]!);
      if (distance < required - 0.05) {
        problems.push(
          `${markers[i]!.key} and ${markers[j]!.key} are ${distance.toFixed(
            3,
          )} apart on screen but need ${required.toFixed(3)}`,
        );
      }
    }
  }
  return problems;
}

function expectNothingOverlaps(
  markers: Array<CollidableMarker>,
  placements: Array<MarkerPlacement>,
  zoom: number,
): void {
  expect(overlappingPairs(markers, placements, zoom)).toEqual([]);
}

// Placements that fail a promise, named — so a failure says which and why.
function offenders(
  placements: Array<MarkerPlacement>,
  isGood: (placement: MarkerPlacement) => boolean,
  explain: (placement: MarkerPlacement) => string,
): Array<string> {
  const problems: Array<string> = [];
  for (const placement of placements) {
    if (!isGood(placement)) {
      problems.push(`${placement.key}: ${explain(placement)}`);
    }
  }
  return problems;
}

describe("resolveMarkerCollisions leaves markers alone when it can", () => {
  test("markers with room around them are drawn exactly where they belong", () => {
    const markers: Array<CollidableMarker> = [
      marker("a", 100, 100),
      marker("b", 300, 300),
      marker("c", 700, 120),
    ];
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      markers,
      1,
    );

    for (let index: number = 0; index < markers.length; index++) {
      // Bit-for-bit, not merely close: an untouched marker must not drift.
      expect(placements[index]!.x).toBe(markers[index]!.x);
      expect(placements[index]!.y).toBe(markers[index]!.y);
      expect(placements[index]!.needsLeaderLine).toBe(false);
    }
  });

  test("a lone marker is never moved", () => {
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      [marker("only", 12.5, 88.25)],
      4,
    );
    expect(placements).toEqual([
      {
        key: "only",
        x: 12.5,
        y: 88.25,
        anchorX: 12.5,
        anchorY: 88.25,
        needsLeaderLine: false,
      },
    ]);
  });

  test("no markers, no placements", () => {
    expect(resolveMarkerCollisions([], 1)).toEqual([]);
  });

  test("every marker gets exactly one placement, in the order it came in", () => {
    const markers: Array<CollidableMarker> = [
      marker("zulu", 480, 250),
      marker("alpha", 480, 250),
      marker("mike", 481, 250),
    ];
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      markers,
      1,
    );
    expect(
      placements.map((placement: MarkerPlacement): string => {
        return placement.key;
      }),
    ).toEqual(["zulu", "alpha", "mike"]);
  });
});

describe("resolveMarkerCollisions pulls a pile-up apart", () => {
  test("two markers on the same point end up clear of each other", () => {
    const markers: Array<CollidableMarker> = pileOf(2);
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      markers,
      1,
    );

    expectNothingOverlaps(markers, placements, 1);
    expect(screenDistance(placements[0]!, placements[1]!, 1)).toBeGreaterThan(
      requiredDistance(markers[0]!, markers[1]!) - 0.05,
    );
    for (const placement of placements) {
      expect(placement.needsLeaderLine).toBe(true);
    }
  });

  test.each([3, 5, 8, 13, 30])(
    "a pile of %i markers comes apart completely",
    (count: number) => {
      const markers: Array<CollidableMarker> = pileOf(count);
      const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
        markers,
        1,
      );
      expectNothingOverlaps(markers, placements, 1);
    },
  );

  test("a pile-up keeps every anchor, so nothing loses its real position", () => {
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      pileOf(9),
      1,
    );
    expect(
      offenders(
        placements,
        (placement: MarkerPlacement): boolean => {
          return placement.anchorX === 480 && placement.anchorY === 250;
        },
        (placement: MarkerPlacement): string => {
          return `anchored at ${placement.anchorX},${placement.anchorY}`;
        },
      ),
    ).toEqual([]);
    // They moved, and they say so — that is what draws the leader lines.
    expect(
      offenders(
        placements,
        (placement: MarkerPlacement): boolean => {
          return (
            placement.needsLeaderLine &&
            displacement(placement, 1) > MIN_VISIBLE_DISPLACEMENT
          );
        },
        (placement: MarkerPlacement): string => {
          return `moved ${displacement(placement, 1).toFixed(3)}, flagged ${
            placement.needsLeaderLine
          }`;
        },
      ),
    ).toEqual([]);
  });

  test("markers of different sizes still clear each other", () => {
    const markers: Array<CollidableMarker> = [
      marker("huge", 480, 250, 22),
      marker("mid", 480, 250, 14),
      marker("small", 480, 250, 7),
      marker("tiny", 480.5, 250.5, 7),
    ];
    expectNothingOverlaps(markers, resolveMarkerCollisions(markers, 1), 1);
  });

  /*
   * A chain of markers each overlapping the next is the case a naive
   * "nudge the pair apart" pass gets wrong: fixing one pair breaks the
   * neighbouring one, and it has to keep going until the whole row is clear.
   */
  test("a chain of overlapping markers separates all the way down", () => {
    const markers: Array<CollidableMarker> = [];
    for (let index: number = 0; index < 12; index++) {
      markers.push(marker(`chain-${index}`, 300 + index * 8, 250));
    }
    expectNothingOverlaps(markers, resolveMarkerCollisions(markers, 1), 1);
  });

  test("a busy map with piles, chains and loners resolves all of it", () => {
    const markers: Array<CollidableMarker> = [
      ...pileOf(6),
      marker("chain-a", 300, 100),
      marker("chain-b", 304, 100),
      marker("chain-c", 308, 100),
      marker("far-1", 100, 400, 22),
      marker("far-2", 800, 60, 14),
    ];
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      markers,
      1,
    );
    expectNothingOverlaps(markers, placements, 1);

    // The loners had room, so they did not move.
    const placed: Map<string, MarkerPlacement> = byKey(placements);
    expect(placed.get("far-1")!.needsLeaderLine).toBe(false);
    expect(placed.get("far-1")!.x).toBe(100);
    expect(placed.get("far-2")!.needsLeaderLine).toBe(false);
    expect(placed.get("far-2")!.y).toBe(60);
  });

  /*
   * The promise that makes displacement acceptable at all: the map never
   * draws a marker away from the place it belongs without a line saying so.
   * "Away from" means off its own footprint — a marker nudged within its own
   * radius is still covering its coordinates, and a line to a point beneath
   * it would be invisible.
   */
  test("nothing is drawn off its spot without a line to explain it", () => {
    const markers: Array<CollidableMarker> = [
      ...pileOf(7),
      marker("pair-a", 300, 100, 18),
      marker("pair-b", 316, 104, 18),
      marker("row-a", 700, 400),
      marker("row-b", 706, 400),
      marker("row-c", 712, 400),
      marker("alone", 120, 60, 22),
    ];
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      markers,
      1,
    );

    const unexplained: Array<string> = [];
    for (let index: number = 0; index < markers.length; index++) {
      const placement: MarkerPlacement = placements[index]!;
      if (placement.needsLeaderLine) {
        continue;
      }
      const moved: number = displacement(placement, 1);
      if (moved > markers[index]!.radius) {
        unexplained.push(`${placement.key} moved ${moved.toFixed(2)}`);
      }
    }
    expect(unexplained).toEqual([]);
  });
});

describe("resolveMarkerCollisions moves markers as little as possible", () => {
  /*
   * The displacement is a lie the leader line has to carry. A marker moved
   * further than it needed to be is a lie told for no reason.
   */
  test("a pair that barely overlaps barely moves", () => {
    const required: number = requiredDistance(
      marker("a", 0, 0),
      marker("b", 0, 0),
    );
    const markers: Array<CollidableMarker> = [
      marker("a", 400, 250),
      marker("b", 400 + required - 2, 250),
    ];
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      markers,
      1,
    );

    // They end up exactly clear, not flung apart.
    expect(screenDistance(placements[0]!, placements[1]!, 1)).toBeCloseTo(
      required,
      3,
    );
    // Two pixels of overlap, shared: one screen unit each.
    for (const placement of placements) {
      expect(displacement(placement, 1)).toBeCloseTo(1, 3);
    }
  });

  /*
   * A sub-pixel nudge gets no leader line: a thread nobody can see, pointing
   * at a marker that has not visibly moved, is noise. The POSITION is still
   * the resolved one — snapping it back would put the overlap back.
   */
  test("a nudge too small to see draws no leader line", () => {
    const required: number = requiredDistance(
      marker("a", 0, 0),
      marker("b", 0, 0),
    );
    const markers: Array<CollidableMarker> = [
      marker("a", 400, 250),
      marker("b", 400 + required - 1, 250),
    ];
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      markers,
      1,
    );

    for (const placement of placements) {
      expect(displacement(placement, 1)).toBeCloseTo(0.5, 3);
      expect(displacement(placement, 1)).toBeLessThan(MIN_VISIBLE_DISPLACEMENT);
      expect(placement.needsLeaderLine).toBe(false);
    }
    // Moved anyway — the overlap is real even if the correction is invisible.
    expect(placements[0]!.x).not.toBe(400);
  });

  /*
   * Nor does a marker nudged by less than its own radius. It is still sitting
   * on the spot it belongs to — the line and the dot would be drawn entirely
   * underneath it, and the legend would be explaining ink that is not on
   * screen. Big markers are exactly where this bites: two large regions in
   * one city need a lot of separating before either one stops covering its
   * own coordinates.
   */
  test("a marker still covering its own spot draws no leader line", () => {
    const markers: Array<CollidableMarker> = [
      marker("big-a", 480, 250, 30),
      // Overlapping enough to need a few units of correction, no more.
      marker("big-b", 480 + 30 + 30 + MARKER_CLEARANCE - 8, 250, 30),
    ];
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      markers,
      1,
    );

    for (const placement of placements) {
      expect(displacement(placement, 1)).toBeCloseTo(4, 3);
      // Well past the "did it move at all" floor...
      expect(displacement(placement, 1)).toBeGreaterThan(
        MIN_VISIBLE_DISPLACEMENT,
      );
      // ...and still deep inside the marker's own footprint.
      expect(placement.needsLeaderLine).toBe(false);
      expect(wasMoved(placement)).toBe(true);
    }
  });

  test("once the marker clears its own spot, the line appears", () => {
    const markers: Array<CollidableMarker> = [
      marker("big-a", 480, 250, 30),
      marker("big-b", 480, 250, 30),
    ];
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      markers,
      1,
    );
    for (const placement of placements) {
      // Half the required separation each: 31.5, clear of a radius of 30.
      expect(displacement(placement, 1)).toBeGreaterThan(30);
      expect(placement.needsLeaderLine).toBe(true);
    }
  });

  /*
   * The big marker is the one carrying the most meaning — a region standing
   * for three hundred units — and it is the one the eye is on. The single
   * store next to it is what steps aside.
   */
  test("the bigger marker holds its ground and the small one moves", () => {
    const markers: Array<CollidableMarker> = [
      marker("region", 480, 250, 22),
      marker("store", 480, 250, 7),
    ];
    const placed: Map<string, MarkerPlacement> = byKey(
      resolveMarkerCollisions(markers, 1),
    );
    expect(displacement(placed.get("region")!, 1)).toBeLessThan(
      displacement(placed.get("store")!, 1),
    );
  });

  test("nothing is ever pushed further than a leader line can explain", () => {
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      pileOf(120),
      1,
    );
    expect(
      offenders(
        placements,
        (placement: MarkerPlacement): boolean => {
          return displacement(placement, 1) <= MAX_MARKER_DISPLACEMENT + 1e-6;
        },
        (placement: MarkerPlacement): string => {
          return `moved ${displacement(placement, 1).toFixed(3)}`;
        },
      ),
    ).toEqual([]);
  });

  /*
   * Past what fits, the map keeps some overlap rather than scattering
   * markers across a county they are not in. It must still be a map, not a
   * crash or an infinite loop.
   */
  test("a pile too dense to resolve still terminates and stays near home", () => {
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      pileOf(400),
      1,
    );
    expect(placements).toHaveLength(400);
    expect(
      offenders(
        placements,
        (placement: MarkerPlacement): boolean => {
          return (
            Number.isFinite(placement.x) &&
            Number.isFinite(placement.y) &&
            displacement(placement, 1) <= MAX_MARKER_DISPLACEMENT + 1e-6
          );
        },
        (placement: MarkerPlacement): string => {
          return `at ${placement.x},${placement.y}`;
        },
      ),
    ).toEqual([]);
  });
});

describe("resolveMarkerCollisions is the same every time", () => {
  const markers: Array<CollidableMarker> = [
    ...pileOf(7),
    marker("near-a", 300, 100),
    marker("near-b", 305, 103),
    marker("lonely", 800, 400, 18),
  ];

  test("the same markers lay out identically twice", () => {
    expect(resolveMarkerCollisions(markers, 1)).toEqual(
      resolveMarkerCollisions(markers, 1),
    );
  });

  /*
   * Paint order is re-decided every render (biggest marker first, and the
   * counts change as sites go down). If the layout depended on it, a site
   * going offline would visibly shuffle the map.
   */
  test("the order the markers arrive in changes nothing", () => {
    const reversed: Array<CollidableMarker> = [...markers].reverse();
    const forward: Map<string, MarkerPlacement> = byKey(
      resolveMarkerCollisions(markers, 1),
    );
    const backward: Map<string, MarkerPlacement> = byKey(
      resolveMarkerCollisions(reversed, 1),
    );

    expect(backward.size).toBe(forward.size);
    for (const [key, placement] of forward.entries()) {
      expect(backward.get(key)).toEqual(placement);
    }
  });

  test("a shuffled pile lays out the same way", () => {
    const shuffled: Array<CollidableMarker> = [
      markers[4]!,
      markers[9]!,
      markers[0]!,
      markers[7]!,
      markers[2]!,
      markers[8]!,
      markers[1]!,
      markers[5]!,
      markers[3]!,
      markers[6]!,
    ];
    const straight: Map<string, MarkerPlacement> = byKey(
      resolveMarkerCollisions(markers, 1),
    );
    for (const placement of resolveMarkerCollisions(shuffled, 1)) {
      expect(placement).toEqual(straight.get(placement.key));
    }
  });
});

describe("resolveMarkerCollisions works in screen space, so zoom undoes it", () => {
  /*
   * This is the other half of the fix, and the reason the map's zoom limit
   * was raised: zooming in genuinely separates markers, and when it does the
   * layout stops moving them. Markers snap back to their true positions
   * rather than staying nudged at every zoom.
   */
  test("two markers that need nudging zoomed out are untouched zoomed in", () => {
    const markers: Array<CollidableMarker> = [
      marker("a", 400, 250),
      marker("b", 402, 250),
    ];

    const wide: Array<MarkerPlacement> = resolveMarkerCollisions(markers, 1);
    expect(wasMoved(wide[0]!)).toBe(true);
    expect(wasMoved(wide[1]!)).toBe(true);

    const close: Array<MarkerPlacement> = resolveMarkerCollisions(markers, 10);
    expect(close[0]!.x).toBe(400);
    expect(close[1]!.x).toBe(402);
    expect(wasMoved(close[0]!)).toBe(false);
    expect(close[0]!.needsLeaderLine).toBe(false);
    expect(close[1]!.needsLeaderLine).toBe(false);
  });

  test("the displacement shrinks as the map zooms in", () => {
    const markers: Array<CollidableMarker> = pileOf(4);
    const spread: (zoom: number) => number = (zoom: number): number => {
      const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
        markers,
        zoom,
      );
      return Math.max(
        ...placements.map((placement: MarkerPlacement): number => {
          // In viewBox units: the same screen spread covers less world.
          return Math.hypot(
            placement.x - placement.anchorX,
            placement.y - placement.anchorY,
          );
        }),
      );
    };
    expect(spread(4)).toBeLessThan(spread(1));
    expect(spread(16)).toBeLessThan(spread(4));
  });

  /*
   * Sites in one metro area are the everyday version of this problem. At the
   * map's old zoom limit two of them 20 km apart were still inside one
   * marker's radius, so a reader who zoomed in to tell them apart hit the
   * stop with the pair still stacked. The current limit resolves them for
   * real — which is what the raise was for.
   */
  test("the deepest zoom separates sites the old limit could not", () => {
    const [aX, aY]: [number, number] = projectRobinson(40, -100);
    // ~20 km east, at that latitude.
    const [bX, bY]: [number, number] = projectRobinson(40, -100 + 0.2345);
    const markers: Array<CollidableMarker> = [
      marker("store-a", aX, aY),
      marker("store-b", bX, bY),
    ];

    const atOldLimit: Array<MarkerPlacement> = resolveMarkerCollisions(
      markers,
      FIT_MAX_ZOOM,
    );
    expect(wasMoved(atOldLimit[0]!)).toBe(true);
    expect(wasMoved(atOldLimit[1]!)).toBe(true);

    const atMaxZoom: Array<MarkerPlacement> = resolveMarkerCollisions(
      markers,
      MAX_ZOOM,
    );
    expect(wasMoved(atMaxZoom[0]!)).toBe(false);
    expect(atMaxZoom[0]!.needsLeaderLine).toBe(false);
    expect(atMaxZoom[0]!.x).toBe(aX);
    expect(atMaxZoom[1]!.x).toBe(bX);
  });
});

describe("resolveMarkerCollisions survives hostile input", () => {
  test("a marker with no usable position is passed straight through", () => {
    const markers: Array<CollidableMarker> = [
      marker("nan", Number.NaN, 250),
      marker("infinite", 480, Infinity),
      marker("real-a", 480, 250),
      marker("real-b", 480, 250),
    ];
    const placed: Map<string, MarkerPlacement> = byKey(
      resolveMarkerCollisions(markers, 1),
    );

    expect(Number.isNaN(placed.get("nan")!.x)).toBe(true);
    expect(placed.get("nan")!.needsLeaderLine).toBe(false);
    expect(placed.get("infinite")!.y).toBe(Infinity);
    expect(placed.get("infinite")!.needsLeaderLine).toBe(false);

    // The real pair is still pulled apart around them.
    expect(
      screenDistance(placed.get("real-a")!, placed.get("real-b")!, 1),
    ).toBeGreaterThan(2 * DEFAULT_RADIUS + MARKER_CLEARANCE - 0.05);
  });

  test("only one usable marker means nothing to resolve", () => {
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      [marker("nan", Number.NaN, Number.NaN), marker("real", 100, 100)],
      1,
    );
    expect(placements[1]!.x).toBe(100);
    expect(placements[1]!.needsLeaderLine).toBe(false);
  });

  test.each([
    ["NaN", Number.NaN],
    ["zero", 0],
    ["negative", -4],
    ["infinite", Infinity],
  ])(
    "a %s zoom is treated as the whole world",
    (_name: string, zoom: number) => {
      const markers: Array<CollidableMarker> = pileOf(4);
      expect(resolveMarkerCollisions(markers, zoom)).toEqual(
        resolveMarkerCollisions(markers, 1),
      );
    },
  );

  test.each([
    ["NaN", Number.NaN],
    ["negative", -7],
    ["infinite", Infinity],
  ])(
    "a %s radius still gets the markers off each other",
    (_name: string, radius: number) => {
      const markers: Array<CollidableMarker> = pileOf(4, radius);
      const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
        markers,
        1,
      );
      const tooClose: Array<string> = [];
      for (let i: number = 0; i < placements.length; i++) {
        for (let j: number = i + 1; j < placements.length; j++) {
          const distance: number = screenDistance(
            placements[i]!,
            placements[j]!,
            1,
          );
          if (distance < MARKER_CLEARANCE - 0.05) {
            tooClose.push(`${i}/${j}: ${distance.toFixed(3)}`);
          }
        }
      }
      expect(tooClose).toEqual([]);
    },
  );

  test("a zero radius still leaves the clearance between markers", () => {
    const markers: Array<CollidableMarker> = pileOf(3, 0);
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      markers,
      1,
    );
    expectNothingOverlaps(markers, placements, 1);
  });
});

describe("resolveMarkerCollisions stays out of the way of a huge map", () => {
  /*
   * Past a few thousand markers the map is a texture rather than a set of
   * things to click, and the relaxation would run on every wheel tick of a
   * zoom. Stepping aside is the honest failure: the picture is unchanged,
   * and a drag does not stutter.
   */
  test("past the ceiling every marker is drawn exactly where it belongs", () => {
    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      pileOf(MAX_LAID_OUT_MARKERS + 1),
      1,
    );
    expect(placements).toHaveLength(MAX_LAID_OUT_MARKERS + 1);
    expect(
      offenders(
        placements,
        (placement: MarkerPlacement): boolean => {
          return (
            placement.x === 480 &&
            placement.y === 250 &&
            !placement.needsLeaderLine
          );
        },
        (placement: MarkerPlacement): string => {
          return `drawn at ${placement.x},${placement.y}`;
        },
      ),
    ).toEqual([]);
  });

  /*
   * ...and right up to the ceiling it still does the work. A thousand
   * markers is an ordinary "all sites" view of a large estate, and it has to
   * lay out fast enough to run on every frame of a zoom — which is what the
   * neighbourhood grid inside is for.
   */
  test("a thousand markers, some of them stacked, all come apart", () => {
    const markers: Array<CollidableMarker> = [];
    for (let index: number = 0; index < 1000; index++) {
      const column: number = index % 40;
      const row: number = Math.floor(index / 40);
      markers.push(marker(`grid-${index}`, 20 + column * 23, 10 + row * 18));
    }
    // Five sites sharing one address, in the middle of all that.
    for (let index: number = 0; index < 5; index++) {
      markers.push(marker(`stacked-${index}`, 480, 250));
    }

    const placements: Array<MarkerPlacement> = resolveMarkerCollisions(
      markers,
      1,
    );
    expect(placements).toHaveLength(1005);
    expectNothingOverlaps(markers, placements, 1);
  });
});
