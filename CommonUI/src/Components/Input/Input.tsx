import Color from 'Common/Types/Color';
import OneUptimeDate from 'Common/Types/Date';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useRef,
    useState,
} from 'react';

export interface ComponentProps {
    initialValue?: undefined | string;
    onClick?: undefined | (() => void);
    placeholder?: undefined | string;
    className?: undefined | string;
    onChange?: undefined | ((value: string) => void);
    value?: string | undefined;
    readOnly?: boolean | undefined;
    type?: 'text' | 'number' | 'date' | 'datetime-local';
    leftCircleColor?: Color | undefined;
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
    dataTestId?: string;
    tabIndex?: number | undefined;
}

const Input: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [value, setValue] = useState<string>('');
    const [displayValue, setDisplayValue] = useState<string>('');
    const ref = useRef(null);

    useEffect(() => {
        const input = ref.current;
        if (input) {
            (input as any).value = displayValue;
        }
    }, [ref, displayValue]);

    useEffect(() => {
        if (props.type === 'date' || props.type === 'datetime-local') {
            if (value && !value.includes(' - ')) {
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
    });

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
        <div
            className={`flex ${props.className}`}
            onClick={() => {
                props.onClick && props.onClick();
                props.onFocus && props.onFocus();
            }}
        >
            {props.leftCircleColor && (
                <div
                    style={{
                        backgroundColor: props.leftCircleColor.toString(),
                        height: '20px',
                        width: '20px',
                        borderRadius: '300px',
                        boxShadow: 'rgb(149 157 165 / 20%) 0px 8px 24px',
                        marginRight: '7px',
                    }}
                ></div>
            )}
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
                //value={displayValue}
                readOnly={props.readOnly || false}
                type={props.type || 'text'}
                placeholder={props.placeholder}
                className="form-control white-background-on-readonly"
                style={{
                    border: 'none',
                    padding: '0px',
                }}
                onBlur={() => {
                    if (props.onBlur) {
                        props.onBlur();
                    }
                }}
            />
        </div>
    );
};

export default Input;
