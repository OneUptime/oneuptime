import React, { FunctionComponent, ReactElement, useState } from 'react';
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
    const [isHovered, setIsHovered] = useState(false);

    // calculate bar width. 
    const barWidth = (props.bar.barTimelineEnd - props.bar.barTimelineStart) / (props.chartTimelineEnd - props.chartTimelineStart) * props.timelineWidth;
    const barLeftPosition = (props.bar.barTimelineStart - props.chartTimelineStart) / (props.chartTimelineEnd - props.chartTimelineStart) * props.timelineWidth;

    const handleMouseEnter = () => {
        setIsHovered(true);
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
    };

    return (
        // rectangle div with curved corners and text inside in tailwindcss
        <div>
            <div
                className="chart-bar h-8 pt-1 pb-1 mt-2.5 mb-2.5 rounded absolute cursor-pointer"
                style={{
                    marginLeft: `${barLeftPosition}px`,
                    width: `${barWidth}px`,
                    backgroundColor: `${props.bar.barColor.toString()}`,
                }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                <BarLabel
                    title={props.bar.title}
                    titleColor={props.bar.titleColor}
                />
                {isHovered && (
                    <div className="bar-tooltip bg-white shadow rounded p-2 w-fit">
                        <div className="bar-tooltip-title text-sm text-gray-700 font-medium">Static Title</div>
                        <div className="bar-tooltip-description text-gray-400 text-xs">Description on hover</div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Bar;
