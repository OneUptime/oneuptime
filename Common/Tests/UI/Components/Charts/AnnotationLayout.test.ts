import { describe, expect, test } from "@jest/globals";
import ChartEventKind from "../../../../UI/Components/Charts/Types/ChartEventKind";
import FormattedReferenceRegion from "../../../../UI/Components/Charts/ChartLibrary/Types/FormattedReferenceRegion";
import FormattedTimeReferenceLine from "../../../../UI/Components/Charts/ChartLibrary/Types/FormattedTimeReferenceLine";
import {
  AxisTick,
  BARE_CHART_MARGIN_TOP,
  CategoryXResolver,
  MARKER_RAIL_HEIGHT,
  MarkerCluster,
  PositionedMarker,
  PositionedRegion,
  RAIL_GAP,
  REGION_RAIL_HEIGHT,
  SINGLE_MARKER_CHIP_SIZE,
  buildCategoryXResolver,
  clampHoverCardLeft,
  clusterMarkers,
  getChartMarginTop,
  getChipWidth,
  getMarkerRailY,
  getRailHeight,
  getRegionRailY,
  getRelativeLuminance,
  positionMarkers,
  positionRegions,
  toAnnotationColor,
  truncateLabelToWidth,
} from "../../../../UI/Components/Charts/ChartLibrary/Annotations/AnnotationLayout";

/*
 * The annotation rail's geometry, clustering and colour handling live in
 * this module precisely so they can be tested without a DOM: jsdom gives
 * recharts a 0x0 chart and gives us no text metrics, so anything that had
 * to measure would be untestable here.
 */

const PLOT: { x: number; y: number; width: number; height: number } = {
  x: 60,
  y: 40,
  width: 500,
  height: 200,
};

function marker(data: {
  bucketIndex: number;
  label?: string | undefined;
  color?: string | undefined;
  kind?: ChartEventKind | undefined;
  strokeDasharray?: string | undefined;
  onClick?: (() => void) | undefined;
}): FormattedTimeReferenceLine {
  return {
    formattedX: `bucket-${data.bucketIndex}`,
    bucketIndex: data.bucketIndex,
    original: {
      date: new Date("2026-03-02T00:00:00.000Z"),
      label: data.label ?? `event ${data.bucketIndex}`,
      color: data.color,
      kind: data.kind,
      strokeDasharray: data.strokeDasharray,
      onClick: data.onClick,
    },
  };
}

function region(data: {
  start: number;
  end: number;
  label?: string | undefined;
  color?: string | undefined;
}): FormattedReferenceRegion {
  return {
    formattedX1: `bucket-${data.start}`,
    formattedX2: `bucket-${data.end}`,
    startBucketIndex: data.start,
    endBucketIndex: data.end,
    original: {
      startDate: new Date("2026-03-02T00:00:00.000Z"),
      endDate: new Date("2026-03-02T01:00:00.000Z"),
      label: data.label,
      color: data.color,
    },
  };
}

function labels(count: number): Array<string> {
  return Array.from({ length: count }, (_unused: unknown, index: number) => {
    return `bucket-${index}`;
  });
}

function tick(index: number, coordinate: number, value?: string): AxisTick {
  return { index, coordinate, value: value ?? `bucket-${index}` };
}

