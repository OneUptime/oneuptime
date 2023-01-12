import Select from 'react-select';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

export type DropdownValue = string | number | boolean;

export interface DropdownOption {
    value: DropdownValue;
    label: string;
}

export interface ComponentProps {
    options: Array<DropdownOption>;
    initialValue?: undefined | DropdownOption;
    onClick?: undefined | (() => void);
    placeholder?: undefined | string;
    className?: undefined | string;
    onChange?:
        | undefined
        | ((value: DropdownValue | Array<DropdownValue> | null) => void);
    value?: DropdownOption | undefined;
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
    isMultiSelect?: boolean;
    tabIndex?: number | undefined;
}

const Dropdown: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [value, setValue] = useState<
        DropdownOption | Array<DropdownOption> | null
    >(null);
    const [selectedValue, setSelectedValue] = useState<
        DropdownOption | Array<DropdownOption> | null
    >(null);

    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue);
        }

        if (props.value) {
            setValue(props.value);
        }
    }, []);

    useEffect(() => {
        if (props.value) {
            setValue(props.value ? props.value : null);
        }
    }, [props.value]);

    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue ? props.initialValue : null);
        }
    }, [props.initialValue]);

    useEffect(() => {
        const selectedValues: Array<DropdownOption> = props.options.filter(
            (item: DropdownOption) => {
                if (Array.isArray(value)) {
                    return value
                        .map((v: DropdownOption) => {
                            return v.value;
                        })
                        .includes(item.value);
                }
                return item.value === value?.value;
            }
        );

        let selectedValue: DropdownOption | null = null;

        if (selectedValues.length > 0 && !props.isMultiSelect) {
            selectedValue = selectedValues[0] || null;
        }

        setSelectedValue(props.isMultiSelect ? selectedValues : selectedValue);
        if (value) {
            if (Array.isArray(value)) {
                props.onChange &&
                    props.onChange(
                        (value as Array<DropdownOption>).map(
                            (i: DropdownOption) => {
                                return i.value;
                            }
                        )
                    );
            } else {
                props.onChange &&
                    props.onChange((value as DropdownOption).value);
            }
        }

        if (!value) {
            props.onChange && props.onChange(props.isMultiSelect ? [] : null);
        }
    }, [value]);

    return (
        <div
            className={`${props.className || 'relative mt-2 mb-1 rounded-md shadow-sm w-full'}`}
            onClick={() => {
                props.onClick && props.onClick();
                props.onFocus && props.onFocus();
            }}
        >
            <Select
                onBlur={() => {
                    props.onBlur && props.onBlur();
                }}
                tabIndex={props.tabIndex}
                isMulti={props.isMultiSelect}
                value={selectedValue}
                onFocus={() => {
                    props.onFocus && props.onFocus();
                }}
                isClearable={true}
                isSearchable={true}
                placeholder={props.placeholder}
                options={props.options as any}
                onChange={(option: any | null) => {
                    if (option) {
                        if (props.isMultiSelect) {
                            const value: Array<DropdownOption> =
                                option as Array<DropdownOption>;
                            setValue(value);
                        } else {
                            const value: DropdownOption =
                                option as DropdownOption;
                            setValue(value);
                        }
                    }

                    if (option === null && props.isMultiSelect) {
                        setValue([]);
                    }

                    if (option === null && !props.isMultiSelect) {
                        setValue(null);
                    }
                }}
            />
        </div>
    );
};

export default Dropdown;
