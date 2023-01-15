import { Grey } from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Icon, { IconProp } from '../Icon/Icon';
import Input from './Input';

export interface ComponentProps {
    initialValue?: undefined | string;
    onClick?: undefined | (() => void);
    placeholder?: undefined | string;
    className?: undefined | string;
    onChange?: undefined | ((value: string) => void);
    value?: string | undefined;
    readOnly?: boolean | undefined;
    disabled?: boolean | undefined;
    leftCircleColor?: Color | undefined;
    onFocus?: (() => void) | undefined;
    onBlur?: (() => void) | undefined;
    dataTestId?: string;
    tabIndex?: number | undefined;
    onEnterPress?: (() => void) | undefined;
}

const ColorInput: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [value, setValue] = useState<string>('');
    const [color, setColor] = useState<string | null>(null);

    useEffect(() => {
        if (props.leftCircleColor) {
            setColor(props.leftCircleColor.toString());
        }
    }, [props.leftCircleColor]);

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
            {color && (
                <div
                    style={{
                        backgroundColor: color.toString(),
                        height: '20px',
                        borderWidth: '1px',
                        borderColor: Grey.toString(),
                        width: '20px',
                        borderRadius: '300px',
                        boxShadow: 'rgb(149 157 165 / 20%) 0px 8px 24px',
                        marginRight: '7px',
                        borderStyle: 'solid',
                    }}
                ></div>
            )}
            <Input {...props} value={value} />
            {color && !props.disabled && (
                <Icon
                    icon={IconProp.Close}
                    className="h-3 w-3"
                    onClick={() => {
                        setValue('');
                        setColor('#000000');
                        if (props.onChange) {
                            props.onChange('');
                        }
                    }}
                />
            )}
        </div>
    );
};

export default ColorInput;
