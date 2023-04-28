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
        DropdownOption | Array<DropdownOption> | undefined
    >(props.initialValue);

    useEffect(() => {
        if (props.value) {
            setValue(props.value ? props.value : undefined);
        }
    }, [props.value]);

    return (
        <div
            className={`${
                props.className || 'relative mt-2 mb-1 rounded-md w-full'
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
                value={value}
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

                            props.onChange &&
                                props.onChange(
                                    value.map(i => {
                                        return i.value;
                                    })
                                );
                        } else {
                            const value: DropdownOption =
                                option as DropdownOption;
                            setValue(value);
                            props.onChange && props.onChange(value.value);
                        }
                    }

                    if (option === null && props.isMultiSelect) {
                        setValue([]);
                        props.onChange && props.onChange([]);
                    }

                    if (option === null && !props.isMultiSelect) {
                        setValue(undefined);
                        props.onChange && props.onChange(null);
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
