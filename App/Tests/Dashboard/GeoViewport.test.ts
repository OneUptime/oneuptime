import { describe, expect, test } from "@jest/globals";
import {
  DETAIL_GEOMETRY_MIN_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  MapViewport,
  ViewportPoint,
  WORLD_VIEWPORT,
  clampViewport,
  countPointsInViewport,
  fitViewportToPoints,
  panViewport,
  screenLengthToViewportLength,
  shouldUseDetailGeometry,
  viewBoxOfViewport,
  viewportContainsPoint,
  viewportsMatch,
  zoomOfViewport,
  zoomViewport,
} from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoViewport";
import { projectRobinson } from "../../FeatureSet/Dashboard/src/Components/NetworkSite/Geo/GeoProjection";

/*
 * The Network Map has no region picker. It draws one world projection and
 * frames itself to wherever the project's sites are — which is the whole
 * reason the old "United States / World" toggle could be deleted rather than
 * extended country by country. That framing decision lives entirely in this
 * module, so this is where the behaviour has to be pinned:
 *
 *   - a fit actually contains every site, whichever continent they are on,
 *     and NEVER depends on which country they happen to be in;
 *   - a viewport is always drawable — world aspect ratio, inside the world,
 *     within the zoom limits — no matter what a caller hands in;
 *   - zoom holds its focal point still, pan cannot escape the world, and
 *     hostile input (NaN, Infinity, zero-size) degrades to the whole world
 *     rather than to a blank map.
 */

const WORLD_ASPECT: number = WORLD_VIEWPORT.height / WORLD_VIEWPORT.width;

function point(x: number, y: number): ViewportPoint {
  return { x, y };
}

// A real city, projected the way the map projects a site pin.
function city(latitude: number, longitude: number): ViewportPoint {
  const projected: [number, number] = projectRobinson(latitude, longitude);
  return { x: projected[0], y: projected[1] };
}

const CITIES: Record<string, ViewportPoint> = {
  // Continental US, corner to corner.
  seattle: city(47.61, -122.33),
  miami: city(25.76, -80.19),
  // Europe.
  london: city(51.51, -0.13),
  berlin: city(52.52, 13.4),
  madrid: city(40.42, -3.7),
  // Elsewhere, on purpose — no geography here is special.
  mumbai: city(19.08, 72.88),
  sydney: city(-33.87, 151.21),
  saoPaulo: city(-23.55, -46.63),
  nairobi: city(-1.29, 36.82),
  tokyo: city(35.68, 139.65),
};

function containsPoint(viewport: MapViewport, target: ViewportPoint): boolean {
  return (
    target.x >= viewport.x &&
    target.x <= viewport.x + viewport.width &&
    target.y >= viewport.y &&
    target.y <= viewport.y + viewport.height
  );
}

function expectDrawable(viewport: MapViewport): void {
  // World aspect ratio: any other shape would silently letterbox the SVG.
  expect(viewport.height / viewport.width).toBeCloseTo(WORLD_ASPECT, 9);
  // Inside the world.
  expect(viewport.x).toBeGreaterThanOrEqual(-1e-9);
  expect(viewport.y).toBeGreaterThanOrEqual(-1e-9);
  expect(viewport.x + viewport.width).toBeLessThanOrEqual(
    WORLD_VIEWPORT.width + 1e-9,
  );
  expect(viewport.y + viewport.height).toBeLessThanOrEqual(
    WORLD_VIEWPORT.height + 1e-9,
  );
  // Within the zoom limits.
  const zoom: number = zoomOfViewport(viewport);
  expect(zoom).toBeGreaterThanOrEqual(MIN_ZOOM - 1e-9);
  expect(zoom).toBeLessThanOrEqual(MAX_ZOOM + 1e-9);
}

describe("WORLD_VIEWPORT", () => {
  test("is the whole Robinson viewBox at zoom 1", () => {
    expect(WORLD_VIEWPORT).toEqual({ x: 0, y: 0, width: 960, height: 500 });
    expect(zoomOfViewport(WORLD_VIEWPORT)).toBe(1);
  });

  test("survives a clamp unchanged", () => {
    expect(clampViewport(WORLD_VIEWPORT)).toEqual(WORLD_VIEWPORT);
  });
});

