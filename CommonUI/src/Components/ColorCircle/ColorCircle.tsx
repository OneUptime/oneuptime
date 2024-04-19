import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';
import Tooltip from '../Tooltip/Tooltip';

export interface ComponentProps {
    color: Color;
    tooltip: string;
}

const ColorCircle: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Tooltip text={props.tooltip}>
            <div
                className="rounded-full h-3 w-3"
                style={{
                    backgroundColor: props.color.toString(),
                }}
            ></div>
        </Tooltip>
    );
};

export default ColorCircle;
