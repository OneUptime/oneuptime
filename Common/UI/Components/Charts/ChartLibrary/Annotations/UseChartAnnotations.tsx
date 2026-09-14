import React from "react";
import FormattedReferenceRegion from "../Types/FormattedReferenceRegion";
import FormattedTimeReferenceLine from "../Types/FormattedTimeReferenceLine";
import AnnotationHoverCard from "./AnnotationHoverCard";
import ChartAnnotationLayer, { AnnotationHover } from "./ChartAnnotationLayer";
import {
  CategoryScaleKind,
  getChartMarginTop,
  getRailHeight,
} from "./AnnotationLayout";

/*
 * Leaving the card open for a beat after the pointer leaves a chip is what
 * makes the chip -> card journey possible at all: the gap between them is
 * unavoidable (the card must clear the chip's ring), and a card that shut
 * the instant the pointer crossed it could never be clicked.
 */
const HOVER_CLOSE_DELAY_MS: number = 140;

export interface UseChartAnnotationsInput {
  formattedTimeReferenceLines?: Array<FormattedTimeReferenceLine> | undefined;
  formattedReferenceRegions?: Array<FormattedReferenceRegion> | undefined;
  /** The x values recharts is drawing, in axis order. */
  categoryLabels: Array<string>;
  /** The chart's `XAxis padding`, needed by the layer's no-ticks fallback. */
  axisPaddingPx: number;
  /** How recharts lays the categories out; see CategoryScaleKind. */
  scaleKind: CategoryScaleKind;
  /**
   * Whether the chart renders a top-aligned legend. It decides which of
   * the two layout levers buys the rail its strip.
   */
  hasTopLegend: boolean;
  /** True while a drag-to-select is settling; see the layer's prop. */
  isClickSuppressed?: (() => boolean) | undefined;
}

export interface UseChartAnnotationsResult {
  /** False when there is nothing to draw — the chart then keeps its own margin. */
  hasAnnotations: boolean;
  /** `margin.top` for the recharts chart, sized to hold the rail. */
  marginTop: number;
  /**
   * Add to the recharts `<Legend height>`. A top-aligned legend is laid
   * out between the top margin and the plot, so the margin alone does not
   * reserve the rail's band — the legend would be drawn straight through
   * it. Padding the legend's reserved height pushes the plot down by the
   * rail's height and leaves the rail its own clear strip underneath.
   */
  railHeight: number;
  /** Render as a direct child of the recharts chart. */
  layer: React.ReactElement | null;
  /** Render as a sibling of ResponsiveContainer, inside a relative parent. */
  overlay: React.ReactElement | null;
}

/**
 * Wires the annotation rail into a chart: the in-SVG layer, the HTML hover
 * card that goes with it, and the top margin the rail needs.
 *
 * Lives here rather than in each chart so line, area and bar charts draw
 * event markers identically — the three used to carry their own copy of
 * the annotation JSX, and had already drifted apart.
 */
export default function useChartAnnotations(
  input: UseChartAnnotationsInput,
): UseChartAnnotationsResult {
  const [hover, setHover] = React.useState<AnnotationHover | null>(null);

  const closeTimeoutRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingClose: () => void = React.useCallback((): void => {
    if (closeTimeoutRef.current !== null) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  React.useEffect((): (() => void) => {
    return (): void => {
      if (closeTimeoutRef.current !== null) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const onHoverChange: (next: AnnotationHover | null) => void =
    React.useCallback(
      (next: AnnotationHover | null): void => {
        cancelPendingClose();
        if (next) {
          setHover(next);
          return;
        }
        closeTimeoutRef.current = setTimeout((): void => {
          closeTimeoutRef.current = null;
          setHover(null);
        }, HOVER_CLOSE_DELAY_MS);
      },
      [cancelPendingClose],
    );

  const markerCount: number = input.formattedTimeReferenceLines?.length || 0;
  const regionCount: number = input.formattedReferenceRegions?.length || 0;
  const hasMarkers: boolean = markerCount > 0;
  const hasRegions: boolean = regionCount > 0;
  const hasAnnotations: boolean = hasMarkers || hasRegions;

  const marginTop: number = getChartMarginTop({
    hasMarkers,
    hasRegions,
    hasTopLegend: input.hasTopLegend,
  });
  const railHeight: number = getRailHeight({ hasMarkers, hasRegions });

  /*
   * A hover left over from a previous window would point at a chip that no
   * longer exists, so annotations changing closes the card.
   *
   * Keyed on WHERE the annotations sit, not on array identity: a caller
   * passing an inline array literal (IncidentRootCauseMetricChart does)
   * hands over a referentially-new-but-equal array on every render, and an
   * identity-keyed effect would then shut the card on every parent render
   * — which a dashboard's auto-refresh tick makes constant.
   */
  const annotationSignature: string = React.useMemo((): string => {
    const markerPart: string = (input.formattedTimeReferenceLines || [])
      .map((marker: FormattedTimeReferenceLine): number => {
        return marker.bucketIndex;
      })
      .join(",");
    const regionPart: string = (input.formattedReferenceRegions || [])
      .map((region: FormattedReferenceRegion): string => {
        return `${region.startBucketIndex}-${region.endBucketIndex}`;
      })
      .join(",");
    return `${markerPart}|${regionPart}`;
  }, [input.formattedTimeReferenceLines, input.formattedReferenceRegions]);

  React.useEffect((): void => {
    cancelPendingClose();
    setHover(null);
  }, [annotationSignature, cancelPendingClose]);

  /*
   * The card is positioned from the chip's coordinates at the moment it
   * opened. A resize moves every chip and leaves the card pointing at
   * nothing, so it closes rather than lying about which event it describes.
   */
  React.useEffect((): (() => void) | undefined => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const onResize: () => void = (): void => {
      cancelPendingClose();
      setHover(null);
    };
    window.addEventListener("resize", onResize);
    return (): void => {
      window.removeEventListener("resize", onResize);
    };
  }, [cancelPendingClose]);

  if (!hasAnnotations) {
    return {
      hasAnnotations,
      marginTop,
      railHeight,
      layer: null,
      overlay: null,
    };
  }

  const layer: React.ReactElement = (
    <ChartAnnotationLayer
      formattedTimeReferenceLines={input.formattedTimeReferenceLines}
      formattedReferenceRegions={input.formattedReferenceRegions}
      categoryLabels={input.categoryLabels}
      axisPaddingPx={input.axisPaddingPx}
      scaleKind={input.scaleKind}
      hoveredId={hover?.id ?? null}
      onHoverChange={onHoverChange}
      isClickSuppressed={input.isClickSuppressed}
    />
  );

  const overlay: React.ReactElement | null = hover ? (
    <AnnotationHoverCard
      hover={hover}
      onMouseEnter={cancelPendingClose}
      onMouseLeave={(): void => {
        onHoverChange(null);
      }}
      onDismiss={(): void => {
        cancelPendingClose();
        setHover(null);
      }}
    />
  ) : null;

  return { hasAnnotations, marginTop, railHeight, layer, overlay };
}
