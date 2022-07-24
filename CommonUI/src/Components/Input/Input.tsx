import Color from 'Common/Types/Color';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
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
    type?: string;
    leftCircleColor?: Color | undefined;
    onFocus?: (() => void) | undefined;
    onBlur?: (()=>void) | undefined;
}

const Input: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [value, setValue] = useState<string>('');

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
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setValue(e.target.value);
                    if (props.onChange) {
                        props.onChange(e.target.value);
                    }
                }}
                value={value}
                readOnly={props.readOnly || false}
                type={props.type || 'text'}
                placeholder={props.placeholder}
                className="pointer form-control white-background-on-readonly"
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
