
// Tailwind

import OneUptimeDate from 'Common/Types/Date';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useRef,
    useState,
} from 'react';

export type InputType = 'text' | 'number' | 'date' | 'datetime-local' | 'url';

export interface ComponentProps {
    initialValue?: undefined | string;
    onClick?: undefined | (() => void);
    placeholder?: undefined | string;
    className?: undefined | string;
    onChange?: undefined | ((value: string) => void);
    value?: string | undefined;
    readOnly?: boolean | undefined;
    disabled?: boolean | undefined;
    type?: InputType;
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
    dataTestId?: string;
    tabIndex?: number | undefined;
    onEnterPress?: (() => void) | undefined;
}

const Input: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [value, setValue] = useState<string>('');
    const [displayValue, setDisplayValue] = useState<string>('');
    const ref: any = useRef<any>(null);

    useEffect(() => {
        const input: any = ref.current;
        if (input) {
            (input as any).value = displayValue;
        }
    }, [ref, displayValue]);


    useEffect(() => {
        if (props.type === 'date' || props.type === 'datetime-local') {
            if (value && (value as unknown) instanceof Date) {
                let dateString: string = '';
                if (props.type === 'datetime-local') {
                    dateString = OneUptimeDate.toDateTimeLocalString(
                        value as any
                    );
                } else {
                    dateString = OneUptimeDate.asDateForDatabaseQuery(value);
                }
                setDisplayValue(dateString);
            } else if (value && !value.includes(' - ')) {
                // " - " is for InBetween dates.
                const date: Date = OneUptimeDate.fromString(value);
                let dateString: string = '';
                if (props.type === 'datetime-local') {
                    dateString = OneUptimeDate.toDateTimeLocalString(date);
                } else {
                    dateString = OneUptimeDate.asDateForDatabaseQuery(date);
                }
                setDisplayValue(dateString);
            } else if (!value.includes(' - ')) {
                setDisplayValue('');
            }
        } else {
            setDisplayValue(value);
        }
    }, [value]);

    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue);
        }

        if (props.value) {
            setValue(props.value);
        }
    }, []);

    useEffect(() => {
        if (props.initialValue) {
            setValue(props.initialValue);
        }
    }, [props.initialValue]);

    useEffect(() => {
        setValue(props.value ? props.value : '');
    }, [props.value]);

    return (
        <input
            autoFocus={true}
            ref={ref}
            data-testid={props.dataTestId}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const value: string = e.target.value;

                if (
                    (props.type === 'date' ||
                        props.type === 'datetime-local') &&
                    value
                ) {
                    const date: Date = OneUptimeDate.fromString(value);
                    const dateString: string = OneUptimeDate.toString(date);
                    setValue(dateString);
                    if (props.onChange) {
                        props.onChange(dateString);
                    }
                } else {
                    setValue(value);
                    if (props.onChange) {
                        props.onChange(value);
                    }
                }
            }}
            tabIndex={props.tabIndex}
            onKeyDown={
                props.onEnterPress
                    ? (event: any) => {
                        if (event.key === 'Enter') {
                            props.onEnterPress && props.onEnterPress();
                        }
                    }
                    : undefined
            }
            readOnly={props.readOnly || props.disabled || false}
            type={props.type || 'text'}
            placeholder={props.placeholder}
            className={props.className}
            onBlur={() => {
                if (props.onBlur) {
                    props.onBlur();
                }
            }}
        />
    );
};

export default Input;
