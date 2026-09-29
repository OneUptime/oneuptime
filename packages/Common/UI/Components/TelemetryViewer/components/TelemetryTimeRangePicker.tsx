import React, { FunctionComponent, ReactElement } from "react";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRangePickerDropdown from "../../Date/TimeRangePickerDropdown";
import ResetTimeRangeZoomButton from "../../Charts/TimeRangeZoom/ResetTimeRangeZoomButton";

export interface TelemetryTimeRangePickerProps {
  value: RangeStartAndEndDateTime;
  onChange: (value: RangeStartAndEndDateTime) => void;
}

// Matches the Tailwind `w-72` on the rendered dropdown (18rem).
export const TIME_RANGE_DROPDOWN_WIDTH_IN_PX: number = 288;

export const TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX: string =
  "telemetry-time-range-picker";

const TelemetryTimeRangePicker: FunctionComponent<
  TelemetryTimeRangePickerProps
> = (props: TelemetryTimeRangePickerProps): ReactElement => {
  /*
   * Inside a page that zooms (TimeRangeZoomScope), a drag on any chart
   * retimes the page; the reset button beside the picker is the way back
   * for anyone who does not know to double-click a chart. It shows only
   * for a zoom of this picker's range, so a viewer nested in a zoomed page
   * does not offer to reset the page.
   */
  return (
    <div className="inline-flex items-center gap-1.5">
      <TimeRangePickerDropdown
        value={props.value}
        onChange={props.onChange}
        dataTestIdPrefix={TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX}
        dropdownWidthInPx={TIME_RANGE_DROPDOWN_WIDTH_IN_PX}
      />
      <ResetTimeRangeZoomButton forTimeRange={props.value} />
    </div>
  );
};

export default TelemetryTimeRangePicker;
