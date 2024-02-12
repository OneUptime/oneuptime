import React, { FunctionComponent, ReactElement } from 'react';
import Color from 'Common/Types/Color';

export interface ComponentProps {
    titleColor: Color;
    title: string;
}

const BarLabel: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        // rectangle div with curved corners and text inside in tailwindcss

        <div
            className="text-center"
            style={{
                color: `${props.titleColor.toString()}`,
            }}
        >
            {props.title}
        </div>
    );
};

export default BarLabel;
