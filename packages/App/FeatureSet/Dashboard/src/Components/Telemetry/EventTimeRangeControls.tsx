import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import TimeRange from "Common/Types/Time/TimeRange";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import MetricInvestigationTimePicker from "../Metrics/Investigation/MetricInvestigationTimePicker";
import { InvestigationTimeRangeState } from "../Metrics/Investigation/UseInvestigationTimeRange";

export const EVENT_TIME_RANGE_RESET_TEST_ID: string = "event-time-range-reset";

export interface ComponentProps {
  time: InvestigationTimeRangeState;
  // English heading above the ranges around the event ("Around this alert").
  presetsHeading: string;
  // The ranges relative to now to offer.
  relativeRanges: Array<TimeRange>;
}

const BUTTON_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

/**
 * The time range of an event's logs, traces or exceptions card (issue
 * #6251), on the header of every tab of the card: the picker, with the
 * ranges around the event first and Reset zoom beside it while a drag has
 * zoomed the card, and - once the reader moved off what the monitor saw -
 * Copy link, for a link that opens the same range, and Reset, which goes
 * back to what the monitor saw. A zoom dragged out of what the monitor saw
 * is undone by Reset zoom alone: a second button doing the same is left
 * out.
 */
const EventTimeRangeControls: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const time: InvestigationTimeRangeState = props.time;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <MetricInvestigationTimePicker
        investigation={time}
        presetsHeading={props.presetsHeading}
        relativeRanges={props.relativeRanges}
      />
      {time.isTimeChanged && time.shareUrl ? (
        /*
         * What the reader picked is in the page's URL, so this link opens
         * the very same range for whoever it is sent to.
         */
        <CopyTextButton
          textToBeCopied={time.shareUrl}
          label="Copy link"
          copiedLabel="Link copied"
          title="Copy a link to this time range"
          size="sm"
          variant="ghost"
          className="bg-white font-medium text-gray-700 shadow-sm"
        />
      ) : (
        <></>
      )}
      {time.isTimeChanged && !time.isZoomedFromDefault ? (
        <Tooltip text="Go back to what the monitor saw">
          <button
            type="button"
            data-testid={EVENT_TIME_RANGE_RESET_TEST_ID}
            className={BUTTON_CLASS_NAME}
            onClick={time.reset}
          >
            <Icon icon={IconProp.ArrowUturnLeft} className="h-3.5 w-3.5" />
            {translator.translateText("Reset")}
          </button>
        </Tooltip>
      ) : (
        <></>
      )}
    </div>
  );
};

export default EventTimeRangeControls;
