import React, { FunctionComponent, ReactElement } from 'react';

export interface GanttChartTimelineIntervalMarks {
    numberOfMarks: number;
    widthOfEachMark: number;
}


export interface ComponentProps {
    timelineIntervalMarks: GanttChartTimelineIntervalMarks;
}

const TimelineInterval: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    return (
        <div className='timeline-interval-marks h-10 flex' style={{
            width: `${props.timelineIntervalMarks.widthOfEachMark * props.timelineIntervalMarks.numberOfMarks}`,

        }}>
            {Array.from({ length: props.timelineIntervalMarks.numberOfMarks }, (_, i) => (
                <div key={i} className='h-10 border-right' style={{
                    width: `${props.timelineIntervalMarks.widthOfEachMark}`,
                }}>
                   
                </div>
            ))}
        </div>
    );
};

export default TimelineInterval;