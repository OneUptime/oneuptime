import React, { FunctionComponent, ReactElement } from "react";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRangePickerDropdown from "../../Date/TimeRangePickerDropdown";

export interface LogTimeRangePickerProps {
  value: RangeStartAndEndDateTime;
  onChange: (value: RangeStartAndEndDateTime) => void;
}

// Matches the Tailwind `w-72` on the rendered dropdown (18rem).
export const LOG_TIME_RANGE_DROPDOWN_WIDTH_IN_PX: number = 288;

export const LOG_TIME_RANGE_PICKER_TEST_ID_PREFIX: string =
  "log-time-range-picker";

const LogTimeRangePicker: FunctionComponent<LogTimeRangePickerProps> = (
  props: LogTimeRangePickerProps,
): ReactElement => {
  return (
    <TimeRangePickerDropdown
      value={props.value}
      onChange={props.onChange}
      dataTestIdPrefix={LOG_TIME_RANGE_PICKER_TEST_ID_PREFIX}
      dropdownWidthInPx={LOG_TIME_RANGE_DROPDOWN_WIDTH_IN_PX}
    />
  );
};

export default LogTimeRangePicker;