describe("buildCategoryXResolver", () => {
  test("fits the point scale from two rendered ticks", () => {
    /*
     * recharts spaces categories evenly, so any two ticks recover the
     * whole line — including the axis padding already baked into their
     * coordinates.
     */
    const resolve: CategoryXResolver = buildCategoryXResolver({
      ticks: [tick(0, 80), tick(48, 326), tick(96, 572)],
      categoryLabels: labels(97),
      plotArea: PLOT,
      axisPaddingPx: 20,
      scaleKind: "point",
    });

    expect(resolve(0)).toBe(80);
    expect(resolve(48)).toBe(326);
    expect(resolve(96)).toBe(572);
    // An index between ticks interpolates on the same line.
    expect(resolve(24)).toBeCloseTo(203, 6);
  });

  test("a repeated label does not stop it resolving — the whole point", () => {
    /*
     * A 48h window at 30-minute buckets formats bare HH:mm, so every label
     * appears twice. recharts' categorical scale refuses to resolve ANY
     * label on such a domain, which is why positions come from indices.
     */
    const repeated: Array<string> = [
      ...labels(48).map((_unused: string, index: number) => {
        return `${index}:00`;
      }),
      ...labels(48).map((_unused: string, index: number) => {
        return `${index}:00`;
      }),
    ];

    const resolve: CategoryXResolver = buildCategoryXResolver({
      ticks: [tick(0, 80, "0:00"), tick(90, 530, "42:00")],
      categoryLabels: repeated,
      plotArea: PLOT,
      axisPaddingPx: 20,
      scaleKind: "point",
    });

    const dayOne: number | null = resolve(12);
    const dayTwo: number | null = resolve(60);
    expect(dayOne).not.toBeNull();
    expect(dayTwo).not.toBeNull();
    // Same label, different index — and therefore a different position.
    expect(repeated[12]).toBe(repeated[60]);
    expect(dayTwo).toBeGreaterThan(dayOne!);
  });

  test("indices outside the axis resolve to null", () => {
    const resolve: CategoryXResolver = buildCategoryXResolver({
      ticks: [tick(0, 80), tick(9, 530)],
      categoryLabels: labels(10),
      plotArea: PLOT,
      axisPaddingPx: 20,
      scaleKind: "point",
    });

    expect(resolve(-1)).toBeNull();
    expect(resolve(10)).toBeNull();
    expect(resolve(9)).toBe(530);
  });

  test("ticks whose value no longer names their row are not fitted on", () => {
    /*
     * `startEndOnly` hands recharts synthetic explicit ticks. Fitting on
     * one whose index does not address the row it names would skew every
     * marker, so the resolver drops to plot geometry instead.
     */
    const resolve: CategoryXResolver = buildCategoryXResolver({
      ticks: [tick(0, 80, "not-the-row"), tick(9, 530, "also-wrong")],
      categoryLabels: labels(10),
      plotArea: PLOT,
      axisPaddingPx: 20,
      scaleKind: "point",
    });

    // Analytic point-scale geometry: 60 + 20 .. 60 + 500 - 20.
    expect(resolve(0)).toBe(80);
    expect(resolve(9)).toBe(540);
  });

  test("falls back to point geometry with no ticks at all", () => {
    const resolve: CategoryXResolver = buildCategoryXResolver({
      ticks: undefined,
      categoryLabels: labels(11),
      plotArea: PLOT,
      axisPaddingPx: 20,
      scaleKind: "point",
    });

    expect(resolve(0)).toBe(80);
    expect(resolve(10)).toBe(540);
    expect(resolve(5)).toBe(310);
  });

  test("falls back to band geometry for bar charts", () => {
    /*
     * A band scale gives each category a band and sits it at the centre,
     * so neither the first nor the last category touches the plot edge.
     */
    const resolve: CategoryXResolver = buildCategoryXResolver({
      ticks: [],
      categoryLabels: labels(10),
      plotArea: PLOT,
      axisPaddingPx: 0,
      scaleKind: "band",
    });

    expect(resolve(0)).toBe(85); // 60 + 0.5 * 50
    expect(resolve(9)).toBe(535); // 60 + 9.5 * 50
  });

  test("a single category centres in the plot rather than dividing by zero", () => {
    const resolve: CategoryXResolver = buildCategoryXResolver({
      ticks: [],
      categoryLabels: labels(1),
      plotArea: PLOT,
      axisPaddingPx: 20,
      scaleKind: "point",
    });

    expect(resolve(0)).toBe(310);
  });

  test("a single tick cannot define a step, so geometry wins", () => {
    const resolve: CategoryXResolver = buildCategoryXResolver({
      ticks: [tick(3, 999)],
      categoryLabels: labels(11),
      plotArea: PLOT,
      axisPaddingPx: 20,
      scaleKind: "point",
    });

    expect(resolve(0)).toBe(80);
  });

  test("a zero-width plot never yields NaN", () => {
    const resolve: CategoryXResolver = buildCategoryXResolver({
      ticks: [],
      categoryLabels: labels(10),
      plotArea: { x: 0, y: 0, width: 0, height: 0 },
      axisPaddingPx: 20,
      scaleKind: "point",
    });

    expect(Number.isFinite(resolve(0))).toBe(true);
  });
});

