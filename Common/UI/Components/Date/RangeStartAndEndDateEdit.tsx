import React, { FunctionComponent, ReactElement } from "react";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import StartAndEndDate, {
  StartAndEndDateType,
} from "../../../UI/Components/Date/StartAndEndDate";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "../../../UI/Components/Dropdown/Dropdown";
import DropdownUtil from "../../../UI/Utils/Dropdown";

export interface ComponentProps {
  value?: RangeStartAndEndDateTime | undefined;
  onChange: (startAndEndDate: RangeStartAndEndDateTime) => void;
}

const DashboardStartAndEndDateEditElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dropdownOptions: DropdownOption[] =
    DropdownUtil.getDropdownOptionsFromEnum(TimeRange);
  const defaultDropdownOption: DropdownOption =
    dropdownOptions.find((option: DropdownOption) => {
      return option.value === TimeRange.PAST_ONE_HOUR;
    }) || dropdownOptions[0]!;
  const selectedDropdownnOption: DropdownOption =
    dropdownOptions.find((option: DropdownOption) => {
      return option.value === props.value?.range;
    }) || defaultDropdownOption;

  return (
    <div>
      <Dropdown
        value={selectedDropdownnOption}
        onChange={(range: DropdownValue | Array<DropdownValue> | null) => {
          props.onChange({
            range: range as TimeRange,
          });
        }}
        options={dropdownOptions}
      />
      {/* Start and End Date */}
      {props.value?.range === TimeRange.CUSTOM && (
        <StartAndEndDate
          type={StartAndEndDateType.DateTime}
          value={props.value?.startAndEndDate || undefined}
          hideTimeButtons={true}
          onValueChanged={(startAndEndDate: InBetween<Date> | null) => {
            if (startAndEndDate) {
              props.onChange({
                range: TimeRange.CUSTOM,
                startAndEndDate,
              });
            }
          }}
        />
      )}
    </div>
  );
};

export default DashboardStartAndEndDateEditElement;