describe("clampViewport", () => {
  test("derives height from width, so the two can never disagree", () => {
    // A caller asking for a square frame gets the world's shape instead.
    const clamped: MapViewport = clampViewport({
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });
    expect(clamped.width).toBe(200);
    expect(clamped.height).toBe(200 * WORLD_ASPECT);
    expectDrawable(clamped);
  });

  test("a viewport wider than the world collapses to the world", () => {
    expect(
      clampViewport({ x: -500, y: -500, width: 5000, height: 5000 }),
    ).toEqual(WORLD_VIEWPORT);
  });

  test("clamps zoom at MAX_ZOOM instead of magnifying further", () => {
    const tooDeep: MapViewport = clampViewport({
      x: 480,
      y: 250,
      width: 0.001,
      height: 0.001,
    });
    expect(zoomOfViewport(tooDeep)).toBeCloseTo(MAX_ZOOM, 9);
    expectDrawable(tooDeep);
  });

  test("slides a frame that hangs off an edge back inside", () => {
    const offLeft: MapViewport = clampViewport({
      x: -200,
      y: -200,
      width: 480,
      height: 250,
    });
    expect(offLeft.x).toBe(0);
    expect(offLeft.y).toBe(0);

    const offRight: MapViewport = clampViewport({
      x: 900,
      y: 480,
      width: 480,
      height: 250,
    });
    expect(offRight.x).toBe(WORLD_VIEWPORT.width - 480);
    expect(offRight.y).toBe(WORLD_VIEWPORT.height - 250);
  });

  test.each([
    ["NaN width", { x: 0, y: 0, width: Number.NaN, height: 250 }],
    ["infinite width", { x: 0, y: 0, width: Infinity, height: 250 }],
    ["zero width", { x: 0, y: 0, width: 0, height: 250 }],
    ["negative width", { x: 0, y: 0, width: -480, height: 250 }],
  ])(
    "%s degrades to the whole world, not to a blank map",
    (_name: string, viewport: MapViewport) => {
      expect(clampViewport(viewport)).toEqual(WORLD_VIEWPORT);
    },
  );

  test("a non-finite position is treated as the origin", () => {
    const clamped: MapViewport = clampViewport({
      x: Number.NaN,
      y: Infinity,
      width: 480,
      height: 250,
    });
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
    expectDrawable(clamped);
  });

  test("is idempotent", () => {
    const once: MapViewport = clampViewport({
      x: 700,
      y: 400,
      width: 300,
      height: 999,
    });
    expect(clampViewport(once)).toEqual(once);
  });
});