describe("positionMarkers", () => {
  const resolve: CategoryXResolver = buildCategoryXResolver({
    ticks: [tick(0, 100), tick(10, 500)],
    categoryLabels: labels(11),
    plotArea: PLOT,
    axisPaddingPx: 20,
    scaleKind: "point",
  });

  test("resolves markers to pixels and sorts them left to right", () => {
    const positioned: Array<PositionedMarker> = positionMarkers({
      markers: [
        marker({ bucketIndex: 8 }),
        marker({ bucketIndex: 1 }),
        marker({ bucketIndex: 5 }),
      ],
      resolveX: resolve,
    });

    expect(
      positioned.map((entry: PositionedMarker) => {
        return entry.categoryIndex;
      }),
    ).toEqual([1, 5, 8]);
    expect(positioned[0]!.xPixel).toBe(140);
  });

  test("drops markers whose bucket is off the axis", () => {
    /*
     * A window change can outrun the annotations by a render; a marker
     * pointing at a bucket that no longer exists is skipped rather than
     * drawn at NaN.
     */
    const positioned: Array<PositionedMarker> = positionMarkers({
      markers: [marker({ bucketIndex: 99 }), marker({ bucketIndex: 2 })],
      resolveX: resolve,
    });

    expect(positioned).toHaveLength(1);
    expect(positioned[0]!.categoryIndex).toBe(2);
  });

  test("an empty marker list positions nothing", () => {
    expect(positionMarkers({ markers: [], resolveX: resolve })).toEqual([]);
  });
});

describe("clusterMarkers", () => {
  function at(xPixel: number): PositionedMarker {
    return {
      xPixel,
      categoryIndex: xPixel,
      marker: marker({ bucketIndex: xPixel }),
    };
  }

  test("markers far apart each keep their own chip", () => {
    const clusters: Array<MarkerCluster> = clusterMarkers({
      positioned: [at(100), at(200), at(300)],
    });

    expect(clusters).toHaveLength(3);
    expect(
      clusters.map((cluster: MarkerCluster) => {
        return cluster.markers.length;
      }),
    ).toEqual([1, 1, 1]);
  });

  test("markers inside the separation collapse into one counted chip", () => {
    const clusters: Array<MarkerCluster> = clusterMarkers({
      positioned: [at(100), at(104), at(110), at(300)],
      separationPx: 18,
    });

    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.markers).toHaveLength(3);
    // The chip sits on a real event, not on the average of several.
    expect(clusters[0]!.xPixel).toBe(100);
    expect(clusters[1]!.markers).toHaveLength(1);
  });

  test("a dense window widens the separation until the chips fit", () => {
    /*
     * 60 markers evenly spread over 600px are 10px apart: at the default
     * separation that is 60 chips, which is a comb, not a rail.
     */
    const positioned: Array<PositionedMarker> = Array.from(
      { length: 60 },
      (_unused: unknown, index: number) => {
        return at(index * 10);
      },
    );

    const clusters: Array<MarkerCluster> = clusterMarkers({
      positioned,
      maxClusters: 12,
    });

    expect(clusters.length).toBeLessThanOrEqual(12);
    // Nothing is dropped — every marker is still reachable through a chip.
    expect(
      clusters.reduce((total: number, cluster: MarkerCluster) => {
        return total + cluster.markers.length;
      }, 0),
    ).toBe(60);
  });

  test("markers stacked on one pixel collapse however many there are", () => {
    const positioned: Array<PositionedMarker> = Array.from(
      { length: 40 },
      () => {
        return at(250);
      },
    );

    const clusters: Array<MarkerCluster> = clusterMarkers({ positioned });

    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.markers).toHaveLength(40);
  });

  test("a cluster takes the colour of the most serious thing in it", () => {
    const clusters: Array<MarkerCluster> = clusterMarkers({
      positioned: [
        {
          xPixel: 100,
          categoryIndex: 1,
          marker: marker({
            bucketIndex: 1,
            kind: ChartEventKind.Change,
            color: "#6366f1",
          }),
        },
        {
          xPixel: 104,
          categoryIndex: 2,
          marker: marker({
            bucketIndex: 2,
            kind: ChartEventKind.Incident,
            color: "#f87171",
          }),
        },
        {
          xPixel: 106,
          categoryIndex: 3,
          marker: marker({
            bucketIndex: 3,
            kind: ChartEventKind.Alert,
            color: "#fbbf24",
          }),
        },
      ],
    });

    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.kind).toBe(ChartEventKind.Incident);
    expect(clusters[0]!.color).toBe("#f87171");
  });

  test("a mixed cluster draws solid — dashes mean change event", () => {
    const clusters: Array<MarkerCluster> = clusterMarkers({
      positioned: [
        {
          xPixel: 100,
          categoryIndex: 1,
          marker: marker({ bucketIndex: 1, strokeDasharray: "4 4" }),
        },
        {
          xPixel: 104,
          categoryIndex: 2,
          marker: marker({ bucketIndex: 2 }),
        },
      ],
    });

    expect(clusters[0]!.strokeDasharray).toBeUndefined();
  });

  test("a cluster of only change events keeps its dashes", () => {
    const clusters: Array<MarkerCluster> = clusterMarkers({
      positioned: [
        {
          xPixel: 100,
          categoryIndex: 1,
          marker: marker({ bucketIndex: 1, strokeDasharray: "4 4" }),
        },
        {
          xPixel: 104,
          categoryIndex: 2,
          marker: marker({ bucketIndex: 2, strokeDasharray: "4 4" }),
        },
      ],
    });

    expect(clusters[0]!.strokeDasharray).toBe("4 4");
  });

  test("cluster ids survive a resize", () => {
    /*
     * A pixel-keyed id would remount the rail on every frame of a window
     * drag and drop any open hover card with it.
     */
    const before: Array<MarkerCluster> = clusterMarkers({
      positioned: [at(100), at(300)],
    });
    const after: Array<MarkerCluster> = clusterMarkers({
      positioned: [
        {
          xPixel: 150,
          categoryIndex: 100,
          marker: marker({ bucketIndex: 100 }),
        },
        {
          xPixel: 450,
          categoryIndex: 300,
          marker: marker({ bucketIndex: 300 }),
        },
      ],
    });

    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[1]!.id).toBe(before[1]!.id);
  });

  test("no markers means no clusters", () => {
    expect(clusterMarkers({ positioned: [] })).toEqual([]);
  });
});

