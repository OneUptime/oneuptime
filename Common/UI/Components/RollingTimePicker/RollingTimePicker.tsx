import React, { FunctionComponent, ReactElement, useEffect } from "react";
import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import DropdownUtil from "../../Utils/Dropdown";
import RollingTime from "../../../Types/RollingTime/RollingTime";

export interface ComponentProps {
    initialValue?: undefined | RollingTime;
    value?: RollingTime | undefined;
    onChange?: undefined | ((value: RollingTime) => void);
}

const RollingTimePicker: FunctionComponent<ComponentProps> = (
    props: ComponentProps,
): ReactElement => {
    const [rollingTime, setRollingTime] = React.useState<RollingTime>(
        props.initialValue || RollingTime.Past1Minute
    );

    const dropdownOptions: Array<DropdownOption> = DropdownUtil.getDropdownOptionsFromEnum(RollingTime);

    useEffect(() => {
        if (props.value) {
            setRollingTime(props.value);
        }
    }, [props.value]);

    useEffect(() => {
        if (rollingTime) {
            props.onChange && props.onChange(rollingTime);
        }
    }
        , [rollingTime]);


    const currentDropdownOption: DropdownOption | undefined = dropdownOptions.find((option) => option.value === rollingTime);

    return <Dropdown
        value={currentDropdownOption}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (value === null) {
                return;
            }

            if (Array.isArray(value)) {
                return;
            }


            setRollingTime(value as RollingTime);
        }}
        options={dropdownOptions}
    />;
};

export default RollingTimePicker;
