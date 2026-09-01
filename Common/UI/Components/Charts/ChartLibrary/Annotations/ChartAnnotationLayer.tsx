import React from "react";
import {
  ZIndexLayer,
  useChartWidth,
  usePlotArea,
  useXAxisTicks,
} from "recharts";
import FormattedReferenceRegion from "../Types/FormattedReferenceRegion";
import FormattedTimeReferenceLine from "../Types/FormattedTimeReferenceLine";
import {
  AxisTick,
  CategoryScaleKind,
  CategoryXResolver,
  MARKER_RAIL_HEIGHT,
  MarkerCluster,
  PositionedMarker,
  PositionedRegion,
  REGION_RAIL_HEIGHT,
  SINGLE_MARKER_CHIP_SIZE,
  buildCategoryXResolver,
  clusterMarkers,
  getChipWidth,
  getMarkerRailY,
  getRegionRailY,
  positionMarkers,
  positionRegions,
  truncateLabelToWidth,
} from "./AnnotationLayout";

/*
 * What the chart needs to know to place the HTML hover card that goes with
 * a hovered chip or region pill. All coordinates are in the chart's own
 * pixel space: recharts renders its <svg> at an explicit width/height with
 * no viewBox, so SVG user units and CSS pixels are the same thing here,
 * and an absolutely positioned div can share them.
 */
export interface AnnotationHover {
  id: string;
  /** Horizontal anchor — the chip's centre, or a region pill's centre. */
  anchorX: number;
  /** Vertical anchor — the bottom of the rail row the anchor sits on. */
  anchorY: number;
  chartWidth: number;
  markers: Array<FormattedTimeReferenceLine>;
  region?: FormattedReferenceRegion | undefined;
  /** Heading for the card: the x-axis bucket, or the region's name. */
  heading: string;
  /**
   * Set when a keyboard activated the card. A cluster's events live only
   * in the card, so opening one from the keyboard has to move focus into
   * it — otherwise Tab goes to the next chip and those events are simply
   * unreachable without a pointer.
   */
  takeFocus?: boolean | undefined;
}

export interface ChartAnnotationLayerProps {
  formattedTimeReferenceLines?: Array<FormattedTimeReferenceLine> | undefined;
  formattedReferenceRegions?: Array<FormattedReferenceRegion> | undefined;
  /** The x values recharts is drawing, in axis order. */
  categoryLabels: Array<string>;
  /** The chart's `XAxis padding`, needed by the no-ticks fallback. */
  axisPaddingPx: number;
  /** How recharts lays the categories out; see CategoryScaleKind. */
  scaleKind: CategoryScaleKind;
  hoveredId: string | null;
  onHoverChange: (hover: AnnotationHover | null) => void;
  /**
   * True while a drag-to-select is settling. Annotation clicks are dropped
   * then, so releasing a range selection over a chip never also navigates.
   */
  isClickSuppressed?: (() => boolean) | undefined;
}

/** Ring drawn around a chip so overlapping chips still read as separate. */
const CHIP_RING: string = "var(--ou-chart-marker-ring, #ffffff)";

const HAIRLINE_OPACITY: number = 0.34;
const HAIRLINE_OPACITY_HOVERED: number = 0.85;
const REGION_FILL_OPACITY: number = 0.1;
const REGION_FILL_OPACITY_HOVERED: number = 0.2;

/** Font size of the label inside a region pill. */
const REGION_LABEL_FONT_SIZE: number = 9;

/** Padding either side of a region pill's label. */
const REGION_LABEL_INSET: number = 6;

/** How far a chip's invisible hit area extends past the chip itself. */
const HIT_AREA_PADDING: number = 3;

/*
 * SVG has no z-index, and recharts portals each layer into its own DOM
 * node, so paint order comes from these rather than from where the JSX
 * sits. Region bands go under every series (recharts draws areas at 100,
 * bars at 300, lines at 400); hairlines go over the filled marks but under
 * the lines, so the data stays the brightest thing on the chart; the rail
 * itself goes above everything, including the active dot at 1200.
 */
const REGION_BAND_Z_INDEX: number = 50;
const HAIRLINE_Z_INDEX: number = 350;
const RAIL_Z_INDEX: number = 1300;

function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}

/*
 * A press that reaches the chart starts a drag-to-select. Chips and pills
 * are targets in their own right, so their presses stop there — otherwise
 * clicking one both navigates and leaves a stray selection behind.
 */
function stopPress(event: React.MouseEvent): void {
  event.stopPropagation();
}

/**
 * Everything the annotation rail draws inside the chart's SVG: shaded
 * region bands and their pills, one hairline per marker cluster, and the
 * clickable chips that top them.
 *
 * Rendered as a plain child of the recharts chart — recharts 3 hands any
 * child the chart context, so the hooks here return the real geometry and
 * the rail stays pinned to the plot through every resize, with no
 * measurement round-trip through React state.
 */
