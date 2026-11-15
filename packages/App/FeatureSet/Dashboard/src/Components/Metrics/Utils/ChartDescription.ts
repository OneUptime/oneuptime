import MetricAliasData from "Common/Types/Metrics/MetricAliasData";
import { Translator } from "Common/Types/Translator";

/*
 * A CHART'S DESCRIPTION, AS ITS READER READS IT (#8572).
 *
 * The metrics explorer copies a metric's own description into a chart it
 * builds (MetricQueryConfig), and marks it so (isMetricTypeDescription).
 * That description is a key of OneUptime's for a monitor's series (#8356),
 * which every language words, or the telemetry's own words, which no
 * locale holds: looked up, a key reads in the reader's language and
 * anything else as written. A description a person typed is theirs, drawn
 * as written. The chart's configuration keeps the stored English either
 * way, so a saved chart reads in each reader's language.
 *
 * The explorer's chart (MetricCharts) and its alias editor (MetricAlias)
 * draw a description through this, once, and nothing looks it up again.
 */
export const getChartDescriptionText: (
  alias:
    | Pick<MetricAliasData, "description" | "isMetricTypeDescription">
    | undefined,
  translator: Translator,
) => string = (
  alias:
    | Pick<MetricAliasData, "description" | "isMetricTypeDescription">
    | undefined,
  translator: Translator,
): string => {
  const description: string = alias?.description || "";

  if (!description || alias?.isMetricTypeDescription !== true) {
    return description;
  }

  return translator.translateText(description) || description;
};
