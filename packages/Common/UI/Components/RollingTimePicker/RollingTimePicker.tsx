import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import DropdownUtil from "../../Utils/Dropdown";
import RollingTime from "../../../Types/RollingTime/RollingTime";

export interface ComponentProps {
  value?: RollingTime | undefined;
  onChange?: undefined | ((value: RollingTime) => void);
}

const RollingTimePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dropdownOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(RollingTime);

  const currentDropdownOption: DropdownOption | undefined =
    dropdownOptions.find((option: DropdownOption) => {
      return option.value === props.value;
    });

  return (
    <Dropdown
      value={currentDropdownOption}
      onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
        let selectedOption: DropdownOption = dropdownOptions.find(
          (option: DropdownOption) => {
            return option.value === value;
          },
        ) as DropdownOption;

        if (!selectedOption) {
          selectedOption = dropdownOptions[0] as DropdownOption;
        }

        if (props.onChange) {
          props.onChange(selectedOption.value as RollingTime);
        }
      }}
      options={dropdownOptions}
    />
  );
};

export default RollingTimePicker;