describe("fitViewportToPoints", () => {
  test("no points means nothing to frame: the whole world", () => {
    expect(fitViewportToPoints([])).toEqual(WORLD_VIEWPORT);
  });

  test("points that are all non-finite also fall back to the world", () => {
    expect(
      fitViewportToPoints([
        point(Number.NaN, 10),
        point(10, Infinity),
        point(Number.NEGATIVE_INFINITY, Number.NaN),
      ]),
    ).toEqual(WORLD_VIEWPORT);
  });

  test("a finite point is still framed when others are corrupt", () => {
    const fitted: MapViewport = fitViewportToPoints([
      point(Number.NaN, 10),
      CITIES["berlin"]!,
    ]);
    expect(containsPoint(fitted, CITIES["berlin"]!)).toBe(true);
    expectDrawable(fitted);
  });

  /*
   * The core promise. Whatever the network looks like, the opening view
   * holds all of it — and holds it the same way regardless of continent.
   */
  test.each([
    ["one country (US)", ["seattle", "miami"]],
    ["one country (Europe)", ["london", "berlin", "madrid"]],
    ["one hemisphere", ["mumbai", "sydney", "tokyo"]],
    ["global", ["seattle", "london", "sydney", "saoPaulo", "nairobi"]],
    ["a single site", ["nairobi"]],
  ])("frames every site: %s", (_name: string, keys: Array<string>) => {
    const points: Array<ViewportPoint> = keys.map((key: string) => {
      return CITIES[key]!;
    });
    const fitted: MapViewport = fitViewportToPoints(points);
    expectDrawable(fitted);
    for (const target of points) {
      expect(containsPoint(fitted, target)).toBe(true);
    }
  });

  /*
   * The whole point of deleting the region toggle: geography must not be
   * hardcoded anywhere. A network of the same shape and size gets the same
   * quality of view wherever on Earth it sits.
   */
  test("treats every continent identically", () => {
    const spans: Array<number> = [
      // ~10 degrees of longitude at four very different places.
      [40, -100],
      [50, 5],
      [20, 75],
      [-30, 145],
    ].map((location: Array<number>): number => {
      const fitted: MapViewport = fitViewportToPoints([
        city(location[0]!, location[1]!),
        city(location[0]!, location[1]! + 10),
      ]);
      return fitted.width;
    });

    /*
     * Robinson compresses meridians towards the poles, so the widths are not
     * identical — but they are all the same ORDER, which is what "no country
     * is special" means here. A hardcoded region would show up as one of
     * these being wildly different.
     */
    const smallest: number = Math.min(...spans);
    const largest: number = Math.max(...spans);
    expect(largest / smallest).toBeLessThan(2);
  });

  test("leaves a margin: sites are never flush against the frame edge", () => {
    const points: Array<ViewportPoint> = [CITIES["seattle"]!, CITIES["miami"]!];
    const fitted: MapViewport = fitViewportToPoints(points);
    const left: number = Math.min(points[0]!.x, points[1]!.x);
    const right: number = Math.max(points[0]!.x, points[1]!.x);
    expect(left - fitted.x).toBeGreaterThan(0);
    expect(fitted.x + fitted.width - right).toBeGreaterThan(0);
  });

  test("a US-only network fits far tighter than the world", () => {
    // The behaviour the deleted "United States" toggle used to provide.
    const fitted: MapViewport = fitViewportToPoints([
      CITIES["seattle"]!,
      CITIES["miami"]!,
    ]);
    expect(zoomOfViewport(fitted)).toBeGreaterThan(2);
  });

  test("a network spanning the globe opens on the whole world", () => {
    // Near-antipodal on the equator, where Robinson stretches longitude most.
    const fitted: MapViewport = fitViewportToPoints([
      city(0, -179),
      city(0, 179),
    ]);
    expect(fitted).toEqual(WORLD_VIEWPORT);
  });

  test("a network spanning the globe at high latitude still opens near zoom 1", () => {
    /*
     * Robinson compresses meridians towards the poles, so two sites at the
     * same longitudes but far north and south genuinely span slightly less
     * of the viewBox. The fit follows the projection rather than special
     * casing it — but it is still, to the eye, the whole world.
     */
    const fitted: MapViewport = fitViewportToPoints([
      city(60, -170),
      city(-50, 175),
    ]);
    expect(zoomOfViewport(fitted)).toBeLessThan(1.1);
    expectDrawable(fitted);
  });

  test("identical points do not fit to infinite zoom", () => {
    const fitted: MapViewport = fitViewportToPoints([
      point(480, 250),
      point(480, 250),
      point(480, 250),
    ]);
    expectDrawable(fitted);
    expect(zoomOfViewport(fitted)).toBeLessThanOrEqual(MAX_ZOOM);
    expect(containsPoint(fitted, point(480, 250))).toBe(true);
  });

  test("a tall network is framed by its height, not squashed", () => {
    // Two sites on the same meridian, far apart north to south.
    const points: Array<ViewportPoint> = [city(60, 10), city(-30, 10)];
    const fitted: MapViewport = fitViewportToPoints(points);
    expectDrawable(fitted);
    for (const target of points) {
      expect(containsPoint(fitted, target)).toBe(true);
    }
  });

  test("is order-independent and deterministic", () => {
    const points: Array<ViewportPoint> = [
      CITIES["london"]!,
      CITIES["tokyo"]!,
      CITIES["nairobi"]!,
    ];
    const forward: MapViewport = fitViewportToPoints(points);
    expect(fitViewportToPoints(points)).toEqual(forward);
    expect(fitViewportToPoints([...points].reverse())).toEqual(forward);
  });
});

