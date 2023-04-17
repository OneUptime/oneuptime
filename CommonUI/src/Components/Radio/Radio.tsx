import React, { FunctionComponent, ReactElement } from 'react';
import { DropdownOption, DropdownValue } from '../Dropdown/Dropdown';
import Text from 'Common/Types/Text';

export interface RadioOption extends DropdownOption { }

export type RadioValue = DropdownValue;

export interface ComponentProps {
    options: Array<RadioOption>;
    initialValue?: undefined | RadioOption | Array<RadioOption>;
    placeholder?: undefined | string;
    className?: undefined | string;
    onChange?:
    | undefined
    | ((value: RadioValue | Array<RadioValue> | null) => void);
    value?: RadioOption | undefined;
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
    tabIndex?: number | undefined;
    error?: string | undefined;
}

const Radio: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const groupName = Text.generateRandomText();

    return (
        <div className={`mt-2 space-y-2 ${props.className}`}>

            {props.options.map((option: RadioOption, index: number) => {
                return (<div key={index} className="flex items-center gap-x-3">
                    <input tabIndex={props.tabIndex} onClick={() => {
                        props.onChange && props.onChange(option.value);
                        props.onBlur && props.onBlur();
                        props.onFocus && props.onFocus();

                    }} name={groupName} type="radio" className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-600" />
                    <label className="block text-sm font-medium leading-6 text-gray-900">{option.label}</label>
                </div>)
            })}

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

export default Radio;
