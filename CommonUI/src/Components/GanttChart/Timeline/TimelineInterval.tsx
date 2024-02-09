import React, { FunctionComponent, ReactElement } from 'react';

export interface GanttChartTimelineInterval {
    width: number;
    intervalUnit: string;
    intervalCount: number;
}

export interface ComponentProps {
    timelineInterval: GanttChartTimelineInterval;
}

const TimelineInterval: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div
            className="timeline-interval h-10"
            style={{
                width: `${props.timelineInterval.width}px`,
            }}
        >
            <div className="timeline-interval h-full flex justify-center border-r-2 border-indigo-600 border-solid">
                {props.timelineInterval.intervalCount}{' '}
                {props.timelineInterval.intervalUnit}
            </div>
        </div>
    );
};

export default TimelineInterval;