describe("zoomViewport", () => {
  test("zooming in halves the frame and keeps the centre", () => {
    const zoomed: MapViewport = zoomViewport(WORLD_VIEWPORT, 2);
    expect(zoomed.width).toBe(WORLD_VIEWPORT.width / 2);
    expect(zoomed.x + zoomed.width / 2).toBeCloseTo(
      WORLD_VIEWPORT.width / 2,
      9,
    );
    expect(zoomed.y + zoomed.height / 2).toBeCloseTo(
      WORLD_VIEWPORT.height / 2,
      9,
    );
    expectDrawable(zoomed);
  });

  test("holds the focal point still — what is under the cursor stays there", () => {
    const start: MapViewport = clampViewport({
      x: 200,
      y: 100,
      width: 480,
      height: 250,
    });
    const focus: ViewportPoint = point(300, 150);
    const zoomed: MapViewport = zoomViewport(start, 2, focus);

    const fractionBefore: number = (focus.x - start.x) / start.width;
    const fractionAfter: number = (focus.x - zoomed.x) / zoomed.width;
    expect(fractionAfter).toBeCloseTo(fractionBefore, 9);

    const verticalBefore: number = (focus.y - start.y) / start.height;
    const verticalAfter: number = (focus.y - zoomed.y) / zoomed.height;
    expect(verticalAfter).toBeCloseTo(verticalBefore, 9);
  });

  test("zooming out and back in returns to the same frame", () => {
    const start: MapViewport = clampViewport({
      x: 200,
      y: 100,
      width: 240,
      height: 125,
    });
    const round: MapViewport = zoomViewport(zoomViewport(start, 0.5), 2);
    expect(viewportsMatch(round, start)).toBe(true);
  });

  test("cannot zoom past MAX_ZOOM however many times it is called", () => {
    let viewport: MapViewport = WORLD_VIEWPORT;
    for (let i: number = 0; i < 40; i++) {
      viewport = zoomViewport(viewport, 2);
    }
    expect(zoomOfViewport(viewport)).toBeCloseTo(MAX_ZOOM, 9);
    expectDrawable(viewport);
  });

  test("cannot zoom out past the world", () => {
    let viewport: MapViewport = clampViewport({
      x: 400,
      y: 200,
      width: 100,
      height: 52,
    });
    for (let i: number = 0; i < 40; i++) {
      viewport = zoomViewport(viewport, 0.5);
    }
    expect(viewport).toEqual(WORLD_VIEWPORT);
  });

  test("a focus at the edge still zooms, sliding the frame inside", () => {
    const zoomed: MapViewport = zoomViewport(WORLD_VIEWPORT, 4, point(0, 0));
    expect(zoomOfViewport(zoomed)).toBeCloseTo(4, 9);
    expectDrawable(zoomed);
    expect(zoomed.x).toBe(0);
    expect(zoomed.y).toBe(0);
  });

  test.each([
    ["NaN", Number.NaN],
    ["zero", 0],
    ["negative", -2],
    ["infinite", Infinity],
  ])("a %s factor leaves the frame alone", (_name: string, factor: number) => {
    const start: MapViewport = clampViewport({
      x: 100,
      y: 50,
      width: 480,
      height: 250,
    });
    const result: MapViewport = zoomViewport(start, factor);
    if (Number.isFinite(factor) && factor > 0) {
      return;
    }
    expect(result).toEqual(start);
  });

  test("a non-finite focus falls back to the centre", () => {
    const start: MapViewport = clampViewport({
      x: 100,
      y: 50,
      width: 480,
      height: 250,
    });
    expect(zoomViewport(start, 2, point(Number.NaN, 10))).toEqual(
      zoomViewport(start, 2),
    );
  });
});

describe("panViewport", () => {
  test("slides the frame by the delta", () => {
    const start: MapViewport = clampViewport({
      x: 200,
      y: 100,
      width: 480,
      height: 250,
    });
    const panned: MapViewport = panViewport(start, 50, -30);
    expect(panned.x).toBe(250);
    expect(panned.y).toBe(70);
    expect(panned.width).toBe(start.width);
  });

  test("never escapes the world, however hard it is pushed", () => {
    const start: MapViewport = clampViewport({
      x: 200,
      y: 100,
      width: 480,
      height: 250,
    });
    for (const [dx, dy] of [
      [10_000, 10_000],
      [-10_000, -10_000],
      [10_000, -10_000],
    ]) {
      expectDrawable(panViewport(start, dx!, dy!));
    }
  });

  test("panning does not change the zoom", () => {
    const start: MapViewport = clampViewport({
      x: 200,
      y: 100,
      width: 240,
      height: 125,
    });
    expect(zoomOfViewport(panViewport(start, 1000, 1000))).toBeCloseTo(
      zoomOfViewport(start),
      9,
    );
  });

  test("the world cannot be panned — there is nowhere to go", () => {
    expect(panViewport(WORLD_VIEWPORT, 100, 100)).toEqual(WORLD_VIEWPORT);
    expect(panViewport(WORLD_VIEWPORT, -100, -100)).toEqual(WORLD_VIEWPORT);
  });

  test("non-finite deltas are treated as no movement", () => {
    const start: MapViewport = clampViewport({
      x: 200,
      y: 100,
      width: 480,
      height: 250,
    });
    expect(panViewport(start, Number.NaN, Infinity)).toEqual(start);
  });

  test("a pan and its inverse round-trip", () => {
    const start: MapViewport = clampViewport({
      x: 200,
      y: 100,
      width: 480,
      height: 250,
    });
    expect(
      viewportsMatch(panViewport(panViewport(start, 60, 20), -60, -20), start),
    ).toBe(true);
  });
});

