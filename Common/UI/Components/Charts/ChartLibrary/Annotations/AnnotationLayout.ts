import ChartEventKind from "../../Types/ChartEventKind";
import FormattedReferenceRegion from "../Types/FormattedReferenceRegion";
import FormattedTimeReferenceLine from "../Types/FormattedTimeReferenceLine";

/*
 * Geometry for the annotation rail, in SVG user units. recharts sizes its
 * <svg> in CSS pixels with no viewBox scaling, so these are also CSS
 * pixels — which is what lets the HTML hover card be positioned from the
 * same numbers the SVG chips are drawn with.
 */

/** Height of the strip that holds region pills, when any region exists. */
export const REGION_RAIL_HEIGHT: number = 13;

/** Height of the strip that holds event chips. */
export const MARKER_RAIL_HEIGHT: number = 16;

/** Gap between the two strips, and between the rail and the plot. */
export const RAIL_GAP: number = 4;

/** The chart's own `margin.top` when it carries no annotations. */
export const BARE_CHART_MARGIN_TOP: number = 5;

/** Diameter of the chip drawn for a cluster holding exactly one marker. */
export const SINGLE_MARKER_CHIP_SIZE: number = 13;

/** Width of a counted chip, per digit in the count. */
export const CHIP_WIDTH_PER_DIGIT: number = 7;

/** Base width a counted chip gets before its digits are added. */
export const COUNTED_CHIP_BASE_WIDTH: number = 11;

/*
 * Two chips closer than this collapse into one. Sized so neighbouring
 * chips keep a visible gap at the widest single-marker chip.
 */
export const DEFAULT_CLUSTER_SEPARATION_PX: number = 18;

/*
 * A chart wider than a phone still cannot carry more chips than this
 * without them reading as noise; past it the separation widens until the
 * count fits. Chosen so the busiest realistic window (the event overlay
 * fetches up to 50 of each source) still resolves in a few passes.
 */
export const MAX_CLUSTERS: number = 22;

/** Each widening pass multiplies the separation by this much. */
const CLUSTER_SEPARATION_GROWTH: number = 1.6;

/** Bounded so a pathological chart cannot spin here. */
const MAX_CLUSTER_PASSES: number = 8;

/*
 * Fallback marker colours, matched to the app's event overlay so a caller
 * that sets `kind` but no `color` still gets the familiar palette.
 */
export const KIND_COLORS: Record<ChartEventKind, string> = {
  [ChartEventKind.Incident]: "#f87171", // red-400
  [ChartEventKind.Alert]: "#fbbf24", // amber-400
  [ChartEventKind.Change]: "#6366f1", // indigo-500
  [ChartEventKind.Generic]: "#64748b", // slate-500
};

/*
 * Which kind speaks for a cluster: the chip takes the colour of the most
 * serious thing inside it, so a deploy sharing a bucket with an incident
 * never paints the cluster indigo.
 */
const KIND_PRIORITY: Record<ChartEventKind, number> = {
  [ChartEventKind.Incident]: 3,
  [ChartEventKind.Alert]: 2,
  [ChartEventKind.Change]: 1,
  [ChartEventKind.Generic]: 0,
};

export interface PositionedMarker {
  /** Centre of the marker's x-axis bucket, in SVG user units. */
  xPixel: number;
  /** Index into the chart's category list — ties break on it, so stable. */
  categoryIndex: number;
  marker: FormattedTimeReferenceLine;
}

export interface MarkerCluster {
  /** Stable across renders for the same data — used as the hover key. */
  id: string;
  /** Where the chip and hairline are drawn. */
  xPixel: number;
  /** The x-axis label the cluster sits on, for the hover card heading. */
  formattedX: string;
  markers: Array<FormattedTimeReferenceLine>;
  /** Colour of the chip and hairline. */
  color: string;
  /** Set when every marker in the cluster asked for a dashed line. */
  strokeDasharray: string | undefined;
  kind: ChartEventKind;
}

export interface PositionedRegion {
  id: string;
  /** Left edge in SVG user units, already ordered so x1 <= x2. */
  x1: number;
  /** Right edge in SVG user units. */
  x2: number;
  color: string;
  region: FormattedReferenceRegion;
}

