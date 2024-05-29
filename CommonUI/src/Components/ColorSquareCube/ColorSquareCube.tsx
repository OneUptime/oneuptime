import Tooltip from '../Tooltip/Tooltip';
import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    color: Color;
    tooltip: string;
}

const ColorSquareCube: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Tooltip text={props.tooltip}>
            <div
                className="rounded h-3 w-3"
                style={{
                    backgroundColor: props.color.toString(),
                }}
            ></div>
        </Tooltip>
    );
};

export default ColorSquareCube;
