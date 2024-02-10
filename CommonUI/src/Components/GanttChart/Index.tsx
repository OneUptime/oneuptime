import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import Timeline, { GanttChartTimeline } from './Timeline/Index';
import { GanttChartRow } from './Row/Index';
import ChartContainer from './ChartContainer';
import { GanttChartBar } from './Bar/Index';
import Rows from './Rows';

export interface GanttChartProps {
    id: string;
    rows: GanttChartRow[];
    bars: GanttChartBar[];
    timeline: GanttChartTimeline;
}

export interface ComponentProps {
    chart: GanttChartProps;
}

const GanttChart: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const eachIntervalDefaultWidth: number = 100; // in pixels

    const [chartWidth, setChartWidth] = React.useState<number>(0);

    const [eachIntervalWidth, setEachIntervalWidth] = React.useState<number>(
        eachIntervalDefaultWidth
    );

    const numberOfInterval: number =
        (props.chart.timeline.end - props.chart.timeline.start) /
        props.chart.timeline.interval;

    const totalIntervalWidth: number =
        eachIntervalDefaultWidth * numberOfInterval;

    useEffect(() => {
        if (chartWidth < totalIntervalWidth) {
            setChartWidth(totalIntervalWidth);
        } else {
            setEachIntervalWidth(chartWidth / numberOfInterval);
        }
    }, [chartWidth]);

    return (
        <ChartContainer
            onWidthChange={(width: number) => {
                setChartWidth(width);
            }}
        >
            <div
                style={{
                    width: `${chartWidth}px`,
                }}
            >
                <Timeline
                    timeline={props.chart.timeline}
                    eachIntervalWidth={eachIntervalWidth}
                />

                <Rows rows={props.chart.rows} bars={props.chart.bars} />
            </div>
        </ChartContainer>
    );
};

export default GanttChart;
