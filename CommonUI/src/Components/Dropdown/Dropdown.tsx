import Select from 'react-select'
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

export interface DropdownOption {
    value: string | number;
    label: string;
}

export interface ComponentProps {
    options: Array<DropdownOption>;
    initialValue?: undefined | string;
    onClick?: undefined | (() => void);
    placeholder?: undefined | string;
    className?: undefined | string;
    onChange?: undefined | ((value: string | number) => void);
    value?: string | undefined;
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
}

const Dropdown: FunctionComponent<ComponentProps> = (
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
                onFocus={() => {
                    props.onFocus && props.onFocus()
                }} placeholder={props.placeholder} options={props.options as any} value={value} onChange={(option: string | number | null) => {
                    props.onChange && option && props.onChange(option);
                }} />
        </div>
    );
};

export default Dropdown;
