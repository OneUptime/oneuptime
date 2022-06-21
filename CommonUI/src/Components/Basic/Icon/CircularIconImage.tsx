import Color from "Common/Types/Color";
import React, { ReactElement } from "react";
import Icon, { IconProp } from "./Icon";

export interface ComponentProps {
    backgroundColor?: Color,
    icon: IconProp
}

const CircularIconImage = (props: ComponentProps): ReactElement => {
    return (<div className="me-3 rounded-circle avatar-sm" style={{ backgroundColor: props.backgroundColor ? props.backgroundColor.toString(): "black" }}>
        <Icon icon={props.icon} />
    </div>)
}

export default CircularIconImage;