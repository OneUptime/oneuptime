import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import SeriesLabelDisplay from "../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";

import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
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
 *
 * The root cause is Markdown (the state timeline's feed item, posted to
 * Slack and Teams, and the resolved email show it), and the series' labels
 * come from the telemetry: both they and the criteria's name are placed as
 * text (mdText), so they read as written.
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

    const criteriaName: string = input.createdCriteriaId
      ? input.criteriaInstancesById?.[
          input.createdCriteriaId
        ]?.data?.name?.trim() || ""
      : "";

    const series: MarkdownText = seriesSummary
      ? mdText`Series "${seriesSummary}"`
      : mdText`This series`;

    const criteria: MarkdownText = criteriaName
      ? mdText`criteria "${criteriaName}"`
      : mdText`the criteria that raised it`;

    return mdText`${series} no longer satisfies ${criteria}.`.toString();
  }
}
