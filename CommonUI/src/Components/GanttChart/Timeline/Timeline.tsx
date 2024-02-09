import React, { FunctionComponent, ReactElement } from 'react';

export interface GanttChartTimeline { 
    start: number; 
    end: number;
    interval: number;
    intervalUnit: string;
}


export interface ComponentProps {
    timeline: GanttChartTimeline;
}

const Timeline: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const eachIntervalWidth = 20; // in pixels
    const timelineWidth = (props.timeline.end - props.timeline.start) * eachIntervalWidth;

    return (
        <div className='timeline h-10' style={{
            width: `${timelineWidth}`,
        
        }}>
            {/* timeline */}
        </div>
    );
};

export default Timeline;