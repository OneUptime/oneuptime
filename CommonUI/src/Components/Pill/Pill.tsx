import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';
import { Black } from '../../Utils/BrandColors';

export enum PillSize {
    Small = "10px", 
    Normal = "13px", 
    Large = "15px",
    ExtraLarge = "18px"
}


export interface ComponentProps {
    text: string;
    color: Color;
    size?: PillSize | undefined;
}

const Pill: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    return (
        <span className="rounded-pill badge bg-secondary" style={{
            color: "white",
            backgroundColor: props.color ? props.color.toString() : Black.toString(),
            fontSize: props.size ? props.size.toString() : PillSize.Normal
        }}> {props.text} </span>
    )
}

export default Pill;

