import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import SeriesLabelDisplay from "../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";

/*
 * Why one series' alert or incident was auto-resolved.
 *
 * In per-series mode a series that has recovered is resolved on a tick
 * where other series can still be breaching. That tick's root cause
 * describes the series that are still breaching, and it used to be
 * written onto the recovered series' state timeline as-is — so node A's
 * "resolved" email listed, under "Root Cause", the nodes that were still
 * down. This names the series that recovered and the criteria it no
 * longer satisfies instead.
 */
export default class PerSeriesResolutionRootCause {
  public static build(input: {
    seriesLabels: JSONObject | undefined;
    createdCriteriaId: string | undefined;
    criteriaInstancesById?: Dictionary<MonitorCriteriaInstance> | undefined;
  }): string {
    const seriesSummary: string = SeriesLabelDisplay.buildInlineSummary(
      input.seriesLabels,
    );

    const criteriaName: string =
      (input.createdCriteriaId
        ? input.criteriaInstancesById?.[
            input.createdCriteriaId
          ]?.data?.name?.trim()
        : undefined) || "";

    const series: string = seriesSummary
      ? `Series "${seriesSummary}"`
      : "This series";

    const criteria: string = criteriaName
      ? `criteria "${criteriaName}"`
      : "the criteria that raised it";

    return `${series} no longer satisfies ${criteria}.`;
  }
}