describe("zoomOfViewport", () => {
  test("the world is zoom 1 and half the world is zoom 2", () => {
    expect(zoomOfViewport(WORLD_VIEWPORT)).toBe(1);
    expect(zoomOfViewport({ x: 0, y: 0, width: 480, height: 250 })).toBe(2);
  });

  test("a degenerate frame reads as zoom 1 rather than dividing by zero", () => {
    expect(zoomOfViewport({ x: 0, y: 0, width: 0, height: 0 })).toBe(1);
    expect(zoomOfViewport({ x: 0, y: 0, width: Number.NaN, height: 0 })).toBe(
      1,
    );
  });
});

describe("viewBoxOfViewport", () => {
  test("renders the four numbers an SVG viewBox wants", () => {
    expect(viewBoxOfViewport(WORLD_VIEWPORT)).toBe("0 0 960 500");
    expect(viewBoxOfViewport({ x: 100, y: 50, width: 480, height: 250 })).toBe(
      "100 50 480 250",
    );
  });

  test("clamps first, so a bad viewport can never reach the DOM", () => {
    expect(
      viewBoxOfViewport({ x: -50, y: -50, width: 99_999, height: 1 }),
    ).toBe("0 0 960 500");
  });
});

describe("viewportsMatch", () => {
  test("identical frames match", () => {
    expect(viewportsMatch(WORLD_VIEWPORT, { ...WORLD_VIEWPORT })).toBe(true);
  });

  test("floating-point noise from repeated zooms still matches", () => {
    const start: MapViewport = clampViewport({
      x: 200,
      y: 100,
      width: 240,
      height: 125,
    });
    let drifted: MapViewport = start;
    for (let i: number = 0; i < 6; i++) {
      drifted = zoomViewport(zoomViewport(drifted, 3), 1 / 3);
    }
    expect(viewportsMatch(drifted, start)).toBe(true);
  });

  test("a real difference does not match", () => {
    expect(
      viewportsMatch(WORLD_VIEWPORT, { x: 0, y: 0, width: 480, height: 250 }),
    ).toBe(false);
    expect(viewportsMatch(WORLD_VIEWPORT, { ...WORLD_VIEWPORT, x: 5 })).toBe(
      false,
    );
  });
});

describe("viewportContainsPoint and countPointsInViewport", () => {
  const frame: MapViewport = clampViewport({
    x: 100,
    y: 50,
    width: 480,
    height: 250,
  });

  test("inside, outside and exactly on the edge", () => {
    expect(viewportContainsPoint(frame, point(300, 150))).toBe(true);
    expect(viewportContainsPoint(frame, point(90, 150))).toBe(false);
    expect(viewportContainsPoint(frame, point(600, 150))).toBe(false);
    // Edges count as inside: the pin is drawn there.
    expect(viewportContainsPoint(frame, point(100, 50))).toBe(true);
    expect(
      viewportContainsPoint(frame, point(frame.x + frame.width, frame.y)),
    ).toBe(true);
  });

  test("a non-finite point is never inside", () => {
    expect(viewportContainsPoint(frame, point(Number.NaN, 150))).toBe(false);
    expect(viewportContainsPoint(frame, point(300, Infinity))).toBe(false);
  });

  test("the world contains every projected site", () => {
    const all: Array<ViewportPoint> = Object.values(CITIES);
    expect(countPointsInViewport(all, WORLD_VIEWPORT)).toBe(all.length);
  });

  /*
   * The footer count exists because zooming past a site silently drops it,
   * and a count that quietly shrinks reads as sites disappearing.
   */
  test("counts only what the frame actually shows", () => {
    const usOnly: MapViewport = fitViewportToPoints([
      CITIES["seattle"]!,
      CITIES["miami"]!,
    ]);
    const all: Array<ViewportPoint> = Object.values(CITIES);
    const inView: number = countPointsInViewport(all, usOnly);
    expect(inView).toBeGreaterThanOrEqual(2);
    expect(inView).toBeLessThan(all.length);
  });

  test("a fit always shows everything it was fitted to", () => {
    const points: Array<ViewportPoint> = [
      CITIES["mumbai"]!,
      CITIES["sydney"]!,
      CITIES["tokyo"]!,
    ];
    expect(countPointsInViewport(points, fitViewportToPoints(points))).toBe(
      points.length,
    );
  });
});

