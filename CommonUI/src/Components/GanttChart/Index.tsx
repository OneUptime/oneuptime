import React, { FunctionComponent, ReactElement } from 'react';
import Timeline, { GanttChartTimeline } from './Timeline/Timeline';
import { GanttChartRow } from './Row/Index';

export interface GanttChartProps {
    id: string;
    containerWidth: number;
    rows: GanttChartRow[];
    timeline: GanttChartTimeline;
}

export interface ComponentProps {
    chart: GanttChartProps;
}

const GanttChart: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let chartWidth: number = props.chart.containerWidth;
    const eachIntervalDefaultWidth: number = 100; // in pixels
    let eachIntervalWidth: number = eachIntervalDefaultWidth;
    const numberOfInterval: number =
        (props.chart.timeline.end - props.chart.timeline.start) /
        props.chart.timeline.interval;
    const totalIntervalWidth: number =
        eachIntervalDefaultWidth * numberOfInterval;

    if (chartWidth < totalIntervalWidth) {
        chartWidth = totalIntervalWidth;
    } else {
        eachIntervalWidth = chartWidth / numberOfInterval;
    }

    return (
        <div
            style={{
                width: `${chartWidth}px`,
            }}
        >
            <Timeline
                timeline={props.chart.timeline}
                eachIntervalWidth={eachIntervalWidth}
                timelineWidth={chartWidth}
            />
        </div>
    );
};

export default GanttChart;
