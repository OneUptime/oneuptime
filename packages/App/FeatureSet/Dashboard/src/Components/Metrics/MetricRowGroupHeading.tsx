import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useId,
} from "react";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * THE HEADING OF A SECTION OF A METRICS LIST (MetricsViewer's getRowGroup):
 * "Traffic", "Errors", "Latency" above the rows of a cloud resource's key
 * metrics about each. A quiet band as wide as the rows, its word in small
 * capitals, lined up with the rows' names - it sorts the rows under it and
 * is not one of them, and a heading to a screen reader.
 *
 * Where the section's metrics did not all report in the list's range
 * (MetricsViewer's getRowGroupGaps), the band says how many on its other
 * end, "2 not reported", folded away: pressed, what the page says of them
 * opens under the band (gapContent). A section none of whose metrics
 * reported is this band alone.
 *
 * The title is an English key (a CloudKeyMetricGroup's label, or "Other"),
 * looked up here once, in the reader's language.
 */
export interface MetricRowGroupHeadingProps {
  title: string;
  // How many of its metrics did not report: none, no count.
  gapCount?: number | undefined;
  isGapOpen?: boolean | undefined;
  onToggleGap?: (() => void) | undefined;
  // What opens under the band: drawn only while it is open.
  gapContent?: ReactNode | undefined;
}

export const METRIC_ROW_GROUP_HEADING_CLASS_NAME: string =
  "border-b border-gray-100 bg-gray-50 px-5 pb-2 pt-3";

export const METRIC_ROW_GROUP_GAP_TOGGLE_TEST_ID: string =
  "metric-row-group-gap-toggle";
export const METRIC_ROW_GROUP_GAP_CONTENT_TEST_ID: string =
  "metric-row-group-gap-content";

const MetricRowGroupHeading: FunctionComponent<MetricRowGroupHeadingProps> = (
  props: MetricRowGroupHeadingProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const contentId: string = useId();
  const gapCount: number = props.gapCount || 0;

  return (
    <div
      data-testid="metric-row-group-heading"
      className={METRIC_ROW_GROUP_HEADING_CLASS_NAME}
    >
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {translator.translateText(props.title) || props.title}
        </h3>
        {gapCount > 0 && props.onToggleGap ? (
          <Button
            dataTestId={METRIC_ROW_GROUP_GAP_TOGGLE_TEST_ID}
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            buttonSize={ButtonSize.Small}
            icon={props.isGapOpen ? IconProp.ChevronUp : IconProp.ChevronDown}
            title={translator.translatePlural(
              {
                one: "{{count}} not reported",
                other: "{{count}} not reported",
              },
              gapCount,
            )}
            isTitleTranslated={true}
            ariaExpanded={Boolean(props.isGapOpen)}
            ariaControls={contentId}
            onClick={props.onToggleGap}
          />
        ) : (
          <></>
        )}
      </div>
      {gapCount > 0 && props.isGapOpen ? (
        <div
          id={contentId}
          data-testid={METRIC_ROW_GROUP_GAP_CONTENT_TEST_ID}
          className="pb-1 pt-2"
        >
          {props.gapContent}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default MetricRowGroupHeading;