/** Maps a category index to its pixel x on the chart's x-axis. */
export type CategoryXResolver = (categoryIndex: number) => number | null;

/** The (index, coordinate) pairs recharts reports for the rendered ticks. */
export interface AxisTick {
  value: unknown;
  coordinate: number;
  index: number;
}

export interface PlotBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How recharts lays the categories out. Line and area charts use a point
 * scale (categories sit on evenly spaced points, first and last on the
 * edges); bar charts use a band scale (each category owns a band and sits
 * at its centre). Only the no-ticks fallback needs to tell them apart.
 */
export type CategoryScaleKind = "point" | "band";

/**
 * Build the index-to-pixel mapping the rail is drawn from.
 *
 * recharts' categorical scale is a point scale, so category positions are
 * exactly linear in index; two rendered ticks are enough to recover the
 * whole line, padding included. Going through the ticks rather than
 * through `scale(label)` is what makes the rail survive a repeated label —
 * the scale refuses to resolve any label at all once its domain holds a
 * duplicate, which a sub-hour axis over a multi-day window always does.
 *
 * Falls back to plot geometry when the ticks cannot be trusted: a chart
 * showing only its first and last tick, or a tick whose value no longer
 * matches the row it indexes, would otherwise fit a wrong line.
 */
export function buildCategoryXResolver(data: {
  ticks: ReadonlyArray<AxisTick> | undefined;
  categoryLabels: Array<string>;
  plotArea: PlotBox;
  /** The chart's `XAxis padding`, which tick coordinates already include. */
  axisPaddingPx: number;
  scaleKind: CategoryScaleKind;
}): CategoryXResolver {
  const categoryCount: number = data.categoryLabels.length;

  const usable: Array<AxisTick> = (data.ticks || []).filter(
    (tick: AxisTick): boolean => {
      return (
        Number.isFinite(tick.coordinate) &&
        Number.isInteger(tick.index) &&
        tick.index >= 0 &&
        tick.index < categoryCount &&
        /*
         * `startEndOnly` hands recharts synthetic explicit ticks whose
         * index does not address the row it names; fitting on those would
         * skew every marker.
         */
        tick.value === data.categoryLabels[tick.index]
      );
    },
  );

  const first: AxisTick | undefined = usable[0];
  const last: AxisTick | undefined = usable[usable.length - 1];

  if (first && last && last.index !== first.index) {
    const step: number =
      (last.coordinate - first.coordinate) / (last.index - first.index);
    return (categoryIndex: number): number | null => {
      if (categoryIndex < 0 || categoryIndex >= categoryCount) {
        return null;
      }
      return first.coordinate + (categoryIndex - first.index) * step;
    };
  }

  // Analytic fallback: the same scale geometry, derived by hand.
  return (categoryIndex: number): number | null => {
    if (categoryIndex < 0 || categoryIndex >= categoryCount) {
      return null;
    }
    const innerWidth: number = data.plotArea.width - data.axisPaddingPx * 2;
    if (categoryCount === 0 || innerWidth <= 0) {
      return data.plotArea.x + data.plotArea.width / 2;
    }
    const innerLeft: number = data.plotArea.x + data.axisPaddingPx;

    if (data.scaleKind === "band") {
      const bandWidth: number = innerWidth / categoryCount;
      return innerLeft + (categoryIndex + 0.5) * bandWidth;
    }

    if (categoryCount === 1) {
      return data.plotArea.x + data.plotArea.width / 2;
    }
    const step: number = innerWidth / (categoryCount - 1);
    return innerLeft + categoryIndex * step;
  };
}

/*
 * Severity colours are project-editable rows, so a marker can arrive in
 * near-white or near-black. The chart surface flips with the theme and SVG
 * cannot ask which one it is on, so instead of picking a contrasting
 * colour per theme we pull every marker colour into a mid band that is
 * legible on both: light enough to read on the dark surface (#172033),
 * dark enough to read on the light one (#ffffff). Hue and saturation are
 * preserved, so a red severity still reads as red.
 */

