import BarLabel from './BarLabel';
import Color from 'Common/Types/Color';
import React, {
    FunctionComponent,
    MouseEventHandler,
    ReactElement,
    useState,
} from 'react';

export interface GanttChartBar {
    id: string;
    label: string | ReactElement;
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
    areOtherBarsSelected: boolean;
    onSelect: (barId: string) => void;
    onDeselect: (barId: string) => void;
    isSelected?: boolean;
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

    const handleMouseEnter: MouseEventHandler = (): void => {
        setIsHovered(true);
    };

    const handleMouseLeave: MouseEventHandler = (): void => {
        setIsHovered(false);
    };

    let barOpacity: number = 0.9;

    if (props.areOtherBarsSelected && !props.isSelected) {
        barOpacity = 0.5;
    }

    if (isHovered) {
        barOpacity = 1;
    }

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
                    width: `${barWidth}px`,
                    backgroundColor: `${props.bar.barColor.toString()}`,
                    opacity: barOpacity,
                }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onClick={() => {
                    if (props.isSelected) {
                        props.onDeselect(props.bar.id);
                    } else {
                        props.onSelect(props.bar.id);
                    }
                }}
            >
                {isHovered && props.bar.tooltip && (
                    <div className="bar-tooltip cursor-pointer bg-white shadow rounded p-2 w-fit z-40 absolute">
                        {props.bar.tooltip}
                    </div>
                )}
            </div>

            <div
                className="h-8 pt-1 pb-1 mt-2.5 mb-2.5"
                style={{
                    marginLeft: `${barWidth + 15}px`,
                    opacity: barOpacity,
                }}
            >
                <BarLabel label={props.bar.label} />
            </div>
        </div>
    );
};

export default Bar;
