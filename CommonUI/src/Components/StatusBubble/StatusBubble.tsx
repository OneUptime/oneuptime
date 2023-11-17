import { Black } from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';
import React, { CSSProperties, FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    text: string;
    color: Color;
    style?: CSSProperties;
    shouldAnimate: boolean;
}

const Statusbubble: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="flex" style={props.style}>
            <div
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full mr-2 ${
                    props.shouldAnimate ? 'animate-pulse' : ''
                }`}
                style={{
                    backgroundColor: props.color
                        ? props.color.toString()
                        : Black.toString(),
                }}
            ></div>
            <div
                className="text-sm font-medium"
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