describe("positionRegions", () => {
  const resolve: CategoryXResolver = buildCategoryXResolver({
    ticks: [tick(0, 100), tick(10, 500)],
    categoryLabels: labels(11),
    plotArea: PLOT,
    axisPaddingPx: 20,
    scaleKind: "point",
  });

  test("resolves a span to its pixel edges", () => {
    const positioned: Array<PositionedRegion> = positionRegions({
      regions: [region({ start: 2, end: 6, label: "Maintenance" })],
      resolveX: resolve,
    });

    expect(positioned).toHaveLength(1);
    expect(positioned[0]!.x1).toBe(180);
    expect(positioned[0]!.x2).toBe(340);
  });

  test("reversed endpoints are ordered rather than inverted", () => {
    const positioned: Array<PositionedRegion> = positionRegions({
      regions: [region({ start: 6, end: 2 })],
      resolveX: resolve,
    });

    expect(positioned[0]!.x1).toBeLessThan(positioned[0]!.x2);
  });

  test("a region collapsed onto one bucket still gets drawable width", () => {
    const positioned: Array<PositionedRegion> = positionRegions({
      regions: [region({ start: 4, end: 4 })],
      resolveX: resolve,
      minWidthPx: 2,
    });

    expect(positioned[0]!.x2 - positioned[0]!.x1).toBe(2);
  });

  test("a region whose buckets left the axis is dropped", () => {
    const positioned: Array<PositionedRegion> = positionRegions({
      regions: [region({ start: 40, end: 60 })],
      resolveX: resolve,
    });

    expect(positioned).toEqual([]);
  });
});

