import Color from 'Common/Types/Color';
import React, { CSSProperties, FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    text: string;
    color: Color;
    style?: CSSProperties;
}

const Statusbubble: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="flex" style={props.style}>
            <div
                className="small-circle margin-5"
                style={{
                    backgroundColor: props.color.toString(),
                }}
            ></div>
            <div
                className="bold margin-5"
                style={{
                    color: props.color.toString(),
                }}
            >
                {props.text}
            </div>
        </div>
    );
};

export default Statusbubble;
