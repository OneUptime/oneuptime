import React, {
    FunctionComponent,
    MouseEventHandler,
    ReactElement,
    useState,
} from 'react';
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
    tooltip?: ReactElement;
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
    let barWidth: number =
        ((props.bar.barTimelineEnd - props.bar.barTimelineStart) /
            (props.chartTimelineEnd - props.chartTimelineStart)) *
        props.timelineWidth;
    const barLeftPosition: number =
        ((props.bar.barTimelineStart - props.chartTimelineStart) /
            (props.chartTimelineEnd - props.chartTimelineStart)) *
        props.timelineWidth;

    if (barWidth > 1) {
        barWidth -= 1; // we do this because the bar width is calculated based on the timeline width, and we want to remove 1px from the width to account for the 1px margin on the left and right of the bar.
    }

    if (barWidth < 5) {
        barWidth = 5;
    }

    const eachCharacterWidth: number = 8;
    const showLabelOutsideBar: boolean =
        barWidth < props.bar.title.length * eachCharacterWidth;

    const handleMouseEnter: MouseEventHandler = (): void => {
        setIsHovered(true);
    };

    const handleMouseLeave: MouseEventHandler = (): void => {
        setIsHovered(false);
    };

    return (
        // rectangle div with curved corners and text inside in tailwindcss
        <div
            className="flex absolute"
            style={{
                marginLeft: `${barLeftPosition}px`,
            }}
        >
            <div
                className="chart-bar h-8 pt-1 pb-1 mt-2.5 mb-2.5 rounded absolute cursor-pointer ml-1 mr-1"
                style={{
                    marginLeft: `${barLeftPosition}px`,
                    width: `${barWidth}px`,
                    backgroundColor: `${props.bar.barColor.toString()}`,
                }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {!showLabelOutsideBar && (
                    <BarLabel
                        title={props.bar.title}
                        titleColor={props.bar.titleColor}
                    />
                )}
                {isHovered && props.bar.tooltip && (
                    <div className="bar-tooltip bg-white shadow rounded p-2 w-fit z-40 absolute">
                        {props.bar.tooltip}
                    </div>
                )}
            </div>
            {showLabelOutsideBar && (
                <div
                    className="h-8 pt-1 pb-1 mt-2.5 mb-2.5"
                    style={{
                        marginLeft: `${barLeftPosition + barWidth + 10}px`,
                    }}
                >
                    <BarLabel
                        title={props.bar.title}
                        titleColor={props.bar.barColor}
                    />
                </div>
            )}
        </div>
    );
};

export default Bar;