const ChartAnnotationLayer: React.FunctionComponent<
  ChartAnnotationLayerProps
> = (props: ChartAnnotationLayerProps): React.ReactElement | null => {
  const plotArea: ReturnType<typeof usePlotArea> = usePlotArea();
  const ticks: ReturnType<typeof useXAxisTicks> = useXAxisTicks();
  const chartWidth: number | undefined = useChartWidth();
  /*
   * clipPath ids are document-global. Two charts on one dashboard would
   * otherwise both define `ou-region-clip-region-0-…`, and every region
   * label on the page would be clipped to whichever chart rendered last.
   */
  const clipNamespace: string = React.useId();

  const {
    formattedTimeReferenceLines,
    formattedReferenceRegions,
    categoryLabels,
    axisPaddingPx,
    scaleKind,
    hoveredId,
    onHoverChange,
    isClickSuppressed,
  } = props;

  const resolveX: CategoryXResolver | null =
    React.useMemo((): CategoryXResolver | null => {
      if (!plotArea) {
        return null;
      }
      return buildCategoryXResolver({
        ticks: ticks as ReadonlyArray<AxisTick> | undefined,
        categoryLabels,
        plotArea,
        axisPaddingPx,
        scaleKind,
      });
    }, [ticks, categoryLabels, plotArea, axisPaddingPx, scaleKind]);

  const regions: Array<PositionedRegion> = React.useMemo(():
    | Array<PositionedRegion>
    | never => {
    if (!formattedReferenceRegions?.length || !resolveX) {
      return [];
    }
    return positionRegions({ regions: formattedReferenceRegions, resolveX });
  }, [formattedReferenceRegions, resolveX]);

  const clusters: Array<MarkerCluster> = React.useMemo(():
    | Array<MarkerCluster>
    | never => {
    if (!formattedTimeReferenceLines?.length || !resolveX) {
      return [];
    }
    const positioned: Array<PositionedMarker> = positionMarkers({
      markers: formattedTimeReferenceLines,
      resolveX,
    });
    return clusterMarkers({ positioned });
  }, [formattedTimeReferenceLines, resolveX]);

  if (!plotArea || !resolveX) {
    return null;
  }

  const plotBottom: number = plotArea.y + plotArea.height;
  const markerRailY: number = getMarkerRailY(plotArea.y);
  /*
   * Whether the rail reserved a marker strip, which is what the chart's
   * margin/legend padding was sized from — not whether any marker survived
   * positioning. Markers that all fall outside the window still bought
   * their row, and measuring from a row that is not there would drop the
   * region pill onto the plot.
   */
  const reservedMarkerStrip: boolean = Boolean(
    formattedTimeReferenceLines?.length,
  );
  const regionRailY: number = getRegionRailY(plotArea.y, reservedMarkerStrip);
  const width: number = chartWidth ?? plotArea.x + plotArea.width;

  const canClick: () => boolean = (): boolean => {
    return !isClickSuppressed?.();
  };

  return (
    <>
      {/*
       * Bands only. They cover the whole plot, so they stay inert: a
       * pointer over one has to reach the series for the value tooltip,
       * and a drag across one has to reach the range selection. The pill
       * on the rail is the region's affordance.
       */}
      <ZIndexLayer zIndex={REGION_BAND_Z_INDEX}>
        <g
          className="oneuptime-chart-annotation-bands"
          style={{ pointerEvents: "none" }}
        >
          {regions.map((positioned: PositionedRegion): React.ReactElement => {
            return (
              <rect
                key={positioned.id}
                data-testid="chart-annotation-region-band"
                x={positioned.x1}
                y={plotArea.y}
                width={positioned.x2 - positioned.x1}
                height={plotArea.height}
                fill={positioned.color}
                fillOpacity={
                  hoveredId === positioned.id
                    ? REGION_FILL_OPACITY_HOVERED
                    : REGION_FILL_OPACITY
                }
              />
            );
          })}
        </g>
      </ZIndexLayer>

      <ZIndexLayer zIndex={HAIRLINE_Z_INDEX}>
        <g
          className="oneuptime-chart-annotation-lines"
          style={{ pointerEvents: "none" }}
        >
          {regions.map((positioned: PositionedRegion): React.ReactElement => {
            const isHovered: boolean = hoveredId === positioned.id;
            /*
             * Edges rather than a full border: a boxed region reads as a
             * second chart frame, two hairlines read as "this span".
             */
            return (
              <g key={positioned.id}>
                <line
                  x1={positioned.x1}
                  x2={positioned.x1}
                  y1={plotArea.y}
                  y2={plotBottom}
                  stroke={positioned.color}
                  strokeWidth={1}
                  strokeOpacity={isHovered ? 0.8 : 0.45}
                />
                <line
                  x1={positioned.x2}
                  x2={positioned.x2}
                  y1={plotArea.y}
                  y2={plotBottom}
                  stroke={positioned.color}
                  strokeWidth={1}
                  strokeOpacity={isHovered ? 0.8 : 0.45}
                />
              </g>
            );
          })}
          {clusters.map((cluster: MarkerCluster): React.ReactElement => {
            const isHovered: boolean = hoveredId === cluster.id;
            return (
              <line
                key={cluster.id}
                data-testid="chart-annotation-hairline"
                x1={cluster.xPixel}
                x2={cluster.xPixel}
                y1={plotArea.y}
                y2={plotBottom}
                stroke={cluster.color}
                strokeWidth={isHovered ? 1.5 : 1}
                strokeOpacity={
                  isHovered ? HAIRLINE_OPACITY_HOVERED : HAIRLINE_OPACITY
                }
                {...(cluster.strokeDasharray
                  ? { strokeDasharray: cluster.strokeDasharray }
                  : {})}
              />
            );
          })}
        </g>
      </ZIndexLayer>

      <ZIndexLayer zIndex={RAIL_Z_INDEX}>
        <g
          className="oneuptime-chart-annotations"
          data-testid="chart-annotation-layer"
        >
          {regions.map((positioned: PositionedRegion): React.ReactElement => {
            const isHovered: boolean = hoveredId === positioned.id;
            const regionWidth: number = positioned.x2 - positioned.x1;
            const label: string | undefined = positioned.region.original.label;
            const clipId: string = `ou-region-clip-${clipNamespace}-${positioned.id}`;
            /*
             * Cut to the pill rather than clipped by it: a hard edge
             * mid-glyph reads as a rendering fault, an ellipsis reads as a
             * name that did not fit. The clip path stays as a backstop for
             * the estimate.
             */
            const shownLabel: string | null = label
              ? truncateLabelToWidth({
                  label,
                  maxWidthPx: regionWidth - REGION_LABEL_INSET * 2,
                  fontSizePx: REGION_LABEL_FONT_SIZE,
                })
              : null;

            const hover: AnnotationHover = {
              id: positioned.id,
              anchorX: positioned.x1 + regionWidth / 2,
              anchorY: regionRailY + REGION_RAIL_HEIGHT,
              chartWidth: width,
              markers: [],
              region: positioned.region,
              heading: label || "Window",
            };

            const onActivate: (() => void) | undefined =
              positioned.region.original.onClick;

            return (
              <g
                key={positioned.id}
                data-testid="chart-annotation-region"
                data-annotation-label={label || ""}
                role={onActivate ? "button" : "img"}
                tabIndex={0}
                aria-label={
                  label ? `Window: ${label}` : "Highlighted window on the chart"
                }
                style={{ cursor: onActivate ? "pointer" : "default" }}
                onMouseEnter={(): void => {
                  onHoverChange(hover);
                }}
                onFocus={(): void => {
                  onHoverChange(hover);
                }}
                onMouseLeave={(): void => {
                  onHoverChange(null);
                }}
                onBlur={(): void => {
                  onHoverChange(null);
                }}
                onMouseDown={stopPress}
                onClick={(event: React.MouseEvent): void => {
                  event.stopPropagation();
                  if (!canClick()) {
                    return;
                  }
                  onActivate?.();
                }}
                onKeyDown={(event: React.KeyboardEvent): void => {
                  if (!isActivationKey(event.key)) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  onActivate?.();
                }}
              >
                <rect
                  x={positioned.x1}
                  y={regionRailY}
                  width={regionWidth}
                  height={REGION_RAIL_HEIGHT}
                  rx={3}
                  fill={positioned.color}
                  fillOpacity={isHovered ? 0.26 : 0.16}
                  stroke={positioned.color}
                  strokeOpacity={isHovered ? 0.9 : 0.55}
                  strokeWidth={1}
                />
                {shownLabel ? (
                  <>
                    <clipPath id={clipId}>
                      <rect
                        x={positioned.x1 + 3}
                        y={regionRailY}
                        width={Math.max(regionWidth - 6, 0)}
                        height={REGION_RAIL_HEIGHT}
                      />
                    </clipPath>
                    <text
                      clipPath={`url(#${clipId})`}
                      x={positioned.x1 + REGION_LABEL_INSET}
                      y={regionRailY + REGION_RAIL_HEIGHT - 3.5}
                      fontSize={REGION_LABEL_FONT_SIZE}
                      fontWeight={600}
                      fill={positioned.color}
                      style={{ pointerEvents: "none" }}
                    >
                      {shownLabel}
                    </text>
                  </>
                ) : null}
              </g>
            );
          })}

          {clusters.map((cluster: MarkerCluster): React.ReactElement => {
            const isHovered: boolean = hoveredId === cluster.id;
            const count: number = cluster.markers.length;
            const chipWidth: number = getChipWidth(count);
            const chipX: number = cluster.xPixel - chipWidth / 2;
            const chipCentreY: number = markerRailY + MARKER_RAIL_HEIGHT / 2;

            const hover: AnnotationHover = {
              id: cluster.id,
              anchorX: cluster.xPixel,
              anchorY: markerRailY + MARKER_RAIL_HEIGHT,
              chartWidth: width,
              markers: cluster.markers,
              heading: cluster.formattedX,
            };

            const firstLabel: string =
              cluster.markers[0]?.original.label || "Event";
            const ariaLabel: string =
              count > 1
                ? `${count} events at ${cluster.formattedX}`
                : `${firstLabel} at ${cluster.formattedX}`;

            const activate: () => void = (): void => {
              /*
               * One event goes straight through; a cluster has no single
               * destination, so it opens its card and lets the reader pick.
               */
              if (count === 1) {
                cluster.markers[0]?.original.onClick?.();
                return;
              }
              onHoverChange(hover);
            };

            return (
              <g key={cluster.id} data-testid="chart-annotation-marker">
                {/* Stem: ties the chip to its hairline across the rail gap. */}
                <line
                  x1={cluster.xPixel}
                  x2={cluster.xPixel}
                  y1={markerRailY + MARKER_RAIL_HEIGHT}
                  y2={plotArea.y}
                  stroke={cluster.color}
                  strokeWidth={1}
                  strokeOpacity={isHovered ? 0.9 : 0.55}
                  style={{ pointerEvents: "none" }}
                />
                <g
                  data-testid="chart-annotation-chip"
                  data-annotation-count={String(count)}
                  data-annotation-kind={cluster.kind}
                  role="button"
                  tabIndex={0}
                  aria-label={ariaLabel}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(): void => {
                    onHoverChange(hover);
                  }}
                  onFocus={(): void => {
                    onHoverChange(hover);
                  }}
                  onMouseLeave={(): void => {
                    onHoverChange(null);
                  }}
                  onBlur={(): void => {
                    onHoverChange(null);
                  }}
                  onMouseDown={stopPress}
                  onClick={(event: React.MouseEvent): void => {
                    // An annotation click must never also pin a time bucket.
                    event.stopPropagation();
                    if (!canClick()) {
                      return;
                    }
                    activate();
                  }}
                  onKeyDown={(event: React.KeyboardEvent): void => {
                    if (!isActivationKey(event.key)) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    if (count === 1) {
                      cluster.markers[0]?.original.onClick?.();
                      return;
                    }
                    onHoverChange({ ...hover, takeFocus: true });
                  }}
                >
                  {/*
                   * An invisible, generously sized hit area: a 13px chip is
                   * below the comfortable pointer target, and widening the
                   * visible chip to compensate would crowd the rail. It
                   * grows upward only as far as the chart's own edge — a
                   * negative y is not clickable, just invalid.
                   */}
                  <rect
                    x={chipX - 5}
                    y={Math.max(0, markerRailY - HIT_AREA_PADDING)}
                    width={chipWidth + 10}
                    height={
                      MARKER_RAIL_HEIGHT +
                      HIT_AREA_PADDING +
                      Math.min(HIT_AREA_PADDING, markerRailY)
                    }
                    fill="transparent"
                  />
                  <rect
                    x={chipX}
                    y={
                      markerRailY +
                      (MARKER_RAIL_HEIGHT - SINGLE_MARKER_CHIP_SIZE) / 2
                    }
                    width={chipWidth}
                    height={SINGLE_MARKER_CHIP_SIZE}
                    rx={SINGLE_MARKER_CHIP_SIZE / 2}
                    fill={cluster.color}
                    stroke={CHIP_RING}
                    strokeWidth={isHovered ? 2.5 : 1.5}
                  />
                  {count > 1 ? (
                    <text
                      x={cluster.xPixel}
                      y={chipCentreY + 3.2}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={700}
                      fill="#ffffff"
                      style={{ pointerEvents: "none" }}
                    >
                      {count}
                    </text>
                  ) : (
                    /*
                     * Sits on the chip's own colour, not on the chart
                     * surface, so it must not follow the ring token that
                     * flips with the theme.
                     */
                    <circle
                      cx={cluster.xPixel}
                      cy={chipCentreY}
                      r={2.2}
                      fill="#ffffff"
                      fillOpacity={0.9}
                      style={{ pointerEvents: "none" }}
                    />
                  )}
                </g>
              </g>
            );
          })}
        </g>
      </ZIndexLayer>
    </>
  );
};

export default ChartAnnotationLayer;
