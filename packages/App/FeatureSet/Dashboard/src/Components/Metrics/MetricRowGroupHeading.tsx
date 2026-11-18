import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * THE HEADING OF A SECTION OF A METRICS LIST (MetricsViewer's getRowGroup):
 * "Traffic", "Errors", "Latency" above the rows of a cloud resource's key
 * metrics about each. A quiet band as wide as the rows, its word in small
 * capitals, lined up with the rows' names - it sorts the rows under it and
 * is not one of them: nothing to click, and a heading to a screen reader.
 *
 * The title is an English key (a CloudKeyMetricGroup's label, or "Other"),
 * looked up here once, in the reader's language.
 */
export interface MetricRowGroupHeadingProps {
  title: string;
}

export const METRIC_ROW_GROUP_HEADING_CLASS_NAME: string =
  "border-b border-gray-100 bg-gray-50 px-5 pb-2 pt-3";

const MetricRowGroupHeading: FunctionComponent<MetricRowGroupHeadingProps> = (
  props: MetricRowGroupHeadingProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      data-testid="metric-row-group-heading"
      className={METRIC_ROW_GROUP_HEADING_CLASS_NAME}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {translator.translateText(props.title) || props.title}
      </h3>
    </div>
  );
};

export default MetricRowGroupHeading;