describe("rail geometry", () => {
  test("nothing to draw costs the plot nothing", () => {
    expect(getRailHeight({ hasMarkers: false, hasRegions: false })).toBe(0);
    expect(
      getChartMarginTop({
        hasMarkers: false,
        hasRegions: false,
        hasTopLegend: false,
      }),
    ).toBe(BARE_CHART_MARGIN_TOP);
  });

  test("markers alone need one strip, markers plus regions need two", () => {
    const markersOnly: number = getRailHeight({
      hasMarkers: true,
      hasRegions: false,
    });
    const both: number = getRailHeight({ hasMarkers: true, hasRegions: true });

    expect(markersOnly).toBe(MARKER_RAIL_HEIGHT + RAIL_GAP);
    expect(both).toBe(markersOnly + REGION_RAIL_HEIGHT + RAIL_GAP);
  });

  test("a top legend buys the rail its strip, so the margin stays bare", () => {
    /*
     * recharts lays a top-aligned legend out between the margin and the
     * plot. Growing the margin would put the rail ABOVE the legend; the
     * legend's own height is padded instead.
     */
    expect(
      getChartMarginTop({
        hasMarkers: true,
        hasRegions: true,
        hasTopLegend: true,
      }),
    ).toBe(BARE_CHART_MARGIN_TOP);
  });

  test("with no legend the margin has to carry the rail itself", () => {
    const railHeight: number = getRailHeight({
      hasMarkers: true,
      hasRegions: true,
    });

    expect(
      getChartMarginTop({
        hasMarkers: true,
        hasRegions: true,
        hasTopLegend: false,
      }),
    ).toBe(railHeight);
  });

  test("both rail strips sit above the plot, region strip on top", () => {
    const plotTop: number = 90;

    expect(getMarkerRailY(plotTop)).toBeLessThan(plotTop);
    expect(getRegionRailY(plotTop)).toBeLessThan(getMarkerRailY(plotTop));
    // Nothing pokes above the space the margin/legend reserved.
    expect(plotTop - getRegionRailY(plotTop)).toBe(
      getRailHeight({ hasMarkers: true, hasRegions: true }),
    );
  });

  test("too little headroom slides the rail down instead of off-canvas", () => {
    /*
     * The chart reserves the rail's strip through its margin or its legend
     * padding, but a legend that reports no height at all would leave the
     * rail hanging above the SVG's own edge, where it is clipped away and
     * the feature simply vanishes. Overlapping is the better failure.
     */
    expect(getMarkerRailY(2)).toBe(0);
    expect(getRegionRailY(2)).toBe(0);
    expect(getMarkerRailY(0)).toBe(0);
  });

  test("a single-marker chip is round; a counted chip widens with its digits", () => {
    expect(getChipWidth(1)).toBe(SINGLE_MARKER_CHIP_SIZE);
    expect(getChipWidth(0)).toBe(SINGLE_MARKER_CHIP_SIZE);
    expect(getChipWidth(9)).toBeGreaterThan(getChipWidth(1));
    expect(getChipWidth(12)).toBeGreaterThan(getChipWidth(9));
    expect(getChipWidth(120)).toBeGreaterThan(getChipWidth(12));
  });
});

describe("clampHoverCardLeft", () => {
  test("centres on its chip when there is room", () => {
    expect(
      clampHoverCardLeft({ anchorX: 400, cardWidth: 288, chartWidth: 900 }),
    ).toBe(256);
  });

  test("slides back in rather than hanging off the left edge", () => {
    expect(
      clampHoverCardLeft({ anchorX: 20, cardWidth: 288, chartWidth: 900 }),
    ).toBe(4);
  });

  test("slides back in rather than hanging off the right edge", () => {
    expect(
      clampHoverCardLeft({ anchorX: 890, cardWidth: 288, chartWidth: 900 }),
    ).toBe(608);
  });

  test("a card wider than the chart pins to the left so its start reads", () => {
    expect(
      clampHoverCardLeft({ anchorX: 100, cardWidth: 288, chartWidth: 200 }),
    ).toBe(4);
  });
});

