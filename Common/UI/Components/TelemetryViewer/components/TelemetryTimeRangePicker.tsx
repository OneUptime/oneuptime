import React, { FunctionComponent, ReactElement } from "react";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRangePickerDropdown from "../../Date/TimeRangePickerDropdown";

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
  return (
    <TimeRangePickerDropdown
      value={props.value}
      onChange={props.onChange}
      dataTestIdPrefix={TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX}
      dropdownWidthInPx={TIME_RANGE_DROPDOWN_WIDTH_IN_PX}
    />
  );
};

export default TelemetryTimeRangePicker;
