import Color from "Common/Types/Color";
import React, { FunctionComponent, ReactElement, useEffect, useState } from "react";
import { ChromePicker } from 'react-color';
import useComponentOutsideClick from '../../../Types/UseComponentOutsideClick';


export interface ComponentProps {
    onChange: (value: Color) => void;
    initialValue?: undefined | Color;
    placeholder: string;
}

const ColorPicker: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {

    const [color, setColor] = useState<string>("");
    const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

    useEffect(() => {
        if (props.initialValue) {
            setColor(props.initialValue.toString());
        }
    }, [])

    const handleChange = (color: string): void => {
        setColor(color);
        props.onChange(new Color(color));
    };

    return (<div>
        <input placeholder={props.placeholder} className="form-control white-background-on-readonly" value={color} readOnly={true} type="text" onClick={() => {
            setIsComponentVisible(!isComponentVisible);
        }} />
        {isComponentVisible ?
            <div ref={ref}>
                <ChromePicker  color={color} onChange={(color) => {
                    setColor(color.hex);
                }} onChangeComplete={color => handleChange(color.hex)} />
            </div> : <></>}
    </div>)

};


export default ColorPicker;