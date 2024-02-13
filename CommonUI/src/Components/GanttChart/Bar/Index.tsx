import React, { FunctionComponent, ReactElement } from 'react';
import Color from 'Common/Types/Color';
import BarLabel from './BarLabel';

export interface GanttChartBar {
    id: string;
    title: string;
    titleColor: Color;
    barColor: Color;
    barTimelineStart: number;
    barTimelineEnd: number; 
    rowId: string;
}

export interface ComponentProps {
    bar: GanttChartBar;
    chartTimelineStart: number; 
    chartTimelineEnd: number;
    timelineWidth: number; 
}

const Bar: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    // calculate bar width. 
    const barWidth = (props.bar.barTimelineEnd - props.bar.barTimelineStart) / (props.chartTimelineEnd - props.chartTimelineStart) * props.timelineWidth;
    const barLeftPosition = (props.bar.barTimelineStart - props.chartTimelineStart) / (props.chartTimelineEnd - props.chartTimelineStart) * props.timelineWidth;


    return (
        // rectangle div with curved corners and text inside in tailwindcss

        <div
            className="chart-bar h-8 pt-1 pb-1 mt-2.5 mb-2.5 rounded"
            style={{
                marginLeft: `${barLeftPosition}px`,
                width: `${barWidth}px`,
                backgroundColor: `${props.bar.barColor.toString()}`,
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
