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
    eachIntervalWidth: number;
}

const Timeline: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const numberOfInterval: number =
        (props.timeline.end - props.timeline.start) / props.timeline.interval;

    return (
        <div className="timeline flex h-5 border-b-2 border-l-2 border-gray-400 w-full">
            <div className="w-1/4">{/** Row Category Spacer  */}</div>

            {/** Render Timeline Intervals */}
            {Array.from(
                { length: numberOfInterval },
                (_: number, i: number) => {
                    return (
                        <TimelineInterval
                            key={i}
                            timelineInterval={{
                                width: props.eachIntervalWidth,
                                intervalUnit: props.timeline.intervalUnit,
                                intervalCount:
                                    props.timeline.start +
                                    (i + 1) * props.timeline.interval,
                            }}
                        />
                    );
                }
            )}
        </div>
    );
};

export default Timeline;
