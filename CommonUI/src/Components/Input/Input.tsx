// Tailwind
import { Logger } from '../../Utils/Logger';
import Icon from '../Icon/Icon';
import OneUptimeDate from 'Common/Types/Date';
import IconProp from 'Common/Types/Icon/IconProp';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useRef,
    useState,
} from 'react';

export enum InputType {
    TEXT = 'text',
    NUMBER = 'number',
    DATE = 'date',
    DATETIME_LOCAL = 'datetime-local',
    URL = 'url',
    TIME = 'time',
}

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
    dataTestId?: string | undefined;
    tabIndex?: number | undefined;
    onEnterPress?: (() => void) | undefined;
    error?: string | undefined;
    outerDivClassName?: string | undefined;
    autoFocus?: boolean | undefined;
}

const Input: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let className: string = '';

    if (!props.className) {
        className =
            'block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm';
    } else {
        className = props.className;
    }

    if (props.error) {
        className +=
            ' border-red-300 pr-10 text-red-900 placeholder-red-300 focus:border-red-500 focus:outline-none focus:ring-red-500';
    }

    if (props.disabled) {
        className += ' bg-gray-100 text-gray-500 cursor-not-allowed';
    }

    const [value, setValue] = useState<string>('');
    const [displayValue, setDisplayValue] = useState<string>('');
    const ref: any = useRef<any>(null);

    useEffect(() => {
        if (
            props.type === InputType.DATE ||
            props.type === InputType.DATETIME_LOCAL ||
            props.type === InputType.TIME
        ) {
            if (value && (value as unknown) instanceof Date) {
                let dateString: string = '';
                try {
                    if (props.type === InputType.DATETIME_LOCAL) {
                        dateString = OneUptimeDate.toDateTimeLocalString(
                            value as any
                        );
                    } else if (props.type === InputType.TIME) {
                        // get time from date
                        dateString = OneUptimeDate.toTimeString(value as any);
                    } else {
                        dateString =
                            OneUptimeDate.asDateForDatabaseQuery(value);
                    }
                } catch (e: any) {
                    Logger.error(e);
                }
                setDisplayValue(dateString);
            } else if (value && value.includes && !value.includes(' - ')) {
                // " - " is for InBetween dates.
                const date: Date = OneUptimeDate.fromString(value);
                let dateString: string = '';
                try {
                    if (props.type === InputType.DATETIME_LOCAL) {
                        dateString = OneUptimeDate.toDateTimeLocalString(date);
                    } else if (props.type === InputType.TIME) {
                        // get time from date
                        dateString = OneUptimeDate.toTimeString(value as any);
                    } else {
                        dateString = OneUptimeDate.asDateForDatabaseQuery(date);
                    }
                } catch (err: any) {
                    Logger.error(err);
                }
                setDisplayValue(dateString);
            } else if (!value || (value.includes && !value.includes(' - '))) {
                setDisplayValue('');
            }
        } else {
            setDisplayValue(value);
        }
    }, [value]);

    useEffect(() => {
        const input: any = ref.current;
        if (input) {
            (input as any).value = displayValue;
        }
    }, [ref, displayValue]);

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
        setValue(props.value ? props.value : props.initialValue || '');
    }, [props.value]);

    return (
        <>
            <div
                className={
                    props.outerDivClassName ||
                    `relative mt-2 mb-1 rounded-md shadow-sm w-full`
                }
            >
                <input
                    autoFocus={props.autoFocus}
                    ref={ref}
                    onFocus={props.onFocus}
                    onClick={props.onClick}
                    data-testid={props.dataTestId}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        let value: string | Date = e.target.value;

                        if (
                            (props.type === InputType.DATE ||
                                props.type === InputType.DATETIME_LOCAL ||
                                props.type === InputType.TIME) &&
                            value
                        ) {
                            if (props.type === InputType.TIME) {
                                // conver value like "16:00" to date with local timezone
                                value = OneUptimeDate.getDateWithCustomTime({
                                    hours: parseInt(
                                        value.split(':')[0]?.toString() || '0'
                                    ),
                                    minutes: parseInt(
                                        value.split(':')[1]?.toString() || '0'
                                    ),
                                    seconds: 0,
                                });
                            }

                            const date: Date = OneUptimeDate.fromString(value);
                            const dateString: string =
                                OneUptimeDate.toString(date);
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
                                      props.onEnterPress &&
                                          props.onEnterPress();
                                  }
                              }
                            : undefined
                    }
                    readOnly={props.readOnly || props.disabled || false}
                    type={props.type || 'text'}
                    placeholder={props.placeholder}
                    className={className}
                    onBlur={() => {
                        if (props.onBlur) {
                            props.onBlur();
                        }
                    }}
                />

                {props.error && (
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                        <Icon
                            icon={IconProp.ErrorSolid}
                            className="h-5 w-5 text-red-500"
                        />
                    </div>
                )}
            </div>

            {props.error && (
                <p
                    data-testid="error-message"
                    className="mt-1 text-sm text-red-400"
                >
                    {props.error}
                </p>
            )}
        </>
    );
};

export default Input;
