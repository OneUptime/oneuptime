import Select from 'react-select';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import ArrayUtil from "Common/Types/ArrayUtil";

export type DropdownValue = string | number | boolean;

export interface DropdownOption {
    value: DropdownValue;
    label: string;
}

export interface ComponentProps {
    options: Array<DropdownOption>;
    initialValue?: undefined | DropdownOption | Array<DropdownOption>;
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
    error?: string | undefined;
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


    const [initialValueSet, setInitialValueSet] = useState<DropdownOption | Array<DropdownOption> | undefined>(undefined);

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

        if(Array.isArray(initialValueSet) || Array.isArray(props.initialValue)){
            if(!ArrayUtil.isEqual(Array.isArray(initialValueSet) ? initialValueSet : [], Array.isArray(props.initialValue) ? props.initialValue : [])){
                setValue(props.initialValue || null);
            }
        }else if (initialValueSet !== props.initialValue) {
            setValue(props.initialValue || null);
        }

        setInitialValueSet(props.initialValue);
    }, [props.initialValue]);

    useEffect(() => {

        // translate from string array or string value to value. 
        let dropdownValue: DropdownOption | Array<DropdownOption> | null = value;

        if (typeof value === "string") {
            dropdownValue = props.options.find((i) => i.value === value) || null;
        }

        if (Array.isArray(value)) {

            const items: Array<DropdownOption> = []

            for (const item of value) {
                if (typeof item === "string") {
                    const tempItem: DropdownOption | Array<DropdownOption> | null = props.options.find((i) => i.value === item) || null;

                    if (tempItem) {
                        items.push(tempItem);
                    }
                } else {
                    items.push(item)
                }
            }

            dropdownValue = [...items];
        }



        const selectedValues: Array<DropdownOption> = props.options.filter(
            (item: DropdownOption) => {
                if (Array.isArray(dropdownValue)) {
                    return dropdownValue
                        .map((v: DropdownOption) => {
                            return v.value;
                        })
                        .includes(item.value);
                }
                return item.value === dropdownValue?.value;
            }
        );

        let selectedValue: DropdownOption | null = null;

        if (selectedValues.length > 0 && !props.isMultiSelect) {
            selectedValue = selectedValues[0] || null;
        }

        setSelectedValue(props.isMultiSelect ? selectedValues : selectedValue);
        if (dropdownValue) {
            if (Array.isArray(dropdownValue)) {
                props.onChange &&
                    props.onChange(
                        (dropdownValue as Array<DropdownOption>).map(
                            (i: DropdownOption) => {
                                return i.value;
                            }
                        )
                    );
            } else {
                props.onChange &&
                    props.onChange((dropdownValue as DropdownOption).value);
            }
        }

        if (!dropdownValue) {
            props.onChange && props.onChange(props.isMultiSelect ? [] : null);
        }
    }, [value]);

    return (
        <div
            className={`${props.className ||
                'relative mt-2 mb-1 rounded-md w-full'
                }`}
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
            {props.error && (
                <p
                    data-testid="error-message"
                    className="mt-1 text-sm text-red-400"
                >
                    {props.error}
                </p>
            )}
        </div>
    );
};

export default Dropdown;
