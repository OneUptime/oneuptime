import Color from 'Common/Types/Color';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import { ChromePicker, ColorResult } from 'react-color';
import useComponentOutsideClick from '../../../Types/UseComponentOutsideClick';
import Input from '../../Input/Input';
import Icon from '../../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';

export interface ComponentProps {
    onChange: (value: Color | null) => void;
    initialValue?: undefined | Color;
    placeholder: string;
    onFocus?: (() => void) | undefined;
    tabIndex?: number | undefined;
    value?: string | undefined;
    readOnly?: boolean | undefined;
    disabled?: boolean | undefined;
    onBlur?: (() => void) | undefined;
    dataTestId?: string | undefined;
    onEnterPress?: (() => void) | undefined;
    error?: string | undefined;
}

const ColorPicker: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [color, setColor] = useState<string>('');
    const { ref, isComponentVisible, setIsComponentVisible } =
        useComponentOutsideClick(false);

    useEffect(() => {
        if (props.initialValue) {
            setColor(props.initialValue.toString());
        }
    }, [props.initialValue]);

    const handleChange: Function = (color: string): void => {
        setColor(color);
        if (!color) {
            return props.onChange(null);
        }
        props.onChange(new Color(color));
    };

    return (
        <div>
            <div className="flex block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm">
                <div
                    onClick={() => {
                        if (!props.readOnly) {
                            setIsComponentVisible(!isComponentVisible);
                        }
                    }}
                    className="rounded h-5 w-5 border border-gray-200 cursor-pointer"
                    style={{ backgroundColor: color.toString() }}
                ></div>

                <Input
                    onClick={() => {
                        if (!props.readOnly) {
                            setIsComponentVisible(!isComponentVisible);
                        }
                    }}
                    disabled={props.disabled}
                    dataTestId={props.dataTestId}
                    onBlur={props.onBlur}
                    onEnterPress={props.onEnterPress}
                    className="border-none focus:outline-none w-full pl-2 text-gray-500 cursor-pointer"
                    outerDivClassName='className="border-none focus:outline-none w-full pl-2 text-gray-500 cursor-pointer"'
                    placeholder={props.placeholder}
                    value={color || props.value}
                    readOnly={true}
                    type="text"
                    tabIndex={props.tabIndex}
                    onChange={(value: string) => {
                        if (!value) {
                            return handleChange('');
                        }
                    }}
                    onFocus={props.onFocus || undefined}
                />
                {color && !props.disabled && (
                    <Icon
                        icon={IconProp.Close}
                        className="text-gray-400 h-5 w-5 cursor-pointer hover:text-gray-600"
                        onClick={() => {
                            setColor('#FFFFFF');
                            if (props.onChange) {
                                props.onChange(null);
                            }
                        }}
                    />
                )}
                {isComponentVisible ? (
                    <div
                        ref={ref}
                        style={{
                            position: 'absolute',
                        }}
                    >
                        <ChromePicker
                            color={color}
                            onChange={(color: ColorResult) => {
                                setColor(color.hex);
                            }}
                            onChangeComplete={(color: ColorResult) => {
                                return handleChange(color.hex);
                            }}
                        />
                    </div>
                ) : (
                    <></>
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
        </div>
    );
};

export default ColorPicker;
