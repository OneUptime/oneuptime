import React, { FunctionComponent, ReactElement } from "react";
import DashboardStartAndEndDate from "../Types/DashboardStartAndEndDate";
import StartAndEndDate, {
  StartAndEndDateType,
} from "Common/UI/Components/Date/StartAndEndDate";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import DashboardStartAndEndDateRange from "../Types/DashboardStartAndEndDateRange";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import DropdownUtil from "Common/UI/Utils/Dropdown";

export interface ComponentProps {
  value?: DashboardStartAndEndDate | undefined;
  onChange: (startAndEndDate: DashboardStartAndEndDate) => void;
}

const DashboardStartAndEndDateEditElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dropdownOptions: DropdownOption[] =
    DropdownUtil.getDropdownOptionsFromEnum(DashboardStartAndEndDateRange);
  const defaultDropdownOption: DropdownOption =
    dropdownOptions.find((option: DropdownOption) => {
      return option.value === DashboardStartAndEndDateRange.PAST_ONE_HOUR;
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
            range: range as DashboardStartAndEndDateRange,
          });
        }}
        options={dropdownOptions}
      />
      {/* Start and End Date */}
      {props.value?.range === DashboardStartAndEndDateRange.CUSTOM && (
        <StartAndEndDate
          type={StartAndEndDateType.DateTime}
          value={props.value?.startAndEndDate || undefined}
          hideTimeButtons={true}
          onValueChanged={(startAndEndDate: InBetween<Date> | null) => {
            if (startAndEndDate) {
              props.onChange({
                range: DashboardStartAndEndDateRange.CUSTOM,
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
