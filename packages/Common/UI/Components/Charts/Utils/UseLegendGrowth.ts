import React from "react";

/*
 * A CHART THAT GROWS WHEN ITS LEGEND WRAPS, AS A CARD DOES (issue #7125).
 *
 * The line, area and bar charts draw their legend inside the height they
 * are given (heightInPx), so a legend that wraps onto a second or third
 * line took those lines from the plot. Product Analytics' Active users card
 * went from a 78px plot to 30px on a phone (#6562), and a Host's, a
 * Kubernetes cluster's or a VMware host's Network chart - two series, In
 * and Out, in German - lost a line of its plot beside the side menu, so it
 * read shorter than the CPU chart beside it.
 *
 * Every chart drawn at a fixed height now grows by its legend's lines past
 * the first, so its plot keeps the height it was given. Only a chart that
 * has to fit a box of its own size, a dashboard widget's, says so
 * (growsWhenLegendWraps={false}), and its legend's lines come out of its
 * height as before. A chart with no fixed height fills its box, and a chart
 * with no legend has nothing to grow by.
 */
export interface LegendGrowth {
  // The chart's height, its legend's extra lines added; unset without a height.
  chartHeightInPx: number | undefined;
  /*
   * Handed to the chart library's onLegendExtraRowsHeightChange: undefined
   * when the chart does not grow, so the library measures nothing for it.
   */
  onLegendExtraRowsHeightChange:
    | ((extraRowsHeightInPx: number) => void)
    | undefined;
}

/**
 * Whether a chart grows when its legend wraps: unless it says it must not
 * (growsWhenLegendWraps={false}) or draws no legend.
 */
export function isGrownByLegend(data: {
  growsWhenLegendWraps?: boolean | undefined;
  showLegend?: boolean | undefined;
}): boolean {
  return data.growsWhenLegendWraps !== false && data.showLegend !== false;
}

export function useLegendGrowth(data: {
  heightInPx?: number | undefined;
  growsWhenLegendWraps?: boolean | undefined;
  showLegend?: boolean | undefined;
}): LegendGrowth {
  /*
   * How much taller than one line the legend is, as the chart last measured
   * it: the height the chart grows by.
   */
  const [legendExtraRowsHeight, setLegendExtraRowsHeight] =
    React.useState<number>(0);
  const grows: boolean = Boolean(data.heightInPx) && isGrownByLegend(data);

  return {
    chartHeightInPx: data.heightInPx
      ? data.heightInPx + (grows ? legendExtraRowsHeight : 0)
      : undefined,
    onLegendExtraRowsHeightChange: grows ? setLegendExtraRowsHeight : undefined,
  };
}
