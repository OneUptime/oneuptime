import Select from 'react-select';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

type DropdownValue = string | number;

export interface DropdownOption {
    value: DropdownValue;
    label: string;
}

export interface ComponentProps {
    options: Array<DropdownOption>;
    initialValue?: undefined | string;
    onClick?: undefined | (() => void);
    placeholder?: undefined | string;
    className?: undefined | string;
    onChange?: undefined | ((value: DropdownValue) => void);
    value?: string | undefined;
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
    isMultiSelect?: boolean;
}

const Dropdown: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [value, setValue] = useState<DropdownValue>('');

    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue);
        }

        if (props.value) {
            setValue(props.value);
        }
    }, []);

    useEffect(() => {
        setValue(props.value ? props.value : '');
    }, [props.value]);

    const selectedValues: Array<DropdownOption> = props.options.filter(
        (item: DropdownOption) => {
            return item.value === value;
        }
    );

    let selectedValue: DropdownOption | undefined;

    if (selectedValues.length > 0) {
        selectedValue = selectedValues[0];
    }

    return (
        <div
            className={`${props.className || ''}`}
            onClick={() => {
                props.onClick && props.onClick();
                props.onFocus && props.onFocus();
            }}
        >
            <Select
                onBlur={() => {
                    props.onBlur && props.onBlur();
                }}
                isMulti={props.isMultiSelect}
                value={selectedValue}
                onFocus={() => {
                    props.onFocus && props.onFocus();
                }}
                placeholder={props.placeholder}
                options={props.options as any}
                onChange={(option: any | null) => {
                    if (option) {
                        const value: DropdownValue = (option as DropdownOption)
                            .value;
                        setValue(value);
                        props.onChange &&
                            props.onChange((option as DropdownOption).value);
                    }
                }}
            />
        </div>
    );
};

export default Dropdown;
