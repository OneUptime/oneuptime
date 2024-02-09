import React, { FunctionComponent, ReactElement } from 'react';
import Color from 'Common/Types/Color';
import BarLabel from './BarLabel';

export interface GanttChartBar {
    id: string;
    title: string;
    titleColor: Color;
    color: Color;
    width: number;
}

export interface ComponentProps {
    bar: GanttChartBar;
}

const Bar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        // rectangle div with curved corners and text inside in tailwindcss

        <div
            className="h-10 rounded"
            style={{
                width: `${props.bar.width}`,
                backgroundColor: `${props.bar.color}`,
            }}
        >
            <BarLabel
                title={props.bar.title}
                titleColor={props.bar.titleColor}
            />
        </div>
    );
};

export default Bar;
