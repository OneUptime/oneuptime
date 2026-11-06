import InBetween from "Common/Types/BaseDatabase/InBetween";
import ChartReferenceRegionProps from "Common/UI/Components/Charts/Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import MetricInvestigationTime from "./MetricInvestigationTime";

/*
 * Which of a page's marks a metric investigation's charts can draw over the
 * window on screen. A mark outside it would be pulled onto the nearest edge
 * of the chart, saying something happened there when it did not.
 */

type ToMsFunction = (value: unknown) => number;

const toMs: ToMsFunction = (value: unknown): number => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "string" || typeof value === "number") {
    return new Date(value).getTime();
  }

  return Number.NaN;
};

// The moments inside the window, its ends included.
export function getReferenceLinesInWindow(
  lines: Array<ChartTimeReferenceLineProps>,
  window: InBetween<Date> | null | undefined,
): Array<ChartTimeReferenceLineProps> {
  const usableWindow: InBetween<Date> | null =
    MetricInvestigationTime.toUsableWindow(window);

  if (!usableWindow) {
    return [];
  }

  const startMs: number = usableWindow.startValue.getTime();
  const endMs: number = usableWindow.endValue.getTime();

  return lines.filter((line: ChartTimeReferenceLineProps): boolean => {
    const lineMs: number = toMs(line.date);
    return Number.isFinite(lineMs) && lineMs >= startMs && lineMs <= endMs;
  });
}

/*
 * The spans that share any instant with the window. A span reaching past an
 * edge is kept: the chart trims it there.
 */
export function getReferenceRegionsInWindow(
  regions: Array<ChartReferenceRegionProps>,
  window: InBetween<Date> | null | undefined,
): Array<ChartReferenceRegionProps> {
  const usableWindow: InBetween<Date> | null =
    MetricInvestigationTime.toUsableWindow(window);

  if (!usableWindow) {
    return [];
  }

  const startMs: number = usableWindow.startValue.getTime();
  const endMs: number = usableWindow.endValue.getTime();

  return regions.filter((region: ChartReferenceRegionProps): boolean => {
    const regionStartMs: number = toMs(region.startDate);
    const regionEndMs: number = toMs(region.endDate);

    return (
      Number.isFinite(regionStartMs) &&
      Number.isFinite(regionEndMs) &&
      regionStartMs <= regionEndMs &&
      regionStartMs <= endMs &&
      regionEndMs >= startMs
    );
  });
}