/** Relative luminance floor, so a marker cannot vanish on white. */
const MIN_ANNOTATION_LUMINANCE: number = 0.09;

/** Relative luminance ceiling, so a marker cannot vanish on the dark surface. */
const MAX_ANNOTATION_LUMINANCE: number = 0.62;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHexColor(color: string): Rgb | null {
  const match: RegExpMatchArray | null = color
    .trim()
    .match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }
  const digits: string = match[1]!;
  const full: string =
    digits.length === 3
      ? digits
          .split("")
          .map((digit: string): string => {
            return digit + digit;
          })
          .join("")
      : digits;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function toHexChannel(value: number): string {
  const clamped: number = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0");
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function getRelativeLuminance(color: string): number | null {
  const rgb: Rgb | null = parseHexColor(color);
  if (!rgb) {
    return null;
  }
  const channel: (raw: number) => number = (raw: number): number => {
    const value: number = raw / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  );
}

/**
 * Pull a caller's colour into the band that reads on both themes. Colours
 * already inside the band are returned untouched, and anything that is not
 * a plain hex (a CSS var, a named colour) is passed through — the caller
 * owns it, and guessing at its luminance would be worse than trusting it.
 */
export function toAnnotationColor(color: string): string {
  const rgb: Rgb | null = parseHexColor(color);
  if (!rgb) {
    return color;
  }
  const luminance: number | null = getRelativeLuminance(color);
  if (luminance === null) {
    return color;
  }
  if (
    luminance >= MIN_ANNOTATION_LUMINANCE &&
    luminance <= MAX_ANNOTATION_LUMINANCE
  ) {
    return color;
  }

  /*
   * Blend toward black or white until the luminance lands on the boundary.
   * Luminance is not linear in sRGB, so the blend ratio is approximated and
   * then verified — a handful of steps is plenty and keeps this pure.
   */
  const towardWhite: boolean = luminance < MIN_ANNOTATION_LUMINANCE;
  const target: number = towardWhite
    ? MIN_ANNOTATION_LUMINANCE
    : MAX_ANNOTATION_LUMINANCE;
  const anchor: number = towardWhite ? 255 : 0;

  /*
   * Binary search on the blend ratio, keeping the last blend that actually
   * landed inside the band. Returning the last PROBE instead would hand
   * back a colour a hair outside it, which makes the function
   * non-idempotent — clamping a clamped colour would move it again.
   */
  let low: number = 0;
  let high: number = 1;
  let best: string | null = null;
  for (let step: number = 0; step < 14; step++) {
    const ratio: number = (low + high) / 2;
    const blended: string = `#${toHexChannel(
      rgb.r + (anchor - rgb.r) * ratio,
    )}${toHexChannel(rgb.g + (anchor - rgb.g) * ratio)}${toHexChannel(
      rgb.b + (anchor - rgb.b) * ratio,
    )}`;
    const blendedLuminance: number | null = getRelativeLuminance(blended);
    if (blendedLuminance === null) {
      break;
    }
    if (
      blendedLuminance >= MIN_ANNOTATION_LUMINANCE &&
      blendedLuminance <= MAX_ANNOTATION_LUMINANCE
    ) {
      best = blended;
    }
    if (towardWhite === blendedLuminance < target) {
      low = ratio;
    } else {
      high = ratio;
    }
  }

  /*
   * A hue so saturated that no blend along this axis lands in the band
   * (a pure primary, say) keeps its own colour — a wrong colour would be
   * a worse answer than a slightly out-of-band one.
   */
  return best ?? color;
}

export function getMarkerKind(
  marker: FormattedTimeReferenceLine,
): ChartEventKind {
  return marker.original.kind || ChartEventKind.Generic;
}

export function getMarkerColor(marker: FormattedTimeReferenceLine): string {
  return toAnnotationColor(
    marker.original.color || KIND_COLORS[getMarkerKind(marker)]!,
  );
}

/**
 * Total vertical space the rail needs above the plot, including the gap
 * that separates it from the topmost gridline. Zero when there is nothing
 * to draw, so an un-annotated chart keeps every pixel of its plot.
 */
export function getRailHeight(data: {
  hasMarkers: boolean;
  hasRegions: boolean;
}): number {
  if (!data.hasMarkers && !data.hasRegions) {
    return 0;
  }
  let height: number = 0;
  if (data.hasRegions) {
    height += REGION_RAIL_HEIGHT + RAIL_GAP;
  }
  if (data.hasMarkers) {
    height += MARKER_RAIL_HEIGHT;
  }
  return height + RAIL_GAP;
}

/**
 * The chart's `margin.top`.
 *
 * The rail needs a clear strip between the chart's top edge and the plot.
 * A top-aligned legend already sits in that gap and is laid out from its
 * own reserved height, so when there is one the strip is bought by padding
 * that height instead (see `getRailHeight`'s caller) and the margin stays
 * at its bare value. With no legend the margin is the only thing between
 * the SVG edge and the plot, so it has to carry the rail itself —
 * otherwise chips render above the SVG's own top edge and are clipped.
 */
export function getChartMarginTop(data: {
  hasMarkers: boolean;
  hasRegions: boolean;
  hasTopLegend: boolean;
}): number {
  if (data.hasTopLegend) {
    return BARE_CHART_MARGIN_TOP;
  }
  const railHeight: number = getRailHeight(data);
  if (railHeight === 0) {
    return BARE_CHART_MARGIN_TOP;
  }
  return Math.max(BARE_CHART_MARGIN_TOP, railHeight);
}

/*
 * The rail hangs off the plot's top edge, so it needs `plotTop` to be at
 * least `getRailHeight()` — which the chart guarantees through its margin
 * or its legend padding. When something upstream reports less headroom
 * than that (a legend that measures as zero-height, for instance), the
 * rows slide down to the chart's own top edge rather than off it: an
 * overlapping rail is a cosmetic problem, an invisible one is a missing
 * feature.
 */
function clampRailTop(desiredTop: number): number {
  return Math.max(0, desiredTop);
}

/**
 * Top edge of the region pill strip, given where the plot starts.
 *
 * `hasMarkers` is not cosmetic: the strip is measured down from the top of
 * the reserved rail, and a regions-only chart reserves one row less than a
 * chart carrying both, so assuming the marker strip is there would float
 * the pill a row above the space the chart actually made for it.
 */
export function getRegionRailY(
  plotTop: number,
  hasMarkers: boolean = true,
): number {
  return clampRailTop(
    plotTop - getRailHeight({ hasMarkers, hasRegions: true }),
  );
}

/**
 * Top edge of the event chip strip. Sits directly above the plot whether
 * or not the region strip is present.
 */
export function getMarkerRailY(plotTop: number): number {
  return clampRailTop(plotTop - RAIL_GAP - MARKER_RAIL_HEIGHT);
}

/*
 * SVG has no text-overflow, so a label that outgrows its pill has to be cut
 * by hand. Average glyph advance for the app's UI font, as a fraction of
 * the font size — close enough at 9px that the ellipsis lands within a
 * character of the true break, and the pill's clip path covers the rest.
 */
const AVERAGE_GLYPH_WIDTH_RATIO: number = 0.55;

/** Room the ellipsis itself needs, in glyph widths. */
const ELLIPSIS_GLYPHS: number = 1;

/**
 * Cut a label to what fits in `maxWidthPx`, ending in an ellipsis when
 * anything was dropped. Returns null when not even one character fits —
 * the caller then draws the pill bare and leaves the name to the hover
 * card, which reads better than a one-letter stub.
 */
export function truncateLabelToWidth(data: {
  label: string;
  maxWidthPx: number;
  fontSizePx: number;
}): string | null {
  const glyphWidth: number = data.fontSizePx * AVERAGE_GLYPH_WIDTH_RATIO;
  if (glyphWidth <= 0) {
    return null;
  }

  const fittingGlyphs: number = Math.floor(data.maxWidthPx / glyphWidth);
  if (fittingGlyphs <= 0) {
    return null;
  }
  if (data.label.length <= fittingGlyphs) {
    return data.label;
  }

  const keep: number = fittingGlyphs - ELLIPSIS_GLYPHS;
  if (keep <= 0) {
    return null;
  }

  return `${data.label.slice(0, keep).trimEnd()}\u2026`;
}

/** Width of the chip drawn for a cluster of `count` markers. */
export function getChipWidth(count: number): number {
  if (count <= 1) {
    return SINGLE_MARKER_CHIP_SIZE;
  }
  const digits: number = String(count).length;
  return COUNTED_CHIP_BASE_WIDTH + CHIP_WIDTH_PER_DIGIT * digits;
}

/**
 * Resolve every marker onto a pixel on the x-axis, dropping the ones whose
 * bucket is not on the axis (a window change can outrun the annotations by
 * a render).
 *
 * Markers keep their caller-supplied order inside a bucket, so the same
 * data always produces the same cluster contents.
 */
export function positionMarkers(data: {
  markers: Array<FormattedTimeReferenceLine>;
  resolveX: CategoryXResolver;
}): Array<PositionedMarker> {
  const positioned: Array<PositionedMarker> = [];

  for (const marker of data.markers) {
    const xPixel: number | null = data.resolveX(marker.bucketIndex);
    if (xPixel === null || !Number.isFinite(xPixel)) {
      continue;
    }
    positioned.push({ xPixel, categoryIndex: marker.bucketIndex, marker });
  }

  /*
   * Sorted by position, then by the caller's order within a bucket, so a
   * cluster's rows read the way the producer listed them.
   */
  positioned.sort((a: PositionedMarker, b: PositionedMarker): number => {
    return a.xPixel - b.xPixel;
  });

  return positioned;
}

function pickClusterKind(
  markers: Array<FormattedTimeReferenceLine>,
): ChartEventKind {
  let best: ChartEventKind = ChartEventKind.Generic;
  for (const marker of markers) {
    const kind: ChartEventKind = getMarkerKind(marker);
    if (KIND_PRIORITY[kind]! > KIND_PRIORITY[best]!) {
      best = kind;
    }
  }
  return best;
}

/*
 * The chip shows the cluster's most serious event, so that event's colour
 * is the chip's colour. With no kinds to separate them (the common case
 * for a caller that only sets `color`), the first marker speaks.
 */
function pickClusterColor(
  markers: Array<FormattedTimeReferenceLine>,
  kind: ChartEventKind,
): string {
  let fallback: string | undefined = undefined;
  for (const marker of markers) {
    if (getMarkerKind(marker) === kind) {
      return getMarkerColor(marker);
    }
    fallback = fallback ?? getMarkerColor(marker);
  }
  return fallback ?? KIND_COLORS[kind]!;
}

function buildCluster(members: Array<PositionedMarker>): MarkerCluster {
  const markers: Array<FormattedTimeReferenceLine> = members.map(
    (member: PositionedMarker): FormattedTimeReferenceLine => {
      return member.marker;
    },
  );
  const kind: ChartEventKind = pickClusterKind(markers);

  /*
   * A mixed cluster gets a solid line: dashes mean "change event", and a
   * cluster holding an incident is not one.
   */
  const dashes: Array<string | undefined> = markers.map(
    (marker: FormattedTimeReferenceLine): string | undefined => {
      return marker.original.strokeDasharray;
    },
  );
  const firstDash: string | undefined = dashes[0];
  const everyDashMatches: boolean = dashes.every(
    (dash: string | undefined): boolean => {
      return dash === firstDash;
    },
  );

  const anchor: PositionedMarker = members[0]!;

  return {
    /*
     * Keyed on the anchor's bucket, not its pixel: a resize moves every
     * chip, and a pixel-keyed id would remount the whole rail (and drop an
     * open hover card) on each frame of a window drag.
     */
    id: `cluster-${anchor.categoryIndex}-${members.length}`,
    xPixel: anchor.xPixel,
    formattedX: anchor.marker.formattedX,
    markers,
    color: pickClusterColor(markers, kind),
    strokeDasharray: everyDashMatches ? firstDash : undefined,
    kind,
  };
}

function clusterOnce(data: {
  positioned: Array<PositionedMarker>;
  separationPx: number;
}): Array<MarkerCluster> {
  const clusters: Array<MarkerCluster> = [];
  let members: Array<PositionedMarker> = [];

  for (const candidate of data.positioned) {
    const anchor: PositionedMarker | undefined = members[0];
    if (!anchor || candidate.xPixel - anchor.xPixel <= data.separationPx) {
      members.push(candidate);
      continue;
    }
    clusters.push(buildCluster(members));
    members = [candidate];
  }

  if (members.length > 0) {
    clusters.push(buildCluster(members));
  }

  return clusters;
}

/**
 * Collapse markers that would draw on top of each other into counted
 * chips.
 *
 * The pass is greedy left-to-right and anchored on the first marker of
 * each cluster, so a chip always sits on a real event rather than on the
 * average of several. When the result is still denser than the rail can
 * carry, the separation widens and the pass repeats — an unreadable comb
 * of 50 hairlines becomes a readable handful of counted chips.
 */
export function clusterMarkers(data: {
  positioned: Array<PositionedMarker>;
  separationPx?: number | undefined;
  maxClusters?: number | undefined;
}): Array<MarkerCluster> {
  if (data.positioned.length === 0) {
    return [];
  }

  const maxClusters: number = data.maxClusters ?? MAX_CLUSTERS;
  let separationPx: number = data.separationPx ?? DEFAULT_CLUSTER_SEPARATION_PX;

  let clusters: Array<MarkerCluster> = clusterOnce({
    positioned: data.positioned,
    separationPx,
  });

  for (
    let pass: number = 0;
    pass < MAX_CLUSTER_PASSES && clusters.length > maxClusters;
    pass++
  ) {
    separationPx = separationPx * CLUSTER_SEPARATION_GROWTH;
    clusters = clusterOnce({ positioned: data.positioned, separationPx });
  }

  return clusters;
}

/**
 * Resolve regions onto pixel spans, dropping any whose endpoints are not
 * on the axis. A region that resolves to a single bucket still gets a
 * minimum width so it stays visible.
 */
export function positionRegions(data: {
  regions: Array<FormattedReferenceRegion>;
  resolveX: CategoryXResolver;
  minWidthPx?: number | undefined;
}): Array<PositionedRegion> {
  const minWidthPx: number = data.minWidthPx ?? 2;
  const positioned: Array<PositionedRegion> = [];

  for (let index: number = 0; index < data.regions.length; index++) {
    const region: FormattedReferenceRegion = data.regions[index]!;
    const startX: number | null = data.resolveX(region.startBucketIndex);
    const endX: number | null = data.resolveX(region.endBucketIndex);
    if (
      startX === null ||
      endX === null ||
      !Number.isFinite(startX) ||
      !Number.isFinite(endX)
    ) {
      continue;
    }

    const x1: number = Math.min(startX, endX);
    const x2: number = Math.max(startX, endX);

    positioned.push({
      /*
       * Keyed on buckets rather than pixels, for the same reason clusters
       * are — a resize must not remount the region.
       */
      id: `region-${index}-${region.startBucketIndex}-${region.endBucketIndex}`,
      x1,
      x2: Math.max(x2, x1 + minWidthPx),
      color: toAnnotationColor(
        region.original.color || KIND_COLORS[ChartEventKind.Change]!,
      ),
      region,
    });
  }

  return positioned;
}

/**
 * Keep the hover card inside the chart. Cards are centred on their chip
 * until that would push them past an edge, then they slide back in.
 */
export function clampHoverCardLeft(data: {
  anchorX: number;
  cardWidth: number;
  chartWidth: number;
  edgeInset?: number | undefined;
}): number {
  const edgeInset: number = data.edgeInset ?? 4;
  const ideal: number = data.anchorX - data.cardWidth / 2;
  const maxLeft: number = data.chartWidth - data.cardWidth - edgeInset;

  /*
   * A card wider than the chart cannot satisfy both edges; pinning it to
   * the left one keeps its start readable rather than its middle.
   */
  if (maxLeft <= edgeInset) {
    return edgeInset;
  }

  return Math.min(Math.max(ideal, edgeInset), maxLeft);
}
