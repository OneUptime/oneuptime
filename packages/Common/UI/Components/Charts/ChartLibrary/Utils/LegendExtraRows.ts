/*
 * How much taller a legend is than its first row: 0 while its items fit on
 * one line, a row's height for each line they wrap onto.
 *
 * The line, area and bar charts draw their legend inside the height they
 * are given, so a legend that wraps takes its extra lines from the plot. A
 * chart drawn at a fixed height grows by this much instead (each wrapper's
 * growsWhenLegendWraps), so its plot keeps its height (issues #6562, #7125).
 */
export function getLegendExtraRowsHeight(
  legend: HTMLElement | null | undefined,
): number {
  if (!legend) {
    return 0;
  }

  const firstItem: HTMLElement | null = legend.querySelector("li");

  if (!firstItem) {
    return 0;
  }

  return Math.max(0, legend.clientHeight - firstItem.offsetHeight);
}
