import ObjectID from 'Common/Types/ObjectID';
import React, {
    FunctionComponent,
    ReactElement,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import Select, { ControlProps, GroupBase, OptionProps } from 'react-select';

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
    value?: DropdownOption | Array<DropdownOption> | undefined;
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
    isMultiSelect?: boolean;
    tabIndex?: number | undefined;
    error?: string | undefined;
    id?: string | undefined;
    dataTestId?: string | undefined;
}

const Dropdown: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    type GetDropdownOptionFromValueFunctionProps =
        | undefined
        | DropdownValue
        | DropdownOption
        | Array<DropdownOption>
        | Array<DropdownValue>;

    type GetDropdownOptionFromValueFunction = (
        value: GetDropdownOptionFromValueFunctionProps
    ) => DropdownOption | Array<DropdownOption> | undefined;

    const getDropdownOptionFromValue: GetDropdownOptionFromValueFunction = (
        value: GetDropdownOptionFromValueFunctionProps
    ): DropdownOption | Array<DropdownOption> | undefined => {
        if (value === undefined) {
            return undefined;
        }

        if (value instanceof ObjectID) {
            value = value.toString();
        }

        if (
            Array.isArray(value) &&
            value.length > 0 &&
            Object.keys(value[0]!).includes('value')
        ) {
            return value as Array<DropdownOption>;
        }

        if (
            Array.isArray(value) &&
            value.length > 0 &&
            typeof value[0] === 'string'
        ) {
            const options: Array<DropdownOption> = [];

            for (const item of value as Array<DropdownValue>) {
                if (
                    (!Array.isArray(item) && typeof item === 'string') ||
                    typeof item === 'number'
                ) {
                    const option:
                        | DropdownOption
                        | undefined
                        | Array<DropdownOption> = props.options.find(
                        (option: DropdownOption) => {
                            return option.value === item;
                        }
                    ) as DropdownOption | Array<DropdownOption>;

                    if (option) {
                        options.push(option as DropdownOption);
                    }
                }
            }

            return options;
        }

        if (
            (!Array.isArray(value) && typeof value === 'string') ||
            typeof value === 'number'
        ) {
            return props.options.find((option: DropdownOption) => {
                return option.value === value;
            }) as DropdownOption | Array<DropdownOption>;
        }

        return value as DropdownOption | Array<DropdownOption>;
    };

    const [value, setValue] = useState<
        DropdownOption | Array<DropdownOption> | undefined
    >(getDropdownOptionFromValue(props.initialValue));

    const firstUpdate: React.MutableRefObject<boolean> = useRef(true);

    useLayoutEffect(() => {
        if (firstUpdate.current && props.initialValue) {
            firstUpdate.current = false;
            return;
        }

        const value: DropdownOption | Array<DropdownOption> | undefined =
            getDropdownOptionFromValue(
                props.value === null ? undefined : props.value
            );

        setValue(value);
    }, [props.value]);

    return (
        <div
            id={props.id}
            className={`${
                props.className ||
                'relative mt-2 mb-1 rounded-md w-full overflow-visible'
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
                data-testid={props.dataTestId}
                tabIndex={props.tabIndex}
                isMulti={props.isMultiSelect}
                value={value || null}
                onFocus={() => {
                    props.onFocus && props.onFocus();
                }}
                classNames={{
                    control: (
                        state: ControlProps<any, boolean, GroupBase<any>>
                    ): string => {
                        return state.isFocused
                            ? '!border-indigo-500'
                            : 'border-Gray500-300';
                    },
                    option: (
                        state: OptionProps<any, boolean, GroupBase<any>>
                    ): string => {
                        if (state.isDisabled) {
                            return 'bg-gray-100';
                        }
                        if (state.isSelected) {
                            return '!bg-indigo-500';
                        }
                        if (state.isFocused) {
                            return '!bg-indigo-100';
                        }
                        return '';
                    },
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
                                    value.map((i: DropdownOption) => {
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
