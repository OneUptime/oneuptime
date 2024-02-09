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
        <div className='timeline-interval h-10' style={{
            width: `${props.timelineInterval.width}`,

        }}>
            <div className='flex-end' style={{
                width: `${props.timelineInterval.width}`,

            }}>
                {props.timelineInterval.intervalCount} {props.timelineInterval.intervalUnit}
            </div>
            {/* timeline */}
        </div>
    );
};

export default TimelineInterval;