describe("shouldUseDetailGeometry", () => {
  test("the whole world draws the small overview outlines", () => {
    expect(shouldUseDetailGeometry(WORLD_VIEWPORT)).toBe(false);
  });

  test("switches exactly at the threshold zoom", () => {
    const atThreshold: MapViewport = clampViewport({
      x: 0,
      y: 0,
      width: WORLD_VIEWPORT.width / DETAIL_GEOMETRY_MIN_ZOOM,
      height: 0,
    });
    expect(shouldUseDetailGeometry(atThreshold)).toBe(true);

    const justBelow: MapViewport = clampViewport({
      x: 0,
      y: 0,
      width: WORLD_VIEWPORT.width / (DETAIL_GEOMETRY_MIN_ZOOM - 0.1),
      height: 0,
    });
    expect(shouldUseDetailGeometry(justBelow)).toBe(false);
  });

  test("the deepest zoom wants detail", () => {
    expect(
      shouldUseDetailGeometry(zoomViewport(WORLD_VIEWPORT, MAX_ZOOM)),
    ).toBe(true);
  });

  /*
   * A country-sized fit is what most customers open the page on. If that
   * did NOT pull the detail tier, the common case would be the chunky one —
   * which is the regression this whole tier system exists to prevent.
   */
  test("a single-country fit is detailed enough to want detail outlines", () => {
    expect(
      shouldUseDetailGeometry(
        fitViewportToPoints([CITIES["seattle"]!, CITIES["miami"]!]),
      ),
    ).toBe(true);
  });
});

describe("screenLengthToViewportLength", () => {
  test("at zoom 1 a screen length is a viewBox length", () => {
    expect(screenLengthToViewportLength(7, WORLD_VIEWPORT)).toBe(7);
  });

  test("shrinks with zoom, so markers stay the same size on screen", () => {
    const zoomed: MapViewport = zoomViewport(WORLD_VIEWPORT, 4);
    expect(screenLengthToViewportLength(8, zoomed)).toBeCloseTo(2, 9);
  });

  test("a non-finite length is zero rather than a broken attribute", () => {
    expect(screenLengthToViewportLength(Number.NaN, WORLD_VIEWPORT)).toBe(0);
    expect(screenLengthToViewportLength(Infinity, WORLD_VIEWPORT)).toBe(0);
  });

  test("a degenerate viewport does not produce a degenerate length", () => {
    expect(
      screenLengthToViewportLength(7, {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      }),
    ).toBe(7);
  });
});

/*
 * Nothing in this module — or anywhere the map reads from it — may reach a
 * state that cannot be drawn. These sweep the space rather than pick
 * examples.
 */
describe("every operation produces a drawable viewport", () => {
  const SEEDS: Array<MapViewport> = [
    WORLD_VIEWPORT,
    clampViewport({ x: 0, y: 0, width: 480, height: 250 }),
    clampViewport({ x: 700, y: 400, width: 100, height: 52 }),
    fitViewportToPoints([CITIES["london"]!, CITIES["berlin"]!]),
    fitViewportToPoints([CITIES["sydney"]!]),
  ];

  test.each(
    SEEDS.map((seed: MapViewport, index: number) => {
      return [index, seed] as [number, MapViewport];
    }),
  )(
    "seed %i survives a long random-ish walk",
    (_index: number, seed: MapViewport) => {
      let viewport: MapViewport = seed;
      // Deterministic pseudo-sequence: no Math.random in tests.
      for (let step: number = 1; step <= 60; step++) {
        const kind: number = step % 4;
        if (kind === 0) {
          viewport = zoomViewport(viewport, 1 + (step % 5) * 0.5);
        } else if (kind === 1) {
          viewport = zoomViewport(viewport, 1 / (1 + (step % 3)));
        } else if (kind === 2) {
          viewport = panViewport(viewport, step * 13, -step * 7);
        } else {
          viewport = panViewport(viewport, -step * 29, step * 11);
        }
        expectDrawable(viewport);
      }
    },
  );
});