describe("truncateLabelToWidth", () => {
  test("a label that fits is returned untouched", () => {
    expect(
      truncateLabelToWidth({
        label: "Maintenance",
        maxWidthPx: 400,
        fontSizePx: 9,
      }),
    ).toBe("Maintenance");
  });

  test("a label that does not fit ends in an ellipsis", () => {
    const shown: string | null = truncateLabelToWidth({
      label: "Scheduled maintenance window",
      maxWidthPx: 40,
      fontSizePx: 9,
    });

    expect(shown).not.toBeNull();
    expect(shown!.endsWith("…")).toBe(true);
    expect(shown!.length).toBeLessThan("Scheduled maintenance window".length);
  });

  test("too narrow for even a stub gives nothing, not a one-letter label", () => {
    expect(
      truncateLabelToWidth({
        label: "Maintenance",
        maxWidthPx: 4,
        fontSizePx: 9,
      }),
    ).toBeNull();
    expect(
      truncateLabelToWidth({
        label: "Maintenance",
        maxWidthPx: -20,
        fontSizePx: 9,
      }),
    ).toBeNull();
  });

  test("a zero font size cannot divide by zero", () => {
    expect(
      truncateLabelToWidth({
        label: "Maintenance",
        maxWidthPx: 40,
        fontSizePx: 0,
      }),
    ).toBeNull();
  });
});

describe("toAnnotationColor", () => {
  /*
   * Severity colours are project-editable rows, and the chart surface
   * flips with the theme, so a marker colour has to be legible on both
   * without knowing which one it is on.
   */

  test("colours already in the readable band pass through untouched", () => {
    expect(toAnnotationColor("#f87171")).toBe("#f87171");
    expect(toAnnotationColor("#6366f1")).toBe("#6366f1");
  });

  test("a near-white severity is darkened until it reads on white", () => {
    const clamped: string = toAnnotationColor("#fffbea");

    expect(clamped).not.toBe("#fffbea");
    expect(getRelativeLuminance(clamped)!).toBeLessThanOrEqual(
      getRelativeLuminance("#fffbea")!,
    );
    expect(getRelativeLuminance(clamped)!).toBeLessThan(0.65);
  });

  test("a near-black severity is lightened until it reads on the dark surface", () => {
    const clamped: string = toAnnotationColor("#050505");

    expect(clamped).not.toBe("#050505");
    expect(getRelativeLuminance(clamped)!).toBeGreaterThan(
      getRelativeLuminance("#050505")!,
    );
  });

  test("clamping is idempotent — a clamped colour is already in band", () => {
    const once: string = toAnnotationColor("#ffffff");
    expect(toAnnotationColor(once)).toBe(once);
  });

  test("the clamped colour is itself inside the band", () => {
    /*
     * The search has to return the last blend that LANDED in the band, not
     * the last one it probed — otherwise clamping a clamped colour moves it
     * again, and two markers of the same severity could differ.
     */
    for (const input of [
      "#ffffff",
      "#fffbea",
      "#050505",
      "#000000",
      "#fefefe",
      "#0a0a0a",
    ]) {
      const clamped: string = toAnnotationColor(input);
      const luminance: number | null = getRelativeLuminance(clamped);
      expect(luminance).not.toBeNull();
      expect(luminance!).toBeGreaterThanOrEqual(0.09);
      expect(luminance!).toBeLessThanOrEqual(0.62);
      expect(toAnnotationColor(clamped)).toBe(clamped);
    }
  });

  test("hue survives the clamp: a red severity stays red", () => {
    const clamped: string = toAnnotationColor("#ffe5e5");
    const red: number = parseInt(clamped.slice(1, 3), 16);
    const blue: number = parseInt(clamped.slice(5, 7), 16);

    expect(red).toBeGreaterThan(blue);
  });

  test("shorthand hex is understood", () => {
    expect(toAnnotationColor("#f00")).toBe("#f00");
    expect(getRelativeLuminance("#fff")).toBeCloseTo(1, 5);
  });

  test("anything that is not a plain hex is the caller's to own", () => {
    // A CSS var or a named colour cannot be measured; guessing is worse.
    expect(toAnnotationColor("var(--ou-chart-tick)")).toBe(
      "var(--ou-chart-tick)",
    );
    expect(toAnnotationColor("rebeccapurple")).toBe("rebeccapurple");
    expect(getRelativeLuminance("not a colour")).toBeNull();
  });
});
