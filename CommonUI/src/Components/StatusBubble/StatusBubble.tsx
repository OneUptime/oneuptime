import { Black } from 'Common/Types/BrandColors';
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
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full mr-2"
                style={{
                    backgroundColor: props.color
                        ? props.color.toString()
                        : Black.toString(),
                }}
            ></div>
            <div
                className="font-bold"
                style={{
                    color: props.color
                        ? props.color.toString()
                        : Black.toString(),
                }}
            >
                {props.text}
            </div>
        </div>
    );
};

export default Statusbubble;
