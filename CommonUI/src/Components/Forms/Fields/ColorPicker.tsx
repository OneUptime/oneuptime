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

export interface ComponentProps {
    onChange: (value: Color | null) => void;
    initialValue?: undefined | Color;
    placeholder: string;
    onFocus?: (() => void) | undefined;
    tabIndex?: number | undefined;
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
            <Input
                leftCircleColor={new Color(color || props.placeholder)}
                placeholder={props.placeholder}
                className="pointer form-control white-background-on-readonly"
                value={color}
                readOnly={true}
                type="text"
                tabIndex={props.tabIndex}
                onClick={() => {
                    setIsComponentVisible(!isComponentVisible);
                }}
                onChange={(value: string) => {
                    if (!value) {
                        return handleChange('');
                    }
                }}
                onFocus={props.onFocus || undefined}
            />
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
    );
};

export default ColorPicker;
