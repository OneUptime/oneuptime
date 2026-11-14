import React, { FunctionComponent, ReactElement } from "react";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRangePickerDropdown from "../../Date/TimeRangePickerDropdown";
import ResetTimeRangeZoomButton from "../../Charts/TimeRangeZoom/ResetTimeRangeZoomButton";

export interface LogTimeRangePickerProps {
  value: RangeStartAndEndDateTime;
  onChange: (value: RangeStartAndEndDateTime) => void;
  /*
   * False while the viewer follows a zoom offered around it (see
   * useViewerTimeRangeZoom): whoever offers that zoom shows its "Reset
   * zoom", and a second one here would only repeat it.
   */
  showResetZoom?: boolean | undefined;
}

// Matches the Tailwind `w-72` on the rendered dropdown (18rem).
export const LOG_TIME_RANGE_DROPDOWN_WIDTH_IN_PX: number = 288;

export const LOG_TIME_RANGE_PICKER_TEST_ID_PREFIX: string =
  "log-time-range-picker";

const LogTimeRangePicker: FunctionComponent<LogTimeRangePickerProps> = (
  props: LogTimeRangePickerProps,
): ReactElement => {
  /*
   * Once a drag on the log volume or analytics chart has zoomed the viewer,
   * the picker only reads "Custom". The reset button beside it is the way
   * back for anyone who does not know to double-click a chart, and the only
   * one for keyboard users. It renders nothing unless the viewer is zoomed.
   *
   * No wider than the row it sits in, as TelemetryTimeRangePicker: a custom
   * range that names its years ("Nov 12, 2025, 9:49 AM – Nov 12, 2026, 9:49
   * AM") is wider than a phone's toolbar row, and the picker cuts it short
   * (the whole range is its tooltip) only when this group may shrink. Sized
   * to its content, it ran past the card's edge at 390px.
   */
  return (
    <div className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      <TimeRangePickerDropdown
        value={props.value}
        onChange={props.onChange}
        dataTestIdPrefix={LOG_TIME_RANGE_PICKER_TEST_ID_PREFIX}
        dropdownWidthInPx={LOG_TIME_RANGE_DROPDOWN_WIDTH_IN_PX}
      />
      {props.showResetZoom === false ? null : <ResetTimeRangeZoomButton />}
    </div>
  );
};

export default LogTimeRangePicker;
