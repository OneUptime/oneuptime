import React, { FunctionComponent, ReactElement } from 'react';
import TimelineInterval from './TimelineInterval';

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
    const eachIntervalWidth = 80; // in pixels
    const timelineWidth =
        (props.timeline.end - props.timeline.start) * eachIntervalWidth;

    const numberOfInterval =
        (props.timeline.end - props.timeline.start) / props.timeline.interval;

    return (
        <div
            className="timeline flex h-10"
            style={{
                width: `${timelineWidth}`,
            }}
        >
            {/** Render Timeline Intervals */}
            {Array.from({ length: numberOfInterval }, (_, i) => {
                return (
                    <TimelineInterval
                        key={i}
                        timelineInterval={{
                            width: eachIntervalWidth,
                            intervalUnit: props.timeline.intervalUnit,
                            intervalCount:
                                props.timeline.start +
                                i * props.timeline.interval,
                        }}
                    />
                );
            })}
        </div>
    );
};

export default Timeline;
